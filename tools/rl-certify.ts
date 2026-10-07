/**
 * Replay certification of a run's games: npm run rl:certify -- <run dir> [--workers N]
 * Replays every game of <run dir>/games.jsonl.gz with this repository's rules code: each input must be a legal answer to the
 * decision it was given for, and each game must end as recorded (winner and turn). If all of them do, it writes
 * <run dir>/certified-<rules fingerprint>.json (tools/rl/certificate.ts), which npm run rl:encode reads to take games recorded
 * with older rules code. If any game differs, it lists them and writes nothing (the games must then be dropped or played again).
 */
import { execFileSync, fork } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { availableParallelism } from "node:os";
import { join, resolve } from "node:path";
import { createEngine, validateAnswer } from "../packages/core/src";
import { ALL_CARDS, ALL_SCRIPTS } from "../packages/core/src/sets";
import { rulesFingerprint } from "../packages/gui/fingerprint";
import { certificatePath, sha256Of, type ReplayCertificate } from "./rl/certificate";
import { gameLines } from "./rl/records";
import { ROOT } from "./rl/series";
import { rulesOfRecorded } from "./train/code";
import type { JobGame } from "./train/job";

const args = process.argv.slice(2);
const option = (name: string) => {
  const at = args.indexOf(name);
  return at >= 0 ? (args[at + 1] ?? null) : null;
};
const VALUED = ["--workers", "--worker", "--workers-total"];
const runDir = args.find((a, i) => !a.startsWith("--") && !(i > 0 && VALUED.includes(args[i - 1]!)));
const workers = Number(option("--workers") ?? Math.max(1, Math.min(12, availableParallelism() - 4)));
const records = runDir ? join(resolve(runDir), "games.jsonl.gz") : "";
if (!runDir || !existsSync(records) || !(Number.isInteger(workers) && workers >= 1)) {
  console.error("usage: npm run rl:certify -- <run dir with games.jsonl.gz> [--workers N]");
  process.exit(1);
}

/** What a process found in its share of the games (index % total === k). */
interface Part {
  games: number;
  same: number;
  broken: number;
  recorded: Record<string, number>;
  differ: string[];
}

function runWorker(k: number, total: number): Part {
  const engine = createEngine({ cards: ALL_CARDS, scripts: ALL_SCRIPTS });
  const part: Part = { games: 0, same: 0, broken: 0, recorded: {}, differ: [] };
  const stats = { broken: 0 };
  let index = -1;
  for (const line of gameLines(records, stats)) {
    index += 1;
    if (index % total !== k) continue;
    part.games += 1;
    let why = "";
    let g: JobGame | null = null;
    try {
      g = JSON.parse(line) as JobGame;
      const rules = rulesOfRecorded(String(g.engine?.fingerprint));
      part.recorded[rules] = (part.recorded[rules] ?? 0) + 1;
      const game = engine.newGame({ seed: g.seed, players: [g.decks[0]!.deck, g.decks[1]!.deck], config: g.config as never });
      for (const [i, [, input]] of g.inputs.entries()) {
        const d = game.decision;
        const refused = d ? validateAnswer(d, input as never) : "no decision";
        if (refused !== null) {
          why = `input ${i}: ${refused}`;
          break;
        }
        game.act(input as never);
      }
      if (!why) {
        const winner = game.result ? game.result.winner : "?";
        if (winner !== g.result.winner || game.state.turn !== g.result.turns) why = `ends ${String(winner)} on turn ${game.state.turn}, recorded ${String(g.result.winner)} on turn ${g.result.turns}`;
      }
    } catch (e) {
      why = `error: ${(e as Error).message}`;
    }
    if (why) part.differ.push(`${index} ${g?.seed ?? "?"}: ${why}`);
    else part.same += 1;
  }
  if (k === 0) part.broken = stats.broken;
  return part;
}

if (option("--worker") !== null) {
  process.send!(runWorker(Number(option("--worker")), Number(option("--workers-total"))));
} else {
  const rules = rulesFingerprint(join(ROOT, "packages", "gui"));
  const started = Date.now();
  const parts: Part[] = await Promise.all(
    Array.from({ length: workers }, (_, k) =>
      new Promise<Part>((done, fail) => {
        const child = fork(process.argv[1]!, [...args, "--worker", String(k), "--workers-total", String(workers)], { stdio: ["ignore", "inherit", "inherit", "ipc"] });
        let part: Part | null = null;
        child.on("message", (m: Part) => (part = m));
        child.on("exit", (code) => (code === 0 && part ? done(part) : fail(new Error(`process ${k} ended with ${code}`))));
      }),
    ),
  );
  const games = parts.reduce((n, p) => n + p.games, 0);
  const same = parts.reduce((n, p) => n + p.same, 0);
  const broken = parts.reduce((n, p) => n + p.broken, 0);
  const differ = parts.flatMap((p) => p.differ);
  const recorded: Record<string, number> = {};
  for (const p of parts) for (const [fp, n] of Object.entries(p.recorded)) recorded[fp] = (recorded[fp] ?? 0) + n;
  console.log(`${records}: ${games} games replayed with rules ${rules} in ${((Date.now() - started) / 60000).toFixed(1)} minutes`);
  console.log(`  recorded with: ${Object.entries(recorded).map(([fp, n]) => `${fp} (${n})`).join(", ")}`);
  console.log(`  the same: ${same}; different: ${differ.length}; unreadable pieces of the file: ${broken}`);
  for (const d of differ.slice(0, 20)) console.log(`    ${d}`);
  if (differ.length > 0 || broken > 0 || same !== games || games === 0) {
    console.log("no certificate written: these games don't play the same with this code");
    process.exit(1);
  }
  const git = (...a: string[]) => {
    try {
      return execFileSync("git", ["-C", ROOT, ...a], { encoding: "utf8" }).trim();
    } catch {
      return "";
    }
  };
  const certificate: ReplayCertificate = {
    format: "sve-replay-certificate",
    version: 1,
    rules,
    records: { file: "games.jsonl.gz", sha256: sha256Of(records), games },
    recordedRules: recorded,
    replayed: same,
    commit: git("rev-parse", "--short", "HEAD"),
    dirty: git("status", "--porcelain", "--", "packages/core") !== "",
    date: new Date().toISOString(),
    command: `rl:certify ${args.join(" ")}`,
  };
  const path = certificatePath(resolve(runDir), rules);
  writeFileSync(path, JSON.stringify(certificate, null, 1) + "\n");
  console.log(`-> ${path}`);
}
