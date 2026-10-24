import { describe, expect, it } from "vitest";
import { createEngine, randomInt, seedRng, type Answer, type GameSession, type PlayerId, type RngState } from "../src/core";
import { ALL_CARDS, ALL_SCRIPTS } from "../../core/src/sets";
import { GreedyBot, PlannerBot, SIM_DEFAULTS, evaluate, hiddenPools, playOpening, plansItself, pp1Evaluator, setupSample, setupWorld, simIdentity, simMulligan, simProblems, stepBack, type MulliganDecision, type SimParams } from "../src";
import { dealt } from "../src/setup-sample";
import { ARENA_CONFIG, sampleDeck } from "./samples";

// The mulligan by simulation (mulligan-sim.ts: CR 6.2.1.8, the first turns played from samples, keeping and redrawing) and
// its samples at the setup (setup-sample.ts: the game rebuilt from its setup checkpoint with what the player can't see
// dealt again, from the core's public API).
const engine = createEngine({ cards: ALL_CARDS, scripts: ALL_SCRIPTS });
const world = setupWorld(engine);
const pp1 = pp1Evaluator();

/** A game of two sample decks at the first mulligan decision (player 0 goes first). */
function opening(seed: string, decks: [string, string] = ["sd01", "dsd01b"]): GameSession {
  const g = engine.newGame({ seed, players: [sampleDeck(decks[0]), sampleDeck(decks[1])], config: ARENA_CONFIG });
  const d = g.decision!;
  g.act({ type: "chooseTurnOrder", goFirst: d.player === 0 });
  expect(g.decision).toMatchObject({ type: "mulligan", player: 0 });
  return g;
}
const defsOf = (g: GameSession, p: PlayerId, zone: "hand" | "deck") => g.reader().cards(p, zone).map((id) => g.reader().card(id)!.def);
const sorted = (xs: string[]) => [...xs].sort();
const redraw = (d: MulliganDecision): Answer => ({ type: "mulligan", redraw: true, bottomOrder: [...d.hand] });

/** The game with two card instances' identities swapped at its checkpoint (the setup replays the same, the cards differ). */
function swapped(g: GameSession, a: string, b: string): GameSession {
  const snap = g.snapshot();
  const cards = snap.checkpoint.cards;
  const [da, pa] = [cards[a]!.def, cards[a]!.printing];
  cards[a]!.def = cards[b]!.def;
  cards[a]!.printing = cards[b]!.printing;
  cards[b]!.def = da;
  cards[b]!.printing = pa;
  return engine.restore(snap);
}
/** Two cards of player p's deck with different definitions (by card id). */
function twoDifferent(g: GameSession, p: PlayerId): [string, string] {
  const ids = g.reader().cards(p, "deck");
  return [ids[0]!, ids.find((id) => g.reader().card(id)!.def !== g.reader().card(ids[0]!)!.def)!];
}

describe("mulligan sim: parameters and identity", () => {
  it("writes every parameter in the identity, and refuses bad ones", () => {
    expect(simIdentity(SIM_DEFAULTS)).toBe("mull=sim:k=8,t=3,margin=0,opp=greedy,cand=32");
    expect(simProblems({ ...SIM_DEFAULTS, k: 0, t: 11, cand: 2.5, opp: "random" as SimParams["opp"] })).toEqual([
      "k=0: a whole number from 1 to 64",
      "t=11: a whole number from 1 to 10",
      "cand=2.5: a whole number from 1 to 64",
      "opp=random: passive or greedy",
    ]);
    expect(() => new PlannerBot(engine, { mulligan: "sim", mulliganSim: { k: 0 } })).toThrow(/k=0/);
  });
});

describe("setup sample: what the player knows at the mulligan", () => {
  it("runs the core's generator backwards a step at a time", () => {
    const s: RngState = seedRng("back");
    for (let i = 0; i < 200; i++) {
      const before: RngState = [...s];
      randomInt(s, 0x1_0000_0000);
      expect(stepBack(s)).toEqual(before);
    }
  });

  it("keeps the hand and deals the deck and the opponent's hidden cards again from the same cards (CR 4.5.2, 4.1.2)", () => {
    const g = opening("mull-test:world");
    const w = setupSample(engine, g, 0, "s1").world;
    expect(w.decision).toEqual(g.decision);
    expect(defsOf(w, 0, "hand")).toEqual(defsOf(g, 0, "hand"));
    expect(sorted(defsOf(w, 0, "deck"))).toEqual(sorted(defsOf(g, 0, "deck")));
    expect(defsOf(w, 0, "deck")).not.toEqual(defsOf(g, 0, "deck"));
    const theirs = (s: GameSession) => [...defsOf(s, 1, "hand"), ...defsOf(s, 1, "deck")];
    expect(sorted(theirs(w))).toEqual(sorted(theirs(g)));
    expect(defsOf(w, 1, "hand")).not.toEqual(defsOf(g, 1, "hand"));
    // Same seed, same copy; another seed, another one; the random results to come are the sample's own.
    expect(defsOf(setupSample(engine, g, 0, "s1").world, 0, "deck")).toEqual(defsOf(w, 0, "deck"));
    expect(defsOf(setupSample(engine, g, 0, "s2").world, 0, "deck")).not.toEqual(defsOf(w, 0, "deck"));
    expect(w.state.rng).toEqual(seedRng("determinize-rng:s1"));
  });

  it("does not depend on the real order of the deck or on the opponent's real hand", () => {
    const g = opening("mull-test:order");
    const [a, b] = twoDifferent(g, 0);
    const reordered = swapped(g, a, b);
    expect(defsOf(reordered, 0, "deck")).not.toEqual(defsOf(g, 0, "deck"));
    const deckNow = new Set(g.reader().cards(1, "deck"));
    const start = g.snapshot().checkpoint;
    const c = start.players[1].zones.deck.find((id) => !deckNow.has(id))!;
    const d = [...deckNow].find((id) => start.cards[id]!.def !== start.cards[c]!.def)!;
    const otherHand = swapped(g, c, d);
    expect(defsOf(otherHand, 1, "hand")).not.toEqual(defsOf(g, 1, "hand"));
    for (const h of [reordered, otherHand]) {
      const [w1, w2] = [setupSample(engine, g, 0, "s").world, setupSample(engine, h, 0, "s").world];
      for (const p of [0, 1] as const) for (const zone of ["hand", "deck"] as const) expect(defsOf(w2, p, zone)).toEqual(defsOf(w1, p, zone));
    }
  });

  it("can be copied before its first main phase (its checkpoint holds the sample), and is determinized past the setup", () => {
    const g = opening("mull-test:copy");
    const { world: w, memoryKept } = setupSample(engine, g, 0, "s");
    expect(memoryKept).toBe(0);
    expect(defsOf(w.clone(), 1, "hand")).toEqual(defsOf(w, 1, "hand"));
    expect(w.clone().state).toEqual(w.state);
    w.act({ type: "mulligan", redraw: false });
    w.act({ type: "mulligan", redraw: false });
    expect(w.decision?.type).toBe("mainPhase");
    expect(defsOf(setupSample(engine, w, 0, "x").world, 1, "hand")).toEqual(defsOf(w.determinized(0, "x"), 1, "hand"));
  });

  it("deals what the player can't see as the core's determinize does (its copy held to it past the setup)", () => {
    const g = opening("mull-test:deal");
    g.act(redraw(g.decision as MulliganDecision));
    g.act({ type: "mulligan", redraw: false });
    expect(g.decision?.type).toBe("mainPhase");
    for (const viewer of [0, 1] as const) {
      for (const seed of ["d1", "d2"]) {
        const identities = dealt(g.state, hiddenPools(g.state, viewer, new Set()), seed);
        expect(identities.size, `${viewer} ${seed}`).toBeGreaterThan(30);
        const copy = g.determinized(viewer, seed).state;
        for (const [id, card] of Object.entries(g.state.cards)) {
          const want = identities.get(id) ?? { def: card.def, printing: card.printing };
          expect({ def: copy.cards[id]!.def, printing: copy.cards[id]!.printing }, `${viewer} ${seed} ${id}`).toEqual(want);
        }
      }
    }
  });

  it("plays the same opening in a copy of a sample as in the sample (the keep's playout is in a copy)", () => {
    const g = opening("mull-test:copy-play");
    const play = (w: GameSession) => {
      const self = new GreedyBot(engine, { seed: "self", evaluator: pp1 });
      const opp = new GreedyBot(engine, { seed: "opp" });
      return playOpening(w, 0, { type: "mulligan", redraw: false }, 2, (s) => self.decide(s), (s) => opp.decide(s), pp1);
    };
    // A fair bot's sample (setup-sample.ts) and a cheating bot's (a copy of the real game).
    for (const make of [() => world(g, 0, "c"), () => g.clone()]) expect(play(make().clone())).toEqual(play(make()));
  });

  it("at the second player's mulligan after a redraw, keeps the first player's memory of the cards it put back (sampled ones)", () => {
    const g = opening("mull-test:memory");
    g.act(redraw(g.decision as MulliganDecision));
    expect(g.decision).toMatchObject({ type: "mulligan", player: 1 });
    const { world: w, memoryKept } = setupSample(engine, g, 1, "m");
    expect(memoryKept).toBe(4);
    expect(defsOf(w, 1, "hand")).toEqual(defsOf(g, 1, "hand"));
    // The second player never remembers a card dealt again.
    for (const id of w.reader().cards(0, "deck")) expect(w.state.cards[id]!.knownBy ?? []).not.toContain(1);
    // After a keep there is nothing to remember.
    const k = opening("mull-test:memory");
    k.act({ type: "mulligan", redraw: false });
    expect(setupSample(engine, k, 1, "m").memoryKept).toBe(0);
  });
});

describe("mulligan sim: the first turns played from samples, keeping and redrawing", () => {
  it("plays to the opponent's first main phase after our t-th turn (first and second player)", () => {
    for (const [me, t] of [[0, 3], [1, 2]] as const) {
      const g = opening(`mull-test:playout:${me}:${t}`);
      if (me === 1) g.act({ type: "mulligan", redraw: false });
      const w = world(g, me, "p");
      const self = new GreedyBot(engine, { seed: "self", evaluator: pp1 });
      const opp = new GreedyBot(engine, { seed: "opp" });
      const played = playOpening(w, me, { type: "mulligan", redraw: false }, t, (s) => self.decide(s), (s) => opp.decide(s), pp1);
      expect(played).toMatchObject({ ended: "leaf", turns: t });
      expect(w.decision).toMatchObject({ type: "mainPhase", player: 1 - me });
      // The game turn: ours are 1, 3, 5 going first, 2, 4, 6 going second; the opponent's next one follows.
      expect(w.state.turn).toBe(me === 0 ? 2 * t : 2 * t + 1);
    }
  });

  it("is deterministic and fair: the same outcome for the same seed, whatever the real order of the deck", () => {
    const g = opening("mull-test:sim-fair");
    const [a, b] = twoDifferent(g, 0);
    const ctx = { engine, world, seed: "fair", params: { ...SIM_DEFAULTS, k: 2, t: 2 }, evaluator: pp1, modelEvaluator: evaluate };
    const d = g.decision as MulliganDecision;
    const one = simMulligan(g, d, ctx);
    expect(one.keep).toHaveLength(2);
    expect(one.failures).toBe(0);
    expect(simMulligan(g, d, ctx)).toEqual(one);
    expect(simMulligan(swapped(g, a, b), d, ctx)).toEqual(one);
    expect(one.redraw).toBe(one.diff > 0);
    // Our main phases go to the beam's form, our other decisions to the greedy's.
    expect(plansItself(g, 0)).toBe(false);
    expect(one.own.main).toBeGreaterThan(0);
  });

  it("on the planner: counts its mulligans, falls back to its own greedy rule when every sample fails", () => {
    const g = opening("mull-test:sim-bot");
    const options = { beamWidth: 2, maxSimulations: 40, replyPlans: 2, evaluator: pp1, seed: "bot" };
    const bot = new PlannerBot(engine, { ...options, mulligan: "sim", mulliganSim: { k: 2, t: 1 } });
    const a = bot.decide(g.clone());
    expect(bot.mulliganStats).toMatchObject({ identity: "mull=sim:k=2,t=1,margin=0,opp=greedy,cand=32", mulligans: 1, fallbacks: 0, failures: 0 });
    expect(bot.mulliganStats!.last!.keep).toHaveLength(2);
    expect(bot.mulliganStats!.redraws).toBe(a.type === "mulligan" && a.redraw ? 1 : 0);
    const broken = new PlannerBot(engine, { ...options, mulligan: "sim", mulliganSim: { k: 2 }, mulliganWorld: () => { throw new Error("no world"); } });
    expect(broken.decide(g.clone())).toEqual(new PlannerBot(engine, options).decide(g.clone()));
    expect(broken.mulliganStats).toMatchObject({ mulligans: 1, fallbacks: 1, failures: 2 });
    expect(broken.stats.fallbacks).toBe(0);
  });

  it("leaves every other decision to the planner", () => {
    const g = opening("mull-test:others");
    g.act({ type: "mulligan", redraw: false });
    g.act({ type: "mulligan", redraw: false });
    expect(g.decision?.type).toBe("mainPhase");
    const options = { beamWidth: 2, maxSimulations: 40, replyPlans: 2, evaluator: pp1, seed: "o" };
    const sim = new PlannerBot(engine, { ...options, mulligan: "sim" });
    expect(sim.decide(g.clone())).toEqual(new PlannerBot(engine, options).decide(g.clone()));
    expect(sim.mulliganStats!.mulligans).toBe(0);
  });

  it("plays a cheating planner's openings in copies of the real game", () => {
    const g = opening("mull-test:cheat");
    const bot = new PlannerBot(engine, { cheat: true, beamWidth: 2, maxSimulations: 40, replyPlans: 2, seed: "c", mulligan: "sim", mulliganSim: { k: 2, t: 1 } });
    expect(bot.decide(g.clone()).type).toBe("mulligan");
    expect(bot.mulliganStats).toMatchObject({ mulligans: 1, fallbacks: 0, failures: 0 });
    // The real game: both samples start from the same deal, so keeping scores alike in both but for the models' seeds.
    expect(bot.mulliganStats!.last!.keep).toHaveLength(2);
  });
});
