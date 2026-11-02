// Online play's time limits, the host's rules. Whose time runs: the active player's, from the start of their turn, except
// while the game waits for the other player (a quick window, a choice of theirs) — then the other's. Each program keeps them
// from its own clock: the inputs keep the two games the same, the times may differ by the network's delay. A program holds
// its own player to their time (out of time, it acts for them); the other player's is only shown.
// - The turn time limit (GameOptions.turnLimit): each player has `limit` for their turn and for their answers in the other
//   player's turn after it, given again at the start of each of their turns. Out of time, their program answers for them.
// - The total time limit (GameOptions.totalLimit): each player has `limit` for the whole game, never given back; the setup's
//   decisions count too, so nobody can hold a game there. Out of time, their program concedes for them (CR 1.2.3).
import type { PlayerId } from "@sve/core";

/** Where the game is, as the clocks need it. */
export interface ClockMoment {
  /** The turn (CR 3.3; 0: not begun, the setup) and whose it is. */
  turn: number;
  active: PlayerId;
  /** Whom the game waits for (null: nobody). */
  deciding: PlayerId | null;
  over: boolean;
}

/** A clock as the screens show it (GameUpdate.online.clock, .total). */
export interface ClockView {
  /** Each player's time left (ms) when this was made. */
  left: [number, number];
  /** Whose time is running (null: nobody's). */
  running: PlayerId | null;
  /** The limit (ms). */
  limit: number;
}

/** Whose time runs in a turn. */
const runningIn = ({ active, deciding }: ClockMoment): PlayerId => (deciding !== null && deciding !== active ? deciding : active);

class PlayerClocks {
  protected readonly left: [number, number];
  protected running: PlayerId | null = null;
  private since = 0;

  constructor(
    readonly limit: number,
    private readonly now: () => number,
  ) {
    this.left = [limit, limit];
  }

  /** The time since the last time this was called goes to whoever's was running. */
  protected charge(): void {
    const t = this.now();
    if (this.running !== null) this.left[this.running] = Math.max(0, this.left[this.running] - (t - this.since));
    this.since = t;
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

  view(): ClockView {
    return { left: [this.timeLeft(0), this.timeLeft(1)], running: this.running, limit: this.limit };
  }
}

export class TurnClock extends PlayerClocks {
  /** The last turn whose start gave its player their whole time again (a turn played again after taking answers back doesn't). */
  private turn = 0;

  /** The game is at `moment` now: the time since the last one goes to whoever's was running, then whose runs from now. */
  follow(moment: ClockMoment): void {
    this.charge();
    if (moment.turn > this.turn) {
      this.turn = moment.turn;
      this.left[moment.active] = this.limit;
    }
    this.running = moment.over || moment.turn === 0 ? null : runningIn(moment);
  }
}

export class TotalClock extends PlayerClocks {
  /** As TurnClock.follow; in the setup, the time of whoever the game waits for runs. */
  follow(moment: ClockMoment): void {
    this.charge();
    this.running = moment.over ? null : moment.turn === 0 ? moment.deciding : runningIn(moment);
  }

  /** The players' time left as the room's host counts it (a spectator who came during the game). */
  setLeft(left: readonly [number, number]): void {
    this.charge();
    this.left[0] = left[0];
    this.left[1] = left[1];
  }
}
