// A phone held upright (app/compact.ts): from the top, a bar (the menu, a spectator's side; the connection online and
// conceding), the card panel (the card last read, or the log in its place), the two players with the turn and what the game
// waits for between them, the table (board/Table.tsx: the mats take the width, your hand is a row under them), and a bar
// of buttons (the quick chat, the log, the buttons that answer the decision) — or, watching a replay, its playback bar.
// The sizes are styles/phone.css's.
import { useLayoutEffect, useRef } from "react";
import type { GameUpdate } from "../../engine/protocol";
import { useT } from "../../i18n";
import { useCenterState, usePlacingName } from "../board/center-state";
import { OnlineStatus } from "../OnlineStatus";
import { QuickChat } from "../QuickChat";
import { WatchBar } from "../watch/WatchBar";
import { PhoneActions, PhoneCardPanel, PhonePlayer, PhonePrompt, type PhoneTab } from "./PhoneParts";

interface TopProps {
  update: GameUpdate;
  /** The seat of the person at this screen (null: watching), for conceding. */
  seat: 0 | 1 | null;
  logOpen: boolean;
  tabs: readonly PhoneTab[];
  tab: PhoneTab;
  onTab: (tab: PhoneTab) => void;
  onCloseLog: () => void;
  onMenu: () => void;
  onConcede: () => void;
  /** Online: the chat (from the unread messages' button), and connecting again. */
  onChat: () => void;
  onOnline: () => void;
  /** A spectator chooses which player is at the bottom. */
  onSwapSides: (() => void) | null;
}

/** Above the table: the top bar, the card panel and the players. */
export function PortraitTop({ update, seat, logOpen, tabs, tab, onTab, onCloseLog, onMenu, onConcede, onChat, onOnline, onSwapSides }: TopProps) {
  const t = useT();
  // The card's picture is as tall as the panel (which gives way on a short screen), and its text starts right after it.
  const panel = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = panel.current;
    if (!element) return;
    const update = () => element.style.setProperty("--sve-portrait-art-height", `${Math.max(40, Math.min(186, element.clientHeight - 8))}px`);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return (
    <>
      <div className="sve-portrait-bar" data-testid="phone-tools">
        <button type="button" onClick={onMenu} data-testid="game-menu">
          {t("game.menu")}
        </button>
        {onSwapSides ? (
          <button type="button" onClick={onSwapSides} data-testid="game-swap-sides">
            {t("game.swapSides")}
          </button>
        ) : null}
        <div className="sve-portrait-topright">
          {update.online ? <OnlineStatus update={update} chatOpen={false} onChat={onChat} onOnline={onOnline} /> : null}
          {seat !== null && !update.result ? (
            <button type="button" className="sve-concede" onClick={onConcede} data-testid="game-concede">
              {t("game.concede")}
            </button>
          ) : null}
        </div>
      </div>
      <div className="sve-portrait-panel" ref={panel} data-testid="game-left">
        <PhoneCardPanel update={update} log={logOpen} tabs={tabs} tab={tab} onTab={onTab} onCloseLog={onCloseLog} />
      </div>
      <PortraitPlayers update={update} />
    </>
  );
}

/** The opponent on the left, you on the right (as the mats are above and below), the turn and the prompt between. */
function PortraitPlayers({ update }: { update: GameUpdate }) {
  const placing = usePlacingName();
  const center = useCenterState(update, placing);
  const me = update.perspective;
  return (
    <div className="sve-portrait-players" data-testid="phone-right">
      <PhonePlayer update={update} side={update.view.players[me === 0 ? 1 : 0]} upright />
      <PhonePrompt update={update} center={center} placing={placing !== null} />
      <PhonePlayer update={update} side={update.view.players[me]} upright mirrored />
    </div>
  );
}

/**
 * Under the table: the quick chat (a player at the screen), the log (it takes the card panel's place), and the buttons that
 * answer the decision; watching a replay, its playback bar instead.
 */
export function PortraitBottom({
  update,
  seat,
  logOpen,
  onLog,
  onReplays,
}: {
  update: GameUpdate;
  seat: 0 | 1 | null;
  logOpen: boolean;
  onLog: () => void;
  onReplays: () => void;
}) {
  const t = useT();
  const placing = usePlacingName();
  const center = useCenterState(update, placing);
  if (update.watch) {
    return (
      <div className="sve-portrait-watch">
        <WatchBar update={update} onExit={onReplays} />
        <button type="button" className={logOpen ? "sve-tab-active" : undefined} onClick={onLog} aria-pressed={logOpen} data-testid="phone-log">
          {t("tab.log")}
        </button>
      </div>
    );
  }
  return (
    <div className="sve-portrait-bottom" data-testid="phone-bottom">
      {seat !== null ? <QuickChat update={update} /> : null}
      <button type="button" className={`sve-portrait-log${logOpen ? " sve-tab-active" : ""}`} onClick={onLog} aria-pressed={logOpen} data-testid="phone-log">
        {t("tab.log")}
      </button>
      <PhoneActions center={center} />
    </div>
  );
}
