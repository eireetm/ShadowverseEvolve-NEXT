/**
 * How a bot plays, beyond who wins: npm run rl:behaviour -- <dir | games.jsonl.gz> [--games N]
 * Plays recorded games (npm run bot:arena -- ... --out) again and counts behaviours the blind-spot audit found wanting, to
 * compare one version of a bot with the next (win rates between bots that share a blind spot can't show it):
 *   - Ward followers entered engaged in their controller's own turn (CR 12.8.2: they can be engaged at the end phase);
 *   - quick windows where something besides passing was possible, and Quick plays made;
 *   - evolution and super-evolution points left when the game ended, for the first and the second player (CR 6.2.1.10);
 *   - turns ended with a follower in hand that could still have been played (holding cards: neither good nor bad by itself).
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { constants, gunzipSync } from "node:zlib";
import { createEngine, type DeckList, type Input, type PlayerId } from "../packages/core/src";
import { ALL_CARDS, ALL_SCRIPTS } from "../packages/core/src/sets";

interface RecordedGame {
  index: number;
  seed: string;
  config: Record<string, unknown>;
  decks: { name: string; deck: DeckList }[];
  inputs: [PlayerId, Input][];
}

const args = process.argv.slice(2);
const option = (name: string) => {
  const at = args.indexOf(name);
  return at >= 0 ? (args[at + 1] ?? null) : null;
};
const path = args.find((a, i) => !a.startsWith("--") && !(i > 0 && args[i - 1] === "--games"));
const file = path && existsSync(path) && statSync(path).isDirectory() ? join(path, "games.jsonl.gz") : path;
const limit = option("--games") === null ? Infinity : Number(option("--games"));
if (!file || !existsSync(file) || !(limit >= 1)) {
  console.error("usage: npm run rl:behaviour -- <dir | games.jsonl.gz> [--games N]");
  process.exit(1);
}

const engine = createEngine({ cards: ALL_CARDS, scripts: ALL_SCRIPTS });
const text = gunzipSync(readFileSync(file), { finishFlush: constants.Z_SYNC_FLUSH }).toString("utf8");
const games: RecordedGame[] = [];
for (const line of text.split("\n")) {
  if (!line.trim()) continue;
  try {
    games.push(JSON.parse(line) as RecordedGame);
  } catch {
    // a file cut short
  }
}
games.sort((a, b) => a.index - b.index);

const n = { games: 0, wardEntries: 0, wardEngagedOwnTurn: 0, quickWindows: 0, quickReal: 0, quickPlays: 0, ended: 0, ep: [0, 0], sep: [0, 0], turnEnds: 0, heldPlayable: 0 };
for (const g of games.slice(0, limit)) {
  const game = engine.newGame({ seed: g.seed, players: [g.decks[0]!.deck, g.decks[1]!.deck], config: g.config });
  let ok = true;
  for (const [, input] of g.inputs) {
    const d = game.decision;
    if (!d) break;
    const st = game.state;
    if (d.type === "selectCards" && d.reason === "wardEnterEngaged" && input.type === "selectCards") {
      n.wardEntries += d.candidates.length;
      if (st.activePlayer === d.player) n.wardEngagedOwnTurn += input.cards.length;
    }
    if (d.type === "quick") {
      n.quickWindows += 1;
      if (d.actions.some((a) => a.type !== "pass")) n.quickReal += 1;
      if (input.type === "quick" && input.action.type !== "pass") n.quickPlays += 1;
    }
    if (d.type === "mainPhase" && st.activePlayer === d.player && input.type === "mainPhase" && input.action.type === "endMainPhase") {
      n.turnEnds += 1;
      if (d.actions.some((a) => a.type === "play" && game.reader().info(a.card).type === "follower")) n.heldPlayable += 1;
    }
    try {
      game.act(input);
    } catch {
      ok = false;
      break;
    }
  }
  if (!ok) continue;
  n.games += 1;
  if (game.result) {
    n.ended += 1;
    for (const p of [0, 1] as const) {
      const side = game.state.players[p];
      const seat = game.state.firstPlayer === p ? 0 : 1;
      n.ep[seat]! += side.evolutionPoints;
      n.sep[seat]! += side.superEvolutionPoints;
    }
  }
}
const pct = (a: number, b: number) => (b > 0 ? `${((100 * a) / b).toFixed(1)}%` : "-");
console.log(`${file}: ${n.games} games`);
console.log(`Ward followers entered engaged in their own turn: ${n.wardEngagedOwnTurn} of ${n.wardEntries} entries (${pct(n.wardEngagedOwnTurn, n.wardEntries)})`);
console.log(`quick windows: ${n.quickWindows}; with something besides passing: ${n.quickReal}; Quick plays: ${n.quickPlays} (${(n.quickPlays / Math.max(1, n.games)).toFixed(2)} a game)`);
const per = (x: number) => (x / Math.max(1, n.ended)).toFixed(2);
console.log(`left at the end of a game, first / second player: evolution points ${per(n.ep[0]!)} / ${per(n.ep[1]!)}, super-evolution points ${per(n.sep[0]!)} / ${per(n.sep[1]!)}`);
console.log(`turns ended with a playable follower in hand: ${n.heldPlayable} of ${n.turnEnds} (${pct(n.heldPlayable, n.turnEnds)})`);
