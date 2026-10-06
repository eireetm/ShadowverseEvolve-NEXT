/**
 * Take the games friends made with the training kit (npm run release:train): npm run rl:ingest -- <folder> [--out <folder>]
 * [--recheck P] [--kit <folder>] [--workers N]
 * Reads every *.jsonl.gz under <folder> (the files of their training folders). A game is taken when it is a game of a job
 * in tools/rl/jobs made with the rules code this repository runs (the engine fingerprint: the games are replayed with it;
 * an older kit's own kind of fingerprint is read as the core's it stood for, tools/train/code.ts), it is the game its seed
 * draws (the kind of game, the decks, the seats and the job's settings: tools/train/job.ts jobSetup), its inputs replay as
 * recorded (each legal, the same end), it finished, and it isn't already in the dataset (its seed).
 * P percent of the games (default 3), chosen by their seeds, are also played again from the seed alone with the job's bots:
 * the answers must be the same one by one (the bots are deterministic), which catches a file that was changed. With a kit
 * of the same job, rules code and bots — the folder given with --kit, or a SVEN-train-* folder beside the repository — on N
 * processes at once (default: half the processor threads, fewer when memory is short), since the bots go on changing while
 * friends play an older kit; without such a kit, with this repository's bots when they are the games' (one process); and
 * otherwise not at all (said in the report, as are games whose check failed to run). Games taken are appended to
 * <out>/games.jsonl.gz (default: rl-runs/<job> beside the repository, one folder per job); a report (<out>/ingest-<time>.json,
 * and printed) says how many games of each volunteer and of each file were taken and why the others weren't.
 */
import { spawn } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { availableParallelism, freemem, tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { join, relative, resolve } from "node:path";
import { gzipSync } from "node:zlib";
import { createEngine, validateAnswer } from "../packages/core/src";
import { ALL_CARDS, ALL_SCRIPTS } from "../packages/core/src/sets";
import { rulesFingerprint } from "../packages/gui/fingerprint";
import { gamesOf } from "./rl/records";
import { ROOT, deckSet, sampleDeck } from "./rl/series";
import { botFingerprint, rulesOfRecorded } from "./train/code";
import { JOB_CONFIG, jobSetup, playJobGame, type Job, type JobFile, type JobGame } from "./train/job";

const args = process.argv.slice(2);
const option = (name: string) => {
  const at = args.indexOf(name);
  return at >= 0 ? (args[at + 1] ?? null) : null;
};
const source = args.find((a, i) => !a.startsWith("--") && !(i > 0 && ["--out", "--recheck", "--kit", "--workers"].includes(args[i - 1]!)));
const recheck = option("--recheck") === null ? 3 : Number(option("--recheck"));
// A kit's recheck process takes about 500 MB: leave the system 1.5 GB, as the kit itself does.
const memoryWorkers = Math.max(1, Math.floor((freemem() - 1.5 * 2 ** 30) / (600 * 2 ** 20)));
const workers = option("--workers") === null ? Math.max(1, Math.min(Math.floor(availableParallelism() / 2), memoryWorkers)) : Number(option("--workers"));
if (!source || !existsSync(source) || !(recheck >= 0 && recheck <= 100) || !(Number.isInteger(workers) && workers >= 1)) {
  console.error("usage: npm run rl:ingest -- <folder> [--out <folder>] [--recheck percent] [--kit <folder>] [--workers N]");
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

/** JSON with the keys of every object in order: the same value gives the same text, whatever order it was written in. */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_, v: unknown) =>
    v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : v,
  );
}
const isGame = (g: unknown): g is JobGame =>
  typeof g === "object" &&
  g !== null &&
  typeof (g as JobGame).job === "string" &&
  jobs.has((g as JobGame).job) &&
  typeof (g as JobGame).seed === "string" &&
  Array.isArray((g as JobGame).inputs) &&
  Array.isArray((g as JobGame).decks);

/**
 * The jobs a recorded game can be checked against: this repository's, and the job.json of each kit of the same job and rules
 * code beside the repository (a kit carries the decks as they were when it was built: a sample deck edited since doesn't make
 * its games look changed by hand). Edit a job's decks or bots only under a new job id.
 */
const kitJobs: Job[] = (option("--kit") ? [resolve(option("--kit")!)] : readdirSync(join(ROOT, "..")).filter((n) => n.startsWith("SVEN-train-")).map((n) => join(ROOT, "..", n))).flatMap((dir) => {
  try {
    const kitJob = JSON.parse(readFileSync(join(dir, "job.json"), "utf8")) as Job;
    return jobs.has(kitJob.id) && rulesOfRecorded(kitJob.engine) === fingerprint ? [kitJob] : [];
  } catch {
    return [];
  }
});
const referencesOf = (jobId: string): Job[] => [jobs.get(jobId)!, ...kitJobs.filter((k) => k.id === jobId)];

/** Why the game can't be taken, or null. */
function problem(g: JobGame): string | null {
  const job = jobs.get(g.job)!;
  if (g.format !== "sve-arena-game" || g.version !== 1) return `not a game of a known job (${String(g.job)})`;
  if (rulesOfRecorded(String(g.engine?.fingerprint)) !== fingerprint) return "other rules code (a kit of an older or newer engine)";
  // The game its seed draws, under the job's settings: a kit changed by hand would play others.
  const recorded = canonical([g.bots, g.decks, g.config, g.rules]);
  const drawn = (ref: Job) => {
    const setup = jobSetup(ref, g.seed);
    return canonical([setup.specs, setup.decks, JOB_CONFIG, { format: ref.format, restrictionList: ref.restrictionList }]);
  };
  if (!referencesOf(job.id).some((ref) => drawn(ref) === recorded)) return "not the game its seed draws (bots, decks or settings)";
  if (g.error || !g.result || g.result.winner === "?") return "unfinished";
  try {
    const game = engine.newGame({ seed: g.seed, players: [g.decks[0]!.deck, g.decks[1]!.deck], config: g.config });
    for (const [player, input] of g.inputs) {
      const d = game.decision;
      if (!d || d.player !== player || validateAnswer(d, input) !== null) return "an input that doesn't fit";
      game.act(input);
    }
    if (!game.result || game.result.winner !== g.result.winner || game.state.turn !== g.result.turns) return "doesn't end as recorded";
  } catch (e) {
    return `the engine threw (${e instanceof Error ? e.message : String(e)})`;
  }
  return null;
}

/** Played again from the seed with the job's bots (P percent, chosen by the seed's hash). */
const chosen = (seed: string) => parseInt(createHash("sha256").update(seed).digest("hex").slice(0, 8), 16) % 10_000 < recheck * 100;
/** A seed's inputs played again: by seed, the inputs as JSON. */
type Again = Map<string, string>;

/** A kit folder of this job, rules code and bots: --kit, or a SVEN-train-* folder beside the repository. */
function kitOf(jobId: string, bot: string): string | null {
  const candidates = option("--kit") ? [resolve(option("--kit")!)] : readdirSync(join(ROOT, "..")).filter((n) => n.startsWith("SVEN-train-")).map((n) => join(ROOT, "..", n));
  for (const dir of candidates) {
    try {
      const kitJob = JSON.parse(readFileSync(join(dir, "job.json"), "utf8")) as Job;
      if (kitJob.id === jobId && kitJob.bot === bot && rulesOfRecorded(kitJob.engine) === fingerprint && existsSync(join(dir, "train.mjs"))) return dir;
    } catch {
      // not a kit
    }
  }
  return null;
}
/**
 * Games played again by their kit, shared among `workers` processes (a game takes seconds to a minute, so one process would
 * take hours for a few hundred). A process that fails leaves its games out of the result (unchecked, not rejected).
 */
async function kitAgain(kit: string, games: JobGame[]): Promise<{ again: Again; failed: string[] }> {
  const n = Math.min(workers, games.length);
  const parts = Array.from({ length: n }, (_, k) => games.filter((_, i) => i % n === k));
  const results = await Promise.allSettled(
    parts.map(
      (part, k) =>
        new Promise<string>((done, fail) => {
          const list = join(tmpdir(), `sve-recheck-${process.pid}-${createHash("sha256").update(kit).digest("hex").slice(0, 8)}-${k}.json`);
          writeFileSync(list, JSON.stringify(part.map((g) => ({ seed: g.seed, volunteer: g.volunteer }))));
          const child = spawn(process.execPath, [join(kit, "train.mjs"), "--recheck", list], { stdio: ["ignore", "pipe", "inherit"] });
          let out = "";
          child.stdout.setEncoding("utf8").on("data", (d: string) => (out += d));
          child.on("error", (e) => {
            rmSync(list, { force: true });
            fail(e);
          });
          child.on("close", (code) => {
            rmSync(list, { force: true });
            if (code === 0) done(out);
            else fail(new Error(`train.mjs --recheck ended with ${code}`));
          });
        }),
    ),
  );
  const again: Again = new Map();
  const failed: string[] = [];
  for (const r of results) {
    if (r.status === "rejected") {
      failed.push(r.reason instanceof Error ? r.reason.message : String(r.reason));
      continue;
    }
    for (const l of r.value.split("\n").filter((x) => x.trim())) {
      const { seed, inputs } = JSON.parse(l) as { seed: string; inputs: unknown };
      again.set(seed, JSON.stringify(inputs));
    }
  }
  return { again, failed };
}

type Counts = { taken: number; rejected: Record<string, number> };
const taken = new Map<string, JobGame[]>();
const seen = new Map<string, Set<string>>();
// By volunteer, and by file: a kit folder passed on after it ran keeps its volunteer word, so friends can share one.
// No prototype: a volunteer word written by hand ("constructor", "__proto__") is a key like any other.
const report = Object.create(null) as Record<string, Counts>;
const byFile = Object.create(null) as Record<string, Counts>;
const fileOf = new Map<JobGame, string>();
const count = (g: JobGame | null, file: string, why: string | null, n = 1) => {
  const fresh = (): Counts => ({ taken: 0, rejected: Object.create(null) as Record<string, number> });
  for (const r of [(report[g ? String(g.volunteer ?? "?") : "?"] ??= fresh()), (byFile[file] ??= fresh())]) {
    if (why === null) r.taken += n;
    else r.rejected[why] = (r.rejected[why] ?? 0) + n;
  }
};
const take = (g: JobGame, file: string) => {
  seen.get(g.job)!.add(g.seed);
  fileOf.set(g, file);
  if (!taken.has(g.job)) taken.set(g.job, []);
  taken.get(g.job)!.push(g);
};
const outOf = (jobId: string) => resolve(option("--out") ?? join(ROOT, "..", "rl-runs", jobId));
const files = filesIn(source);
let rechecked = 0;
let unchecked = 0;
const failures: string[] = [];
/** The games chosen for the check, by job and bots (played again at the end). */
const toCheck = new Map<string, JobGame[]>();
/** Other copies of a seed taken in this run that differ from the copy taken (and replay): one of them may be the true one. */
const alternates = new Map<string, JobGame[]>();
const firstOf = new Map<string, JobGame>();
for (const file of files) {
  const name = relative(resolve(source), resolve(file)) || file;
  const { games, broken } = gamesOf(file);
  if (broken > 0) count(null, name, "a broken piece of a file", broken);
  for (const g of games) {
    if (!isGame(g)) {
      count(null, name, "not a game of a known job");
      continue;
    }
    // Seeds already in the dataset (a dataset that can't be read whole would let them in twice: stop), or taken from another file.
    if (!seen.has(g.job)) {
      const known = new Set<string>();
      const existing = join(outOf(g.job), "games.jsonl.gz");
      if (existsSync(existing)) {
        const old = gamesOf(existing);
        if (old.broken > 0) {
          console.error(`${existing} can't be read whole (${old.broken} broken pieces): mend or move it first.`);
          process.exit(1);
        }
        for (const o of old.games) known.add(o.seed);
      }
      seen.set(g.job, known);
    }
    const first = firstOf.get(g.seed);
    if (seen.get(g.job)!.has(g.seed)) {
      // A copy that isn't the same game as the one taken, kept in case that one is found changed.
      if (first && JSON.stringify(first.inputs) !== JSON.stringify(g.inputs) && chosen(g.seed) && problem(g) === null) {
        alternates.set(g.seed, [...(alternates.get(g.seed) ?? []), g]);
        fileOf.set(g, name);
      }
      count(g, name, "already taken");
      continue;
    }
    const why = problem(g);
    count(g, name, why);
    if (why) continue;
    take(g, name);
    firstOf.set(g.seed, g);
    if (chosen(g.seed)) {
      const key = `${g.job}\n${g.engine.bot}`;
      toCheck.set(key, [...(toCheck.get(key) ?? []), g]);
    }
  }
}
// The games chosen for the check, played again from their seeds; the ones that differ are taken back out (and another copy
// of the seed that is the game played again, if any, taken instead).
for (const [key, games] of toCheck) {
  const [jobId, bot] = key.split("\n") as [string, string];
  const kit = kitOf(jobId, bot);
  let again: Again;
  if (kit) {
    console.log(`playing ${games.length} games of ${jobId} again with ${kit} on ${Math.min(workers, games.length)} processes…`);
    const result = await kitAgain(kit, games);
    again = result.again;
    failures.push(...result.failed.map((f) => `${kit}: ${f}`));
  } else if (bot === bots) {
    console.log(`playing ${games.length} games of ${jobId} again with this repository's bots…`);
    again = new Map(games.map((g) => [g.seed, JSON.stringify(playJobGame(engine, jobs.get(jobId)!, g.seed, g.volunteer).inputs)]));
  } else {
    unchecked += games.length;
    continue;
  }
  for (const g of games) {
    const replayed = again.get(g.seed);
    if (replayed === undefined) {
      unchecked += 1;
      continue;
    }
    rechecked += 1;
    if (replayed === JSON.stringify(g.inputs)) continue;
    const list = taken.get(g.job)!;
    list.splice(list.indexOf(g), 1);
    seen.get(g.job)!.delete(g.seed);
    const file = fileOf.get(g)!;
    count(g, file, null, -1);
    count(g, file, "played again from its seed, the answers differ");
    const instead = (alternates.get(g.seed) ?? []).find((a) => JSON.stringify(a.inputs) === replayed);
    if (instead) {
      const altFile = fileOf.get(instead)!;
      count(instead, altFile, "already taken", -1);
      count(instead, altFile, null);
      take(instead, altFile);
    }
  }
}
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
for (const [jobId, games] of taken) {
  const dir = outOf(jobId);
  mkdirSync(dir, { recursive: true });
  for (const g of games) appendFileSync(join(dir, "games.jsonl.gz"), gzipSync(JSON.stringify(g) + "\n"));
  writeFileSync(join(dir, `ingest-${stamp}.json`), JSON.stringify({ source: resolve(source), files: files.length, recheckPercent: recheck, rechecked, unchecked, failures, engine: fingerprint, bots, report, byFile }, null, 1));
  console.log(`${jobId}: ${games.length} games taken into ${join(dir, "games.jsonl.gz")}`);
}
console.log(`${files.length} files; engine ${fingerprint}, bots ${bots}; played again from the seed: ${rechecked}${unchecked > 0 ? `; ${unchecked} chosen but not checked (no kit of their job, rules and bots beside the repository: --kit; or its check failed)` : ""}`);
for (const f of failures) console.log(`  a check that failed to run: ${f}`);
const line = (r: Counts) => {
  const rejected = Object.entries(r.rejected)
    .filter(([, n]) => n !== 0)
    .map(([why, n]) => `${n} ${why}`)
    .join(", ");
  return `${r.taken} taken${rejected ? `; not taken: ${rejected}` : ""}`;
};
for (const [volunteer, r] of Object.entries(report)) console.log(`  volunteer ${volunteer}: ${line(r)}`);
for (const [file, r] of Object.entries(byFile)) console.log(`    ${file}: ${line(r)}`);
if (taken.size === 0) console.log("nothing taken");
