/**
 * The training kit's program (npm run release:train builds the kit: this file bundled as train.mjs, beside job.json and
 * start.bat). It plays games of the job in job.json and writes each finished game into training/ at once — a gzip piece per
 * game, so closing the window loses only the games being played — until the window is closed. It uses about half of the
 * computer's processor threads (fewer when memory is short) at a lower priority, so the computer stays usable. Nothing is sent
 * anywhere: the files in training/ are given to the project by hand. The kit names itself with a random word in
 * training/volunteer.txt (nothing personal) so that games of different computers have different seeds.
 *   node train.mjs [--workers N]
 * npm run rl:ingest also runs a kit to check games with the kit's own code (the repository's bots may have changed since):
 *   node train.mjs --recheck <seeds.json>   plays each game of the file (a list of seeds and volunteers) again and prints
 *                                           its inputs, one JSON line per game.
 */
import { fork } from "node:child_process";
import { randomBytes } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { constants, cpus, freemem, setPriority, totalmem } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { createEngine } from "../../packages/core/src";
import { ALL_CARDS, ALL_SCRIPTS } from "../../packages/core/src/sets";
import { playJobGame, type Job, type JobGame } from "./job";

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const option = (name: string) => {
  const at = args.indexOf(name);
  return at >= 0 ? (args[at + 1] ?? null) : null;
};
const lowerPriority = () => {
  try {
    setPriority(0, constants.priority.PRIORITY_BELOW_NORMAL);
  } catch {
    // not allowed here: play at the normal priority
  }
};
const job = JSON.parse(readFileSync(join(here, "job.json"), "utf8")) as Job;

if (option("--recheck") !== null) {
  const engine = createEngine({ cards: ALL_CARDS, scripts: ALL_SCRIPTS });
  const list = JSON.parse(readFileSync(option("--recheck")!, "utf8")) as { seed: string; volunteer: string }[];
  for (const { seed, volunteer } of list) process.stdout.write(JSON.stringify({ seed, inputs: playJobGame(engine, job, seed, volunteer).inputs }) + "\n");
} else if (option("--worker") !== null) {
  // A worker: games one after another, each sent to the main process when it ends.
  lowerPriority();
  // The main process is gone (its window closed, or it was stopped): nothing would save the game being played.
  process.on("disconnect", () => process.exit(0));
  const [k, run, volunteer] = [option("--worker")!, option("--run")!, option("--volunteer")!];
  const engine = createEngine({ cards: ALL_CARDS, scripts: ALL_SCRIPTS });
  process.send!({ ready: true });
  for (let i = 0; ; i++) {
    const game = playJobGame(engine, job, `${job.id}:${volunteer}:${run}:${k}:${i}`, volunteer);
    await new Promise<void>((done) => process.send!(game, undefined, {}, () => done()));
  }
} else {
  lowerPriority();
  const dir = join(here, "training");
  mkdirSync(dir, { recursive: true });
  const nameFile = join(dir, "volunteer.txt");
  if (!existsSync(nameFile)) writeFileSync(nameFile, randomBytes(4).toString("hex"));
  const volunteer = readFileSync(nameFile, "utf8").trim();
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const run = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const file = join(dir, `${job.id}-${volunteer}-${run}.jsonl.gz`);
  // About half the threads; each process needs about 600 MB, and the computer keeps 1.5 GB for itself.
  const threads = cpus().length;
  const byMemory = Math.floor((freemem() - 1.5 * 2 ** 30) / (600 * 2 ** 20));
  const asked = Number(option("--workers"));
  const workers = Number.isInteger(asked) && asked > 0 ? asked : Math.max(1, Math.min(Math.floor(threads / 2), byMemory));
  console.log(`Shadowverse: Evolve NEXT ${job.version} — 训练数据 / training data`);
  console.log(`任务 job: ${job.id}（${job.description}）`);
  console.log(`这台电脑 this computer: ${threads} 个线程 threads, 内存 memory ${(totalmem() / 2 ** 30).toFixed(1)} GB（空闲 free ${(freemem() / 2 ** 30).toFixed(1)} GB）`);
  console.log(`使用 using ${workers} 个进程 processes（较低优先级 lower priority）`);
  console.log(`保存到 saving to: ${file}`);
  console.log("关闭这个窗口即可停止，已经下完的对局都已保存。Close this window to stop; every finished game is saved.\n");
  const started = Date.now();
  let games = 0;
  let unfinished = 0;
  let stopping = false;
  let alive = workers;
  const children =Array.from({ length: workers }, (_, k) => fork(fileURLToPath(import.meta.url), ["--worker", String(k), "--run", run, "--volunteer", volunteer], { stdio: ["ignore", "inherit", "inherit", "ipc"] }));
  for (const child of children) {
    child.on("message", (m: JobGame | { ready: true }) => {
      if ("ready" in m) return;
      appendFileSync(file, gzipSync(JSON.stringify(m) + "\n"));
      games += 1;
      if (m.result.winner === "?") unfinished += 1;
    });
    // Ctrl+C or the window closing reaches the workers too, sometimes before this process: wait a moment before telling.
    child.on("exit", (code) => {
      alive -= 1;
      setTimeout(() => {
        if (stopping) return;
        if (code !== 0) console.log(`一个进程意外退出 a process stopped (exit ${code})`);
        if (alive === 0) {
          report();
          process.exit(1);
        }
      }, 1000);
    });
  }
  const report = () => {
    const hours = (Date.now() - started) / 3_600_000;
    console.log(`${new Date().toLocaleTimeString()}  已完成 games: ${games}${unfinished > 0 ? `（未下完 unfinished ${unfinished}）` : ""}  每小时 per hour: ${hours > 0 ? Math.round(games / hours) : 0}`);
  };
  setInterval(report, 60_000);
  // Ctrl+C, or the window closed (SIGHUP on Windows): the games saved so far are all there is to keep.
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
    process.on(signal, () => {
      stopping = true;
      report();
      for (const child of children) child.kill();
      process.exit(0);
    });
  }
}
