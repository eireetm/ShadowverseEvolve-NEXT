import type { PlayerId } from "@sve/core";
import type { GameUpdate } from "../engine/protocol";
import { useT } from "../i18n";
import { arrangeHand } from "./hand-order";

/**
 * The person's button: their hand by cost, then shuffled (hand-order.ts). Until the game is over; off with less than two
 * cards. `short`: its one word, for a narrow row.
 */
export function HandOrderButton({ update, seat, short = false }: { update: GameUpdate; seat: PlayerId; short?: boolean }) {
  const t = useT();
  if (update.result) return null;
  return (
    <button
      type="button"
      className="sve-hand-order"
      disabled={update.view.players[seat].hand.length < 2}
      onClick={() => arrangeHand(update, seat)}
      title={t("game.handOrderHelp")}
      aria-label={t("game.handOrder")}
      data-testid="hand-order"
    >
      {t(short ? "game.handOrderShort" : "game.handOrder")}
    </button>
  );
}
