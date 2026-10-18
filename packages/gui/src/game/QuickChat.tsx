// The quick chat's button, left of the sidebar's (or of the sidebar when it is shown): its menu says one of seven lines
// (game/quick-chat.ts). For a player at the screen, online or against bots; off while it is blocked (here or, online, by
// the other player) and while an online game's connection is lost.
import { useEffect, useRef, useState } from "react";
import { useBack } from "../app/back";
import { useSettings } from "../app/settings";
import type { GameUpdate } from "../engine/protocol";
import { useT } from "../i18n";
import { QUICK_CHATS } from "../net/messages";
import { canChat, useOnline } from "../net/state";
import { quickChatBlocked, sayQuickChat } from "./quick-chat";

export function QuickChat({ update }: { update: GameUpdate }) {
  const t = useT();
  const { blockQuickChat } = useSettings();
  const online = useOnline();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const game = update.online ? online : null;
  const blocked = quickChatBlocked(blockQuickChat, game);
  const off = blocked || (game !== null && !canChat(game));
  useBack(open, () => setOpen(false));
  // The menu closes on a click or a tap elsewhere, Escape, or the quick chat going off.
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    // Escape closes the menu only: not a window under it too (the Quick announcement, cards looked at) — heard first.
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopImmediatePropagation();
      setOpen(false);
    };
    document.addEventListener("pointerdown", away, true);
    window.addEventListener("keydown", key, true);
    return () => {
      document.removeEventListener("pointerdown", away, true);
      window.removeEventListener("keydown", key, true);
    };
  }, [open]);
  useEffect(() => {
    if (off) setOpen(false);
  }, [off]);
  return (
    <div className="sve-quick-chat" ref={box}>
      <button
        type="button"
        className="sve-quick-chat-button"
        onClick={() => setOpen(!open)}
        disabled={off}
        title={blocked ? t("game.quickChatBlocked") : undefined}
        aria-haspopup="menu"
        aria-expanded={open}
        data-testid="quick-chat"
      >
        {t("game.quickChat")}
      </button>
      {open ? (
        <div className="sve-quick-chat-menu" role="menu" data-testid="quick-chat-menu">
          {QUICK_CHATS.map((quick) => (
            <button
              key={quick}
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                sayQuickChat(update, quick, t(`quickChat.${quick}`), game);
              }}
              data-testid={`quick-chat-${quick}`}
            >
              {t(`quickChat.${quick}`)}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
