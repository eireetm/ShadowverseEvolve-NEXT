// A flash over the screen when someone else writes in the online chat — the other player or a spectator, not this program's
// person — for those who turned on "online chat notice" in the settings (off by default: nothing then). Like the "You go
// first" notice (game/board/TurnOrderNotice.tsx), but shorter, and it lets clicks through. On every screen (the room, the
// game, watching): the chat may be out of sight.
import { useEffect, useRef, useState } from "react";
import { useSettings } from "../app/settings";
import { useT } from "../i18n";
import { useOnline } from "../net/state";

const SHOWN_MS = 1600;

export function ChatNotice() {
  const { chatNotice } = useSettings();
  const { chat } = useOnline();
  const t = useT();
  // A new line is a new last line (the chat keeps its latest 200); the lines there already when this began aren't new.
  const last = chat[chat.length - 1];
  const seen = useRef(last);
  // Each line from someone else starts the flash again (its key).
  const [flash, setFlash] = useState(0);
  useEffect(() => {
    if (last === seen.current) return;
    seen.current = last;
    if (chatNotice && last !== undefined && last.from !== "me") setFlash((n) => n + 1);
  }, [last, chatNotice]);
  useEffect(() => {
    if (flash === 0) return;
    const timer = window.setTimeout(() => setFlash(0), SHOWN_MS);
    return () => window.clearTimeout(timer);
  }, [flash]);
  if (flash === 0) return null;
  return (
    <div key={flash} className="sve-chat-notice" role="status" data-testid="chat-notice">
      {t("online.chatNotice")}
    </div>
  );
}
