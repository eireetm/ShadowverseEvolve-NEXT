import { describe, expect, it } from "vitest";
import { createEngine } from "../../packages/core/src";
import { ALL_CARDS, ALL_SCRIPTS } from "../../packages/core/src/sets";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT, deckSet, sampleDeck } from "../rl/series";
import { rulesOfRecorded } from "../train/code";
import { jobSetup, playJobGame, type Job, type JobFile } from "../train/job";

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
    // What the seed draws is what was played (rl:ingest checks recorded games against it).
    for (const g of [a, c]) expect(jobSetup(job, g.seed)).toEqual({ decks: g.decks, specs: g.bots });
  }, 60_000);
});

describe("recorded engine fingerprints", () => {
  it("read the first kit's (the app's engine) as the core's it stood for, any other as it is", () => {
    expect(rulesOfRecorded("b9dc4777f8bda25c")).toBe("fd673f23fa8ecdbc");
    expect(rulesOfRecorded("fd673f23fa8ecdbc")).toBe("fd673f23fa8ecdbc");
    expect(rulesOfRecorded("0123456789abcdef")).toBe("0123456789abcdef");
  });
});

describe("stage1-v1 games friends played", () => {
  // A seed whose game had a simulation failure (2026-10-05, the sd08 seat, near the end): a node of a sample made in the middle
  // of an action, where the game had ended, was rebuilt from its parent and asked for its decision's player.
  it("the game of a seed that hit a simulation failure plays without one now", () => {
    const file = JSON.parse(readFileSync(join(ROOT, "tools", "rl", "jobs", "stage1.json"), "utf8")) as JobFile;
    const stage1: Job = { ...file, deckLists: (deckSet(file.decks) ?? []).map((n) => sampleDeck(n)!), engine: "e", bot: "b", commit: "c", version: "v" };
    const g = playJobGame(engine, stage1, "stage1-v1:2d789972:20261005-153009:0:5", "2d789972");
    expect(g.error).toBeNull();
    expect(g.decks.map((d) => d.name)).toEqual(["sd08", "sd01"]);
    expect(g.result.winner).not.toBe("?");
    expect(g.problems).toEqual([
      { fallbacks: 0, simulationFailures: 0 },
      { fallbacks: 0, simulationFailures: 0 },
    ]);
  }, 600_000);
});
