// Who goes first (CR 6.2.1.6), said once as a game begins, besides the log's line: "You go first" / "You go second" to the
// person playing, "Player N goes first" to whoever watches two bots or plays both seats at one screen. It shows for a few
// seconds over the top of the table and goes by itself (a click sends it away sooner), out of the way of the redraw window
// that follows (CR 6.2.1.8). Not in a replay, nor in a game found already going (a spectator coming in later, a game shown
// again).
import { useEffect, useState } from "react";
import type { GameUpdate } from "../../engine/protocol";
import { useT } from "../../i18n";
import { playerLabel } from "../labels";

const SHOWN_MS = 3200;

/** The game (its seed) the order was said for: once per game, even when the game screen is left and shown again. */
let saidFor: string | null = null;

export function TurnOrderNotice({ update }: { update: GameUpdate }) {
  const t = useT();
  const first = update.view.firstPlayer;
  const [notice, setNotice] = useState<{ main: string; sub: string } | null>(null);
  useEffect(() => {
    if (update.watch || first === null || saidFor === update.seed) return;
    saidFor = update.seed;
    // Known from the start (the order decided before the redraws, CR 6.2.1.6): a game already in its turns was begun elsewhere.
    if (update.view.turn > 1) return;
    const second = (1 - first) as 0 | 1;
    const humans = ([0, 1] as const).filter((p) => update.controllers[p] === "human");
    const you = humans.length === 1 ? humans[0]! : null;
    setNotice({
      main: you === null ? t("game.goesFirst", { player: playerLabel(first, update, t) }) : t(you === first ? "game.youFirst" : "game.youSecond"),
      sub: t("log.turnOrder", { first: playerLabel(first, update, t), second: playerLabel(second, update, t) }),
    });
  }, [update.seed, first, update.watch]);
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), SHOWN_MS);
    return () => window.clearTimeout(timer);
  }, [notice]);
  if (!notice) return null;
  return (
    <div className="sve-turn-order" role="status" onClick={() => setNotice(null)} data-testid="turn-order">
      <strong>{notice.main}</strong>
      <span>{notice.sub}</span>
    </div>
  );
}
