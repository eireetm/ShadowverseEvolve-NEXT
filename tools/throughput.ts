/**
 * How many games the whole machine plays in a minute: npm run bench:throughput -- [random|easy|medium|hard|...] [--workers N]
 * [--seconds S] [--decks train|holdout|legal]
 * N processes (default: the number of CPU threads) load the engine; once all are ready they start together and play games
 * back to back for S seconds (default 60) with that bot on both sides (random: random legal answers), the deck set's
 * matchups in bot:arena's order (each process its share of the series). A game still going at the end counts for the part
 * of it inside the window. Prints the games per minute of all of them together, and per process. A laptop slows down under a
 * full load, so try fewer workers too: the total stops growing at some point.
 */
import { fork } from "node:child_process";
import { cpus } from "node:os";
import { createEngine } from "../packages/core/src";
import { ALL_CARDS, ALL_SCRIPTS } from "../packages/core/src/sets";
import { playOut, randomAgent } from "../packages/core/src/testing";
import { BOT_LEVELS, createBot, type BotLevel } from "../packages/bot/src";
import { deckSet, orderedMatchups, sampleDeck, seriesGame, type NamedDeck } from "./rl/series";

const args = process.argv.slice(2);
const option = (name: string) => {
  const at = args.indexOf(name);
  return at >= 0 ? (args[at + 1] ?? null) : null;
};
const whole = (text: string | null, fallback: number) => {
  const n = text === null ? fallback : Number(text);
  return Number.isInteger(n) && n >= 1 ? n : NaN;
};
const mode = args.find((a, i) => !a.startsWith("--") && !(i > 0 && args[i - 1]!.startsWith("--"))) ?? "random";
const workers = whole(option("--workers"), cpus().length);
const seconds = whole(option("--seconds"), 60);
const setName = option("--decks") ?? "train";
const names = deckSet(setName);
if ((mode !== "random" && !(BOT_LEVELS as readonly string[]).includes(mode)) || Number.isNaN(workers) || Number.isNaN(seconds) || !names) {
  console.error(`usage: npm run bench:throughput -- [random|${BOT_LEVELS.join("|")}] [--workers N] [--seconds S] [--decks train|holdout|legal]`);
  process.exit(1);
}
const decks = names.map((name) => sampleDeck(name)!) as NamedDeck[];
const matchups = orderedMatchups(decks.length, false);

interface Result {
  /** Games finished in the window, plus the part of the game going at its end. */
  games: number;
  /** Games begun (the averages below are per game begun). */
  begun: number;
  inputs: number;
  turns: number;
  unfinished: number;
}

/** One process: games `k`, `k + workers`, ... of the series, from `start` until `end` (epoch ms). */
function play(engine: ReturnType<typeof createEngine>, k: number, start: number, end: number): Result {
  const pause = new Int32Array(new SharedArrayBuffer(4));
  while (Date.now() < start) Atomics.wait(pause, 0, 0, Math.min(100, start - Date.now()));
  const config = { autoResolve: ["selectPending", "selectCards", "choose", "orderCards"] as ("selectPending" | "selectCards" | "choose" | "orderCards")[], deckRestrictions: true };
  const r: Result = { games: 0, begun: 0, inputs: 0, turns: 0, unfinished: 0 };
  for (let j = 0; Date.now() < end; j++) {
    const g = seriesGame(k + j * workers, "throughput", matchups, true);
    const began = Date.now();
    const game = engine.newGame({ seed: g.seed, players: [decks[g.decks[0]]!.deck, decks[g.decks[1]]!.deck], config }, { checkpoints: mode !== "random" });
    if (mode === "random") r.inputs += playOut(game, [randomAgent(`${g.seed}a`), randomAgent(`${g.seed}b`)]);
    else {
      const bots = [createBot(engine, mode as BotLevel, `${g.seed}a`), createBot(engine, mode as BotLevel, `${g.seed}b`)];
      for (let steps = 0; game.decision && steps < 5000; steps++, r.inputs++) game.act(bots[game.decision.player]!.decide(game));
    }
    const ended = Date.now();
    if (!game.result) r.unfinished += 1;
    r.begun += 1;
    r.turns += game.state.turn;
    // A game past the end counts for the part of it played before.
    r.games += ended <= end ? 1 : Math.max(0, end - began) / Math.max(1, ended - began);
  }
  return r;
}

const shard = option("--shard");
if (shard) {
  // A worker loads the engine, says it is ready, and waits for the start and end the main process sends once all are.
  const k = Number(shard);
  const engine = createEngine({ cards: ALL_CARDS, scripts: ALL_SCRIPTS });
  process.on("message", (m: { start: number; end: number }) => {
    const result = play(engine, k, m.start, m.end);
    process.send!(result, undefined, {}, () => process.exit(0));
  });
  process.send!({ ready: k });
} else {
  console.log(`${workers} processes, ${mode} on both sides, ${seconds} s, ${decks.length} decks (${setName}); loading ...`);
  const children = Array.from({ length: workers }, (_, k) => fork(process.argv[1]!, [...args, "--shard", String(k)], { stdio: ["ignore", "inherit", "inherit", "ipc"] }));
  // Every worker loads the engine before it is told when to start.
  let ready = 0;
  const results = await Promise.all(
    children.map(
      (child) =>
        new Promise<Result>((done, failed) => {
          child.on("message", (m: Result | { ready: number }) => {
            if ("ready" in m) {
              ready += 1;
              if (ready === workers) {
                const start = Date.now() + 1_000;
                for (const c of children) c.send({ start, end: start + seconds * 1_000 });
              }
            } else done(m);
          });
          child.on("exit", (code) => (code === 0 ? undefined : failed(new Error(`a worker stopped (exit ${code})`))));
        }),
    ),
  );
  const sum = (key: keyof Result) => results.reduce((s, r) => s + r[key], 0);
  const games = sum("games");
  const perMinute = games / (seconds / 60);
  const begun = Math.max(1, sum("begun"));
  console.log(
    `${games.toFixed(1)} games: ${Math.round(perMinute)} per minute (${(perMinute / workers).toFixed(1)} per process); ${(sum("inputs") / begun).toFixed(0)} inputs and ${(sum("turns") / begun).toFixed(1)} turns a game; ${sum("unfinished")} unfinished`,
  );
}
