import { describe, expect, it } from "vitest";
import { createEngine } from "../src/core";
import { CLOSE_DEFAULTS, DEFAULT_WEIGHTS, MEDIUM_OPTIONS, PlannerBot, closeIdentity, closeProblems, isClose, type CloseSampleOptions } from "../src";
import { drive, testFollower } from "../../core/src/testing";

// More samples where the two-turn comparison is close (PlannerBotOptions.closeSamples, close-samples.ts), and the opponent's
// lethal search with its own budget in the two-turn model (replyLethalOpp).

const cards = createEngine({ cards: [testFollower("FILLER", 1, 1, 1), testFollower("BIG", 4, 6, 6)], scripts: {} });

interface Plan {
  id: string;
  unsure?: true;
}
interface Internals {
  look: unknown;
  pick(candidates: Plan[], values: number[], turn: number): Plan;
  refine(candidates: Plan[], values: number[], best: number): { values: number[]; best: number };
  sampleValue(plan: Plan, index: number, w: number, look: unknown): number;
}

/**
 * A planner whose latest comparison had these plans' values in 3 samples (raw; `bound` marks a cut's bound), the values
 * pick() is given (raw averages less `charge`), and samples after the third read from `more` (counted).
 */
function rigged(o: Partial<CloseSampleOptions>, raw: Record<string, number[]>, more: Record<string, number[]>, charge: Record<string, number> = {}, bound: Record<string, number> = {}) {
  const bot = new PlannerBot(cards, { closeSamples: { ...CLOSE_DEFAULTS, ...o } });
  const b = bot as unknown as Internals;
  const plans: Plan[] = Object.keys(raw).map((id) => ({ id }));
  const rows = new Map(plans.map((p, index) => [p, { index, values: raw[p.id]!.map((value, w) => ({ value, bound: bound[p.id] === w })) }]));
  b.look = { seed: "s", game: null, me: 0, turn: 3, world: null, worlds: 3, rows, memo: new WeakMap() };
  const calls: string[] = [];
  b.sampleValue = (plan, _index, w) => {
    calls.push(`${plan.id}:${w}`);
    // A cut sample played again exactly: its value in `more` at that index (the samples after the third follow).
    return w < 3 ? more[`${plan.id}@${w}`]![0]! : more[plan.id]![w - 3]!;
  };
  const values = plans.map((p) => raw[p.id]!.reduce((a, x) => a + x, 0) / 3 - (charge[p.id] ?? 0));
  return { bot, b, plans, values, calls };
}

describe("closeSamples: more samples where the comparison is close", () => {
  it("names its parameters, refuses bad ones, and tells close by the spread of the lead", () => {
    expect(CLOSE_DEFAULTS).toEqual({ max: 8, z: 2, margin: 0, most: 3 });
    expect(closeIdentity(CLOSE_DEFAULTS)).toBe("close=8:z=2,margin=0,most=3");
    expect(closeProblems({ ...CLOSE_DEFAULTS, max: 1, most: 1 })).toEqual(["max=1: a whole number from 2 to 16", "most=1: a whole number from 2 to 16"]);
    // A lead of 0.5 over samples that move by several points: close; a lead of 2 the same in every sample: not.
    expect(isClose([10, 6, 14], [9, 7, 12.5], 0.5, { z: 2, margin: 0 })).toBe(true);
    expect(isClose([12, 12, 12], [10, 10, 10], 2, { z: 2, margin: 0 })).toBe(false);
    expect(isClose([12, 12, 12], [10, 10, 10], 2, { z: 2, margin: 2 })).toBe(true);
    // A lethal in one sample of the best: the widest spread there is, close.
    const win = DEFAULT_WEIGHTS.win;
    expect(isClose([win, 5, 5], [6, 5, 5], (win - 1) / 3, { z: 2, margin: 0 })).toBe(true);
    expect(isClose([win, win, win], [6, 5, 5], win - 16 / 3, { z: 2, margin: 0 })).toBe(false);
  });

  it("a close plan and the best are played in the samples after those, up to max, and compared by the longer averages", () => {
    // A leads by 0.5 in 3 samples; in the next 5, B is better.
    const { bot, b, plans, values, calls } = rigged({ max: 8 }, { A: [10, 6, 14], B: [9, 7, 12.5], C: [-20, -20, -20] }, { A: [8, 8, 8, 8, 8], B: [11, 11, 11, 11, 11] });
    const out = b.refine(plans, values, 0);
    expect(calls.sort()).toEqual(["A:3", "A:4", "A:5", "A:6", "A:7", "B:3", "B:4", "B:5", "B:6", "B:7"]);
    expect(out.best).toBe(1);
    expect(out.values[0]).toBeCloseTo((30 + 40) / 8);
    expect(out.values[1]).toBeCloseTo((28.5 + 55) / 8);
    expect(out.values[2]).toBe(values[2]);
    expect(bot.closeStats).toEqual({ comparisons: 1, refined: 1, extraSamples: 10, recomputed: 0, changed: 1 });
    // The caller's array is left as it was; asked again with it, the same answer without playing anything again.
    expect(values[0]).toBeCloseTo(10);
    expect(b.refine(plans, values, 0)).toBe(out);
    expect(calls).toHaveLength(10);
    expect(b.pick(plans, values, 3)).toBe(plans[1]);
  });

  it("nothing close: nothing played; a plan already won is left as it is", () => {
    const far = rigged({}, { A: [12, 12, 12], B: [10, 10, 10] }, {});
    expect(far.b.refine(far.plans, far.values, 0)).toEqual({ values: far.values, best: 0 });
    expect(far.calls).toEqual([]);
    expect(far.bot.closeStats.refined).toBe(0);
    const win = DEFAULT_WEIGHTS.win;
    const won = rigged({}, { A: [win, win, win], B: [win, win, win - 1] }, {});
    expect(won.b.refine(won.plans, won.values, 0).values).toBe(won.values);
    expect(won.bot.closeStats.comparisons).toBe(0);
  });

  it("a plan's charge stays as it was: its value moves by its raw average's change", () => {
    const { b, plans, values } = rigged({ max: 5 }, { A: [10, 6, 14], B: [10.5, 7.5, 12.5] }, { A: [10, 10], B: [12, 12] }, { B: 1.5 });
    // Raw: A 10, B a sixth above it; B charged a point and a half, so A leads by a point and a third, the spread a few points: close.
    const out = b.refine(plans, values, 0);
    expect(out.values[0]).toBeCloseTo((30 + 20) / 5);
    expect(out.values[1]).toBeCloseTo((30.5 + 24) / 5 - 1.5);
  });

  it("a cut sample (a bound above the plan's value) is played again exactly before the plan is judged close", () => {
    // B's last sample is a cut's bound 17 (B looks close, the lead's spread wide); played exactly it is 6: B is behind by 4
    // in every sample, not close, and nothing more is played.
    const { b, plans, values, calls, bot } = rigged({ max: 8 }, { A: [10, 10, 10], B: [6, 6, 17] }, { "B@2": [6], A: [], B: [] }, {}, { B: 2 });
    const out = b.refine(plans, values, 0);
    expect(calls).toEqual(["B:2"]);
    expect(bot.closeStats.recomputed).toBe(1);
    expect(bot.closeStats.refined).toBe(0);
    expect(out.values[1]).toBeCloseTo(6);
    expect(out.best).toBe(0);
  });

  it("in a real two-turn comparison: legal, and the same answer again", () => {
    const run = () => {
      const t = drive(cards, { me: { hand: ["BIG", "FILLER", "FILLER"], field: ["FILLER"], deck: Array(10).fill("FILLER"), playPoints: 5, maxPlayPoints: 5 }, opp: { field: ["BIG"], deck: Array(10).fill("BIG"), leaderDefense: 12 } });
      const bot = new PlannerBot(cards, { ...MEDIUM_OPTIONS, lookahead: 2, samples: 3, lethalSearch: 0, seed: "c", closeSamples: { ...CLOSE_DEFAULTS, max: 5 }, commonRandom: true });
      const answer = bot.decide(t.game);
      return { answer, stats: { ...bot.closeStats }, problems: [bot.stats.fallbacks, bot.stats.simulationFailures] };
    };
    const first = run();
    expect(first.problems).toEqual([0, 0]);
    expect(first.stats.comparisons).toBeGreaterThan(0);
    expect(run()).toEqual(first);
  }, 120_000);
});

describe("replyLethalOpp: the opponent's lethal search in the two-turn model with its own budget", () => {
  it("searches for the opponent's lethal there when only it is given (replyLethal 0), and not with neither", () => {
    // Our leader at 6, the opponent's BIG (6 attack) on the field: their lethal is within reach in their turn.
    const run = (options: object) => {
      const t = drive(cards, { me: { hand: ["FILLER"], deck: Array(10).fill("FILLER"), playPoints: 1, maxPlayPoints: 1, leaderDefense: 6 }, opp: { field: ["BIG"], deck: Array(10).fill("BIG"), leaderDefense: 20 } });
      const bot = new PlannerBot(cards, { ...MEDIUM_OPTIONS, lookahead: 2, samples: 2, lethalSearch: 0, replyLethal: 0, seed: "o", ...options });
      bot.decide(t.game);
      expect([bot.stats.fallbacks, bot.stats.simulationFailures]).toEqual([0, 0]);
      return bot.stats.simulations;
    };
    // A lethal found ends the opponent's simulated turn there (no search of their plans): fewer simulations, not more. Here
    // only the opponent's level is reached (we lose there), so replyLethal on both levels does the same.
    const none = run({});
    const opp = run({ replyLethalOpp: 400 });
    expect(opp).not.toBe(none);
    expect(run({ replyLethal: 400 })).toBe(opp);
    expect(run({ replyLethalOpp: 400, replyLethalKey: "position" })).not.toBe(none);
  }, 120_000);
});
