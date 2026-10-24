import { describe, expect, it } from "vitest";
import { createEngine, type Answer, type GameSession, type PlayerId, type PlayerView } from "../src/core";
import { ALL_CARDS, ALL_SCRIPTS } from "../../core/src/sets";
import { scenario, type ScenarioSide } from "../../core/src/testing/scenario";
import { GreedyBot, PP1_DEFAULTS, evaluate, fastAnswer, lookupFromReader, maxPpValue, pp1Evaluator, pp1GreedyParams, pp1Identity, pp1Parts, pp1Problems, quickReserve } from "../src";

// pp1 (eval-pp.ts): the hand-written evaluation with the max-PP, unused-PP and hand-limit terms replaced. Positions are real
// ones built by the core's scenario helper (main phase decisions); end-phase positions are those views with the phase and
// the active player changed (the evaluation is a function of the view only). Values are worked out by hand from the
// defaults: v(m) = 0.2 + 0.3 · (11 − m), reserve 0.2 / waste 0.25 / spendable 0.05 per PP, a card in hand DEFAULT_WEIGHTS.hand.
const engine = createEngine({ cards: ALL_CARDS, scripts: ALL_SCRIPTS });
const pp1 = pp1Evaluator();
const DECK = Array.from({ length: 10 }, () => "SD04-003");
const FILLER = ["SD04-003", "SD04-005", "SD04-006", "SD04-009"];
const INSIGHT = "SD03-005"; // Insight: a 1-cost spell with Quick (draw a card)
const MISSILE = "SD03-015"; // Magic Missile: a 3-cost spell with Quick
const ORACLE = "SD04-002"; // Dragon Oracle: 2-cost spell, (1) +1 maximum PP, (2) draw a card

/** A game at player 0's main phase (turn 5) or player 1's (turn 6), with these sides (decks of 10 by default). */
function position(turn: 5 | 6, sides: [ScenarioSide, ScenarioSide]): GameSession {
  const withDeck = (s: ScenarioSide): ScenarioSide => ({ deck: DECK, ...s });
  return scenario(engine, { turn, firstPlayer: 0, players: [withDeck({ leader: "SD04-LD01", ...sides[0] }), withDeck({ leader: "SD03-LD01", ...sides[1] })] });
}
/** Player 0's view of a game, as it is or with another phase / active player (an end phase). */
const viewOf = (g: GameSession, change: Partial<Pick<PlayerView, "phase" | "activePlayer">> = {}): PlayerView => ({ ...g.view(0), ...change });
const me: PlayerId = 0;

describe("pp1: parameters and identity", () => {
  it("names every parameter in its identity, and refuses wrong ones", () => {
    expect(pp1Identity(PP1_DEFAULTS)).toBe("pp1:mppBase=0.2,mppSlope=0.3,ppReserve=0.2,ppWaste=0.25,ppSpendable=0.05,handCapOther=9,mainAsEnd=1");
    expect(pp1Identity(pp1GreedyParams(PP1_DEFAULTS))).toBe("pp1:mppBase=0.2,mppSlope=0.3,ppReserve=0.2,ppWaste=0.25,ppSpendable=0.05,handCapOther=9,mainAsEnd=0");
    expect(pp1Problems(PP1_DEFAULTS)).toEqual([]);
    expect(pp1Problems({ ...PP1_DEFAULTS, mainAsEnd: 2, handCapOther: 6.5, ppWaste: -1 })).toHaveLength(3);
    expect(() => pp1Evaluator({ ...PP1_DEFAULTS, mppSlope: Number.NaN })).toThrow(/mppSlope/);
  });

  it("values the m-th point of maximum PP at 0.2 + 0.3 · (11 − m), none past 10 (CR 3.2.4.1)", () => {
    const v = (m: number) => maxPpValue(m, PP1_DEFAULTS) - maxPpValue(m - 1, PP1_DEFAULTS);
    expect(v(1)).toBeCloseTo(3.2, 12);
    expect(v(3)).toBeCloseTo(2.6, 12);
    expect(v(7)).toBeCloseTo(1.4, 12);
    expect(v(10)).toBeCloseTo(0.5, 12);
    expect(maxPpValue(11, PP1_DEFAULTS)).toBe(maxPpValue(10, PP1_DEFAULTS));
    expect(maxPpValue(10, PP1_DEFAULTS)).toBeCloseTo(18.5, 12);
  });
});

describe("pp1: ramp (Dragon Oracle's +1 maximum PP)", () => {
  /** End of our turn at max PP `from` with all PP: nothing done, or Dragon Oracle (2 PP) for +1 maximum PP. */
  const ramp = (from: number) => {
    const before = position(5, [{ hand: [ORACLE, ...FILLER], playPoints: from, maxPlayPoints: from }, { hand: FILLER }]);
    const after = position(5, [{ hand: FILLER, playPoints: from - 2, maxPlayPoints: from + 1 }, { hand: FILLER }]);
    return { pp1: pp1(viewOf(after), me) - pp1(viewOf(before), me), old: evaluate(viewOf(after), me) - evaluate(viewOf(before), me) };
  };

  it("scores ramping at the end of the turn above doing nothing: v(next) − a card + 2 PP no longer wasted", () => {
    // v(next) − a card in hand + 2 PP no longer wasted (the old evaluation: one max PP − a card − 2 PP).
    expect(ramp(2).pp1).toBeCloseTo(2.6 - 1.5 + 2 * 0.25, 9);
    expect(ramp(2).old).toBeCloseTo(0.5 - 1.5 - 0.2, 9);
    expect(ramp(4).pp1).toBeCloseTo(2.0 - 1.5 + 0.5, 9);
    expect(ramp(6).pp1).toBeCloseTo(1.4 - 1.5 + 0.5, 9);
  });

  it("gives the same +1.6 through the engine: Dragon Oracle played and its first mode chosen at 2 → 3", () => {
    const g = position(5, [{ hand: [ORACLE, ...FILLER], playPoints: 2, maxPlayPoints: 2 }, { hand: FILLER }]);
    const before = viewOf(g);
    const oracle = g.state.players[0].zones.hand.find((id) => g.state.cards[id]!.printing === ORACLE)!;
    const d = g.decision!;
    const play = d.type === "mainPhase" ? d.actions.find((a) => a.type === "play" && a.card === oracle) : undefined;
    expect(play).toBeDefined();
    g.act({ type: "mainPhase", action: play! });
    expect(g.decision?.type).toBe("choose");
    g.act({ type: "choose", ids: ["1"] });
    const after = viewOf(g);
    expect([after.players[0].maxPlayPoints, after.players[0].playPoints]).toEqual([3, 0]);
    expect(pp1(after, me) - pp1(before, me)).toBeCloseTo(1.6, 9);
  });
});

describe("pp1: unused PP", () => {
  it("scores a view in the opponent's end phase as 'lost' (CR 7.4.5 is the last window before CR 7.2.2)", () => {
    const pass = position(6, [{ hand: [INSIGHT, ...FILLER], playPoints: 1, maxPlayPoints: 5 }, { hand: FILLER }]);
    const cast = position(6, [{ hand: [...FILLER, "SD04-003"], playPoints: 0, maxPlayPoints: 5 }, { hand: FILLER }]);
    const end = { phase: "end" as const, activePlayer: 1 as PlayerId };
    expect(pp1Parts(viewOf(pass, end), me).mode).toBe("lost");
    // Passing: −1 · 0.25; casting: 0 (the hand is the same size: Insight for the card drawn).
    expect(pp1(viewOf(cast, end), me) - pp1(viewOf(pass, end), me)).toBeCloseTo(0.25, 9);
    expect(evaluate(viewOf(cast, end), me) - evaluate(viewOf(pass, end), me)).toBeCloseTo(-0.1, 9);
  });

  it("doesn't penalise leftover PP a Quick card in hand can use, up to its cost", () => {
    const keep1 = position(5, [{ hand: [INSIGHT, ...FILLER], playPoints: 1, maxPlayPoints: 5 }, { hand: FILLER }]);
    expect(pp1Parts(viewOf(keep1), me)).toMatchObject({ mode: "held", unused: 1, reserve: 1, now: { pp: 0.2 } });
    const keep3 = position(5, [{ hand: [INSIGHT, ...FILLER], playPoints: 3, maxPlayPoints: 5 }, { hand: FILLER }]);
    expect(pp1Parts(viewOf(keep3), me).now.pp).toBeCloseTo(-0.3, 9);
    const none = position(5, [{ hand: FILLER, playPoints: 3, maxPlayPoints: 5 }, { hand: FILLER }]);
    expect(pp1Parts(viewOf(none), me).now.pp).toBeCloseTo(-0.75, 9);
    const theirMain = position(6, [{ hand: [INSIGHT, ...FILLER], playPoints: 1, maxPlayPoints: 5 }, { hand: FILLER }]);
    expect(pp1Parts(viewOf(theirMain), me)).toMatchObject({ mode: "held", reserve: 1 });
  });

  it("reserves the most PP a set of Quick cards fits in (hand and EX area), not cards it can't see", () => {
    const g = position(5, [{ hand: [INSIGHT, MISSILE, ...FILLER], ex: [INSIGHT], playPoints: 4, maxPlayPoints: 6 }, { hand: [INSIGHT, MISSILE], playPoints: 4, maxPlayPoints: 6 }]);
    const view = viewOf(g);
    const ours = view.players[0];
    expect(quickReserve(ours, 4)).toBe(4);
    expect(quickReserve(ours, 2)).toBe(2);
    expect(quickReserve({ ...ours, ex: [] }, 2)).toBe(1);
    expect(quickReserve(ours, 0)).toBe(0);
    // The opponent's hand is hidden from us: nothing reserved, every unused point wasted.
    expect(quickReserve(view.players[1], 4)).toBe(0);
    expect(pp1Parts(view, 1).now.pp).toBeCloseTo(-1, 9);
  });

  it("counts PP still spendable before the active side's main phase, or in it with mainAsEnd 0", () => {
    const g = position(5, [{ hand: FILLER, playPoints: 3, maxPlayPoints: 5 }, { hand: FILLER }]);
    expect(pp1Parts(viewOf(g, { phase: "start" }), me).now.pp).toBeCloseTo(0.15, 9);
    expect(pp1Parts(viewOf(g), me, pp1GreedyParams(PP1_DEFAULTS)).mode).toBe("spendable");
    expect(pp1Parts(viewOf(g), me).mode).toBe("held");
    expect(pp1Parts(viewOf(g, { phase: "end" }), me).mode).toBe("held");
  });
});

describe("pp1: the hand limit", () => {
  it("counts the non-active side's cards above 7 up to 9 (its discard is at its own end phase, CR 7.4.7); the active side keeps 7", () => {
    const hand = (n: number) => Array.from({ length: n }, (_, i) => FILLER[i % FILLER.length]!);
    const at = (ours: number, theirs: number) => viewOf(position(5, [{ hand: hand(ours) }, { hand: hand(theirs) }]));
    expect(pp1(at(5, 8), me) - pp1(at(5, 7), me)).toBeCloseTo(-1.5, 9);
    expect(pp1(at(5, 10), me) - pp1(at(5, 9), me)).toBeCloseTo(0, 9);
    expect(pp1(at(8, 5), me) - pp1(at(7, 5), me)).toBeCloseTo(0, 9);
  });

  it("scores a finished game as the hand-written evaluation does", () => {
    const view = viewOf(position(5, [{ hand: FILLER }, { hand: FILLER }]));
    const won = { ...view, result: { winner: me, losses: [] } };
    expect(pp1(won, me)).toBe(evaluate(won, me));
    expect(pp1(won, 1)).toBe(-1_000_000);
  });
});

describe("pp1: the greedy form at the opponent's end-phase window", () => {
  /** Player 1 (active, turn 6) ends its main phase; the game is played on to player 0's first decision: its CR 7.4.5 window. */
  function endWindow(ours: ScenarioSide, theirs: ScenarioSide): GameSession {
    const g = position(6, [ours, theirs]);
    g.act({ type: "mainPhase", action: { type: "endMainPhase" } } as Answer);
    for (let i = 0; i < 50 && g.decision && g.decision.player !== 0; i++) g.act(fastAnswer(g.decision, lookupFromReader(g.reader())));
    return g;
  }

  it("passes with mainAsEnd 1 (the refilled PP would count as reserve) and casts with the greedy form (mainAsEnd 0)", () => {
    // Magic Missile (3 PP, 2 damage to a follower + draw) with 3 unused PP; the opponent has a follower to hit.
    const g = endWindow({ hand: [MISSILE, ...FILLER], playPoints: 3, maxPlayPoints: 5 }, { hand: FILLER, field: ["SD04-003"] });
    expect(g.decision).toMatchObject({ type: "quick", player: 0 });
    expect(new GreedyBot(engine, { seed: "test:greedy", evaluator: pp1 }).decide(g.clone())).toMatchObject({ type: "quick", action: { type: "pass" } });
    expect(new GreedyBot(engine, { seed: "test:greedy", evaluator: pp1Evaluator(pp1GreedyParams(PP1_DEFAULTS)) }).decide(g.clone())).toMatchObject({ type: "quick", action: { type: "play" } });
  });
});
