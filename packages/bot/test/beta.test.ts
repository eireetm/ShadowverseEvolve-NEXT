import { describe, expect, it } from "vitest";
import { createEngine, seedRng, validateAnswer, type Answer, type GameSession } from "../src/core";
import {
  GreedyBot,
  HARD_BETA_OPTIONS,
  LEADER_CURVE,
  MEDIUM_BETA_OPTIONS,
  PlannerBot,
  curveScore,
  curveValue,
  redrawByExpectation,
  redrawKnowingDeck,
} from "../src";
import { ALL_CARDS, ALL_SCRIPTS } from "../../core/src/sets";
import { checkInvariants, deckPool, randomDeck } from "../../core/src/testing";

// The beta bots: Medium and Hard with a mulligan by the curve and the leader's defense valued on a curve (their sure lethal
// first is Medium's and Hard's: lethal.test.ts).

describe("the mulligan by the curve (CR 6.2.1.8)", () => {
  const inHand = (costs: number[]) => costs.map((cost) => ({ cost, from: 1 }));

  it("scores cards by the play points they use in the first four turns", () => {
    expect(curveScore(inHand([1, 2, 3, 4]))).toBeCloseTo(3.2);
    expect(curveScore(inHand([6, 7, 8, 9]))).toBe(0);
    // A card drawn later is played from that turn on: 2 of turn 3's 3 play points.
    expect(curveScore([{ cost: 2, from: 3 }])).toBeCloseTo(2 / 3);
  });

  it("knowing the deck's order (the hard bot cheats), redraws expensive cards when cheap ones are on top, keeps a good hand", () => {
    expect(redrawKnowingDeck([7, 8, 9, 9], [1, 2, 3, 4, 2, 3, 4], true)).toBe(true);
    expect(redrawKnowingDeck([1, 2, 3, 4], [8, 9, 9, 8, 7, 7, 7], true)).toBe(false);
  });

  it("not knowing it, compares the hand with what the rest of the deck gives on average", () => {
    const deck = [...Array<number>(30).fill(2), ...Array<number>(6).fill(8)];
    expect(redrawByExpectation([8, 8, 9, 9], deck, true, seedRng("m"))).toBe(true);
    expect(redrawByExpectation([1, 2, 3, 4], deck, true, seedRng("m"))).toBe(false);
  });
});

describe("the leader curve", () => {
  const point = (n: number) => curveValue(n, LEADER_CURVE) - curveValue(n - 1, LEADER_CURVE);

  it("values the last points of defense most, spare ones at full defense least", () => {
    expect(point(1)).toBeCloseTo(2.5, 1);
    expect(point(10)).toBeCloseTo(1.1, 1);
    expect(point(20)).toBeCloseTo(0.78, 1);
  });

  it("goes on below zero (a threat larger than the defense): more defense is still better", () => {
    expect(curveValue(-2, LEADER_CURVE)).toBeLessThan(curveValue(-1, LEADER_CURVE));
    expect(curveValue(-1, LEADER_CURVE)).toBeLessThan(curveValue(0, LEADER_CURVE));
  });
});

describe("the beta bots in whole games", () => {
  const engine = createEngine({ cards: ALL_CARDS, scripts: ALL_SCRIPTS });
  const pool = deckPool(engine);

  it("medium beta and hard beta play whole games against the greedy bot: legal answers, every game ends", () => {
    for (const [i, options] of [MEDIUM_BETA_OPTIONS, HARD_BETA_OPTIONS].entries()) {
      const g = engine.newGame({ seed: `beta-${i}`, players: [randomDeck(pool, `beta-${i}/0`), randomDeck(pool, `beta-${i}/1`)], config: { deckRestrictions: false } });
      const beta = new PlannerBot(engine, { seed: `b${i}`, ...options });
      const greedy = new GreedyBot(engine, { seed: `g${i}` });
      const players: [(game: GameSession) => Answer, (game: GameSession) => Answer] = [(game) => beta.decide(game), (game) => greedy.decide(game)];
      for (let n = 0; g.decision && n < 20_000; n++) {
        const d = g.decision;
        const answer = players[d.player](g);
        expect(validateAnswer(d, answer), `${d.type}: ${JSON.stringify(answer)}`).toBeNull();
        g.act(answer);
        expect(checkInvariants(g.state, engine.db, g.decision)).toEqual([]);
      }
      expect(g.result, `game ${i}`).not.toBeNull();
      expect([beta.stats.fallbacks, beta.stats.simulationFailures, beta.stats.lastError], `game ${i}`).toEqual([0, 0, null]);
    }
  }, 600_000);
});
