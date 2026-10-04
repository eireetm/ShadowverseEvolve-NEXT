import { describe, expect, it } from "vitest";
import { createEngine } from "../../packages/core/src";
import { ALL_CARDS, ALL_SCRIPTS } from "../../packages/core/src/sets";
import { sampleDeck } from "../rl/series";
import { playJobGame, type Job } from "../train/job";

// The training kit's games (tools/train): a game is fixed by its seed, so npm run rl:ingest can play it again and compare.
const engine = createEngine({ cards: ALL_CARDS, scripts: ALL_SCRIPTS });
const job: Job = {
  id: "test-job",
  description: "two Easy bots",
  format: "standard",
  restrictionList: "10_26_JPN",
  decks: "train",
  mirror: false,
  games: [{ weight: 1, bots: [{ level: "easy" }, { level: "easy" }] }],
  deckLists: [sampleDeck("sd01")!, sampleDeck("sd02")!],
  engine: "e",
  bot: "b",
  commit: "c",
  version: "v",
};

describe("job games", () => {
  it("are the same game for the same seed, another for another seed", () => {
    const a = playJobGame(engine, job, "test-job:v:r:0:0", "v");
    const b = playJobGame(engine, job, "test-job:v:r:0:0", "v");
    const c = playJobGame(engine, job, "test-job:v:r:0:1", "v");
    expect(a.error).toBeNull();
    expect(a.result.winner).not.toBe("?");
    expect(JSON.stringify(b.inputs)).toBe(JSON.stringify(a.inputs));
    expect(JSON.stringify(c.inputs)).not.toBe(JSON.stringify(a.inputs));
    // Two different decks (mirror off), the job's fingerprints, nothing explored by the greedy bots.
    expect(a.decks[0]!.name).not.toBe(a.decks[1]!.name);
    expect(a.engine).toEqual({ fingerprint: "e", bot: "b", commit: "c" });
    expect(a.explored).toEqual([[], []]);
  }, 60_000);
});
