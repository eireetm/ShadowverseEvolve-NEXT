// Beside the line where the two mats meet: on the left the turn, the phase and what the game waits for; on the right the
// buttons that finish the pending decision (end the main phase, pass, confirm a selection, keep the hand ...). Everything
// else about a decision is on the table (lit cards and their menus) or in the decision window (DecisionDialog). What it
// says and offers is center-state.ts (a phone shows the same in its columns).
import { useEffect, useMemo, useState } from "react";
import type { GameUpdate } from "../../engine/protocol";
import { useT } from "../../i18n";
import { ProcessingPrompt } from "../decisions/ProcessingPrompt";
import { playerLabel } from "../labels";
import { useCenterState } from "./center-state";

/** `placing`: a card waiting for the person to pick its slot (choose card spots by hand), by name. */
export function CenterLine({ update, placing = null }: { update: GameUpdate; placing?: string | null }) {
  const t = useT();
  const center = useCenterState(update, placing);
  return (
    <>
      {/* With a turn clock, a line more: on a small screen the prompt gets one less (the box keeps its height). */}
      <div className={`sve-center-status${update.online?.clock ? " sve-center-status-timed" : ""}`}>
        <div className="sve-center-turn">
          <strong>{t("game.turn", { n: center.turn })}</strong> · {center.phase}
        </div>
        {center.activeLine !== null ? <div data-testid="center-active-player">{center.activeLine}</div> : null}
        <TurnClockLine update={update} />
        {center.prompt !== null ? (
          <div className={`sve-center-prompt${center.yours ? " sve-your-move" : ""}`} data-testid={placing !== null ? "table-choose-slot" : undefined}>
            {center.prompt}
          </div>
        ) : null}
        {/* A decision answered on the table: what it is part of (the decision window shows it above its question). */}
        {update.decision && !center.dialog ? <ProcessingPrompt update={update} compact /> : null}
      </div>
      <div className="sve-center-actions">
        {center.buttons.map((b) => (
          <button key={b.key} type="button" className={b.primary ? "sve-primary" : undefined} disabled={b.disabled} onClick={b.onClick} data-testid={`table-${b.key}`}>
            {b.label}
          </button>
        ))}
      </div>
    </>
  );
}

/**
 * Online play with a turn time limit: whose time is running and how much of it is left, counted down here between the
 * worker's updates (each says the time left when it was made); null when no time runs.
 */
export function useTurnClock(update: GameUpdate): { player: 0 | 1; seconds: number } | null {
  const clock = update.online?.clock ?? null;
  const at = useMemo(() => Date.now(), [clock]);
  const [, setTick] = useState(0);
  useEffect(() => {
    if (clock?.running == null) return;
    const timer = window.setInterval(() => setTick((n) => n + 1), 250);
    return () => window.clearInterval(timer);
  }, [clock]);
  if (!clock || clock.running === null || update.result) return null;
  const player = clock.running;
  return { player, seconds: Math.ceil(Math.max(0, clock.left[player] - (Date.now() - at)) / 1000) };
}

/** A clock's time left as m:ss. */
export const clockTime = (seconds: number): string => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;

/** The turn clock as a line of the center's status. The last 30 seconds stand out. */
function TurnClockLine({ update }: { update: GameUpdate }) {
  const t = useT();
  const clock = useTurnClock(update);
  if (!clock) return null;
  return (
    <div className={`sve-center-clock${clock.seconds <= 30 ? " sve-center-clock-low" : ""}`} data-testid="center-clock" data-player={clock.player} data-seconds={clock.seconds}>
      {t("game.clock", { player: playerLabel(clock.player, update, t), time: clockTime(clock.seconds) })}
    </div>
  );
}
