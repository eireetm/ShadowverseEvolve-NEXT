// A flash over the screen when someone else writes in the online chat — the other player or a spectator, not this program's
// person — for those who turned on "online chat notice" in the settings (off by default: nothing then). Like the "You go
// first" notice (game/board/TurnOrderNotice.tsx), but shorter, and it lets clicks through. On every screen (the room, the
// game, watching): the chat may be out of sight. A quick chat line (game/quick-chat.ts) flashes as itself, who said what,
// whoever said it and in a game against bots too: it is the quick chat's own showing (blocking the quick chat stops it).
import { useEffect, useRef, useState } from "react";
import { useSettings } from "../app/settings";
import { useApp } from "../app/store";
import { playerLabel } from "../game/labels";
import { useQuickChatSaid } from "../game/quick-chat";
import { useT } from "../i18n";
import { useOnline } from "../net/state";

const SHOWN_MS = 1600;

export function ChatNotice() {
  const { chatNotice } = useSettings();
  const { chat } = useOnline();
  const update = useApp((s) => s.update);
  const said = useQuickChatSaid();
  const t = useT();
  // What flashes, and a count: each flash starts again (its key).
  const [flash, setFlash] = useState<{ n: number; text: string } | null>(null);
  const show = (text: string) => setFlash((f) => ({ n: (f?.n ?? 0) + 1, text }));
  // A new line is a new last line (the chat keeps its latest 200); the lines there already when this began aren't new.
  const last = chat[chat.length - 1];
  const seen = useRef(last);
  useEffect(() => {
    if (last === seen.current) return;
    seen.current = last;
    // A quick chat line shows as itself (below).
    if (chatNotice && last !== undefined && last.from !== "me" && last.quick === undefined) show(t("online.chatNotice"));
  }, [last, chatNotice]);
  // A quick chat line said (here or by the other player): who said which.
  const heard = useRef(said?.seq ?? 0);
  useEffect(() => {
    if (!said || said.seq === heard.current) return;
    heard.current = said.seq;
    const name = update ? playerLabel(said.seat, update, t) : t("game.playerN", { n: said.seat + 1 });
    show(t("quickChat.said", { name, text: t(`quickChat.${said.quick}`) }));
  }, [said]);
  useEffect(() => {
    if (!flash) return;
    const timer = window.setTimeout(() => setFlash(null), SHOWN_MS);
    return () => window.clearTimeout(timer);
  }, [flash]);
  if (!flash) return null;
  return (
    <div key={flash.n} className="sve-chat-notice" role="status" data-testid="chat-notice">
      {flash.text}
    </div>
  );
}
