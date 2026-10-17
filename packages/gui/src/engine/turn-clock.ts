// Online play's turn time limit (GameOptions.turnLimit, the host's rule): each player has `limit` for their turn and for
// their answers in the other player's turn after it, given again at the start of each of their turns. Whose time runs: the
// active player's, from the start of their turn, except while the game waits for the other player (a quick window, a choice
// of theirs) — then the other's. Each program keeps it from its own clock: the inputs keep the two games the same, the times
// may differ by the network's delay. A program holds its own player to their time (out of time, it answers for them); the
// other player's is only shown.
import type { PlayerId } from "@sve/core";

/** Where the game is, as the clock needs it. */
export interface ClockMoment {
  /** The turn (CR 3.3; 0: not begun, the setup) and whose it is. */
  turn: number;
  active: PlayerId;
  /** Whom the game waits for (null: nobody). */
  deciding: PlayerId | null;
  over: boolean;
}

/** The clock as the screens show it (GameUpdate.online.clock). */
export interface TurnClockView {
  /** Each player's time left (ms) when this was made. */
  left: [number, number];
  /** Whose time is running (null: nobody's). */
  running: PlayerId | null;
  /** The limit (ms). */
  limit: number;
}

export class TurnClock {
  private readonly left: [number, number];
  private running: PlayerId | null = null;
  private since = 0;
  /** The last turn whose start gave its player their whole time again (a turn played again after taking answers back doesn't). */
  private turn = 0;

  constructor(
    readonly limit: number,
    private readonly now: () => number,
  ) {
    this.left = [limit, limit];
  }

  /** The game is at `moment` now: the time since the last one goes to whoever's was running, then whose runs from now. */
  follow(moment: ClockMoment): void {
    const t = this.now();
    if (this.running !== null) this.left[this.running] = Math.max(0, this.left[this.running] - (t - this.since));
    this.since = t;
    if (moment.turn > this.turn) {
      this.turn = moment.turn;
      this.left[moment.active] = this.limit;
    }
    if (moment.over || moment.turn === 0) this.running = null;
    else this.running = moment.deciding !== null && moment.deciding !== moment.active ? moment.deciding : moment.active;
  }

  /** A player's time left now (ms). */
  timeLeft(player: PlayerId): number {
    const left = this.left[player];
    return this.running === player ? Math.max(0, left - (this.now() - this.since)) : left;
  }

  /** Whether a player has no time left. */
  out(player: PlayerId): boolean {
    return this.timeLeft(player) <= 0;
  }

  /** Whose time is running (null: nobody's). */
  get runningFor(): PlayerId | null {
    return this.running;
  }

  view(): TurnClockView {
    return { left: [this.timeLeft(0), this.timeLeft(1)], running: this.running, limit: this.limit };
  }
}
