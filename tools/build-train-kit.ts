/**
 * Build the training kit: npm run release:train -- [--job stage1] [--out <folder>] [--zip]
 * A folder for friends who lend their computers: start.bat runs train.mjs (tools/train/kit.ts with the engine and bots in one
 * file), which plays games of the job and saves them in training/ until the window is closed. job.json is the job of
 * tools/rl/jobs/<job>.json with its decks written out and the engine and bot fingerprints of the code built (npm run
 * rl:ingest takes games of that code only). The default folder is SVEN-train-<job>-<version> beside the repository; it must
 * not exist yet, or be empty.
 */
import { execFileSync } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { build as bundle } from "esbuild";
import { Zip, ZipDeflate, ZipPassThrough } from "fflate";
import { rulesFingerprint } from "../packages/gui/fingerprint";
import { ROOT, deckSet, sampleDeck, DECK_SETS } from "./rl/series";
import { botFingerprint } from "./train/code";
import type { Job, JobFile } from "./train/job";

const args = process.argv.slice(2);
const option = (name: string) => {
  const at = args.indexOf(name);
  return at >= 0 ? (args[at + 1] ?? null) : null;
};
const jobName = option("--job") ?? "stage1";
const jobPath = join(ROOT, "tools", "rl", "jobs", `${jobName}.json`);
if (!existsSync(jobPath)) {
  console.error(`no job tools/rl/jobs/${jobName}.json`);
  process.exit(1);
}
const gui = join(ROOT, "packages", "gui");
const version = (JSON.parse(readFileSync(join(gui, "package.json"), "utf8")) as { version: string }).version;
const out = resolve(option("--out") ?? join(ROOT, "..", `SVEN-train-${jobName}-${version}`));
if (existsSync(out) && readdirSync(out).length > 0) {
  console.error(`${out} already exists and isn't empty: choose another --out, or delete that folder first.`);
  process.exit(1);
}
const git = (...gitArgs: string[]) => {
  try {
    return execFileSync("git", ["-C", ROOT, ...gitArgs], { encoding: "utf8" }).trim();
  } catch {
    return "";
  }
};
const commit = git("rev-parse", "--short", "HEAD") || "unknown";
// Changes to what goes into the kit or its rules fingerprint (not, say, the release notes of the app).
const uncommitted = git("status", "--porcelain", "--untracked-files=no", "--", "packages/core", "packages/bot", "packages/gui/fingerprint.ts", "tools") !== "";

// The job with its decks written out (the kit has no repository), checked against the deck set's format.
const file = JSON.parse(readFileSync(jobPath, "utf8")) as JobFile;
if (file.restrictionList !== DECK_SETS.restrictionList || file.format !== DECK_SETS.format) {
  console.error(`the job's format (${file.format} ${file.restrictionList}) isn't the deck sets' (${DECK_SETS.format} ${DECK_SETS.restrictionList})`);
  process.exit(1);
}
const names = deckSet(file.decks);
if (!names) {
  console.error(`no deck set ${file.decks}`);
  process.exit(1);
}
const job: Job = {
  ...file,
  deckLists: names.map((name) => sampleDeck(name)!),
  engine: rulesFingerprint(gui),
  bot: botFingerprint(ROOT),
  commit: `${commit}${uncommitted ? "+" : ""}`,
  version,
};

/** A text file the way Windows programs read it: CRLF line ends, and a BOM for UTF-8 text. */
const writeWindowsText = (path: string, text: string, bom: boolean) => writeFileSync(path, (bom ? "﻿" : "") + text.replace(/\r?\n/g, "\r\n"), "utf8");

console.log(`training kit ${job.id} (${jobName}) -> ${out}`);
mkdirSync(join(out, "training"), { recursive: true });
await bundle({
  entryPoints: [join(ROOT, "tools", "train", "kit.ts")],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  outfile: join(out, "train.mjs"),
  absWorkingDir: ROOT,
  legalComments: "none",
  logLevel: "warning",
});
writeFileSync(join(out, "job.json"), JSON.stringify(job, null, 1));
const fill = (name: string) => readFileSync(join(ROOT, "tools", "train", name), "utf8").replaceAll("{{version}}", version);
writeWindowsText(join(out, "start.bat"), fill("start.bat"), false);
writeWindowsText(join(out, "README.txt"), fill("README.txt"), true);
writeWindowsText(
  join(out, "VERSION.txt"),
  [`Shadowverse: Evolve NEXT ${version} - training kit`, `Job: ${job.id}`, `Built: ${new Date().toISOString().slice(0, 10)}`, `Source commit: ${job.commit}`, `Engine fingerprint: ${job.engine}`, `Bot fingerprint: ${job.bot}`, ""].join("\n"),
  false,
);

/** Every file under `dir` ("training/" for an empty folder). */
function filesUnder(dir: string, prefix = ""): string[] {
  const found: string[] = [];
  for (const name of readdirSync(join(dir, prefix)).sort()) {
    const path = prefix ? `${prefix}/${name}` : name;
    if (statSync(join(dir, path)).isDirectory()) found.push(`${path}/`, ...filesUnder(dir, path));
    else found.push(path);
  }
  return found;
}
if (args.includes("--zip")) {
  const zipFile = `${out}.zip`;
  const top = basename(out);
  const stream = createWriteStream(zipFile);
  await new Promise<void>((done, fail) => {
    const archive = new Zip((err, chunk, final) => {
      if (err) return fail(err);
      stream.write(chunk);
      if (final) stream.end(() => done());
    });
    for (const path of filesUnder(out)) {
      const entry = path.endsWith("/") ? new ZipPassThrough(`${top}/${path}`) : new ZipDeflate(`${top}/${path}`, { level: 9 });
      archive.add(entry);
      entry.push(path.endsWith("/") ? new Uint8Array(0) : readFileSync(join(out, path)), true);
    }
    archive.end();
  });
  console.log(`zip: ${zipFile} (${(statSync(zipFile).size / 2 ** 20).toFixed(1)} MB)`);
}
console.log(`engine ${job.engine}, bots ${job.bot}, commit ${job.commit}${uncommitted ? " (with changes not committed yet: commit before handing the kit out)" : ""}`);
