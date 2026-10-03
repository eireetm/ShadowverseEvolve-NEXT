/**
 * Check recorded games (npm run bot:arena -- ... --out <dir>): npm run rl:verify -- <dir | games.jsonl.gz> [more ...]
 * Each game is played again from its seed, decks, config and inputs: every input must answer a decision of the seat that
 * recorded it and be legal (validateAnswer), and the game must end as recorded (winner and turn). Games recorded with
 * other rules code (another engine fingerprint) are counted apart: their cards may play differently now, so only games of
 * the current rules code that don't replay make the command exit with 1. A file cut short (a run that was stopped) is read
 * as far as it goes.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { constants, gunzipSync } from "node:zlib";
import { createEngine, validateAnswer, type Answer, type DeckList, type PlayerId } from "../packages/core/src";
import { ALL_CARDS, ALL_SCRIPTS } from "../packages/core/src/sets";
import { engineFingerprint } from "../packages/gui/fingerprint";

interface RecordedGame {
  format: "sve-arena-game";
  version: 1;
  index: number;
  seed: string;
  engine: { fingerprint: string } | null;
  config: Record<string, unknown>;
  decks: { name: string; deck: DeckList }[];
  result: { winner: PlayerId | null | "?"; turns: number };
  inputs: [PlayerId, Answer][];
}

const paths = process.argv.slice(2);
if (paths.length === 0) {
  console.error("usage: npm run rl:verify -- <dir | games.jsonl.gz> [more ...]");
  process.exit(1);
}
const files = paths.map((p) => (existsSync(p) && statSync(p).isDirectory() ? join(p, "games.jsonl.gz") : p));
const engine = createEngine({ cards: ALL_CARDS, scripts: ALL_SCRIPTS });
const fingerprint = engineFingerprint(join(import.meta.dirname, "..", "packages", "gui"));

/** Why the game doesn't replay as recorded, or null. */
function replayProblem(g: RecordedGame): string | null {
  if (g.format !== "sve-arena-game" || g.version !== 1) return `not a recorded game (${String(g.format)} ${String(g.version)})`;
  const game = engine.newGame({ seed: g.seed, players: [g.decks[0]!.deck, g.decks[1]!.deck], config: g.config });
  for (const [i, [player, input]] of g.inputs.entries()) {
    const d = game.decision;
    if (!d) return `input ${i}: the game was already over`;
    if (d.player !== player) return `input ${i}: the decision is seat ${d.player}'s, recorded for seat ${player}`;
    const problem = validateAnswer(d, input);
    if (problem) return `input ${i} (${d.type}): ${problem}`;
    game.act(input);
  }
  const winner = game.result ? game.result.winner : "?";
  if (winner !== g.result.winner) return `ends with winner ${String(winner)}, recorded ${String(g.result.winner)}`;
  if (game.state.turn !== g.result.turns) return `ends in turn ${game.state.turn}, recorded ${g.result.turns}`;
  if (g.result.winner !== "?" && game.decision) return "the game goes on after the recorded inputs";
  return null;
}

const count = { games: 0, failed: 0, other: 0, otherFailed: 0, cutShort: 0 };
for (const file of files) {
  let text: string;
  try {
    // Every game is its own gzip member; a file cut short gives what it has.
    text = gunzipSync(readFileSync(file), { finishFlush: constants.Z_SYNC_FLUSH }).toString("utf8");
  } catch (e) {
    console.log(`${file}: can't be read (${e instanceof Error ? e.message : String(e)})`);
    count.failed += 1;
    continue;
  }
  let fileGames = 0;
  let fileFailed = 0;
  for (const line of text.split("\n").filter((l) => l.trim() !== "")) {
    let g: RecordedGame;
    try {
      g = JSON.parse(line) as RecordedGame;
    } catch {
      count.cutShort += 1;
      continue;
    }
    fileGames += 1;
    const current = g.engine?.fingerprint === fingerprint;
    if (current) count.games += 1;
    else count.other += 1;
    let problem: string | null;
    try {
      problem = replayProblem(g);
    } catch (e) {
      problem = `the engine threw: ${e instanceof Error ? e.message : String(e)}`;
    }
    if (problem) {
      fileFailed += 1;
      if (current) count.failed += 1;
      else count.otherFailed += 1;
      if (fileFailed <= 5) console.log(`${file} game ${g.index}${current ? "" : " (other rules code)"}: ${problem}`);
    }
  }
  console.log(`${file}: ${fileGames} games, ${fileGames - fileFailed} replay as recorded`);
}
console.log(`current rules code (engine fingerprint ${fingerprint}): ${count.games} games, ${count.games - count.failed} replay as recorded, ${count.failed} don't`);
if (count.other > 0) console.log(`other rules code: ${count.other} games, ${count.otherFailed} don't replay any more`);
if (count.cutShort > 0) console.log(`${count.cutShort} lines cut short (a run that was stopped)`);
process.exit(count.failed > 0 ? 1 : 0);
