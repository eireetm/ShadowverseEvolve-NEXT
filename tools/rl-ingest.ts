/**
 * Take the games friends made with the training kit (npm run release:train): npm run rl:ingest -- <folder> [--out <folder>]
 * [--recheck P] [--kit <folder>]
 * Reads every *.jsonl.gz under <folder> (the files of their training folders). A game is taken when it is a game of a job
 * in tools/rl/jobs made with the rules code this repository runs (the engine fingerprint: the games are replayed with it),
 * its inputs replay as recorded (each legal, the same end), it finished, and it isn't already in the dataset (its seed).
 * P percent of the games (default 3), chosen by their seeds, are also played again from the seed alone with the job's bots:
 * the answers must be the same one by one (the bots are deterministic), which catches a file that was changed. With this
 * repository's bots when they are the kit's (the bot fingerprint); otherwise with the kit itself — the folder given with
 * --kit, or a SVEN-train-* folder beside the repository whose job.json has the games' bot fingerprint — since the bots go
 * on changing while friends play an older kit. Without such a kit, those games are taken unchecked (said in the report).
 * Games taken are
 * appended to <out>/games.jsonl.gz (default: rl-runs/<job> beside the repository, one folder per job); a report
 * (<out>/ingest-<time>.json, and printed) says how many of each volunteer's games were taken and why the others weren't.
 */
import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
import { constants, gunzipSync, gzipSync } from "node:zlib";
import { createEngine, validateAnswer } from "../packages/core/src";
import { ALL_CARDS, ALL_SCRIPTS } from "../packages/core/src/sets";
import { rulesFingerprint } from "../packages/gui/fingerprint";
import { ROOT, deckSet, sampleDeck } from "./rl/series";
import { botFingerprint } from "./train/code";
import { playJobGame, type Job, type JobFile, type JobGame } from "./train/job";

const args = process.argv.slice(2);
const option = (name: string) => {
  const at = args.indexOf(name);
  return at >= 0 ? (args[at + 1] ?? null) : null;
};
const source = args.find((a, i) => !a.startsWith("--") && !(i > 0 && ["--out", "--recheck", "--kit"].includes(args[i - 1]!)));
const recheck = option("--recheck") === null ? 3 : Number(option("--recheck"));
if (!source || !existsSync(source) || !(recheck >= 0 && recheck <= 100)) {
  console.error("usage: npm run rl:ingest -- <folder> [--out <folder>] [--recheck percent]");
  process.exit(1);
}

const engine = createEngine({ cards: ALL_CARDS, scripts: ALL_SCRIPTS });
// The core's fingerprint (the kit's games are played and replayed with the core alone).
const fingerprint = rulesFingerprint(join(ROOT, "packages", "gui"));
const bots = botFingerprint(ROOT);
// The jobs this repository knows, with their decks (as the kit was built with them).
const jobs = new Map<string, Job>();
for (const name of readdirSync(join(ROOT, "tools", "rl", "jobs")).filter((f) => f.endsWith(".json"))) {
  const file = JSON.parse(readFileSync(join(ROOT, "tools", "rl", "jobs", name), "utf8")) as JobFile;
  const names = deckSet(file.decks) ?? [];
  jobs.set(file.id, { ...file, deckLists: names.map((n) => sampleDeck(n)!), engine: fingerprint, bot: bots, commit: "", version: "" });
}

/** Every .jsonl.gz under a folder (or the file itself). */
function filesIn(path: string): string[] {
  if (!statSync(path).isDirectory()) return path.endsWith(".jsonl.gz") ? [path] : [];
  return readdirSync(path).flatMap((name) => filesIn(join(path, name)));
}
/** The games of a file of gzip pieces; a file cut short gives what it has. */
function gamesOf(file: string): { games: JobGame[]; broken: number } {
  const games: JobGame[] = [];
  let broken = 0;
  let text = "";
  try {
    text = gunzipSync(readFileSync(file), { finishFlush: constants.Z_SYNC_FLUSH }).toString("utf8");
  } catch {
    return { games, broken: 1 };
  }
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      games.push(JSON.parse(line) as JobGame);
    } catch {
      broken += 1;
    }
  }
  return { games, broken };
}

/** Why the game can't be taken, or null. */
function problem(g: JobGame): string | null {
  const job = jobs.get(g.job);
  if (g.format !== "sve-arena-game" || g.version !== 1 || !job) return `not a game of a known job (${String(g.job)})`;
  if (g.engine?.fingerprint !== fingerprint) return "other rules code (a kit of an older or newer engine)";
  if (g.error || g.result.winner === "?") return "unfinished";
  const game = engine.newGame({ seed: g.seed, players: [g.decks[0]!.deck, g.decks[1]!.deck], config: g.config });
  for (const [player, input] of g.inputs) {
    const d = game.decision;
    if (!d || d.player !== player || validateAnswer(d, input) !== null) return "an input that doesn't fit";
    game.act(input);
  }
  if (!game.result || game.result.winner !== g.result.winner || game.state.turn !== g.result.turns) return "doesn't end as recorded";
  return null;
}

/** Played again from the seed with the job's bots: the same answers? (P percent, chosen by the seed's hash.) */
const chosen = (seed: string) => parseInt(createHash("sha256").update(seed).digest("hex").slice(0, 8), 16) % 10_000 < recheck * 100;
function playsAgain(g: JobGame): boolean {
  const again = playJobGame(engine, jobs.get(g.job)!, g.seed, g.volunteer);
  return JSON.stringify(again.inputs) === JSON.stringify(g.inputs) && JSON.stringify(again.decks) === JSON.stringify(g.decks);
}

/** A kit folder whose bots are of this fingerprint: --kit, or a SVEN-train-* folder beside the repository. */
function kitOf(bot: string): string | null {
  const candidates = option("--kit") ? [resolve(option("--kit")!)] : readdirSync(join(ROOT, "..")).filter((n) => n.startsWith("SVEN-train-")).map((n) => join(ROOT, "..", n));
  for (const dir of candidates) {
    try {
      const kitJob = JSON.parse(readFileSync(join(dir, "job.json"), "utf8")) as Job;
      if (kitJob.bot === bot && existsSync(join(dir, "train.mjs"))) return dir;
    } catch {
      // not a kit
    }
  }
  return null;
}
/** Games of other bots' code played again by their kit: the seeds whose answers differ (null: no kit for them). */
function kitRecheck(bot: string, games: JobGame[]): Set<string> | null {
  const kit = kitOf(bot);
  if (!kit) return null;
  const list = join(tmpdir(), `sve-recheck-${process.pid}-${bot}.json`);
  writeFileSync(list, JSON.stringify(games.map((g) => ({ seed: g.seed, volunteer: g.volunteer }))));
  const output = execFileSync(process.execPath, [join(kit, "train.mjs"), "--recheck", list], { encoding: "utf8", maxBuffer: 2 ** 30 });
  const again = new Map(output.split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l) as { seed: string; inputs: unknown }).map((r) => [r.seed, JSON.stringify(r.inputs)]));
  return new Set(games.filter((g) => again.get(g.seed) !== JSON.stringify(g.inputs)).map((g) => g.seed));
}

const taken = new Map<string, JobGame[]>();
const seen = new Map<string, Set<string>>();
const report: Record<string, { taken: number; rejected: Record<string, number> }> = {};
const reject = (volunteer: string, why: string) => {
  const r = (report[volunteer] ??= { taken: 0, rejected: {} });
  r.rejected[why] = (r.rejected[why] ?? 0) + 1;
};
const outOf = (jobId: string) => resolve(option("--out") ?? join(ROOT, "..", "rl-runs", jobId));
const files = filesIn(source);
let rechecked = 0;
let unchecked = 0;
/** Games of other bots' code chosen for the check, by bot fingerprint (checked by their kit at the end). */
const byKit = new Map<string, JobGame[]>();
for (const file of files) {
  const { games, broken } = gamesOf(file);
  if (broken > 0) reject("?", `a broken piece of ${file}`);
  for (const g of games) {
    const volunteer = String(g.volunteer ?? "?");
    // Seeds already in the dataset, or taken from another file.
    if (!seen.has(g.job)) {
      const known = new Set<string>();
      const existing = join(outOf(g.job), "games.jsonl.gz");
      if (existsSync(existing)) for (const old of gamesOf(existing).games) known.add(old.seed);
      seen.set(g.job, known);
    }
    const known = seen.get(g.job)!;
    let why = known.has(g.seed) ? "already taken" : problem(g);
    if (!why && chosen(g.seed)) {
      if (g.engine.bot === bots) {
        rechecked += 1;
        if (!playsAgain(g)) why = "played again from its seed, the answers differ";
      } else {
        if (!byKit.has(g.engine.bot)) byKit.set(g.engine.bot, []);
        byKit.get(g.engine.bot)!.push(g);
      }
    }
    if (why) {
      reject(volunteer, why);
      continue;
    }
    known.add(g.seed);
    (report[volunteer] ??= { taken: 0, rejected: {} }).taken += 1;
    if (!taken.has(g.job)) taken.set(g.job, []);
    taken.get(g.job)!.push(g);
  }
}
// The games of other bots' code chosen for the check, played again by their kit; the ones that differ are taken back out.
for (const [bot, games] of byKit) {
  const differ = kitRecheck(bot, games);
  if (differ === null) {
    unchecked += games.length;
    continue;
  }
  rechecked += games.length;
  for (const g of games.filter((x) => differ.has(x.seed))) {
    const list = taken.get(g.job)!;
    list.splice(list.indexOf(g), 1);
    seen.get(g.job)!.delete(g.seed);
    report[String(g.volunteer ?? "?")]!.taken -= 1;
    reject(String(g.volunteer ?? "?"), "played again from its seed by its kit, the answers differ");
  }
}
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
for (const [jobId, games] of taken) {
  const dir = outOf(jobId);
  mkdirSync(dir, { recursive: true });
  for (const g of games) appendFileSync(join(dir, "games.jsonl.gz"), gzipSync(JSON.stringify(g) + "\n"));
  writeFileSync(join(dir, `ingest-${stamp}.json`), JSON.stringify({ source: resolve(source), files: files.length, recheckPercent: recheck, rechecked, unchecked, engine: fingerprint, bots, report }, null, 1));
  console.log(`${jobId}: ${games.length} games taken into ${join(dir, "games.jsonl.gz")}`);
}
console.log(`${files.length} files; engine ${fingerprint}, bots ${bots}; played again from the seed: ${rechecked}${unchecked > 0 ? `; ${unchecked} chosen but not checked (no kit of their bots' code beside the repository: --kit)` : ""}`);
for (const [volunteer, r] of Object.entries(report)) {
  const rejected = Object.entries(r.rejected).map(([why, n]) => `${n} ${why}`).join(", ");
  console.log(`  ${volunteer}: ${r.taken} taken${rejected ? `; not taken: ${rejected}` : ""}`);
}
if (taken.size === 0) console.log("nothing taken");
