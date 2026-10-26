import { describe, expect, it } from "vitest";
import { createEngine, defaultAnswer, type Answer, type DefId, type GameEvent, type GameSession, type ManualOp, type PlayerId, type ScriptRegistry } from "../src/core";
import { ALL_CARDS, ALL_SCRIPTS } from "../../core/src/sets";
import { COND_DEFAULTS, PlannerBot, answeredInWatch, bundledCardTable, bundledGates, condIdentity, condProblems, coveredFanfares, evolveAbilitiesOf, feedWatch, judgeWatch, openEvolveWatch, openWatch, type CondScope, type PlayJudgment } from "../src";
import { ARENA_CONFIG, DECK_SETS, sampleDeck } from "./samples";

// The conditional-Fanfare charge (conditional.ts): the planner charges a plan for a card it plays whose Fanfare (CR 12.4.3)
// did nothing because what it needs was not there. Positions are games of the sample decks set up by hand (the core's
// manual operations, GameConfig.manualActions); the gates scope reads the bundled card feature table.
const engine = createEngine({ cards: ALL_CARDS, scripts: ALL_SCRIPTS });
const scripts: ScriptRegistry = engine.scripts;
const gates = bundledGates();

/** A game of two sample decks at the first main phase decision, manual operations allowed. */
function handGame(a: string, b: string, seed: string): GameSession {
  const g = engine.newGame({ seed, players: [sampleDeck(a), sampleDeck(b)], config: { ...ARENA_CONFIG, manualActions: true } });
  for (let i = 0; i < 200 && g.decision && g.decision.type !== "mainPhase"; i++) g.act(defaultAnswer(g.decision));
  return g;
}
/** A manual operation, then the defaults of whatever it asks (a Fanfare's targets) until the main phase decision again. */
function manual(g: GameSession, op: ManualOp): void {
  g.act({ type: "mainPhase", action: { type: "manual", op } });
  for (let i = 0; i < 50 && g.decision && g.decision.type !== "mainPhase"; i++) g.act(defaultAnswer(g.decision));
}
/** A card of `def` in the player's hand (searched from the deck when none is there). */
function inHand(g: GameSession, p: PlayerId, def: DefId): string {
  const find = () => g.reader().cards(p, "hand").find((id) => g.reader().card(id)!.def === def);
  if (!find()) manual(g, { kind: "search", player: p, def });
  const id = find();
  if (!id) throw new Error(`no ${def} for player ${p}`);
  return id;
}
const me = (g: GameSession): PlayerId => g.decision!.player;
/** The legal sample deck that has `def` in its main deck. */
const deckWith = (def: DefId) => [...DECK_SETS.train, ...DECK_SETS.holdout].find((d) => sampleDeck(d).main.some((p) => engine.db.ofPrinting(p).id === def))!;

/**
 * Play `def` at the game's main phase decision in a copy, our further decisions given their defaults (a confirm answered
 * `pay` when it is given: an optional cost paid or declined), and judge the window.
 */
function playAndJudge(g: GameSession, def: DefId, scope: CondScope, pay?: boolean): PlayJudgment & { asked: string[] } {
  const s = g.clone();
  const d = s.decision!;
  if (d.type !== "mainPhase") throw new Error(`not a main phase decision: ${d.type}`);
  const action = d.actions.find((a) => a.type === "play" && s.reader().card(a.card)!.def === def);
  if (!action || action.type !== "play") throw new Error(`no play of ${def}`);
  let w = feedWatch(openWatch(action.card), s.act({ type: "mainPhase", action }));
  const asked: string[] = [];
  for (let i = 0; i < 50 && s.decision && !(s.decision.type === "mainPhase" && s.decision.player === d.player); i++) {
    const dd = s.decision;
    const a: Answer = dd.type === "confirm" && pay !== undefined ? { type: "confirm", yes: pay } : defaultAnswer(dd);
    if (dd.type === "confirm") asked.push(`${dd.reason}:${a.type === "confirm" && a.yes ? "yes" : "no"}`);
    w = feedWatch(answeredInWatch(w, dd, a), s.act(a));
  }
  return { ...judgeWatch(w, s, d.player, scope, scripts, gates), asked };
}

describe("cond: the parameters and the cards covered", () => {
  it("names the change with its scope and penalty (the gates scope with the card table's hash), and refuses bad ones", () => {
    expect(COND_DEFAULTS).toEqual({ scope: "declared", penalty: 1.5 });
    expect(condIdentity({ scope: "unplayed", penalty: 2 })).toBe("cond=unplayed:penalty=2");
    expect(condIdentity({ scope: "gates", penalty: 1.5 }, gates)).toBe(`cond=gates:penalty=1.5:table=${bundledCardTable().file.hash}`);
    expect(condProblems({ scope: "all" as CondScope, penalty: 1 })).toEqual(["scope=all: declared, unplayed, gates"]);
    expect(condProblems({ scope: "declared", penalty: 11 })).toEqual(["penalty=11: a number from 0 to 10"]);
    expect(() => new PlannerBot(engine, { conditional: { scope: "gates" } })).toThrow(/needs the gates reader/);
    expect(() => new PlannerBot(engine, { conditional: { scope: "declared", penalty: -1 } })).toThrow(/penalty=-1/);
  });

  it("covers the four declared conditions and five gated Fanfares of the 15 legal sample decks", () => {
    const decks = [...DECK_SETS.train, ...DECK_SETS.holdout];
    expect(decks).toHaveLength(15);
    const defs = [...new Set(decks.flatMap((name) => sampleDeck(name).main.map((printing) => engine.db.ofPrinting(printing).id)))];
    expect(coveredFanfares(scripts, defs, "declared").map((c) => `${c.def}#${c.index} ${c.kind}`)).toEqual(["BP10-109#1 condition", "BP16-056#0 condition", "CP02-064#0 condition", "CP04-009#1 condition"]);
    const unplayed = coveredFanfares(scripts, defs, "unplayed");
    const unplayable = (def: DefId) => unplayed.filter((c) => c.def === def && c.kind === "unplayable").map((c) => c.detail);
    expect(unplayable("CP02-012")).toEqual(["targets"]);
    // Fanfares whose effect is bought with a cost (CR 10.4.7.4) are not judged.
    for (const def of ["CP04-008", "CP04-019", "CSD02a-005", "CSD02b-005", "DSD01b-016"]) expect(unplayable(def), def).toEqual([]);
    const gated = coveredFanfares(scripts, defs, "gates", gates).filter((c) => c.kind === "gate").map((c) => `${c.def}#${c.index}`);
    expect(gated).toEqual(["BP10-109#0", "CSD02a-004#0", "DSD01a-002#1", "DSD01a-006#1", "DSD01b-003#0"]);
  });
});

describe("cond: judging a play from the engine's events", () => {
  it("Date Masamune without 3 other Draconic Duelists: played, its gate unmet (gates only, CR 10.3.3)", () => {
    const g = handGame("dsd01b", "dsd01b", "cond-masamune");
    const p = me(g);
    inHand(g, p, "DSD01b-003");
    manual(g, { kind: "points", player: p, playPoints: 10, maxPlayPoints: 10 });
    expect(playAndJudge(g, "DSD01b-003", "declared")).toMatchObject({ charged: null, fanfares: [{ index: 0, outcome: "effective" }] });
    expect(playAndJudge(g, "DSD01b-003", "gates")).toMatchObject({ charged: "gate", fanfares: [{ index: 0, outcome: "wasted", why: "gate" }] });
  });

  it("Honoka Ayase without another iM@S follower: pending, never played (unplayed); Makoto's cost it can't pay: not judged", () => {
    const deck = deckWith("CP02-012");
    const h = handGame(deck, deck, "cond-honoka");
    const p = me(h);
    inHand(h, p, "CP02-012");
    manual(h, { kind: "points", player: p, playPoints: 10, maxPlayPoints: 10 });
    expect(playAndJudge(h, "CP02-012", "declared")).toMatchObject({ charged: null, fanfares: [{ index: 0, outcome: "unknown" }] });
    expect(playAndJudge(h, "CP02-012", "unplayed")).toMatchObject({ charged: "unplayed", fanfares: [{ index: 0, outcome: "wasted", why: "unplayed" }] });
    const deck2 = deckWith("CP04-008");
    const m = handGame(deck2, deck2, "cond-makoto");
    const q = me(m);
    inHand(m, q, "CP04-008");
    manual(m, { kind: "points", player: q, playPoints: 10, maxPlayPoints: 10 });
    expect(playAndJudge(m, "CP04-008", "unplayed")).toMatchObject({ charged: null });
    expect(playAndJudge(m, "CP04-008", "gates").charged).toBeNull();
  });

  it("Forte: charged below 10 max play points (a declared condition, CR 10.7.3.2); not at 10", () => {
    const g = handGame("sd08", "sd08", "cond-forte");
    const p = me(g);
    inHand(g, p, "BP16-056");
    manual(g, { kind: "points", player: p, playPoints: 9, maxPlayPoints: 9 });
    expect(playAndJudge(g, "BP16-056", "declared").charged).toBe("condition");
    manual(g, { kind: "points", player: p, playPoints: 10, maxPlayPoints: 10 });
    expect(playAndJudge(g, "BP16-056", "declared")).toMatchObject({ charged: null, fanfares: [{ index: 0, outcome: "effective" }] });
  });

  it("a trigger restriction unmet (a made-up script): charged; met but not triggered: unknown", () => {
    const fake = (holds: boolean): ScriptRegistry => ({ X: { abilities: [{ kind: "automatic", timing: "fanfare", trigger: () => true, triggerIf: () => holds }] } }) as unknown as ScriptRegistry;
    const w = { ...openWatch("h"), def: "X", resolution: "r", field: "f" };
    const session = { reader: () => ({}) } as unknown as GameSession;
    expect(judgeWatch(w, session, 0, "declared", fake(false), null)).toEqual({ def: "X", fanfares: [{ index: 0, outcome: "wasted", why: "triggerIf" }], charged: "triggerIf" });
    expect(judgeWatch(w, session, 0, "declared", fake(true), null).charged).toBeNull();
  });

  it("a Fanfare bought with a cost (CR 10.4.7.4) is never charged: declined, not affordable, or paid (then it is effective)", () => {
    const g = handGame("dsd01b", "dsd01b", "cond-cost");
    const p = me(g);
    inHand(g, p, "DSD01b-016");
    manual(g, { kind: "points", player: p, playPoints: 1, maxPlayPoints: 1 });
    expect(playAndJudge(g, "DSD01b-016", "unplayed", true)).toMatchObject({ asked: [], charged: null, fanfares: [{ index: 0, outcome: "unknown" }] });
    manual(g, { kind: "points", player: p, playPoints: 2, maxPlayPoints: 2 });
    expect(playAndJudge(g, "DSD01b-016", "gates", false)).toMatchObject({ asked: ["optionalCost:no"], charged: null });
    expect(playAndJudge(g, "DSD01b-016", "gates", true)).toMatchObject({ asked: ["optionalCost:yes"], charged: null, fanfares: [{ index: 0, outcome: "effective" }] });
  });
});

describe("cond: the planner with it", () => {
  const options = { beamWidth: 4, maxSimulations: 200, replyPlans: 2, seed: "cond-planner" };
  /** dsd01b at its first main phase with Date Masamune in hand, its cost in play points, and no Draconic Duelist out. */
  function masamuneTurn(): GameSession {
    const g = handGame("dsd01b", "sd01", "cond-plan");
    const p = me(g);
    inHand(g, p, "DSD01b-003");
    const cost = g.reader().info(g.reader().cards(p, "hand").find((id) => g.reader().card(id)!.def === "DSD01b-003")!).cost ?? 0;
    manual(g, { kind: "points", player: p, playPoints: cost, maxPlayPoints: cost });
    return g;
  }
  const playsMasamune = (g: GameSession, a: Answer) => a.type === "mainPhase" && a.action.type === "play" && g.reader().card(a.action.card)!.def === "DSD01b-003";

  it("charges the play whose gate is unmet in the search and the comparison, so the hold plan wins", () => {
    const g = masamuneTurn();
    const plain = new PlannerBot(engine, options).decide(g.clone());
    const charged = new PlannerBot(engine, { ...options, conditional: { scope: "gates", penalty: 10, gates } });
    const answer = charged.decide(g.clone());
    expect(charged.condStats!.charged.gate).toBeGreaterThan(0);
    expect(charged.condStats!.byCard["DSD01b-003"]).toBeGreaterThan(0);
    expect(charged.condStats!.adjusted).toBeGreaterThan(0);
    expect(playsMasamune(g, plain)).toBe(true);
    expect(playsMasamune(g, answer)).toBe(false);
  });

  it("changes nothing where no play is charged: the same answers as without it", () => {
    const g = engine.newGame({ seed: "cond-quiet", players: [sampleDeck("sd01"), sampleDeck("sd04")], config: ARENA_CONFIG });
    const plain = new PlannerBot(engine, options);
    const watched = new PlannerBot(engine, { ...options, conditional: { scope: "declared" } });
    let mine = 0;
    for (let i = 0; i < 400 && g.decision && g.state.turn <= 6; i++) {
      const a = plain.decide(g);
      const b = watched.decide(g);
      expect(b, `input ${i}`).toEqual(a);
      if (g.state.activePlayer === g.decision.player && g.state.phase === "main") mine += 1;
      g.act(a);
    }
    expect(mine).toBeGreaterThan(5);
    expect(watched.condStats!.windows).toBeGreaterThan(0);
    expect(watched.condStats!.adjusted + watched.condStats!.exact).toBe(0);
  });
});

describe("cond: evolutions whose On Evolve did nothing (CondParams.evolve)", () => {
  /** A follower of `def` put on our field by hand (from the hand: a new card there, CR 4.1.4); its id. */
  function onField(g: GameSession, p: PlayerId, def: DefId): string {
    manual(g, { kind: "move", card: inHand(g, p, def), to: "field" });
    const id = g.reader().cards(p, "field").find((c) => g.reader().card(c)!.def === def);
    if (!id) throw new Error(`no ${def} on the field`);
    return id;
  }
  /** Evolve the follower `card` (its evolve answer, not super) in a copy, our further decisions their defaults, and judge. */
  function evolveAndJudge(g: GameSession, card: string, scope: CondScope): PlayJudgment & { events: GameEvent[] } {
    const s = g.clone();
    const d = s.decision!;
    if (d.type !== "mainPhase") throw new Error(`not a main phase decision: ${d.type}`);
    const action = d.actions.find((a) => a.type === "evolve" && a.card === card && !a.superEvolve);
    if (!action) throw new Error(`no evolve of ${card}`);
    const events: GameEvent[] = [...s.act({ type: "mainPhase", action })];
    let w = feedWatch(openEvolveWatch(card), events);
    for (let i = 0; i < 50 && s.decision && !(s.decision.type === "mainPhase" && s.decision.player === d.player); i++) {
      const dd = s.decision;
      const a = defaultAnswer(dd);
      const more = s.act(a);
      events.push(...more);
      w = feedWatch(answeredInWatch(w, dd, a), more);
    }
    return { ...judgeWatch(w, s, d.player, scope, scripts, gates), events };
  }
  /** sd06 against sd06 at the first main phase, 10 play points and 2 evolution points, `def` on our field. */
  function evolveTurn(def: DefId, seed: string): { g: GameSession; p: PlayerId; card: string } {
    const g = handGame("sd06", "sd06", seed);
    const p = me(g);
    manual(g, { kind: "points", player: p, playPoints: 10, maxPlayPoints: 10, evolutionPoints: 2 });
    return { g, p, card: onField(g, p, def) };
  }

  it("reads the On Evolve abilities of the evolved card's definition (On Super-Evolve only when it super-evolved)", () => {
    expect(evolveAbilitiesOf(scripts, "SD06-004", false).map((f) => [f.index, f.unplayable])).toEqual([[0, ["targets"]]]);
    expect(evolveAbilitiesOf(scripts, "SD06-010", false)).toEqual([]);
    expect(condIdentity({ scope: "gates", penalty: 1.5, evolve: true }, gates)).toBe(`cond=gates:penalty=1.5:table=${bundledCardTable().file.hash}:evolve=1`);
    expect(condIdentity({ scope: "gates", penalty: 1.5 }, gates)).toBe(`cond=gates:penalty=1.5:table=${bundledCardTable().file.hash}`);
    expect(condProblems({ scope: "gates", penalty: 1.5, evolve: "yes" as never })).toEqual(["evolve=yes: true or false"]);
  });

  it("Priest of the Cudgel evolved with no enemy follower to banish: triggered, never played (unplayed, CR 10.7.3.2)", () => {
    const { g, card } = evolveTurn("SD06-003", "cond-evolve-none");
    const j = evolveAndJudge(g, card, "unplayed");
    // The On Evolve ability triggers from the follower (its id unchanged, CR 5.16.2) with the evolved card's definition.
    expect(j.events.filter((e) => e.type === "abilityTriggered").map((e) => (e.type === "abilityTriggered" ? [e.source, e.sourceDef, e.ability] : null))).toEqual([[card, "SD06-004", 0]]);
    expect(j).toMatchObject({ def: "SD06-004", charged: "unplayed", fanfares: [{ index: 0, outcome: "wasted", why: "unplayed" }] });
    expect(evolveAndJudge(g, card, "declared").charged).toBeNull();
  });

  it("with an enemy follower of 3 defense or less: played, effective, not charged; an evolved card without On Evolve: nothing to judge", () => {
    const { g, p, card } = evolveTurn("SD06-003", "cond-evolve-target");
    onField(g, p === 0 ? 1 : 0, "SD06-003");
    expect(evolveAndJudge(g, card, "gates")).toMatchObject({ def: "SD06-004", charged: null, fanfares: [{ index: 0, outcome: "effective" }] });
    const nun = evolveTurn("SD06-009", "cond-evolve-nun");
    expect(evolveAndJudge(nun.g, nun.card, "gates")).toMatchObject({ def: "SD06-010", charged: null, fanfares: [] });
  });

  it("the planner opens an evolution's window only with evolve on; off, the same answers as before", () => {
    const { g } = evolveTurn("SD06-003", "cond-evolve-plan");
    const options = { beamWidth: 4, maxSimulations: 200, replyPlans: 2, seed: "cond-evolve" };
    const off = new PlannerBot(engine, { ...options, conditional: { scope: "unplayed" } });
    const on = new PlannerBot(engine, { ...options, conditional: { scope: "unplayed", evolve: true } });
    off.decide(g.clone());
    on.decide(g.clone());
    expect(off.condStats!.evolve).toBeUndefined();
    expect(on.condStats!.evolve!.windows).toBeGreaterThan(0);
    expect(on.condStats!.evolve!.charged).toBeGreaterThan(0);
    expect(on.condStats!.byCard["SD06-004"]).toBeGreaterThan(0);
  });
});
