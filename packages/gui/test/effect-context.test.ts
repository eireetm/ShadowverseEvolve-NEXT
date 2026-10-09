import { describe, expect, it, vi } from "vitest";
import { ALL_AUTO_RESOLVABLE, createEngine, script, randomAnswer, seedRng, type Input, type GameSession, type PlayerId } from "@sve/core";
import { ALL_CARDS, ALL_SCRIPTS } from "@sve/core/sets";
import { drive, testFollower } from "@sve/core/testing";
import { Catalog } from "../src/app/catalog";
import { displayAbilityText } from "../src/game/card/ability-display";
import { abilitySource, GRANT_TEXT } from "../src/presentation/ability-source";
import { EffectContextObserver, observePresentationEngine } from "../src/presentation/effect-context";
import { createPresentationHost } from "../src/presentation/host";
import { firstPlayerOf, GameHost, stateHash } from "../src/engine/game-host";
import bp11Replay from "./fixtures/bp11-070-context.json";
import type { FromWorker as EngineMessage, GameOptions, ToWorker } from "../src/engine/protocol";
import type { FromWorker, GameUpdate } from "../src/presentation/protocol";

const flow = { ...testFollower("FLOW", 0, 1, 8), text: {
  en: "At the start of your end phase, discard a card: Choose one of the following.\n(1) Select an enemy follower. Bury this card, then your opponent discards a card.\n(2) Draw a card.",
  ja: "自分のエンドフェイズが来たとき、手札1枚を捨てる：チョイスする。\n【1】相手のフォロワーを選ぶ。これを墓場に置き、相手は手札1枚を捨てる。\n【2】1枚引く。",
  cn: "当自己的结束阶段到来时，舍弃1张手牌：抉择。\n【1】选择敌方的从者。将这张卡置入墓场，然后对手舍弃1张手牌。\n【2】抽取1张卡。",
} };
const discardTrigger = script.whenYouDiscard({
  *resolve(fx) { yield* fx.choose([{ id: "new-a", label: "New A" }, { id: "new-b", label: "New B" }]); },
}, () => true);
const discardActivation = script.activated({ custom: { canPay: (g, p) => g.cards(p, "hand").length > 0,
  *pay(fx) { yield* fx.discard(fx.controller, 1, 1); } } }, {
  *resolve(fx) { yield* fx.choose([{ id: "old-a", label: "Old A" }, { id: "old-b", label: "Old B" }]); },
});
const engine = createEngine({ cards: [...ALL_CARDS, flow, testFollower("PLAIN", 0, 1, 8), testFollower("SKIP", 0, 1, 8), testFollower("PRIVATE", 0, 1, 8), testFollower("NESTED", 0, 1, 8),
  ...["SELF", "ACTIVE", "WATCHER", "CASTER", "DONE"].map((id) => testFollower(id, 0, 1, 8)),
  { ...testFollower("DELAY", 0, 1, 8), text: { en: "{[fanfare]} Set up a delayed ability.\nAt the start of your end phase, choose an option.", ja: null, cn: null } }], scripts: {
  ...ALL_SCRIPTS,
  SELF: script.defineCard({ abilities: [discardActivation, discardTrigger] }),
  ACTIVE: script.defineCard({ abilities: [discardActivation] }),
  WATCHER: script.defineCard({ abilities: [discardTrigger] }),
  DONE: script.defineCard({ abilities: [script.atStartOfYourEndPhase({ *resolve() {} })] }),
  CASTER: script.defineCard({ abilities: [script.atStartOfYourEndPhase({ *resolve(fx) {
    yield* fx.playCard(fx.game.cards(fx.controller, "hand")[0]!);
    yield* fx.choose([{ id: "outer-a", label: "Outer A" }, { id: "outer-b", label: "Outer B" }]);
  } })] }),
  FLOW: script.defineCard({ abilities: [script.atStartOfYourEndPhase({
    cost: { canPay: (g, p) => g.cards(p, "hand").length > 0, *pay(fx) { yield* fx.discard(fx.controller, 1, 1); } },
    modes: [
      { id: "take", label: "Take", targets: [{ count: 1, candidates: (g, p) => g.followers(g.opponent(p)) }], *resolve(fx) { yield* fx.bury([fx.self]); yield* fx.discard(fx.game.opponent(fx.controller), 1, 1); } },
      { id: "draw", label: "Draw", *resolve(fx) { yield* fx.draw(1); } },
    ],
  })] }),
  SKIP: script.defineCard({ abilities: [script.atStartOfYourEndPhase({ condition: () => false, *resolve() {} })] }),
  PRIVATE: script.defineCard({ abilities: [{ ...script.atStartOfYourEndPhase({
    *resolve(fx) { yield* fx.chooseCards(fx.game.cards(1, "hand"), 1, 1, 1); },
  }), validIn: ["hand"] }] }),
  NESTED: script.defineCard({ abilities: [script.atStartOfYourEndPhase({
    *resolve(fx) { yield* fx.driveCheck(fx.self); yield* fx.choose([{ id: "a", label: "A" }, { id: "b", label: "B" }]); },
  })] }),
  DELAY: script.defineCard({ abilities: [
    script.fanfare({ *resolve(fx) { yield* fx.delay(1, "endOfTurn"); } }),
    { ...script.atStartOfYourEndPhase({ *resolve(fx) { yield* fx.choose([{ id: "a", label: "A" }, { id: "b", label: "B" }]); } }), delayed: true },
  ] }),
} });
const catalog = new Catalog(engine.db.all().map((card) => ({ ...card, status: engine.implementationStatus(card.id) })));

function track(game: GameSession) {
  const observer = new EffectContextObserver(engine, game);
  const presentation = (perspective: PlayerId = game.decision?.player ?? 0) => observer.presentation({ perspective, view: game.view(perspective),
    decision: game.decision ? { decision: game.decision, cards: {}, abilities: {} } : null });
  return { observer, presentation, context: () => presentation().effectContext,
    act: (answer: Input, from?: PlayerId) => observer.act(answer, from, () => game.act(answer, from)) };
}

function flowGame(count = 2) {
  return drive(engine, { me: { field: Array(count).fill("FLOW"), hand: ["PLAIN", "PLAIN"], deck: Array(20).fill("PLAIN") },
    opp: { field: ["PLAIN", "PLAIN"], hand: ["PLAIN", "PLAIN"], deck: Array(20).fill("PLAIN") } });
}

function mainAction(t: ReturnType<typeof drive>, h: ReturnType<typeof track>, type: "play" | "activate" | "evolve", def: string) {
  const decision = t.game.decision;
  if (decision?.type !== "mainPhase") throw new Error("expected mainPhase");
  const action = decision.actions.find((a) => a.type === type && "card" in a && t.game.state.cards[a.card]?.def === def);
  if (!action) throw new Error(`missing ${type} ${def}`);
  return h.act({ type: "mainPhase", action });
}

describe("activated, spell and card play presentation", () => {
  it.each(["SELF", "ACTIVE"])("keeps %s's activated cost trigger waiting until the old effect finishes", (def) => {
    const t = drive(engine, { me: { field: def === "SELF" ? [def] : [def, "WATCHER"], hand: ["PLAIN", "PLAIN"] } });
    const h = track(t.game);
    mainAction(t, h, "activate", def);
    expect(t.decision).toMatchObject({ type: "selectCards", reason: "discard" });
    h.act({ type: "selectCards", cards: [t.id("PLAIN@hand")] });
    expect(t.decision).toMatchObject({ type: "choose", options: [{ id: "old-a" }, { id: "old-b" }] });
    expect(t.game.state.pending).toHaveLength(1);
    expect(h.context()).toMatchObject({ sourceDef: def, kind: "activated" });
    h.act({ type: "choose", ids: ["old-a"] });
    expect(t.decision).toMatchObject({ type: "choose", options: [{ id: "new-a" }, { id: "new-b" }] });
    expect(h.context()).toMatchObject({ sourceDef: def === "SELF" ? def : "WATCHER", kind: "automatic" });
  });

  it("identifies a nested card before cardPlayed and clears it at its real resolution boundary", () => {
    const t = drive(engine, { me: { field: ["CASTER"], hand: ["BP21-026"], playPoints: 10, deck: Array(10).fill("PLAIN") } });
    const h = track(t.game);
    h.act({ type: "mainPhase", action: { type: "endMainPhase" } });
    expect(t.decision).toMatchObject({ type: "choose", reason: "playOption" });
    expect(h.context()).toMatchObject({ kind: "spell", sourceDef: "BP21-026" });
    h.act({ type: "choose", ids: ["normal"] });
    expect(h.context()).toMatchObject({ kind: "spell", sourceDef: "BP21-026" });
    h.act({ type: "choose", ids: ["amelia"] });
    expect(t.decision).toMatchObject({ type: "choose", options: [{ id: "outer-a" }, { id: "outer-b" }] });
    expect(h.context()).toBeNull(); // No guessed outer restoration.
  });

  it("leaves damageOrder options and display without new ability context", () => {
    const spec = { me: { hand: ["BP06-080"], field: [{ card: "BP06-073", evolvedInto: "BP06-074" }] }, opp: { field: ["PLAIN", "BP02-004"] } };
    const t = drive(engine, spec);
    const h = track(t.game);
    mainAction(t, h, "play", "BP06-080");
    expect(h.context()?.timing).toBe("fanfare");
    h.act({ type: "selectCards", cards: [t.id("opp:PLAIN")] });
    expect(t.decision).toMatchObject({ type: "choose", reason: "damageOrder", player: 1 });
    expect(t.decision?.type === "choose" && t.decision.options.map((o) => o.label)).toEqual(["Take 1 damage", "Take no damage"]);
    expect(h.context()).toBeNull();
  });

  it("uses the keyword provider for Stack even when its runtime position differs", () => {
    const t = drive(engine, { me: { field: ["BP01-T10", "BP01-T10", "BP01-T10"] } });
    const h = track(t.game);
    mainAction(t, h, "activate", "BP01-T10");
    expect(h.context()).toMatchObject({ sourceDef: "kw:stack", kind: "activated", keyword: "stack", abilityIndex: 0 });
    expect(displayAbilityText(h.context()!, catalog, "cn")?.text).toContain("【蓄积】");
  });
  it("keeps the real BP11-070 replay's pre-play and discard-trigger identities, and changes no engine output", () => {
    const options = bp11Replay.options as unknown as GameOptions;
    const config = { deckRestrictions: options.deckRestrictions, manualActions: options.manualActions,
      firstPlayer: firstPlayerOf(options), autoResolve: ALL_AUTO_RESOLVABLE.filter((t) =>
        !(t === "mainPhase" && options.showEveryMainPhase) && !(t === "quick" && options.askEveryQuickWindow)) };
    const game = engine.newGame({ seed: options.seed, players: options.decks, config });
    const plain = engine.newGame({ seed: options.seed, players: options.decks, config });
    const h = track(game);
    for (const [i, record] of bp11Replay.inputs.entries()) {
      const input = record.input as Input;
      const by = record.by === null ? undefined : record.by as PlayerId;
      expect(h.act(input, by)).toEqual(plain.act(input, by));
      expect(stateHash(game.state)).toBe(stateHash(plain.state));
      expect(game.decision).toEqual(plain.decision);
      if ([70, 71, 72, 73, 76, 77].includes(i + 1)) {
        const index = i + 1 === 76 ? 1 : [73, 77].includes(i + 1) ? 2 : 0;
        expect(h.context(), `input ${i + 1}`).toMatchObject({ sourceDef: "BP11-070", abilityIndex: index, kind: "automatic" });
        const text = displayAbilityText(h.context()!, catalog, "ja")!.text;
        expect(text).toMatch(index === 0 ? /^【進化時】/ : index === 1 ? /^これがアクト/ : /^自分のターン中、いずれかのプレイヤー/);
      }
    }
  });

  it.each(["BP01-002", "BP01-004", "BP03-002"])("hands evolve over to %s's on-evolve ability at its first question", (def) => {
    const evolved = def === "BP01-002" ? "BP01-003" : def === "BP01-004" ? "BP01-005" : "BP03-003";
    const t = drive(engine, { me: { field: [def, "PLAIN", "PLAIN"], evolveDeck: [evolved] }, opp: { field: ["PLAIN", "PLAIN"] } });
    const h = track(t.game);
    mainAction(t, h, "evolve", def);
    if (def === "BP03-002") {
      expect(h.context()).toMatchObject({ sourceDef: def, kind: "activated", textRef: { timing: "evolve" } });
      expect(t.decision).toMatchObject({ type: "selectCards", reason: "pick" });
      h.act({ type: "selectCards", cards: [t.id("PLAIN")] });
    }
    expect(h.context()).toMatchObject({ sourceDef: evolved, kind: "automatic", timing: "onEvolve" });
    expect(displayAbilityText(h.context()!, catalog, "ja")?.text).toMatch(/^【進化時】/);
  });

  it("captures an activated mode before its play event and keeps it through target and cost questions", () => {
    const t = drive(engine, { me: { field: ["BP09-006"], hand: ["BP01-023", "PLAIN"], deck: ["PLAIN", "PLAIN"] }, opp: { field: ["PLAIN", "PLAIN"] } });
    const h = track(t.game);
    const events = mainAction(t, h, "activate", "BP09-006");
    expect(events.some((e) => e.type === "abilityPlayed")).toBe(false);
    expect(h.context()).toMatchObject({ kind: "activated", abilityIndex: 1, textRef: { timing: "activated" } });
    const instance = h.context()!.instanceId;
    expect(displayAbilityText(h.context()!, catalog, "cn")?.text).toContain("【2】");
    h.act({ type: "choose", ids: ["follower"] });
    expect(h.context()).toMatchObject({ instanceId: instance, modeIds: ["follower"] });
    h.act({ type: "selectCards", cards: [t.id("opp:PLAIN")] });
    expect(t.decision).toMatchObject({ type: "selectCards", reason: "pick" });
    expect(h.context()?.kind).toBe("activated");
    h.act({ type: "selectCards", cards: [t.id("PLAIN@hand")] });
    expect(h.context()).toBeNull();
  });

  it("tracks spell object migration, selected play option and modes through search", () => {
    const t = drive(engine, { me: { hand: ["BP21-026"], playPoints: 10, deck: ["BP02-021", "BP02-021", "BP02-021", "PLAIN"] } });
    const h = track(t.game);
    const old = t.id("BP21-026@hand");
    const events = mainAction(t, h, "play", "BP21-026");
    expect(events.some((e) => e.type === "cardPlayed")).toBe(false);
    expect(t.decision).toMatchObject({ type: "choose", reason: "playOption" });
    expect(h.context()).toMatchObject({ kind: "spell", sourceDef: "BP21-026", textRef: { timing: "spell" } });
    expect(h.context()?.source).not.toBe(old);
    expect(displayAbilityText(h.context()!, catalog, "ja")).toMatchObject({ match: "body" });
    expect(displayAbilityText(h.context()!, catalog, "ja")?.text).toContain("コストを+2してよい");
    const original = h.context();
    expect(() => h.act({ type: "choose", ids: ["nonexistent"] })).toThrow();
    expect(h.context()).toEqual(original);
    h.act({ type: "choose", ids: ["plus2"] });
    expect(h.context()).toMatchObject({ instanceId: original!.instanceId, playOptionId: "plus2" });
    h.act({ type: "choose", ids: ["amelia"] });
    expect(t.decision).toMatchObject({ type: "selectCards", reason: "search" });
    expect(h.context()).toMatchObject({ instanceId: original!.instanceId, modeIds: ["amelia"], playOptionId: "plus2" });
  });

  it("keeps the Goblinoid discard cost before the spell's cardPlayed event", () => {
    const t = drive(engine, { me: { hand: ["BP14-119", "BP01-171", "BP01-171"] }, opp: { field: ["PLAIN", "PLAIN"] } });
    const h = track(t.game);
    mainAction(t, h, "play", "BP14-119");
    expect(t.decision).toMatchObject({ type: "choose", reason: "playOption" });
    h.act({ type: "choose", ids: ["discard"] });
    expect(h.context()).toMatchObject({ kind: "spell", playOptionId: "discard" });
    h.act({ type: "selectCards", cards: [t.id("opp:PLAIN")] });
    expect(t.decision).toMatchObject({ type: "selectCards", reason: "pick" });
    expect(displayAbilityText(h.context()!, catalog, "ja")?.text).toContain("手札のゴブリン・カード1枚を捨てる");
  });

  it("hands a spell's additional discard cost over to a newly started automatic ability", () => {
    const t = drive(engine, { me: { field: [{ card: "BP11-069", evolvedInto: "BP11-070" }],
      hand: ["BP14-119", "BP01-171", "BP01-171"] }, opp: { field: ["PLAIN", "PLAIN"] } });
    const h = track(t.game);
    mainAction(t, h, "play", "BP14-119");
    h.act({ type: "choose", ids: ["discard"] });
    h.act({ type: "selectCards", cards: [t.id("opp:PLAIN")] });
    expect(h.context()).toMatchObject({ kind: "spell", sourceDef: "BP14-119", playOptionId: "discard" });
    h.act({ type: "selectCards", cards: [t.id("BP01-171@hand")] });
    expect(t.decision).toMatchObject({ type: "selectCards", reason: "target" });
    expect(h.context()).toMatchObject({ kind: "automatic", sourceDef: "BP11-070", abilityIndex: 2 });
    expect(h.context()?.playOptionId).toBeUndefined();
  });

  it("starts a fresh activated instance when the same card uses the same mode ability again", () => {
    const t = drive(engine, { me: { field: ["BP09-006"], hand: Array(4).fill("PLAIN") }, opp: { field: ["PLAIN", "PLAIN"] }, config: { manualActions: true } });
    const h = track(t.game);
    mainAction(t, h, "activate", "BP09-006");
    const first = h.context()!.instanceId;
    h.act({ type: "choose", ids: ["leader"] });
    h.act({ type: "selectCards", cards: [t.id("PLAIN@hand")] });
    expect(h.context()).toBeNull();
    h.act({ type: "mainPhase", action: { type: "manual", op: { kind: "engage", card: t.id("BP09-006"), engaged: false } } });
    mainAction(t, h, "activate", "BP09-006");
    expect(h.context()?.instanceId).not.toBe(first);
    expect(h.context()?.modeIds).toBeUndefined();
  });

  it("shows mandatory additional cost without a play-option question", () => {
    const t = drive(engine, { me: { hand: ["BP11-007"], field: Array(5).fill("BP01-T03"), deck: ["BP01-007", "BP01-007"] } });
    const h = track(t.game);
    mainAction(t, h, "play", "BP11-007");
    expect(t.decision).toMatchObject({ type: "selectCards", reason: "pick", min: 4 });
    expect(h.context()).toMatchObject({ kind: "spell", sourceDef: "BP11-007" });
    expect(displayAbilityText(h.context()!, catalog, "ja")?.text).toContain("追加コストとして場の妖精・トークン4体");
  });

  it.each([0, 10])("shows a follower's alternate cost with %i PP and hands over to its Fanfare", (playPoints) => {
    const t = drive(engine, { me: { hand: ["CP03-083"], field: ["CP03-084", "CP03-084"], cemetery: Array(15).fill("CP03-083"), playPoints, deck: Array(10).fill("PLAIN") },
      opp: { field: ["PLAIN", "PLAIN"] } });
    const h = track(t.game);
    mainAction(t, h, "play", "CP03-083");
    if (playPoints === 10) {
      expect(t.decision).toMatchObject({ type: "choose", reason: "playOption" });
      expect(h.context()?.kind).toBe("cardPlay");
      h.act({ type: "choose", ids: ["buryDragon"] });
    }
    expect(t.decision).toMatchObject({ type: "selectCards", reason: "pick" });
    expect(h.context()).toMatchObject({ kind: "cardPlay", textRef: { timing: "play" } });
    expect(displayAbilityText(h.context()!, catalog, "ja")?.text).toMatch(/^これをプレイする際、.*元のコストを払うのではなく/);
    h.act({ type: "selectCards", cards: [t.id("CP03-084")] });
    expect(t.decision).toMatchObject({ type: "selectCards", reason: "wardEnterEngaged" });
    expect(h.context()).toBeNull();
    h.act({ type: "selectCards", cards: [] });
    expect(h.context()).toMatchObject({ kind: "automatic", sourceDef: "CP03-083", timing: "fanfare" });
    expect(displayAbilityText(h.context()!, catalog, "ja")?.text).toMatch(/^ファンファーレ/);
  });
});

describe("presentation ability identity and live input observation", () => {
  it("keeps the selected instance through modes, optional cost, targets, actual cost and the opponent's choice after source departure", () => {
    const t = flowGame();
    const h = track(t.game);
    h.act({ type: "mainPhase", action: { type: "endMainPhase" } });
    expect(t.decision?.type).toBe("selectPending");
    expect(h.context()).toBeNull();
    const pending = t.game.state.pending[1]!;
    expect(Object.keys(h.presentation().pendingAbilities)).toHaveLength(2);
    h.act({ type: "selectPending", id: pending.id });
    expect(h.context()).toMatchObject({ pendingId: pending.id, source: pending.source, abilityIndex: 0 });
    const initial = h.context()!;
    const text = displayAbilityText(initial, catalog, "cn")!.text;
    expect(text).toContain("【2】");
    expect(() => h.act({ type: "confirm", yes: true })).toThrow();
    expect(() => h.act({ type: "choose", ids: ["take"] }, 1)).toThrow();
    expect(h.context()).toEqual(initial);
    h.act({ type: "choose", ids: ["take"] });
    expect(t.decision).toMatchObject({ type: "confirm", reason: "optionalCost" });
    h.act({ type: "confirm", yes: true });
    expect(t.decision).toMatchObject({ type: "selectCards", reason: "target" });
    h.act({ type: "selectCards", cards: [t.id("opp:PLAIN")] });
    expect(t.decision).toMatchObject({ type: "selectCards", reason: "discard", player: 0 });
    h.act({ type: "selectCards", cards: [t.id("PLAIN@hand")] });
    expect(t.decision).toMatchObject({ type: "selectCards", reason: "discard", player: 1, source: null });
    expect(t.game.state.cards[pending.source]).toBeUndefined();
    expect(h.context()).toMatchObject({ pendingId: pending.id, sourceCard: { def: "FLOW" }, modeIds: ["take"] });
    expect(displayAbilityText(h.context()!, catalog, "ja")?.lang).toBe("ja");
    expect(displayAbilityText(h.context()!, catalog, "zh-Hant")?.lang).toBe("zh-Hant");
    expect(displayAbilityText(h.context()!, catalog, "cn")?.text).toBe(text);
    h.act({ type: "selectCards", cards: [t.id("opp:PLAIN@hand")] });
    // The remaining sole pending ability begins automatically; no previous instance can survive this boundary.
    expect(t.decision?.type).toBe("choose");
    expect(h.context()?.source).not.toBe(pending.source);
    h.act({ type: "choose", ids: ["draw"] });
    h.act({ type: "confirm", yes: false });
    expect(h.context()).toBeNull();
  });

  it("identifies a newly triggered sole automatic ability before abilityPlayed, and clears on concession", () => {
    const t = flowGame(1);
    const h = track(t.game);
    const events = h.act({ type: "mainPhase", action: { type: "endMainPhase" } });
    expect(events.some((e) => e.type === "abilityTriggered")).toBe(true);
    expect(events.some((e) => e.type === "abilityPlayed")).toBe(false);
    expect(t.decision?.type).toBe("choose");
    expect(h.context()?.sourceDef).toBe("FLOW");
    h.act({ type: "concede", player: 0 });
    expect(h.context()).toBeNull();
  });

  it("does not guess the next pre-play ability after multiple instances disappear in one act", () => {
    const t = drive(engine, { me: { field: ["SKIP", "FLOW"], hand: ["PLAIN", "PLAIN"] }, opp: { field: ["PLAIN", "PLAIN"] } });
    const h = track(t.game);
    h.act({ type: "mainPhase", action: { type: "endMainPhase" } });
    const skip = t.game.state.pending.find((p) => p.sourceDef === "SKIP")!;
    h.act({ type: "selectPending", id: skip.id });
    expect(t.decision).toMatchObject({ type: "choose", reason: "mode" });
    expect(h.context()).toBeNull();
  });

  it("hands over after several pending instances disappear when all preceding ones have play events", () => {
    const t = drive(engine, { me: { field: ["DONE", "FLOW"], hand: ["PLAIN", "PLAIN"] }, opp: { field: ["PLAIN", "PLAIN"] } });
    const h = track(t.game);
    h.act({ type: "mainPhase", action: { type: "endMainPhase" } });
    const done = t.game.state.pending.find((p) => p.sourceDef === "DONE")!;
    const flow = t.game.state.pending.find((p) => p.sourceDef === "FLOW")!;
    h.act({ type: "selectPending", id: done.id });
    expect(t.decision).toMatchObject({ type: "choose", reason: "mode" });
    expect(h.context()).toMatchObject({ pendingId: flow.id, sourceDef: "FLOW" });
  });

  it("hides unrelated hand-limit rules even when the preceding ability's source disappeared", () => {
    const t = drive(engine, { me: { field: ["FLOW"], hand: Array(10).fill("PLAIN"), deck: Array(20).fill("PLAIN") },
      opp: { field: ["PLAIN", "PLAIN"], hand: ["PLAIN", "PLAIN"], deck: Array(20).fill("PLAIN") } });
    const h = track(t.game);
    h.act({ type: "mainPhase", action: { type: "endMainPhase" } });
    h.act({ type: "choose", ids: ["take"] });
    h.act({ type: "confirm", yes: true });
    h.act({ type: "selectCards", cards: [t.id("opp:PLAIN")] });
    h.act({ type: "selectCards", cards: [t.id("PLAIN@hand")] });
    expect(h.context()?.sourceDef).toBe("FLOW");
    h.act({ type: "selectCards", cards: [t.id("opp:PLAIN@hand")] });
    expect(t.decision).toMatchObject({ type: "selectCards", reason: "handLimitDiscard" });
    expect(h.context()).toBeNull();
  });

  it("does not publish a cached private source identity to an opponent who must make the effect's choice", () => {
    const t = drive(engine, { me: { hand: ["PRIVATE"] }, opp: { hand: ["PLAIN", "PLAIN"] } });
    const h = track(t.game);
    h.act({ type: "mainPhase", action: { type: "endMainPhase" } });
    expect(t.decision).toMatchObject({ type: "selectCards", player: 1 });
    expect(h.presentation(1).effectContext).toBeNull();
    expect(h.presentation(0).effectContext?.sourceDef).toBe("PRIVATE");
  });

  it("does not carry selected modes into a different pending instance of the same ability on the same source", () => {
    const t = drive(engine, { me: { field: ["BP19-092"], deck: Array(20).fill("PLAIN") }, opp: { deck: Array(20).fill("PLAIN") } });
    const h = track(t.game);
    h.act({ type: "mainPhase", action: { type: "endMainPhase" } });
    const first = t.game.state.pending[1]!;
    h.act({ type: "selectPending", id: first.id });
    h.act({ type: "choose", ids: ["draw"] });
    expect(t.decision).toMatchObject({ type: "choose", reason: "mode" });
    expect(h.context()?.pendingId).not.toBe(first.id);
    expect(h.context()?.source).toBe(first.source);
    expect(h.context()?.modeIds).toBeUndefined();
  });

  it("hides an outer ability during a nested drive trigger and does not invent a restoration boundary", () => {
    const trigger = ALL_CARDS.find((c) => c.trigger === "draw")!;
    const leader = ALL_CARDS.find((c) => c.type === "leader" && c.universe === "vanguard")!;
    const t = drive(engine, { me: { leader: leader.id, universe: "vanguard", field: ["NESTED"], deck: [trigger.id, "PLAIN", "PLAIN"] }, opp: { deck: ["PLAIN"] } });
    const h = track(t.game);
    h.act({ type: "mainPhase", action: { type: "endMainPhase" } });
    expect(t.decision).toMatchObject({ type: "confirm", reason: "driveTrigger" });
    expect(h.context()).toBeNull();
    h.act({ type: "confirm", yes: false });
    expect(t.decision).toMatchObject({ type: "choose", reason: "effect" });
    expect(h.context()).toBeNull();
  });

  it("resolves equipment and passive gifts from the provider, not the receiving follower's printed text", () => {
    const t = drive(engine, { me: { field: ["BP03-011", { card: "PLAIN", equipped: ["CP04-T09"] }] }, opp: { field: [{ card: "PLAIN", engaged: true }, { card: "PLAIN", engaged: true }] } });
    const h = track(t.game);
    h.act({ type: "mainPhase", action: { type: "attack", attacker: t.id("PLAIN"), target: t.id("opp:PLAIN") } });
    expect(t.decision?.type).toBe("selectPending");
    const contexts = Object.values(h.presentation().pendingAbilities);
    expect(contexts.find((c) => c.origin === "granted")).toMatchObject({ providerDef: "BP03-011", sourceDef: "grant:followerStrike2" });
    expect(contexts.find((c) => c.origin === "equipment")).toMatchObject({ providerDef: "CP04-T09", sourceDef: "equip:CP04-T09" });
    for (const context of contexts) expect(displayAbilityText(context, catalog, "cn")?.text).toContain("攻击时");
    const equipment = contexts.find((c) => c.origin === "equipment")!;
    h.act({ type: "selectPending", id: equipment.pendingId! });
    expect(h.context()).toMatchObject({ sourceDef: "equip:CP04-T09", providerDef: "CP04-T09" });
  });

  it("retains the evolved providing definition, even when Last Words runs on a new unevolved cemetery object", () => {
    const evolved = ALL_CARDS.find((c) => c.type === "follower" && c.evolved && (ALL_SCRIPTS[c.id]?.abilities ?? []).some((a) => a.kind === "automatic" && a.timing === "lastWords"))!;
    const base = ALL_CARDS.find((c) => c.type === "follower" && c.name === evolved.name && !c.evolved)!;
    const t = drive(engine, { me: { field: [{ card: base.id, evolvedInto: evolved.id }] }, config: { manualActions: true } });
    const index = ALL_SCRIPTS[evolved.id]!.abilities!.findIndex((a) => a.kind === "automatic" && a.timing === "lastWords");
    const original = t.id(base.id);
    const active = abilitySource(engine, t.game, { controller: 0, source: original, sourceDef: evolved.id, ability: index });
    expect(active.sourceCard?.def).toBe(evolved.id);
    // Use a normal engine zone move; the new cemetery object's base definition must not replace the provider.
    t.game.act({ type: "mainPhase", action: { type: "manual", op: { kind: "move", card: original, to: "cemetery" } } });
    const pending = t.game.state.pending.find((p) => p.sourceDef === evolved.id);
    const cemetery = t.game.state.players[0].zones.cemetery.find((id) => t.game.state.cards[id]?.def === base.id)!;
    const left = abilitySource(engine, t.game, pending ?? { controller: 0, source: cemetery, sourceDef: evolved.id, ability: index });
    expect(left.sourceCard?.def).toBe(evolved.id);
    expect(displayAbilityText(left, catalog, "ja")).not.toBeNull();
  });

  it("keeps a delayed trigger's visible source snapshot across its creation and the source leaving before it triggers", () => {
    const t = drive(engine, { me: { hand: ["DELAY"] }, config: { manualActions: true } });
    const h = track(t.game);
    h.act({ type: "mainPhase", action: { type: "manual", op: { kind: "move", card: t.id("DELAY@hand"), to: "field" } } });
    const source = t.id("DELAY@field");
    expect(t.game.state.delayed).toHaveLength(1);
    h.act({ type: "mainPhase", action: { type: "manual", op: { kind: "move", card: source, to: "cemetery" } } });
    h.act({ type: "mainPhase", action: { type: "endMainPhase" } });
    expect(t.decision).toMatchObject({ type: "choose", source: null });
    expect(h.context()).toMatchObject({ source, sourceCard: { def: "DELAY" }, origin: "delayed", abilityIndex: 1 });
    expect(displayAbilityText(h.context()!, catalog, "en")?.text).toBe("At the start of your end phase, choose an option.");
  });

  it("locates all reviewed grant quotes and keyword expansions in every language, including fallback after the giver disappears", () => {
    const t = drive(engine, { me: { field: ["PLAIN"] } });
    for (const grant of Object.keys(GRANT_TEXT)) for (const lang of ["ja", "cn", "en", "zh-Hant"] as const) {
      const context = abilitySource(engine, t.game, { controller: 0, source: t.id("PLAIN"), sourceDef: `grant:${grant}`, ability: 0 });
      expect(displayAbilityText(context, catalog, lang), `${grant}:${lang}`).not.toBeNull();
      expect(context.providerDef).toBeUndefined(); // A canonical quote is not evidence of the actual giver.
    }
    for (const keyword of ["drain", "singleDrive", "twinDrive"]) {
      const context = abilitySource(engine, t.game, { controller: 0, source: t.id("PLAIN"), sourceDef: `kw:${keyword}`, ability: 0 });
      expect(displayAbilityText(context, catalog, "ja")?.text).toBeTruthy();
    }
  });

  it("delegates a live session exactly once and does not mutate the engine, state, method or rejected input", () => {
    const original = engine.newGame;
    const spy = vi.spyOn(engine, "newGame");
    const restore = vi.spyOn(engine, "restore");
    const observed = observePresentationEngine(engine);
    const game = observed.engine.newGame({ seed: "observer-once", players: [{ main: Array(20).fill("PLAIN"), evolve: [] }, { main: Array(20).fill("PLAIN"), evolve: [] }], config: { deckRestrictions: false } });
    expect(spy).toHaveBeenCalledTimes(1);
    const state = JSON.stringify(game.state);
    const snapshot = game.snapshot();
    const input = { type: "confirm", yes: true } as const;
    expect(() => game.act(input)).toThrow();
    expect(JSON.stringify(game.state)).toBe(state);
    expect(game.snapshot()).toEqual(snapshot);
    expect(input).toEqual({ type: "confirm", yes: true });
    expect(restore).not.toHaveBeenCalled();
    restore.mockRestore();
    spy.mockRestore();
    expect(engine.newGame).toBe(original);
  });

  it("keeps original host state, decisions, events, hashes and replay identical through inputs, undo, watch/seek and queued remote inputs", () => {
    const plain: EngineMessage[] = [];
    const presented: FromWorker[] = [];
    const scheduler = { schedule: () => () => {} };
    const a = new GameHost(engine, (m) => plain.push(m), scheduler);
    const b = createPresentationHost(engine, (m) => presented.push(m), scheduler);
    const options: GameOptions = { seed: "presentation-equivalent", decks: [{ main: Array(20).fill("BP19-092"), evolve: [] }, { main: Array(20).fill("BP19-092"), evolve: [] }], deckNames: ["A", "B"], controllers: ["human", "human"], deckRestrictions: false, showEveryMainPhase: true, manualActions: true, turnOrder: "player1" };
    const send = (m: ToWorker) => {
      a.handle(m); b.handle(m);
      expect(b.session?.state).toEqual(a.session?.state);
      expect(b.session?.decision).toEqual(a.session?.decision);
      expect(b.replay()).toEqual(a.replay());
      expect(presented.map((m) => {
        if (m.kind !== "update") return m;
        const { cardDetails, pendingAbilities, effectContext, ...update } = m.update;
        return { kind: "update", update };
      })).toEqual(plain);
    };
    send({ kind: "start", options });
    const rng = seedRng("presentation-inputs");
    for (let i = 0; i < 150 && a.session?.decision; i++) send({ kind: "answer", seat: a.session.decision.player, answer: randomAnswer(rng, a.session.decision) });
    send({ kind: "rewind", inputs: Math.max(0, a.replay()!.inputs.length - 4) });
    send({ kind: "loadReplay", replay: a.replay()! });
    send({ kind: "watch", replay: a.replay()! });
    send({ kind: "watchControl", playing: false, seek: 0 });
    send({ kind: "watchControl", playing: false, seek: 4 });
    send({ kind: "watchControl", playing: false, perspective: 1 });
    send({ kind: "start", options: { ...options, controllers: ["remote", "human"] } });
    const answer = randomAnswer(rng, a.session!.decision!);
    // An input queued beyond the current position must not change the ability context or the game.
    send({ kind: "remoteInput", index: 2, input: answer, hash: "not-applied-yet" });
    send({ kind: "remoteInput", index: 0, input: answer, hash: stateHash(a.session!.state) });
    const latest = presented.filter((m): m is { kind: "update"; update: GameUpdate } => m.kind === "update").at(-1)!.update;
    expect(latest.effectContext).toBeNull();
  });
});
