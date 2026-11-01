// What the table's center says and offers: the turn, the phase, whose turn it is, what the game waits for, and the buttons
// that finish the pending decision (end the main phase, pass, confirm a selection, keep the hand ...). The wide table shows
// it beside the mats (CenterLine.tsx); a phone shows it in its columns (game/phone/). Which buttons there are is the
// decision's (the engine's), not the screen's: every reader shows the same ones, with the same test ids.
import type { Answer } from "@sve/core";
import { useSyncExternalStore } from "react";
import { isOnTable } from "../../engine/view-utils";
import type { GameUpdate } from "../../engine/protocol";
import { useT, type MessageKey } from "../../i18n";
import { inDialog } from "../actions";
import { rangeLabel, SELECT_KEYS } from "../decisions/DecisionDialog";
import { sendAnswer, setRedrawing, useInteraction } from "../interaction";
import { playerLabel } from "../labels";

const PHASE_KEYS: Record<string, MessageKey> = {
  setup: "game.phase.setup",
  start: "game.phase.start",
  main: "game.phase.main",
  end: "game.phase.end",
  over: "game.phase.over",
};

/** A button that finishes the pending decision: it answers it, or opens the window that asks for more. */
export interface CenterButton {
  /** Its test id is `table-${key}`. */
  key: string;
  label: string;
  primary: boolean;
  disabled: boolean;
  onClick: () => void;
}

export interface CenterState {
  /** "Turn n · phase". */
  turn: number;
  phase: string;
  /** Whose turn it is, with their own turn count (null once the game is over). */
  activeLine: string | null;
  /** What the game waits for, or what the decision asks. */
  prompt: string | null;
  /** The prompt is this person's move (it stands out). */
  yours: boolean;
  /** The decision is answered in its window, not on the table. */
  dialog: boolean;
  buttons: CenterButton[];
}

// The card waiting for its slot (choose card spots by hand), by name: the table works it out (slots.ts) and tells it here,
// for a phone's columns, which show the prompt outside the table.
let placingName: string | null = null;
const placingListeners = new Set<() => void>();

export function setPlacingName(name: string | null): void {
  if (placingName === name) return;
  placingName = name;
  for (const listener of placingListeners) listener();
}

export function usePlacingName(): string | null {
  return useSyncExternalStore(
    (listener) => {
      placingListeners.add(listener);
      return () => placingListeners.delete(listener);
    },
    () => placingName,
  );
}

/** `placing`: a card waiting for the person to pick its slot (choose card spots by hand), by name; its prompt comes first. */
export function useCenterState(update: GameUpdate, placing: string | null = null): CenterState {
  const t = useT();
  const view = update.view;
  const decision = update.decision?.decision;
  const sent = useInteraction((s) => s.sent);
  const chosen = useInteraction((s) => s.chosen);
  const answer = (a: Answer) => sendAnswer(update, a);
  const buttons: CenterButton[] = [];
  const button = (key: string, label: string, onClick: () => void, primary = false, disabled = false) =>
    buttons.push({ key, label, primary, disabled: sent || disabled, onClick });
  // Under the game's turn, the active player's own turn count (CR 3.3 turns passed: what super evolving waits for, 12.2.4).
  const activeTurn = () => {
    const player = playerLabel(view.activePlayer, update, t);
    const n = view.players[view.activePlayer].turnsPassed;
    return n > 0 ? t("game.activePlayerTurn", { player, n }) : t("game.activePlayer", { player });
  };
  let prompt: string | null = null;
  let yours = false;
  const dialog = decision !== undefined && inDialog(decision, (id) => isOnTable(view, id));
  if (placing !== null) {
    prompt = t("table.chooseSlot", { card: placing });
    yours = true;
  } else if (decision && dialog) {
    prompt = t("table.answerInDialog");
    yours = true;
  } else if (decision) {
    yours = true;
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
  return {
    turn: view.turn,
    phase: t(PHASE_KEYS[view.phase] ?? "game.phase.main"),
    activeLine: view.phase !== "over" ? activeTurn() : null,
    prompt,
    yours,
    dialog,
    buttons,
  };
}
