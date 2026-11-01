// A phone held sideways (app/compact.ts): the table takes the whole screen, its two mats as tall as the screen, and a column
// on each side lies over it (styles/phone.css). On the left the card panel (the card last read, or the log) under a row of
// buttons; on the right the opponent's hand (the table's strip), the two players, the buttons that answer the decision and
// what the game waits for, and your hand folded in the bottom corner (a tap spreads it: hand.ts, board/Table.tsx).
import type { ReactNode } from "react";
import type { GameUpdate } from "../../engine/protocol";
import { useT } from "../../i18n";
import { useCenterState, usePlacingName } from "../board/center-state";
import { OnlineStatus } from "../OnlineStatus";
import { QuickChat } from "../QuickChat";
import { PhoneActions, PhoneCardPanel, PhonePlayer, PhonePrompt, type PhoneTab } from "./PhoneParts";

interface ToolsProps {
  update: GameUpdate;
  /** The seat of the person at this screen (null: watching), for the quick chat and conceding. */
  seat: 0 | 1 | null;
  logOpen: boolean;
  onMenu: () => void;
  onLog: () => void;
  onConcede: () => void;
  /** Online: the chat (from the unread messages' button), and connecting again. */
  onChat: () => void;
  onOnline: () => void;
  /** A spectator chooses which player is at the bottom. */
  onSwapSides: (() => void) | null;
}

/** The top left (menu, quick chat, log, a spectator's side) and the top right (the connection online, conceding). */
export function LandscapeTools({ update, seat, logOpen, onMenu, onLog, onConcede, onChat, onOnline, onSwapSides }: ToolsProps) {
  const t = useT();
  return (
    <>
      <div className="sve-phone-tools" data-testid="phone-tools">
        <button type="button" onClick={onMenu} data-testid="game-menu">
          {t("game.menu")}
        </button>
        {seat !== null ? <QuickChat update={update} /> : null}
        <button type="button" className={logOpen ? "sve-tab-active" : undefined} onClick={onLog} aria-pressed={logOpen} data-testid="phone-log">
          {t("tab.log")}
        </button>
        {onSwapSides ? (
          <button type="button" onClick={onSwapSides} data-testid="game-swap-sides">
            {t("game.swapSides")}
          </button>
        ) : null}
      </div>
      <div className="sve-phone-topright">
        {update.online ? <OnlineStatus update={update} chatOpen={false} onChat={onChat} onOnline={onOnline} /> : null}
        {seat !== null && !update.result ? (
          <button type="button" className="sve-concede" onClick={onConcede} data-testid="game-concede">
            {t("game.concede")}
          </button>
        ) : null}
      </div>
    </>
  );
}

/** The left column: the card panel, or the log in its place; `children` under it (a replay's playback bar). */
export function LandscapeLeft({
  update,
  logOpen,
  tabs,
  tab,
  onTab,
  onCloseLog,
  children,
}: {
  update: GameUpdate;
  logOpen: boolean;
  tabs: readonly PhoneTab[];
  tab: PhoneTab;
  onTab: (tab: PhoneTab) => void;
  onCloseLog: () => void;
  children?: ReactNode;
}) {
  return (
    <aside className="sve-phone-left" data-testid="game-left">
      <PhoneCardPanel update={update} log={logOpen} tabs={tabs} tab={tab} onTab={onTab} onCloseLog={onCloseLog} />
      {children}
    </aside>
  );
}

/**
 * The right column, under the opponent's hand: the opponent and you side by side, the buttons that answer the decision,
 * and what the game waits for. Your hand is the table's strip in its bottom corner.
 */
export function LandscapeRight({ update }: { update: GameUpdate }) {
  const placing = usePlacingName();
  const center = useCenterState(update, placing);
  const view = update.view;
  const me = update.perspective;
  return (
    <aside className="sve-phone-right" data-testid="phone-right">
      <div className="sve-phone-players">
        <PhonePlayer update={update} side={view.players[me === 0 ? 1 : 0]} />
        <PhonePlayer update={update} side={view.players[me]} />
      </div>
      <PhoneActions center={center} />
      <PhonePrompt update={update} center={center} placing={placing !== null} />
    </aside>
  );
}
