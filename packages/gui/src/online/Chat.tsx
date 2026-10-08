// The chat with the other player, in the online screen and in a game's sidebar. Only the online state
// (net/state.ts): the game screen shows it without loading the connection code. A spectator reads both players' lines, and
// writes when the room's rules let it (the online server's rooms); spectators' lines say who wrote them.
import { useEffect, useRef, useState } from "react";
import { useT } from "../i18n";
import { CHAT_MAX } from "../net/messages";
import { canChat, sendChat, useOnline, type ChatLine } from "../net/state";

export function Chat() {
  const t = useT();
  const online = useOnline();
  const { chat, room } = online;
  // A spectator only reads, unless the host lets its spectators write.
  const readOnly = room?.role === "spectator" && !canChat(online);
  const who = (c: ChatLine): string =>
    c.from === "me"
      ? t("online.me")
      : c.from === "peer"
        ? t("online.them")
        : c.from === "watcher"
          ? c.name
            ? t("online.watcherSaid", { name: c.name })
            : t("online.watcherSaidAnon")
          : t("online.playerSaid", { n: c.from + 1 });
  const [line, setLine] = useState("");
  const lines = useRef<HTMLDivElement>(null);
  // The newest line in view.
  useEffect(() => {
    const box = lines.current;
    if (box) box.scrollTop = box.scrollHeight;
  }, [chat.length]);
  return (
    <div className="sve-online-chat-box">
      <div className="sve-online-chat" ref={lines} data-testid="online-chat">
        {chat.length === 0 && !readOnly ? <p className="sve-hint">{t("online.chatEmpty")}</p> : null}
        {chat.map((c, i) => (
          <p key={i} className={c.from === "me" ? "sve-online-mine" : c.from === "watcher" ? "sve-online-theirs sve-online-watcher" : "sve-online-theirs"}>
            <strong>{who(c)}</strong> {c.text}
          </p>
        ))}
      </div>
      {readOnly ? (
        <p className="sve-hint" data-testid="online-chat-readonly">
          {t("online.watchChat")}
        </p>
      ) : (
        <form
          className="sve-online-join"
          onSubmit={(e) => {
            e.preventDefault();
            sendChat(line);
            setLine("");
          }}
        >
          <input value={line} onChange={(e) => setLine(e.target.value)} maxLength={CHAT_MAX} placeholder={t("online.chatPlaceholder")} data-testid="online-chat-input" />
          <button type="submit" disabled={line.trim() === "" || !canChat(online)} data-testid="online-send">
            {t("online.send")}
          </button>
        </form>
      )}
    </div>
  );
}
