import { useEffect, useState } from "react";
import type { GameUpdate } from "../engine/protocol";
import { useT } from "../i18n";
import { useOnline } from "../net/state";

/**
 * Online: connected (and the round trip) or not (the game waits; the online screen connects again), and the other player's
 * messages not yet seen. A spectator: watching, or connecting again by itself.
 */
export function OnlineStatus({ update, chatOpen, onChat, onOnline }: { update: GameUpdate; chatOpen: boolean; onChat: () => void; onOnline: () => void }) {
  const t = useT();
  const { phase, chat } = useOnline();
  const spectating = update.online?.spectating === true;
  const [seen, setSeen] = useState(chat.length);
  useEffect(() => {
    if (chatOpen) setSeen(chat.length);
  }, [chatOpen, chat.length]);
  const unread = chat.slice(seen).filter((line) => line.from !== "me").length;
  const connected = phase.kind === "connected";
  const rtt = connected && phase.rtt !== null ? `${phase.rtt} ms` : "…";
  const status = spectating
    ? t(connected ? "game.online.watching" : "game.online.watchLost", { rtt })
    : connected
      ? t("game.online.connected", { rtt })
      : t("game.online.lost");
  return (
    <div className={`sve-game-online${connected ? "" : " sve-game-online-lost"}`} data-testid="game-online" data-connected={connected ? "yes" : "no"}>
      <span>{status}</span>
      {!connected && !update.result && !spectating ? (
        <button type="button" onClick={onOnline} data-testid="game-reconnect">
          {t("game.online.reconnect")}
        </button>
      ) : null}
      {unread > 0 ? (
        <button type="button" className="sve-primary" onClick={onChat} data-testid="game-unread">
          {t("game.online.unread", { n: unread })}
        </button>
      ) : null}
    </div>
  );
}
