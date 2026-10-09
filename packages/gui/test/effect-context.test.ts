import { describe, expect, it, vi } from "vitest";
import { createEngine, script, randomAnswer, seedRng, type Input, type GameSession, type PlayerId } from "@sve/core";
import { ALL_CARDS, ALL_SCRIPTS } from "@sve/core/sets";
import { drive, testFollower } from "@sve/core/testing";
import { Catalog } from "../src/app/catalog";
import { displayAbilityText } from "../src/game/card/ability-display";
import { abilitySource, GRANT_TEXT } from "../src/presentation/ability-source";
import { EffectContextObserver, observePresentationEngine } from "../src/presentation/effect-context";
import { createPresentationHost } from "../src/presentation/host";
import { GameHost, stateHash } from "../src/engine/game-host";
import type { FromWorker as EngineMessage, GameOptions, ToWorker } from "../src/engine/protocol";
import type { FromWorker, GameUpdate } from "../src/presentation/protocol";

const flow = { ...testFollower("FLOW", 0, 1, 8), text: {
  en: "At the start of your end phase, discard a card: Choose one of the following.\n(1) Select an enemy follower. Bury this card, then your opponent discards a card.\n(2) Draw a card.",
  ja: "自分のエンドフェイズが来たとき、手札1枚を捨てる：チョイスする。\n【1】相手のフォロワーを選ぶ。これを墓場に置き、相手は手札1枚を捨てる。\n【2】1枚引く。",
  cn: "当自己的结束阶段到来时，舍弃1张手牌：抉择。\n【1】选择敌方的从者。将这张卡置入墓场，然后对手舍弃1张手牌。\n【2】抽取1张卡。",
} };
const engine = createEngine({ cards: [...ALL_CARDS, flow, testFollower("PLAIN", 0, 1, 8), testFollower("SKIP", 0, 1, 8), testFollower("PRIVATE", 0, 1, 8), testFollower("NESTED", 0, 1, 8),
  { ...testFollower("DELAY", 0, 1, 8), text: { en: "{[fanfare]} Set up a delayed ability.\nAt the start of your end phase, choose an option.", ja: null, cn: null } }], scripts: {
  ...ALL_SCRIPTS,
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
