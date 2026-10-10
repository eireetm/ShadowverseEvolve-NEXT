import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createEngine } from "../../packages/core/src";
import { ALL_CARDS, ALL_SCRIPTS } from "../../packages/core/src/sets";
import { rulesFingerprint } from "../../packages/gui/fingerprint";
import { readNpy } from "../rl/npy";
import { ROOT, sampleDeck } from "../rl/series";
import { botFingerprint } from "../train/code";
import { playJobGame, type Job } from "../train/job";

// rl:encode --encoder 2 end to end, on a few generated Easy-against-Easy games (tests can't read rl-runs): the checks on the
// real game pass (counts against the engine C12, evolve cards C14, pools C15, hidden information C16, ranges C17), the
// int32 arrays read back, y / side / w1 are encoder v1's bytes (C10), and 1 or 2 processes write the same bytes (C22).
const engine = createEngine({ cards: ALL_CARDS, scripts: ALL_SCRIPTS });
let dir = "";
const tool = (...args: string[]) => {
  try {
    return execFileSync(process.execPath, ["--import", "tsx", join(ROOT, "tools", "rl-encode.ts"), ...args, "--no-registry"], { cwd: ROOT, encoding: "utf8", timeout: 600_000 });
  } catch (e) {
    // A check that fails makes the tool exit 1; the report is still written.
    return (e as { stdout?: string }).stdout ?? "";
  }
};
const report = (out: string) => readFileSync(join(out, "report.txt"), "utf8");
const line = (out: string, check: string) => report(out).split("\n").find((l) => l.includes(check)) ?? "";

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "enc-v2-"));
  const job: Job = {
    id: "test-easy",
    description: "generated games for the encoder v2 tool test",
    format: "standard",
    restrictionList: "10_26_JPN",
    decks: "train",
    mirror: true,
    games: [{ weight: 1, bots: [{ level: "easy" }, { level: "easy" }] }],
    deckLists: ["sd01", "sd07", "csd02a", "pcs01"].map((name) => ({ name, deck: sampleDeck(name)!.deck })),
    engine: rulesFingerprint(join(ROOT, "packages", "gui")),
    bot: botFingerprint(ROOT),
    commit: "test",
    version: "test",
  };
  const games = [0, 1, 2, 3].map((i) => playJobGame(engine, job, `enc-v2-test-${i}`, "test"));
  writeFileSync(join(dir, "games.jsonl.gz"), gzipSync(games.map((g) => JSON.stringify(g)).join("\n") + "\n"));
  tool(dir, "--workers", "1", "--leak-every", "4", "--out", join(dir, "enc-v1"));
  tool(dir, "--encoder", "2", "--workers", "1", "--leak-every", "4", "--out", join(dir, "a"));
  tool(dir, "--encoder", "2", "--workers", "2", "--leak-every", "4", "--out", join(dir, "b"), "--compare-with", join(dir, "a"));
}, 900_000);

afterAll(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

describe("rl:encode --encoder 2", () => {
  it("passes the checks on the real game", () => {
    const a = join(dir, "a");
    for (const check of ["C11", "C12", "C14", "C15", "C16", "C17", "C20 汇总向量"]) expect(line(a, check), check).toMatch(/^通过/);
    // The counts were compared at all.
    expect(line(a, "C12")).not.toMatch(/：0 次/);
  });

  it("writes y / side / w1 as encoder v1 does, and the same bytes with 1 or 2 processes", () => {
    expect(line(join(dir, "a"), "C10")).toMatch(/^通过/);
    expect(line(join(dir, "a"), "C10")).not.toMatch(/：0 个/);
    expect(line(join(dir, "b"), "C22")).toMatch(/^通过/);
  });

  it("writes int32 offsets numpy reads, consistent with the rows", () => {
    const a = join(dir, "a");
    const off = readNpy(readFileSync(join(a, "off-0000.npy")));
    const glob = readNpy(readFileSync(join(a, "glob-0000.npy")));
    const card = readNpy(readFileSync(join(a, "card-0000.npy")));
    const pile = readNpy(readFileSync(join(a, "pile-0000.npy")));
    expect(off.data).toBeInstanceOf(Int32Array);
    expect(off.shape).toEqual([glob.shape[0]! + 1, 2]);
    expect(glob.shape[1]).toBe(159);
    expect([off.data[off.data.length - 2], off.data[off.data.length - 1]]).toEqual([card.shape[0], pile.shape[0]]);
    const meta = JSON.parse(readFileSync(join(a, "meta.json"), "utf8")) as { formatVersion: number; encoder: { version: number; pooled: { dims: number } } };
    expect([meta.formatVersion, meta.encoder.version, meta.encoder.pooled.dims]).toEqual([2, 2, 6735]);
  });
});
