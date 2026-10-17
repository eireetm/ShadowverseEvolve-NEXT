// Beside the line where the two mats meet: on the left the turn, the phase and what the game waits for; on the right the
// buttons that finish the pending decision (end the main phase, pass, confirm a selection, keep the hand ...). Everything
// else about a decision is on the table (lit cards and their menus) or in the decision window (DecisionDialog).
import type { Answer } from "@sve/core";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { GameUpdate } from "../../engine/protocol";
import { useT, type MessageKey } from "../../i18n";
import { isOnTable } from "../../engine/view-utils";
import { inDialog } from "../actions";
import { rangeLabel, SELECT_KEYS } from "../decisions/DecisionDialog";
import { ProcessingPrompt } from "../decisions/ProcessingPrompt";
import { sendAnswer, setRedrawing, useInteraction } from "../interaction";
import { playerLabel } from "../labels";

const PHASE_KEYS: Record<string, MessageKey> = {
  setup: "game.phase.setup",
  start: "game.phase.start",
  main: "game.phase.main",
  end: "game.phase.end",
  over: "game.phase.over",
};

/** `placing`: a card waiting for the person to pick its slot (choose card spots by hand), by name. */
export function CenterLine({ update, placing = null }: { update: GameUpdate; placing?: string | null }) {
  const t = useT();
  const view = update.view;
  const decision = update.decision?.decision;
  const sent = useInteraction((s) => s.sent);
  const chosen = useInteraction((s) => s.chosen);
  const answer = (a: Answer) => sendAnswer(update, a);
  const buttons: ReactNode[] = [];
  const button = (key: string, label: string, onClick: () => void, primary = false, disabled = false) =>
    buttons.push(
      <button key={key} type="button" className={primary ? "sve-primary" : undefined} disabled={sent || disabled} onClick={onClick} data-testid={`table-${key}`}>
        {label}
      </button>,
    );
  // Under the game's turn, the active player's own turn count (CR 3.3 turns passed: what super evolving waits for, 12.2.4).
  const activeTurn = () => {
    const player = playerLabel(view.activePlayer, update, t);
    const n = view.players[view.activePlayer].turnsPassed;
    return n > 0 ? t("game.activePlayerTurn", { player, n }) : t("game.activePlayer", { player });
  };
  let prompt: string | null = null;
  const dialog = decision !== undefined && inDialog(decision, (id) => isOnTable(view, id));
  if (decision && dialog) {
    prompt = t("table.answerInDialog");
  } else if (decision) {
    switch (decision.type) {
      case "mainPhase":
        prompt = t("table.mainPhase");
        button("end", t("decision.endMain"), () => answer({ type: "mainPhase", action: { type: "endMainPhase" } }), true);
        break;
      case "quick":
        prompt = t(decision.timing === "attack" ? "decision.quick.attack" : "decision.quick.endPhase");
        button("pass", t("decision.pass"), () => answer({ type: "quick", action: { type: "pass" } }), true);
        break;
      case "selectCards":
        prompt = `${t(SELECT_KEYS[decision.reason])} — ${t("decision.selectCards", { range: rangeLabel(decision.min, decision.max, t) })}`;
        if (decision.min !== 1 || decision.max !== 1) {
          if (decision.min === 0) button("none", t("decision.none"), () => answer({ type: "selectCards", cards: [] }));
          button("confirm", `${t("decision.confirm")} (${chosen.length})`, () => answer({ type: "selectCards", cards: chosen }), true, chosen.length < decision.min || chosen.length > decision.max);
        }
        break;
      case "mulligan":
        prompt = t("decision.mulligan");
        button("keep", t("decision.keep"), () => answer({ type: "mulligan", redraw: false }), true);
        // CR 6.2.1.8: the hand goes to the bottom of the deck in the order the person chooses (the decision window asks it).
        button("redraw", t("decision.redraw"), () => setRedrawing(true));
        break;
      case "chooseTurnOrder":
        prompt = t("decision.chooseTurnOrder");
        button("first", t("decision.goFirst"), () => answer({ type: "chooseTurnOrder", goFirst: true }), true);
        button("second", t("decision.goSecond"), () => answer({ type: "chooseTurnOrder", goFirst: false }));
        break;
      default:
        prompt = t("table.answerInDialog");
    }
  } else if (update.waitingFor !== null && !update.result) {
    prompt = update.thinking ? t("game.thinking", { player: playerLabel(update.waitingFor, update, t) }) : null;
    if (update.settings.paused && update.controllers[update.waitingFor] !== "human") prompt = t("game.paused");
    // Online: the other program's person answers (pausing the bots changes nothing there); a spectator waits for either.
    if (update.online && (update.online.spectating || update.online.remote === update.waitingFor)) {
      prompt = t("game.waitingForOpponent", { player: playerLabel(update.waitingFor, update, t) });
    }
  }
  return (
    <>
      {/* With a turn clock, a line more: on a small screen the prompt gets one less (the box keeps its height). */}
      <div className={`sve-center-status${update.online?.clock ? " sve-center-status-timed" : ""}`}>
        <div className="sve-center-turn">
          <strong>{t("game.turn", { n: view.turn })}</strong> · {t(PHASE_KEYS[view.phase] ?? "game.phase.main")}
        </div>
        {view.phase !== "over" ? <div data-testid="center-active-player">{activeTurn()}</div> : null}
        <TurnClockLine update={update} />
        {placing ? (
          <div className="sve-center-prompt sve-your-move" data-testid="table-choose-slot">
            {t("table.chooseSlot", { card: placing })}
          </div>
        ) : prompt ? (
          <div className={`sve-center-prompt${decision ? " sve-your-move" : ""}`}>{prompt}</div>
        ) : null}
        {/* A decision answered on the table: what it is part of (the decision window shows it above its question). */}
        {decision && !dialog ? <ProcessingPrompt update={update} compact /> : null}
      </div>
      <div className="sve-center-actions">{buttons}</div>
    </>
  );
}

/**
 * Online play with a turn time limit: whose time is running and how much of it is left, counting down here between the
 * worker's updates (each says the time left when it was made). The last 30 seconds stand out.
 */
function TurnClockLine({ update }: { update: GameUpdate }) {
  const t = useT();
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
  const seconds = Math.ceil(Math.max(0, clock.left[player] - (Date.now() - at)) / 1000);
  const time = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  return (
    <div className={`sve-center-clock${seconds <= 30 ? " sve-center-clock-low" : ""}`} data-testid="center-clock" data-player={player} data-seconds={seconds}>
      {t("game.clock", { player: playerLabel(player, update, t), time })}
    </div>
  );
}
