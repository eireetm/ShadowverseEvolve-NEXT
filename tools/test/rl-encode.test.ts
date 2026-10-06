import { describe, expect, it } from "vitest";
import { evaluate } from "../../packages/bot/src";
import { createEngine, randomAnswer, seedRng, type PlayerId } from "../../packages/core/src";
import { ALL_CARDS, ALL_SCRIPTS } from "../../packages/core/src/sets";
import { DEFAULT_WEIGHTS } from "../../packages/bot/src";
import { dotTerms, evalTerms, termWeights, W1_TERMS } from "../rl/eval-terms";
import { npyBytes, readNpy as readNpyFile } from "../rl/npy";
import { bucketOf, labelOf, replaySamples, splitOf } from "../rl/sampling";
import { sampleDeck } from "../rl/series";
import { JOB_CONFIG } from "../train/job";

// The value network's samples (npm run rl:encode): where they are taken, their labels and split, the W1 terms, the files.
const engine = createEngine({ cards: ALL_CARDS, scripts: ALL_SCRIPTS });

/** A short game of random answers (the same config as the jobs'), with its inputs. */
function randomGame(seed: string) {
  const game = engine.newGame({ seed, players: [sampleDeck("sd01")!.deck, sampleDeck("sd02")!.deck], config: JOB_CONFIG });
  const rng = seedRng(`${seed}:answers`);
  const inputs: [PlayerId, unknown][] = [];
  for (let i = 0; game.decision && i < 3000; i++) {
    const d = game.decision;
    const answer = randomAnswer(rng, d);
    inputs.push([d.player, answer]);
    game.act(answer);
  }
  return { game, inputs };
}

/** A .npy file read back: its header's dtype and shape, and its values. */
function readNpy(bytes: Buffer) {
  expect(bytes.subarray(0, 6).toString("latin1")).toBe("\x93NUMPY");
  expect([bytes[6], bytes[7]]).toEqual([1, 0]);
  const length = bytes.readUInt16LE(8);
  expect((10 + length) % 64).toBe(0);
  const header = bytes.subarray(10, 10 + length).toString("latin1");
  expect(header.endsWith("\n")).toBe(true);
  const descr = /'descr': '([^']+)'/.exec(header)![1];
  const shape = /'shape': \(([^)]*)\)/.exec(header)![1]!.split(",").map((s) => s.trim()).filter(Boolean).map(Number);
  const data = bytes.subarray(10 + length);
  const values = descr === "<i2" ? new Int16Array(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)) : new Float32Array(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength));
  return { descr, shape, values: [...values] };
}

describe("sample points", () => {
  it("are the first main phase decision of the active player in each turn, once a turn, in order", () => {
    const { game: played, inputs } = randomGame("samples-1");
    const fresh = engine.newGame({ seed: "samples-1", players: [sampleDeck("sd01")!.deck, sampleDeck("sd02")!.deck], config: JOB_CONFIG });
    const turns: number[] = [];
    let last = -1;
    const it = replaySamples(fresh, inputs);
    let step = it.next();
    for (; !step.done; step = it.next()) {
      const { point, game } = step.value;
      expect(game.decision!.type).toBe("mainPhase");
      expect(game.decision!.player).toBe(game.state.activePlayer);
      expect(point.turn).toBeGreaterThan(last);
      last = point.turn;
      turns.push(point.turn);
    }
    // Every turn that reached its main phase has one; the replay ends where the game ended.
    expect(turns.length).toBeGreaterThan(3);
    expect(turns).toEqual([...new Set(turns)]);
    expect(step.value.result).toEqual(played.result);
    expect(step.value.state.turn).toBe(played.state.turn);
  }, 60_000);
});

describe("labels and splits", () => {
  it("labels a won game 1 / 0 and a draw 0.5 for both; the bucket of a seed never changes", () => {
    expect([labelOf(0, 0), labelOf(0, 1), labelOf(1, 1), labelOf(null, 0), labelOf(null, 1)]).toEqual([1, 0, 1, 0.5, 0.5]);
    // Pinned: the training and test sets are defined by it.
    expect([bucketOf("a"), bucketOf("b"), bucketOf("stage1-v1:2d789972:20261004-203507:3:28")]).toEqual(PINNED_BUCKETS);
    expect([splitOf(0), splitOf(79), splitOf(80), splitOf(89), splitOf(90), splitOf(99)]).toEqual([0, 0, 1, 1, 2, 2]);
    // Spread evenly: 10,000 seeds land 80 / 10 / 10 within 1.5 points.
    const counts = [0, 0, 0];
    for (let i = 0; i < 10_000; i++) counts[splitOf(bucketOf(`s:${i}`))]! += 1;
    expect(Math.abs(counts[0]! - 8000)).toBeLessThan(150);
    expect(Math.abs(counts[1]! - 1000)).toBeLessThan(150);
  });
});

describe("the W1 terms", () => {
  it("give the hand-written evaluation exactly with the default weights, whole numbers, at every sample point", () => {
    const { inputs } = randomGame("terms-1");
    const fresh = engine.newGame({ seed: "terms-1", players: [sampleDeck("sd01")!.deck, sampleDeck("sd02")!.deck], config: JOB_CONFIG });
    const weights = termWeights(DEFAULT_WEIGHTS);
    expect(weights).toHaveLength(W1_TERMS.length);
    let n = 0;
    for (const { game } of replaySamples(fresh, inputs)) {
      for (const viewer of [0, 1] as const) {
        const view = game.view(viewer);
        const t = evalTerms(view, viewer);
        for (const x of [...t.me, ...t.opp]) expect(Number.isInteger(x)).toBe(true);
        expect(Math.abs(dotTerms(weights, t.me, t.opp) - evaluate(view, viewer))).toBeLessThan(1e-9);
        n += 1;
      }
    }
    expect(n).toBeGreaterThan(6);
  }, 60_000);
});

describe(".npy files", () => {
  it("hold the values and shape numpy reads (header aligned to 64 bytes)", () => {
    const ints = Int16Array.from([1, -2, 3, 32767, -32768, 0]);
    const a = readNpy(npyBytes(ints, [2, 3]));
    expect(a).toEqual({ descr: "<i2", shape: [2, 3], values: [1, -2, 3, 32767, -32768, 0] });
    const floats = Float32Array.from([0.5, 1, 0]);
    const b = readNpy(npyBytes(floats, [3]));
    expect(b).toEqual({ descr: "<f4", shape: [3], values: [0.5, 1, 0] });
    expect(() => npyBytes(ints, [4, 2])).toThrow();
    // The tools' own reader (rl:encode reads its shards back with it).
    expect(readNpyFile(npyBytes(ints, [2, 3]))).toEqual({ shape: [2, 3], data: ints });
    expect(readNpyFile(npyBytes(floats, [3]))).toEqual({ shape: [3], data: floats });
  });
});

// Pinned buckets (computed once, 2026-10-06): a change would move games between the training and test sets.
const PINNED_BUCKETS = [84, 41, 50];
