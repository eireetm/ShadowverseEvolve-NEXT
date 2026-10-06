// Where the value network's training samples are taken in a recorded game, their labels and their split.
import type { GameSession, PlayerId } from "../../packages/core/src";

/**
 * A sample point: the first main phase decision of the active player in a turn (a main phase action to choose, CR 9.2), seen
 * by both players. It is where the bots' searches score the positions they compare: the planner plays a turn to the next
 * player's first main phase decision (packages/bot/src/planner.ts toNextMainPhase, the same condition) and scores it there,
 * from the active player's view (one turn ahead) or the other player's (two turns ahead). Once a turn.
 */
export function isSamplePoint(game: GameSession, lastSampledTurn: number): boolean {
  const d = game.decision;
  return d !== null && d !== undefined && d.type === "mainPhase" && d.player === game.state.activePlayer && game.state.turn !== lastSampledTurn;
}

export interface SamplePoint {
  /** The index of the recorded input about to be answered there (the game replayed up to it rebuilds the position). */
  input: number;
  turn: number;
  active: PlayerId;
}

/**
 * Replays a record's inputs, yielding the game at each sample point before the input there is given (the yielded game is
 * live: read it before asking for the next point). Ends with the game after the last input.
 */
export function* replaySamples(game: GameSession, inputs: readonly [PlayerId, unknown][]): Generator<{ point: SamplePoint; game: GameSession }, GameSession> {
  let last = -1;
  for (const [i, [, input]] of inputs.entries()) {
    if (isSamplePoint(game, last)) {
      last = game.state.turn;
      yield { point: { input: i, turn: game.state.turn, active: game.state.activePlayer }, game };
    }
    game.act(input as Parameters<GameSession["act"]>[0]);
  }
  return game;
}

/** A finished game's label for a player: 1 won, 0.5 drawn, 0 lost. */
export function labelOf(winner: PlayerId | null, viewer: PlayerId): number {
  return winner === null ? 0.5 : winner === viewer ? 1 : 0;
}

/**
 * The game's bucket (0–99): FNV-1a (32 bits) of "split-v1|" and its seed, as UTF-8. Every sample of a game shares it, so a game
 * is never on both sides of a split (positions of one game are alike).
 */
export function bucketOf(seed: string): number {
  let h = 0x811c9dc5;
  for (const byte of Buffer.from(`split-v1|${seed}`, "utf8")) {
    h ^= byte;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h % 100;
}

/** Train (0: buckets 0–79), valid (1: 80–89), test (2: 90–99). A holdout deck's data is its own set (3). */
export function splitOf(bucket: number): 0 | 1 | 2 {
  return bucket < 80 ? 0 : bucket < 90 ? 1 : 2;
}
