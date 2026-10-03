/**
 * Missed lethal in recorded games: npm run rl:lethal -- <dir | games.jsonl.gz> [--games N] [--workers N] [--out file.json]
 * Each recorded game (npm run bot:arena -- ... --out; games with the same inputs once) is played again. At each main phase
 * decision of the player whose turn it is, while lethal is within reach, a wide search looks for a sure lethal the way a fair
 * player would (packages/bot lethal.ts: the line must win in 6 samples of what the player knows, the opponent answering) —
 * until one is found that turn; in the turn a player won, only at its first decision. A turn where a sure lethal is found and
 * the player doesn't win in it is a missed lethal. Prints the games with one, those the player who missed it went on to lose,
 * how often the winning turns had lethal in sight from their start (how well this search finds them), and the misses by how
 * many turns the game still went on. Slow (seconds a game): --games takes the first N, --workers splits them.
 */
import { fork } from "node:child_process";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { cpus } from "node:os";
import { join } from "node:path";
import { constants, gunzipSync } from "node:zlib";
import { createEngine, type Answer, type DeckList, type PlayerId } from "../packages/core/src";
import { ALL_CARDS, ALL_SCRIPTS } from "../packages/core/src/sets";
import { GreedyBot, lethalWithinReach, searchSureLethal } from "../packages/bot/src";
import { engineFingerprint } from "../packages/gui/fingerprint";

interface RecordedGame {
  format: "sve-arena-game";
  index: number;
  seed: string;
  engine: { fingerprint: string } | null;
  config: Record<string, unknown>;
  decks: { name: string; deck: DeckList }[];
  result: { winner: PlayerId | null | "?"; turns: number };
  inputs: [PlayerId, Answer][];
}

/** A turn of a game: whose, whether a sure lethal was seen (at which of its main phase decisions), how it went. */
interface TurnRow {
  turn: number;
  player: PlayerId;
  decisions: number;
  /** A sure lethal at the first main phase decision (null: not looked for there, lethal not within reach). */
  atStart: boolean | null;
  seenAt: number | null;
  wonThisTurn: boolean;
  wonGame: boolean;
}

interface GameAudit {
  index: number;
  turns: number;
  rows: TurnRow[];
  /** The game doesn't replay as recorded (other rules code): left out. */
  problem: string | null;
}

const args = process.argv.slice(2);
const option = (name: string) => {
  const at = args.indexOf(name);
  return at >= 0 ? (args[at + 1] ?? null) : null;
};
const VALUED = ["--games", "--workers", "--out", "--shard", "--of"];
const path = args.find((a, i) => !a.startsWith("--") && !(i > 0 && VALUED.includes(args[i - 1]!)));
const file = path && existsSync(path) && statSync(path).isDirectory() ? join(path, "games.jsonl.gz") : path;
const limit = option("--games") === null ? Infinity : Number(option("--games"));
const workers = option("--workers") === null ? Math.max(1, cpus().length - 2) : Number(option("--workers"));
if (!file || !existsSync(file) || !(limit >= 1) || !Number.isInteger(workers) || workers < 1) {
  console.error("usage: npm run rl:lethal -- <dir | games.jsonl.gz> [--games N] [--workers N] [--out file.json]");
  process.exit(1);
}

/** The recorded games, those with the same inputs once (both seats played by the same bot can give the same game twice). */
function loadGames(): RecordedGame[] {
  const text = gunzipSync(readFileSync(file!), { finishFlush: constants.Z_SYNC_FLUSH }).toString("utf8");
  const seen = new Set<string>();
  const games: RecordedGame[] = [];
  for (const line of text.split("\n")) {
    if (line.trim() === "") continue;
    let g: RecordedGame;
    try {
      g = JSON.parse(line) as RecordedGame;
    } catch {
      continue; // a file cut short
    }
    const key = JSON.stringify(g.inputs);
    if (seen.has(key)) continue;
    seen.add(key);
    games.push(g);
  }
  return games.sort((a, b) => a.index - b.index).slice(0, limit);
}

function audit(engine: ReturnType<typeof createEngine>, g: RecordedGame): GameAudit {
  const final = engine.newGame({ seed: g.seed, players: [g.decks[0]!.deck, g.decks[1]!.deck], config: g.config });
  try {
    for (const [, input] of g.inputs) final.act(input);
  } catch (e) {
    return { index: g.index, turns: 0, rows: [], problem: e instanceof Error ? e.message : String(e) };
  }
  const winner = final.result ? final.result.winner : "?";
  if (winner !== g.result.winner || final.state.turn !== g.result.turns) return { index: g.index, turns: 0, rows: [], problem: "doesn't end as recorded" };
  const lastTurn = final.state.turn;
  const game = engine.newGame({ seed: g.seed, players: [g.decks[0]!.deck, g.decks[1]!.deck], config: g.config });
  const rows = new Map<number, TurnRow>();
  let responders = 0;
  for (const [, input] of g.inputs) {
    const d = game.decision!;
    const st = game.state;
    if (d.type === "mainPhase" && st.phase === "main" && st.activePlayer === d.player) {
      const me = d.player;
      let row = rows.get(st.turn);
      if (!row) {
        row = { turn: st.turn, player: me, decisions: 0, atStart: null, seenAt: null, wonThisTurn: winner === me && lastTurn === st.turn, wonGame: winner === me };
        rows.set(st.turn, row);
      }
      const k = row.decisions++;
      if (row.seenAt === null && (!row.wonThisTurn || k === 0) && lethalWithinReach(game.view(me), d, me)) {
        const seed = `rl-lethal:${g.index}:${st.turn}:${k}`;
        const found = searchSureLethal(me, {
          budget: 5000,
          beam: 48,
          maxBranches: 24,
          world: (i) => game.determinized(me, `${seed}:${i}`),
          checks: 6,
          searchResponder: () => null,
          checkResponder: () => {
            const bot = new GreedyBot(engine, { seed: `${seed}:respond:${responders++}`, maxCandidates: 12 });
            return (session) => bot.decide(session);
          },
          maxLines: 10,
          seed,
        });
        if (k === 0) row.atStart = found.line !== null;
        if (found.line) row.seenAt = k;
      }
    }
    game.act(input);
  }
  return { index: g.index, turns: lastTurn, rows: [...rows.values()], problem: null };
}

const shard = option("--shard");
if (shard !== null) {
  // A worker: games k, k + n, ... of the list, one message each; it exits once every message is out.
  const k = Number(shard);
  const n = Number(option("--of"));
  const engine = createEngine({ cards: ALL_CARDS, scripts: ALL_SCRIPTS });
  const games = loadGames().filter((_, i) => i % n === k);
  let sent = 0;
  for (const g of games) {
    let result: GameAudit;
    try {
      result = audit(engine, g);
    } catch (e) {
      result = { index: g.index, turns: 0, rows: [], problem: `the audit threw: ${e instanceof Error ? e.message : String(e)}` };
    }
    process.send!(result, undefined, {}, () => ++sent === games.length && process.exit(0));
  }
  if (games.length === 0) process.exit(0);
} else {
  const all = loadGames();
  const current = engineFingerprint(join(import.meta.dirname, "..", "packages", "gui"));
  const other = all.filter((g) => g.engine?.fingerprint !== current).length;
  const n = Math.min(workers, all.length);
  console.log(`${file}: ${all.length} games (identical ones once), ${n} processes${other > 0 ? `; ${other} recorded with other rules code (those that don't replay are left out)` : ""} ...`);
  const audits: GameAudit[] = [];
  const started = Date.now();
  const exits = await Promise.all(
    Array.from({ length: n }, (_, k) => {
      const child = fork(process.argv[1]!, [...args, "--shard", String(k), "--of", String(n)], { stdio: ["ignore", "inherit", "inherit", "ipc"] });
      child.on("message", (m: GameAudit) => {
        audits.push(m);
        if (audits.length % 50 === 0) console.log(`  ${audits.length}/${all.length} games (${Math.round((Date.now() - started) / 1000)} s)`);
      });
      return new Promise<number | null>((done) => child.on("exit", (code) => done(code)));
    }),
  );
  const done = audits.filter((a) => a.problem === null);
  const rows = done.flatMap((a) => a.rows.map((r) => ({ ...r, game: a.index, left: a.turns - r.turn })));
  const pct = (x: number, of: number) => (of > 0 ? `${((100 * x) / of).toFixed(1)}%` : "-");
  const missed = rows.filter((r) => r.seenAt !== null && !r.wonThisTurn);
  const missedGames = new Set(missed.map((r) => r.game));
  const lostGames = new Set(missed.filter((r) => !r.wonGame).map((r) => r.game));
  const won = rows.filter((r) => r.wonThisTurn);
  const left: Record<string, number> = {};
  for (const r of missed) left[r.left >= 5 ? "5+" : String(r.left)] = (left[r.left >= 5 ? "5+" : String(r.left)] ?? 0) + 1;
  const report = {
    file,
    games: done.length,
    leftOut: audits.length - done.length,
    missing: all.length - audits.length,
    missedTurns: missed.length,
    gamesWithMiss: missedGames.size,
    gamesLostAfterMiss: lostGames.size,
    winningTurns: won.length,
    winningTurnsSeenAtStart: won.filter((r) => r.atStart === true).length,
    missesByTurnsLeft: left,
    seconds: Math.round((Date.now() - started) / 1000),
  };
  console.log(`${done.length} games${report.leftOut > 0 ? ` (${report.leftOut} left out: they don't replay as recorded)` : ""}, ${report.seconds} s`);
  console.log(`missed a sure lethal: ${missed.length} turns in ${missedGames.size} games (${pct(missedGames.size, done.length)}); the player who missed it lost ${lostGames.size} of them (${pct(lostGames.size, done.length)} of all games)`);
  console.log(`winning turns with a sure lethal in sight from their first decision: ${report.winningTurnsSeenAtStart} of ${won.length} (${pct(report.winningTurnsSeenAtStart, won.length)}: how well this search finds them)`);
  console.log(`misses by the turns the game still went on: ${JSON.stringify(left)}`);
  const out = option("--out");
  if (out) writeFileSync(out, JSON.stringify({ report, games: audits }, null, 1));
  if (report.missing > 0 || exits.some((code) => code !== 0)) {
    console.log(`${report.missing} games missing: a process stopped`);
    process.exit(1);
  }
}
