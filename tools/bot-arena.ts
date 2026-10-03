/**
 * Bots against each other: npm run bot:arena -- [games] [a] [b] [options]
 *
 * A bot is a level (easy | medium | hard | medium-beta | hard-beta), one of sve-server's AIs imitated (sve-fool, sve-good,
 * sve-planner; tools/sve-server-ais), or easy / medium / hard with its evaluation swapped, to check the evaluation interface:
 * "medium:identity" plays with the hand-written evaluation passed in from outside (exactly as medium does), and
 * "medium:negated" scores its own positions the other way round (it plays to lose).
 *
 * Decks: the sample decks (packages/gui/decks/samples, all but the Cross Craft one), or a deck set of tools/rl/decksets.json:
 * "train", "holdout" or "legal" (both), played in its format (the engine's deck rules on, and every deck checked against
 * the restriction list). Games come in pairs: the same decks and seed with the seats swapped, so neither the decks nor going
 * first favours a bot; the pairs go through every ordered matchup of the decks in a spread-out order (tools/rl/series.ts).
 * Options:
 *   --decks sd01,sd02 | train | holdout | legal   (default: every sample deck)
 *   --mirror           both players play the same deck (each deck in turn); otherwise two different decks
 *   --independent      every game its own seed: for generating data, not for comparing bots
 *   --workers N        play on N processes at once (default 1)
 *   --seed text        the series of games (default "arena"); keep data ("gen-...") and comparisons ("eval-...") apart
 *   --range a-b        only games a to b-1 of the series (another run, into another --out, can play the rest)
 *   --out dir          a new folder: games.jsonl.gz (every game, written as it ends, replayable: npm run rl:verify),
 *                      report.json (the results; the same games give the same file) and timing.json
 *   --replays N        with --out: the first N games also as replays the GUI opens (replays/)
 * Prints A's score with a 95% interval (by pairs, which takes the luck of the deal out), A's score going first and second,
 * the first player's win rate, the game length, A's score per deck, and how long each bot thinks. A game that throws (an
 * engine error) is kept as unfinished with its error; games missing at the end (a process that died) are listed, and the
 * command then exits with 1.
 */
import { execSync, fork } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { createEngine, type Answer, type Decision, type DeckList, type PlayerId } from "../packages/core/src";
import { ALL_CARDS, ALL_SCRIPTS } from "../packages/core/src/sets";
import { BOT_LEVELS, createBot, evaluate, type Bot, type BotEvaluation, type BotLevel, type BotStats } from "../packages/bot/src";
import { engineFingerprint } from "../packages/gui/fingerprint";
import { DECK_SETS, ROOT, allSampleDecks, deckSet, orderedMatchups, sampleDeck, seriesGame, type NamedDeck } from "./rl/series";
import { SVE_SERVER_AIS, createSveServerBot, type SveServerAI } from "./sve-server-ais";

type Engine = ReturnType<typeof createEngine>;

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
function option(name: string): string | null {
  const at = args.indexOf(name);
  return at >= 0 ? (args[at + 1] ?? null) : null;
}
const VALUED = ["--decks", "--workers", "--seed", "--shard", "--range", "--out", "--replays"];
const positional = args.filter((arg, i) => !arg.startsWith("--") && !(i > 0 && VALUED.includes(args[i - 1]!)));
/** A whole number of at least `least`, or NaN. */
const whole = (text: string | null | undefined, fallback: number, least: number) => {
  const n = text === null || text === undefined ? fallback : Number(text);
  return Number.isInteger(n) && n >= least ? n : NaN;
};
const games = whole(positional[0], 20, 1);
const specs = [positional[1] ?? "medium", positional[2] ?? "easy"] as const;

// ---- Bots ----

const SPEC = /^([a-z-]+)(?::(identity|negated))?$/;
const VARIANT_LEVELS: readonly string[] = ["easy", "medium", "hard"];
function specProblem(spec: string): string | null {
  const m = SPEC.exec(spec);
  if (!m) return `not a bot: ${spec}`;
  const [, level, variant] = m;
  if (![...BOT_LEVELS, ...SVE_SERVER_AIS].includes(level as never)) return `no such level: ${level}`;
  if (variant && !VARIANT_LEVELS.includes(level!)) return `${variant} works with ${VARIANT_LEVELS.join(", ")} (the default weights) only`;
  return null;
}
/** The evaluations of a variant: the hand-written one passed in (the same play), or turned round (the bot plays to lose). */
function variantEvaluation(variant: string | undefined): BotEvaluation {
  if (variant === "identity") {
    const same = () => (view: Parameters<typeof evaluate>[0], me: PlayerId) => evaluate(view, me);
    return { evaluator: same(), replyEvaluator: same(), modelEvaluator: same() };
  }
  if (variant === "negated") return { evaluator: (view, me) => -evaluate(view, me) };
  return {};
}
function makeBot(engine: Engine, spec: string, seed: string): Bot {
  const [, level, variant] = SPEC.exec(spec)!;
  if ((SVE_SERVER_AIS as readonly string[]).includes(level!)) return createSveServerBot(engine, level as SveServerAI);
  return createBot(engine, level as BotLevel, seed, 1, variantEvaluation(variant));
}
/** The GUI's controller for a replay's seat (only shown while watching). */
const controllerOf = (spec: string) => {
  const level = SPEC.exec(spec)![1]!;
  return level === "easy" || level.startsWith("sve-") ? "greedy" : level === "hard" || level === "hard-beta" ? level : "medium";
};

// ---- Decks and the series ----

const deckOption = option("--decks")?.trim().toLowerCase() ?? null;
const setDecks = deckOption === null ? null : deckSet(deckOption);
/** A deck set is played in its format: the engine's deck rules and the restriction list. */
const standard = setDecks !== null;
const deckNames = setDecks ?? (deckOption ? deckOption.split(",").map((d) => d.trim()) : allSampleDecks());
const decks = deckNames.map((name) => sampleDeck(name)).filter((d): d is NamedDeck => d !== null);
const mirror = flag("--mirror");
const independent = flag("--independent");
const matchups = orderedMatchups(decks.length, mirror);
const series = option("--seed") ?? "arena";
const [rangeStart, rangeEnd] = (option("--range") ?? `0-${games}`).split("-").map((n) => whole(n, NaN, 0)) as [number, number];
const gameOf = (index: number) => {
  const g = seriesGame(index, series, matchups, independent);
  return { ...g, decks: [decks[g.decks[0]]!, decks[g.decks[1]]!] as const };
};

/** Why a deck can't be played in the deck sets' format: the engine's deck rules (CR 6.1), then the restriction list. */
function deckProblems(engine: Engine, deck: DeckList): string[] {
  const problems = engine.validateDeck(deck, { deckRestrictions: true });
  const list = JSON.parse(readFileSync(join(ROOT, "packages", "gui", "restrictions", `${DECK_SETS.restrictionList}.json`), "utf8")) as {
    banned: { card: string }[];
    limited: { card: string }[];
  };
  const defOf = (printing: string) => engine.db.ofPrinting(printing).id;
  const counts = new Map<string, number>();
  for (const p of [...deck.main, ...deck.evolve]) counts.set(defOf(p), (counts.get(defOf(p)) ?? 0) + 1);
  for (const { card } of list.banned) if (counts.has(defOf(card))) problems.push(`${card} is banned (${DECK_SETS.restrictionList})`);
  for (const { card } of list.limited) if ((counts.get(defOf(card)) ?? 0) > 1) problems.push(`${card} is limited to 1 (${DECK_SETS.restrictionList})`);
  return problems;
}

const ARENA_CONFIG = {
  // Every main phase and quick window is asked, as in the GUI (its replays: showEveryMainPhase, askEveryQuickWindow).
  autoResolve: ["selectPending", "selectCards", "choose", "orderCards"] as ("selectPending" | "selectCards" | "choose" | "orderCards")[],
  deckRestrictions: standard,
};

/** A quick window where passing is all its player can do: the GUI passes those itself (game-host.ts onlyPass). */
const onlyPass = (d: Decision) => d.type === "quick" && d.actions.every((a) => a.type === "pass");

/** One game's outcome, as a worker reports it. */
interface GameRecord {
  index: number;
  pair: number | null;
  seed: string;
  /** Seat 0's deck, seat 1's deck. */
  decks: [string, string];
  seatOfA: number;
  firstPlayer: PlayerId | null;
  /** "a" / "b": that bot won; "draw"; "?": not finished (the step limit, or an error). */
  winner: "a" | "b" | "draw" | "?";
  turns: number;
  /** The game threw (an engine error): its message. */
  error: string | null;
  think: Record<"a" | "b", { ms: number; decisions: number; turns: number[] }>;
  /** Answers a bot couldn't give and replaced by the default one, and simulations that failed (both should stay 0). */
  problems: Record<"a" | "b", { fallbacks: number; simulationFailures: number; lastError: string | null }>;
  /** Every answer with the seat that gave it (kept with --out). */
  inputs?: [PlayerId, Answer][];
  /** The inputs that answered a quick window where passing was all the seat could do. */
  passOnly?: number[];
}

const out = option("--out");
const recording = out !== null;

function playGame(engine: Engine, index: number): GameRecord {
  const { seed, pair, decks: [x, y], seatOfA } = gameOf(index);
  const think: GameRecord["think"] = { a: { ms: 0, decisions: 0, turns: [] }, b: { ms: 0, decisions: 0, turns: [] } };
  const inputs: [PlayerId, Answer][] = [];
  const passOnly: number[] = [];
  let error: string | null = null;
  let game: ReturnType<Engine["newGame"]> | null = null;
  let bots: Bot[] = [];
  try {
    game = engine.newGame({ seed, players: [x.deck, y.deck], config: ARENA_CONFIG });
    bots = [0, 1].map((seat) => (seat === seatOfA ? makeBot(engine, specs[0], `${seed}:a`) : makeBot(engine, specs[1], `${seed}:b`)));
    let turn = { number: -1, ms: 0, who: "a" as "a" | "b" };
    for (let steps = 0; game.decision && steps < 5000; steps++) {
      const d = game.decision;
      const player = d.player;
      const who = player === seatOfA ? "a" : "b";
      const t0 = performance.now();
      const answer = bots[player]!.decide(game);
      const ms = performance.now() - t0;
      think[who].ms += ms;
      think[who].decisions += 1;
      if (game.state.activePlayer === player) {
        if (turn.number !== game.state.turn) {
          if (turn.number >= 0) think[turn.who].turns.push(turn.ms);
          turn = { number: game.state.turn, ms: 0, who };
        }
        turn.ms += ms;
      }
      if (recording && onlyPass(d)) passOnly.push(inputs.length);
      game.act(answer);
      if (recording) inputs.push([player, answer]);
    }
    if (turn.number >= 0) think[turn.who].turns.push(turn.ms);
  } catch (e) {
    error = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
  }
  const result = error ? null : game?.result;
  const winner = !result ? "?" : result.winner === null ? "draw" : result.winner === seatOfA ? "a" : "b";
  const statsOf = (seat: number) => {
    const stats = (bots[seat] as { stats?: BotStats } | undefined)?.stats;
    return { fallbacks: stats?.fallbacks ?? 0, simulationFailures: stats?.simulationFailures ?? 0, lastError: stats?.lastError ?? null };
  };
  return {
    index,
    pair,
    seed,
    decks: [x.name, y.name],
    seatOfA,
    firstPlayer: game?.state.firstPlayer ?? null,
    winner,
    turns: game?.state.turn ?? 0,
    error,
    think,
    problems: { a: statsOf(seatOfA), b: statsOf(1 - seatOfA) },
    ...(recording ? { inputs, passOnly } : {}),
  };
}

// ---- A worker: its share of the games, one message each; it exits once every message is out ----

const shard = option("--shard");
if (shard) {
  const [k, n] = shard.split("/").map(Number) as [number, number];
  const engine = createEngine({ cards: ALL_CARDS, scripts: ALL_SCRIPTS });
  const sent: Promise<void>[] = [];
  for (let i = rangeStart + k; i < rangeEnd; i += n) {
    const record = playGame(engine, i);
    sent.push(new Promise((done) => process.send!(record, undefined, {}, () => done())));
  }
  await Promise.all(sent);
  process.exit(0);
}

// ---- The main process: check, play, report ----

const LEVELS = [...BOT_LEVELS, ...SVE_SERVER_AIS].join("|");
const fail = (message: string) => {
  console.error(message);
  console.error(
    `usage: npm run bot:arena -- [games] [${LEVELS}][:identity|:negated] [same] [--decks sd01,sd02|train|holdout|legal] [--mirror] [--independent] [--workers N] [--seed text] [--range a-b] [--out dir] [--replays N]`,
  );
  process.exit(1);
};
for (const spec of specs) {
  const problem = specProblem(spec);
  if (problem) fail(problem);
}
const workers = whole(option("--workers"), 1, 1);
const replays = whole(option("--replays"), 0, 0);
if (Number.isNaN(games) || Number.isNaN(workers) || Number.isNaN(replays)) fail("games, --workers and --replays are whole numbers");
if (!(rangeStart < rangeEnd && rangeEnd <= games)) fail(`--range a-b: 0 <= a < b <= ${games}`);
if (decks.length !== deckNames.length) fail(`no sample deck named ${deckNames.filter((n) => !decks.some((d) => d.name === n)).join(", ")}`);
if (matchups.length === 0) fail("two different decks are needed (or --mirror)");
if (replays > 0 && !out) fail("--replays needs --out");
const engine = createEngine({ cards: ALL_CARDS, scripts: ALL_SCRIPTS });
if (standard) {
  const bad = decks.map((d) => ({ name: d.name, problems: deckProblems(engine, d.deck) })).filter((d) => d.problems.length > 0);
  if (bad.length > 0) fail(bad.map((d) => `${d.name}: ${d.problems.join("; ")}`).join("\n"));
}

/** Where the games were played: the rules code, and the commit (with uncommitted changes in packages/ or not). */
function engineInfo() {
  const git = (command: string) => {
    try {
      return execSync(`git ${command}`, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    } catch {
      return null;
    }
  };
  return { fingerprint: engineFingerprint(join(ROOT, "packages", "gui")), commit: git("rev-parse --short HEAD"), changed: (git("status --porcelain -- packages") ?? "") !== "" };
}
const info = out ? engineInfo() : null;
const gamesPath = out ? join(out, "games.jsonl.gz") : null;
if (out) {
  if (existsSync(join(out, "games.jsonl.gz")) || existsSync(join(out, "report.json"))) fail(`${out} already has games: give a new folder`);
  mkdirSync(out, { recursive: true });
  if (replays > 0) mkdirSync(join(out, "replays"), { recursive: true });
}

/** A game as games.jsonl.gz keeps it: all a replay needs, and how it went. */
function gameLine(r: GameRecord) {
  const g = gameOf(r.index);
  return {
    format: "sve-arena-game",
    version: 1,
    series,
    index: r.index,
    pair: r.pair,
    seed: r.seed,
    engine: info,
    config: ARENA_CONFIG,
    rules: standard ? { format: DECK_SETS.format, restrictionList: DECK_SETS.restrictionList } : null,
    bots: { a: specs[0], b: specs[1], seatOfA: r.seatOfA, seeds: { a: `${r.seed}:a`, b: `${r.seed}:b` } },
    decks: g.decks.map((d) => ({ name: d.name, deck: d.deck })),
    firstPlayer: r.firstPlayer,
    result: { winner: r.winner === "?" ? "?" : r.winner === "draw" ? null : r.winner === "a" ? r.seatOfA : 1 - r.seatOfA, turns: r.turns },
    error: r.error,
    problems: r.problems,
    inputs: r.inputs ?? [],
    passOnly: r.passOnly ?? [],
  };
}

/** A game as the GUI's replays keep it (packages/gui/src/engine/protocol.ts Replay), to watch it there. */
function replayOf(r: GameRecord) {
  const g = gameOf(r.index);
  const passOnly = new Set(r.passOnly ?? []);
  return {
    format: "sve-replay",
    version: 1,
    options: {
      seed: r.seed,
      decks: [g.decks[0].deck, g.decks[1].deck],
      deckNames: [g.decks[0].name, g.decks[1].name],
      controllers: [0, 1].map((seat) => controllerOf(seat === r.seatOfA ? specs[0] : specs[1])),
      deckRestrictions: standard,
      ...(standard ? { format: DECK_SETS.format, restrictionList: DECK_SETS.restrictionList } : {}),
      showEveryMainPhase: true,
      askEveryQuickWindow: true,
      turnOrder: "choose",
    },
    // The quick windows where passing was all a seat could do are passed by the GUI itself (by no seat), as it plays them.
    inputs: (r.inputs ?? []).map(([by, input], i) => ({ input, by: passOnly.has(i) ? null : by })),
    info: { result: r.winner === "?" ? null : { winner: r.winner === "draw" ? null : r.winner === "a" ? r.seatOfA : 1 - r.seatOfA }, turn: r.turns },
  };
}

const records: GameRecord[] = [];
const started = performance.now();
/** Each game is written as it ends (its own gzip member: a crash keeps the games before it). */
const take = (r: GameRecord) => {
  if (gamesPath) appendFileSync(gamesPath, gzipSync(`${JSON.stringify(gameLine(r))}\n`));
  if (out && r.index - rangeStart < replays) {
    writeFileSync(join(out, "replays", `${String(r.index).padStart(5, "0")}_${r.decks[0]}_vs_${r.decks[1]}.json`), JSON.stringify(replayOf(r)));
  }
  delete r.inputs;
  records.push(r);
  process.stdout.write(r.error ? "!" : r.winner === "a" ? "A" : r.winner === "b" ? "B" : r.winner === "draw" ? "=" : "?");
};
const exitCodes: (number | null)[] = [];
if (workers === 1) {
  for (let i = rangeStart; i < rangeEnd; i++) take(playGame(engine, i));
} else {
  await Promise.all(
    Array.from({ length: workers }, (_, k) => {
      const child = fork(process.argv[1]!, [...args, "--shard", `${k}/${workers}`], { stdio: ["ignore", "inherit", "inherit", "ipc"] });
      child.on("message", (r: GameRecord) => take(r));
      return new Promise<void>((done) =>
        child.on("close", (code) => {
          exitCodes.push(code);
          done();
        }),
      );
    }),
  );
}
records.sort((u, v) => u.index - v.index);
const seconds = (performance.now() - started) / 1000;
const played = new Set(records.map((r) => r.index));
const missing: number[] = [];
for (let i = rangeStart; i < rangeEnd; i++) if (!played.has(i)) missing.push(i);

// ---- The report ----

/** A's score in a game: 1 won, 0.5 drawn, 0 lost (null: unfinished). */
const scoreOf = (r: GameRecord) => (r.winner === "a" ? 1 : r.winner === "draw" ? 0.5 : r.winner === "b" ? 0 : null);
/** Wilson's 95% interval for a share (`wins` may be fractional: draws count half). */
function wilson(wins: number, n: number) {
  if (n === 0) return { n, share: null, low: null, high: null };
  const z = 1.96;
  const p = wins / n;
  const center = (p + (z * z) / (2 * n)) / (1 + (z * z) / n);
  const margin = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / (1 + (z * z) / n);
  return { n, share: p, low: Math.max(0, center - margin), high: Math.min(1, center + margin) };
}
/**
 * The mean of scores (0–1) with a normal 95% interval from their spread. When they are all the same (everything won, or
 * lost), the spread says nothing: Wilson's interval of the mean as a share instead. No interval for fewer than 2.
 */
function meanInterval(xs: number[]) {
  const n = xs.length;
  if (n === 0) return { n, mean: null, low: null, high: null };
  const mean = xs.reduce((s, x) => s + x, 0) / n;
  if (n < 2) return { n, mean, low: null, high: null };
  const sd = Math.sqrt(xs.reduce((s, x) => s + (x - mean) ** 2, 0) / (n - 1));
  if (sd === 0) {
    const w = wilson(mean * n, n);
    return { n, mean, low: w.low, high: w.high };
  }
  const margin = (1.96 * sd) / Math.sqrt(n);
  return { n, mean, low: Math.max(0, mean - margin), high: Math.min(1, mean + margin) };
}
function groupBy<T, K>(xs: readonly T[], key: (x: T) => K): Map<K, T[]> {
  const groups = new Map<K, T[]>();
  for (const x of xs) groups.set(key(x), [...(groups.get(key(x)) ?? []), x]);
  return groups;
}
const quantile = (xs: number[], q: number) => [...xs].sort((u, v) => u - v)[Math.min(xs.length - 1, Math.floor(xs.length * q))] ?? 0;
const finished = records.filter((r) => r.winner !== "?");
const count = (w: GameRecord["winner"]) => records.filter((r) => r.winner === w).length;
const pairScores = [...groupBy(records, (r) => r.pair ?? -1 - r.index).values()]
  .filter((rs) => rs.length === 2 && rs.every((r) => r.winner !== "?"))
  .map((rs) => (scoreOf(rs[0]!)! + scoreOf(rs[1]!)!) / 2);
const goingFirst = (first: boolean) => meanInterval(finished.filter((r) => r.firstPlayer !== null && (r.firstPlayer === r.seatOfA) === first).map((r) => scoreOf(r)!));
const decided = finished.filter((r) => r.winner !== "draw");
const firstWins = decided.filter((r) => r.firstPlayer !== null && (r.winner === "a" ? r.seatOfA : 1 - r.seatOfA) === r.firstPlayer).length;
const turns = finished.map((r) => r.turns);
/**
 * Per deck: A's score with it, B's score with it, and A's minus B's. The scores alone mostly say how strong the deck is; the
 * difference says which bot plays it better (0 between equal bots).
 */
const byDeck = decks
  .map(({ name }) => {
    const withA = finished.filter((r) => r.decks[r.seatOfA] === name).map((r) => scoreOf(r)!);
    const withB = finished.filter((r) => r.decks[1 - r.seatOfA] === name).map((r) => 1 - scoreOf(r)!);
    const a = meanInterval(withA);
    const b = meanInterval(withB);
    return { deck: name, a, b, difference: a.mean !== null && b.mean !== null ? a.mean - b.mean : null };
  })
  .filter((d) => d.a.n + d.b.n > 0);
const errors = records.filter((r) => r.error !== null).map((r) => ({ index: r.index, error: r.error }));

const report = {
  a: specs[0],
  b: specs[1],
  series,
  range: [rangeStart, rangeEnd],
  decks: decks.map((d) => d.name),
  format: standard ? { format: DECK_SETS.format, restrictionList: DECK_SETS.restrictionList } : null,
  mirror,
  independent,
  games: records.length,
  /** Games of the range that never came back (a process died). */
  missing,
  /** Games that threw (an engine error): counted as unfinished. */
  errors,
  results: { a: count("a"), b: count("b"), draws: count("draw"), unfinished: count("?") },
  /** A's score by pairs (the luck of the deal and the seat taken out): the comparison to judge bots by. */
  pairScore: independent ? null : meanInterval(pairScores),
  /** A's score by games. */
  gameScore: meanInterval(finished.map((r) => scoreOf(r)!)),
  aWins: wilson(count("a"), decided.length),
  aGoingFirst: goingFirst(true),
  aGoingSecond: goingFirst(false),
  firstPlayerWins: wilson(firstWins, decided.length),
  turns: { mean: turns.length ? turns.reduce((s, t) => s + t, 0) / turns.length : null, p10: quantile(turns, 0.1), median: quantile(turns, 0.5), p90: quantile(turns, 0.9) },
  /** Per deck: A's score with it, B's, and the difference (A plays it better: above 0). */
  byDeck,
  problems: Object.fromEntries(
    (["a", "b"] as const).map((who) => [
      who,
      { fallbacks: records.reduce((s, r) => s + r.problems[who].fallbacks, 0), simulationFailures: records.reduce((s, r) => s + r.problems[who].simulationFailures, 0) },
    ]),
  ),
};
const timing = Object.fromEntries(
  (["a", "b"] as const).map((who) => {
    const ms = records.reduce((s, r) => s + r.think[who].ms, 0);
    const decisions = records.reduce((s, r) => s + r.think[who].decisions, 0);
    const own = records.flatMap((r) => r.think[who].turns);
    return [who, { msPerDecision: ms / Math.max(1, decisions), ownTurnMedianMs: quantile(own, 0.5), ownTurnP90Ms: quantile(own, 0.9), ownTurnMaxMs: Math.max(0, ...own) }];
  }),
);
if (out) {
  writeFileSync(join(out, "report.json"), `${JSON.stringify(report, null, 1)}\n`);
  writeFileSync(join(out, "timing.json"), `${JSON.stringify({ seconds, workers, exitCodes, ...timing }, null, 1)}\n`);
}

const pct = (v: number | null) => (v === null ? "-" : `${(100 * v).toFixed(1)}%`);
const range = (x: { mean?: number | null; share?: number | null; low: number | null; high: number | null; n: number }) =>
  `${pct(x.mean ?? x.share ?? null)} (95%: ${pct(x.low)}–${pct(x.high)}, n ${x.n})`;
console.log(
  `\n${specs[0]} (A) vs ${specs[1]} (B), ${records.length} games${mirror ? ", mirror matches" : ""}${independent ? ", independent seeds" : ""}${standard ? `, ${DECK_SETS.format} ${DECK_SETS.restrictionList}` : ""}, ${seconds.toFixed(0)} s`,
);
console.log(`A ${report.results.a}, B ${report.results.b}, draws ${report.results.draws}, unfinished ${report.results.unfinished}`);
if (report.pairScore) console.log(`A's score by pairs: ${range(report.pairScore)}`);
console.log(`A's score by games: ${range(report.gameScore)}`);
console.log(`A going first: ${range(report.aGoingFirst)}; going second: ${range(report.aGoingSecond)}`);
console.log(`the first player won ${range(report.firstPlayerWins)} of the decided games`);
console.log(`turns: mean ${report.turns.mean?.toFixed(1) ?? "-"}, 10% ${report.turns.p10}, median ${report.turns.median}, 90% ${report.turns.p90}`);
if (byDeck.length > 1) {
  console.log("per deck: A's score with it, B's score with it, A minus B (! A plays it 10 points worse or more, in 50 games or more each):");
  const points = (v: number | null) => (v === null ? "-" : `${v >= 0 ? "+" : ""}${(100 * v).toFixed(1)}`);
  for (const d of byDeck) {
    console.log(`  ${d.deck.padEnd(8)} A ${pct(d.a.mean)} (n ${d.a.n}), B ${pct(d.b.mean)} (n ${d.b.n}), ${points(d.difference)}${d.difference !== null && d.difference <= -0.1 && d.a.n >= 50 && d.b.n >= 50 ? " !" : ""}`);
  }
}
for (const [who, spec] of [["a", specs[0]], ["b", specs[1]]] as const) {
  const t = timing[who]!;
  console.log(
    `${who.toUpperCase()} ${spec}: ${t.msPerDecision.toFixed(1)} ms per decision; a turn of its own: median ${t.ownTurnMedianMs.toFixed(0)} ms, 90% ${t.ownTurnP90Ms.toFixed(0)} ms, longest ${t.ownTurnMaxMs.toFixed(0)} ms`,
  );
  const p = report.problems[who]!;
  if (p.fallbacks + p.simulationFailures > 0) {
    const error = records.map((r) => r.problems[who].lastError).find((e) => e !== null);
    console.log(`  ${who.toUpperCase()} problems: ${p.fallbacks} default answers, ${p.simulationFailures} failed simulations${error ? `; e.g. ${error}` : ""}`);
  }
}
for (const e of errors.slice(0, 5)) console.log(`game ${e.index} threw: ${e.error}`);
if (out) console.log(`written: ${out} (games.jsonl.gz, report.json, timing.json${replays > 0 ? `, replays/ (${Math.min(replays, records.length)})` : ""})`);
if (missing.length > 0 || errors.length > 0) {
  console.log(`INCOMPLETE: ${missing.length} games missing${missing.length ? ` (${missing.slice(0, 10).join(", ")}${missing.length > 10 ? ", ..." : ""})` : ""}, ${errors.length} games threw`);
  process.exit(1);
}
