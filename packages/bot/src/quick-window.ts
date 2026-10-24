/**
 * The opponent's end-phase Quick window (CR 7.4.5), the last one before our refill: GreedyBotOptions endPhaseQuickBonus and
 * PlannerBotOptions quickEndBonus. At that window the greedy bot scores each candidate answer as it scores any other
 * (greedy.ts choose / simulate: the answer given in a sample of the game as the bot knows it, played on with quick answers
 * to the next main phase decision, scored there), then adds the bonus for every play point the answer uses of those the
 * bot has at that window; the best wins, ties as the greedy bot breaks them (the first candidate listed).
 *
 * Why. That window is the last one before the refill (7.4.6 repeats it; 7.4.7–7.4.9 have none): play points unused there
 * are lost when our start phase sets them to the maximum (CR 7.2.2). The greedy scores after that refill, where the PP are
 * the same whatever was answered, so it can't see that a Quick card (CR 12.3.2) cast there was paid with points that would
 * have been lost: casting Insight (1 PP, draw a card) and keeping it score the same, and the first candidate ("pass")
 * wins. pp1 (eval-pp.ts (b)) charges exactly those points: −ppWaste each in the opponent's end phase ("lost"), a term the
 * greedy's scoring point never sees; the bonus puts that term back for the window's answers, so it is meant to be pp1's
 * ppWaste (the hand-written evaluation counts +0.1 per unused point anywhere: there is no waste term to put back).
 *
 * The points used: the bot's play points at the window minus those it has when its own next turn starts (the start phase's
 * refill comes right after, CR 7.2.2), never below 0, read from the playPointsChanged events of the sample's inputs (every
 * change of play points emits one). A line that reaches another turn first (the opponent's extra turn, CR 5.28; ours
 * skipped, 5.26: the points are not refilled then) or the end of the game gets no bonus; nor does a simulation that fails.
 */
import type { Decision, GameEvent, PlayerId, PlayerView } from "./core";

/** The only quick window changed: the opponent's end phase (CR 7.4.5). */
export const QUICK_END = "end";

/** The change's identity, written after the greedy's evaluation identity: "quick=end:ppWaste=0.25". */
export const quickIdentity = (ppWaste: number): string => `quick=${QUICK_END}:ppWaste=${String(ppWaste)}`;

/** What is wrong with a bonus (null: nothing): a number from 0 to 10 (pp1's range for ppWaste). */
export function quickBonusProblem(bonus: number): string | null {
  return typeof bonus !== "number" || !Number.isFinite(bonus) || bonus < 0 || bonus > 10 ? `quick=${QUICK_END}: ppWaste=${String(bonus)}: from 0 to 10` : null;
}

/**
 * The bot's play points at the opponent's end-phase window, or null when `d` isn't that window or nothing is left to use
 * there: a quick decision with timing "endPhase" of the non-active player in the active player's end phase (CR 7.4.5).
 */
export function endWindowPoints(d: Decision, view: PlayerView): number | null {
  if (d.type !== "quick" || d.timing !== "endPhase") return null;
  const start = view.players[d.player].playPoints;
  return view.activePlayer === d.player || view.phase !== "end" || start <= 0 ? null : start;
}

/**
 * One answer's line from the window: the bot's play points as the events of the sample's inputs change them, until a turn
 * starts (its own: the refill follows, CR 7.2.2) or the game ends.
 */
export class PpLine {
  private current: number;
  private ended: "ours" | "other" | null = null;
  constructor(
    private readonly me: PlayerId,
    private readonly start: number,
  ) {
    this.current = start;
  }

  /** Follow the events of one input given in the sample. */
  see(events: readonly GameEvent[]): void {
    for (const e of events) {
      if (this.ended) return;
      if (e.type === "playPointsChanged" && e.player === this.me) this.current = e.playPoints;
      else if (e.type === "turnStarted") this.ended = e.player === this.me ? "ours" : "other";
      else if (e.type === "gameEnded") this.ended = "other";
    }
  }

  /** The points used of those the refill would take (0 unless the line reached our next turn). */
  spent(): number {
    return this.ended === "ours" ? Math.max(0, this.start - this.current) : 0;
  }
}

/** What the bonus did on one greedy bot: the windows it armed, the candidates scored there, those given a bonus. */
export interface QuickWindowStats {
  /**
   * The windows with play points left (endWindowPoints), also those the greedy bot answers without scoring — passing the
   * only answer (one candidate), or past its cap of decisions in a turn —, which add nothing to `scored`. Windows armed with
   * nothing scored are those, not a bonus that failed.
   */
  windows: number;
  /** The candidates scored at a window with more than one answer (each with its line's play points). */
  scored: number;
  /** Those whose line used play points there: given the bonus. */
  bonused: number;
}
