// Online play. Make a room (a code to pass to the other player) or join one — on the online server ("使用服务器", when one
// is configured: the rules are chosen before the room is made) or on the public networks; or pass connection codes by hand
// when the public networks can't be reached. Connected, it shows how (which network, direct or through a relay or the
// server), the round trip, whether both programs are the same, a chat, and the next game's preparation: the host's rules,
// each player's deck, ready. Both ready, the game starts (on the game screen); after it, the next one is prepared here. A
// lost connection can be made again, and the game goes on where it was. A room's games can also be watched (a spectator's
// seat, "观战"): the spectator sees them, and the chat, and does nothing else. The person's name goes with the connection;
// on the server, its lobby lists the public rooms ("xxx 的房间") to join or watch with a click.
import { useEffect, useState } from "react";
import { errorText } from "../app/errors";
import { updateSettings, useSettings } from "../app/settings";
import { reportError, useApp } from "../app/store";
import { cardCount, type DeckFile } from "../decks/format";
import type { TurnOrder } from "../engine/protocol";
import { formatProblemText, type FormatProblem } from "../formats/formats";
import { FormatPicker } from "../formats/FormatPicker";
import { hostApi, type DeckFileEntry } from "../host/api";
import { useT, type MessageKey, type Translate } from "../i18n";
import { APP_VERSION, PLATFORM } from "../app/version";
import { checkNetwork, type NetworkCheck } from "../net/check";
import { normalizeRoomCode } from "../net/codes";
import { cleanName, NAME_MAX, SPECTATOR_SEATS, type Rules } from "../net/messages";
import { watchLobby, type LobbyRoom, type ServerProblem } from "../net/server";
import type { ServerSettings } from "../net/server-config";
import {
  acceptReply,
  cancel,
  gameKept,
  getOnline,
  hostManually,
  hostRoom,
  identify,
  joinManually,
  joinRoom,
  leave,
  leavingConcedes,
  problemsUnder,
  ready,
  readyDeckOf,
  reconnect,
  samePrograms,
  updateRules,
  useOnline,
  watchRoom,
  type OnlinePhase,
} from "../net/online";
import type { OnlineState } from "../net/state";
import { Chat } from "./Chat";
import { useBack } from "../app/back";
import { ServerConfigWindow } from "../app/ServerConfigWindow";
import { loadServerConfig, useServerConfig } from "../net/server-config";

/** Who goes first, as the game setup offers it (the rules' way first). */
const TURN_ORDERS: readonly TurnOrder[] = ["choose", "random", "player1", "player2"];

/** Seconds since `since`, updated every second (for "still looking" hints). */
function useSeconds(since: number): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  return Math.max(0, Math.floor((now - since) / 1000));
}

/** Whether a game over the connection is in progress (it goes on after a lost connection). */
function useGameGoing(): boolean {
  const game = useOnline().game;
  const going = useApp((s) => s.update?.online != null && !s.update.result);
  return game !== null && going;
}

/** Leave the connection; a game in progress is conceded, once the person says so. */
function leaveAsking(t: ReturnType<typeof useT>): void {
  if (!leavingConcedes() || window.confirm(t("online.leaveConfirm"))) leave();
}

/** A code to pass on, with a button that copies it. */
function CodeBox({ code, large = false, testId }: { code: string; large?: boolean; testId: string }) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  const copy = () =>
    void hostApi.copyText(code).then(
      () => setCopied(true),
      () => setCopied(false),
    );
  return (
    <div className={`sve-online-code${large ? " sve-online-room-code" : ""}`}>
      {large ? (
        <strong data-testid={testId}>{code}</strong>
      ) : (
        <textarea readOnly value={code} rows={4} onFocus={(e) => e.target.select()} data-testid={testId} />
      )}
      <button type="button" onClick={copy}>
        {t(copied ? "online.copied" : "online.copy")}
      </button>
    </div>
  );
}

interface Props {
  onBack: () => void;
  /** To the game in progress (a game that starts shows by itself: App). */
  onGame: () => void;
  onEditDecks: () => void;
}

export function OnlineScreen({ onBack, onGame, onEditDecks }: Props) {
  const t = useT();
  const online = useOnline();
  const catalog = useApp((s) => s.catalog);
  const going = useGameGoing();
  // This program's fingerprint (the other program is compared with it).
  const [identified, setIdentified] = useState(false);
  useEffect(() => {
    if (catalog) void identify(catalog).then(() => setIdentified(true));
  }, [catalog]);
  useEffect(() => {
    void loadServerConfig();
  }, []);
  // Back to the menu: looking stops; a connection stays (the menu says so), and so does a game waiting for its connection.
  const back = () => {
    const kind = getOnline().phase.kind;
    if (kind === "hosting" || kind === "joining" || kind === "manualHost" || kind === "manualGuest") cancel();
    else if (kind === "closed" && !going) leave();
    onBack();
  };
  useBack(true, back);
  return (
    <div className="sve-menu">
      <div className="sve-menu-panel sve-online" data-testid="online" data-phase={online.phase.kind}>
        <h2>{t("online.title")}</h2>
        <Phase phase={online.phase} since={online.since} identified={identified} going={going} onGame={onGame} onEditDecks={onEditDecks} />
        {online.error ? (
          <p className="sve-problem" data-testid="online-error">
            {t(online.error)}
          </p>
        ) : null}
        <button type="button" onClick={back} data-testid="online-back">
          {t("common.back")}
        </button>
      </div>
    </div>
  );
}

interface PhaseProps {
  phase: OnlinePhase;
  since: number;
  identified: boolean;
  going: boolean;
  onGame: () => void;
  onEditDecks: () => void;
}

function Phase({ phase, since, identified, going, onGame, onEditDecks }: PhaseProps) {
  const t = useT();
  const seconds = useSeconds(since);
  const slow = seconds >= 20;
  switch (phase.kind) {
    case "idle":
      return <Start />;
    case "hosting":
      return (
        <div className="sve-online-step">
          <p>{t("online.roomCode")}</p>
          <CodeBox code={phase.code} large testId="online-room-code" />
          <p className="sve-hint">{t("online.hostWaiting", { s: seconds })}</p>
          {slow ? <p className="sve-hint">{t("online.slowHint", { version: APP_VERSION })}</p> : null}
          <WatchersFact />
          {going ? (
            // The other player comes back to this room: the game waits meanwhile.
            <>
              <button type="button" onClick={onGame} data-testid="online-to-game">
                {t("online.toGame")}
              </button>
              <button type="button" className="sve-concede" onClick={() => leaveAsking(t)} data-testid="online-leave">
                {t("online.leaveGame")}
              </button>
            </>
          ) : (
            <button type="button" onClick={cancel}>
              {t("online.cancel")}
            </button>
          )}
        </div>
      );
    case "joining":
      return (
        <div className="sve-online-step">
          <p data-testid="online-searching">
            {phase.as === "watch" ? t("online.searchingWatch", { code: phase.code, s: seconds }) : t("online.searching", { code: phase.code, s: seconds })}
          </p>
          {slow ? <p className="sve-hint">{t("online.slowHint", { version: APP_VERSION })}</p> : null}
          {going && phase.as === "watch" ? (
            <button type="button" onClick={onGame} data-testid="online-to-game">
              {t("online.toWatch")}
            </button>
          ) : null}
          <button type="button" onClick={cancel}>
            {t(phase.as === "watch" ? "online.leaveWatch" : "online.cancel")}
          </button>
        </div>
      );
    case "manualHost":
      return <ManualHost offer={phase.offer} accepted={phase.accepted} />;
    case "manualGuest":
      return (
        <div className="sve-online-step">
          {phase.reply === null ? (
            <p className="sve-hint">{t("online.making")}</p>
          ) : (
            <>
              <p>{t("online.replyHelp")}</p>
              <CodeBox code={phase.reply} testId="online-reply-code" />
              <p className="sve-hint">{t("online.waitingForHost", { s: seconds })}</p>
            </>
          )}
          <button type="button" onClick={cancel}>
            {t("online.cancel")}
          </button>
        </div>
      );
    case "connected":
      return phase.role === "spectator" ? (
        <Watching phase={phase} identified={identified} going={going} onGame={onGame} />
      ) : (
        <Connected phase={phase} identified={identified} going={going} onGame={onGame} onEditDecks={onEditDecks} />
      );
    case "closed":
      return <Closed reason={phase.reason} going={going} onGame={onGame} />;
  }
}

/**
 * Make a room, join one, or pass codes by hand: on the online server when one is configured (its part first then), and on
 * the public networks.
 */
function Start() {
  const server = useServerConfig().server;
  // Keyed: a server saved in the window moves its part up without making it again (the window stays open).
  const parts = [<ServerStart key="server" />, <PublicStart key="public" titled={server !== null} />];
  return (
    <div className="sve-online-step">
      <NameField />
      {server ? parts : parts.reverse()}
    </div>
  );
}

/** The person's name, which goes with every connection (the other player's screen, the spectators', the lobby). */
function NameField() {
  const t = useT();
  const { playerName } = useSettings();
  return (
    <label className="sve-field sve-online-name">
      <span>{t("online.nameLabel")}</span>
      <input
        value={playerName}
        maxLength={NAME_MAX + 8}
        placeholder={t("online.namePlaceholder")}
        onChange={(e) => updateSettings({ playerName: e.target.value })}
        onBlur={(e) => updateSettings({ playerName: cleanName(e.target.value) })}
        data-testid="online-name"
      />
    </label>
  );
}

/** A name as shown, or "someone" when none was given. */
const nameOr = (name: string | undefined, t: Translate): string => (name ? name : t("online.anonymous"));

/**
 * The server's lobby: the rooms their hosts made public — whose, the rules, waiting or playing, the spectators — to join
 * or watch with a click. Followed while this part is shown (the server says each change).
 */
function Lobby({ server }: { server: ServerSettings }) {
  const t = useT();
  const [rooms, setRooms] = useState<LobbyRoom[] | null>(null);
  const [problem, setProblem] = useState<ServerProblem | null>(null);
  useEffect(() => {
    const lobby = watchLobby(server, setRooms, setProblem);
    return () => lobby.close();
  }, [server.address, server.key]);
  return (
    <div className="sve-online-lobby" data-testid="online-lobby" data-rooms={rooms?.length ?? -1}>
      <h4>{t("online.lobby")}</h4>
      {problem ? (
        <p className="sve-problem">{t("online.lobbyProblem", { why: t(`online.server.${problem}`) })}</p>
      ) : rooms === null ? (
        <p className="sve-hint">…</p>
      ) : rooms.length === 0 ? (
        <p className="sve-hint">{t("online.lobbyEmpty")}</p>
      ) : (
        <ul>
          {rooms.map((room) => (
            <li key={room.code} data-code={room.code} data-testid="online-lobby-room">
              <span className="sve-online-lobby-what">
                <strong>{t("online.lobbyRoom", { name: nameOr(room.name, t) })}</strong>
                <span className="sve-hint">
                  {[
                    t(`format.${room.format}` as MessageKey),
                    room.list ?? t("format.noList"),
                    t(room.playing ? "online.lobbyPlaying" : room.players < 2 ? "online.lobbyWaiting" : "online.lobbyPlaying"),
                    t("online.lobbySpectators", { n: room.watchers, max: room.seats }),
                  ].join(" · ")}
                </span>
              </span>
              <button type="button" disabled={room.players >= 2 || room.playing} onClick={() => joinRoom(room.code, true)} data-testid="online-lobby-join">
                {t("online.join")}
              </button>
              <button type="button" disabled={room.watchers >= room.seats} onClick={() => watchRoom(room.code, false, true)} data-testid="online-lobby-watch">
                {t("online.watch")}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Who goes first, as a select (the online screen's rules: here before a room is made, and in the room for its host). */
function TurnOrderField({ testId }: { testId: string }) {
  const t = useT();
  const settings = useSettings();
  return (
    <label className="sve-field">
      <span>{t("setup.turnOrder")}</span>
      <select value={settings.setupTurnOrder} onChange={(e) => updateSettings({ setupTurnOrder: e.target.value as TurnOrder })} data-testid={testId}>
        {TURN_ORDERS.map((order) => (
          <option key={order} value={order}>
            {t(`turnOrder.${order}`)}
          </option>
        ))}
      </select>
    </label>
  );
}

/** Whether the players may take back their last answer while the other hasn't answered since (the host's rule). */
function UndoField({ testId }: { testId: string }) {
  const t = useT();
  const { allowUndo } = useSettings();
  return (
    <label className="sve-online-check-label">
      <input type="checkbox" checked={allowUndo} onChange={(e) => updateSettings({ allowUndo: e.target.checked })} data-testid={testId} />
      {t("online.allowUndo")}
    </label>
  );
}

/**
 * The online server: the rules of the room to make (the host's settings, as in the room), make it, or join one by its code,
 * to play or to watch. Without a server configured: what it is, and the configuration's window.
 */
function ServerStart() {
  const t = useT();
  const settings = useSettings();
  const server = useServerConfig().server;
  const [code, setCode] = useState("");
  const [editing, setEditing] = useState(false);
  const room = normalizeRoomCode(code);
  return (
    <section className="sve-online-section sve-online-server" data-testid="online-server">
      <h3>{server ? t("online.server.title", { name: server.name }) : t("online.server.titleNone")}</h3>
      {server ? (
        <>
          <p className="sve-hint">{t("online.server.rules")}</p>
          <fieldset className="sve-online-rules">
            <FormatPicker />
            <TurnOrderField testId="online-server-turn-order" />
            <UndoField testId="online-server-undo" />
          </fieldset>
          <label className="sve-online-check-label">
            <input type="checkbox" checked={settings.publicRooms} onChange={(e) => updateSettings({ publicRooms: e.target.checked })} data-testid="online-server-public" />
            {t("online.publicRoom")}
          </label>
          <button type="button" className="sve-primary sve-menu-button" onClick={() => hostRoom(undefined, false, true)} data-testid="online-server-host">
            {t("online.host")}
          </button>
          <form
            className="sve-online-join"
            onSubmit={(e) => {
              e.preventDefault();
              if (room) joinRoom(room, true);
            }}
          >
            <input value={code} onChange={(e) => setCode(e.target.value)} placeholder={t("online.codePlaceholder")} maxLength={12} data-testid="online-server-code" />
            <button type="submit" disabled={!room} data-testid="online-server-join">
              {t("online.join")}
            </button>
            <button type="button" disabled={!room} onClick={() => room && watchRoom(room, false, true)} data-testid="online-server-watch">
              {t("online.watch")}
            </button>
          </form>
          <p className="sve-hint">{t("online.server.watchHint")}</p>
          <Lobby server={server} />
        </>
      ) : (
        <p className="sve-hint">{t("online.server.noneHelp")}</p>
      )}
      <button type="button" className="sve-link-button" onClick={() => setEditing(true)} data-testid="online-server-configure">
        {t("settings.serverEdit")}
      </button>
      {editing ? <ServerConfigWindow onClose={() => setEditing(false)} /> : null}
    </section>
  );
}

/** The public networks: make a room, join one, or pass codes by hand; and the network check. */
function PublicStart({ titled }: { titled: boolean }) {
  const t = useT();
  const [code, setCode] = useState("");
  const [offer, setOffer] = useState("");
  const room = normalizeRoomCode(code);
  return (
    <section className="sve-online-section" data-testid="online-p2p">
      {titled ? <h3>{t("online.p2p.title")}</h3> : null}
      <button type="button" className="sve-primary sve-menu-button" onClick={() => hostRoom()} data-testid="online-host">
        {t("online.host")}
      </button>
      <form
        className="sve-online-join"
        onSubmit={(e) => {
          e.preventDefault();
          if (room) joinRoom(room);
        }}
      >
        <input value={code} onChange={(e) => setCode(e.target.value)} placeholder={t("online.codePlaceholder")} maxLength={12} data-testid="online-code" />
        <button type="submit" disabled={!room} data-testid="online-join">
          {t("online.join")}
        </button>
        <button type="button" disabled={!room} onClick={() => room && watchRoom(room)} data-testid="online-watch">
          {t("online.watch")}
        </button>
      </form>
      <p className="sve-hint">{t("online.watchHint")}</p>
      <details className="sve-online-manual">
        <summary>{t("online.manual")}</summary>
        <p className="sve-hint">{t("online.manualHelp")}</p>
        <button type="button" onClick={() => void hostManually()} data-testid="online-manual-host">
          {t("online.manualHost")}
        </button>
        <p>{t("online.pasteOffer")}</p>
        <textarea value={offer} onChange={(e) => setOffer(e.target.value)} rows={3} data-testid="online-offer-input" />
        <button type="button" disabled={offer.trim() === ""} onClick={() => void joinManually(offer)} data-testid="online-manual-join">
          {t("online.makeReply")}
        </button>
      </details>
      <NetworkCheckPanel />
    </section>
  );
}

/**
 * The connection ended. A game in progress waits: connect again (the same room, or any other way) and it goes on. A
 * spectator connects again by itself.
 */
function Closed({ reason, going, onGame }: { reason: Extract<OnlinePhase, { kind: "closed" }>["reason"]; going: boolean; onGame: () => void }) {
  const t = useT();
  const online = useOnline();
  const room = online.room;
  if (room?.role === "spectator" && reason === "lost") {
    return (
      <div className="sve-online-step">
        <p className="sve-problem" data-testid="online-closed">
          {t("online.watchLost")}
        </p>
        {going ? (
          <button type="button" onClick={onGame} data-testid="online-to-game">
            {t("online.toWatch")}
          </button>
        ) : null}
        <button type="button" onClick={leave} data-testid="online-leave">
          {t("online.leaveWatch")}
        </button>
      </div>
    );
  }
  return (
    <div className="sve-online-step">
      <p className="sve-problem" data-testid="online-closed">
        {t(`online.closed.${reason}` as const, { max: roomSeats(online) })}
      </p>
      {going ? (
        <>
          <p className="sve-hint">{t("online.reconnectHelp")}</p>
          {room ? (
            <button type="button" className="sve-primary" onClick={reconnect} data-testid="online-reconnect">
              {t("online.reconnect", { code: room.code })}
            </button>
          ) : null}
          <button type="button" onClick={onGame} data-testid="online-to-game">
            {t("online.toGame")}
          </button>
          <Start />
          <button type="button" className="sve-concede" onClick={() => leaveAsking(t)} data-testid="online-leave">
            {t("online.leaveGame")}
          </button>
        </>
      ) : (
        <button type="button" onClick={leave} data-testid="online-again">
          {t("online.again")}
        </button>
      )}
    </div>
  );
}

/** The room's spectator seats: as many as the online server says, or the public networks' two. */
function roomSeats(online: OnlineState): number {
  return online.room?.server ? online.seats : SPECTATOR_SEATS;
}

/** How many spectators the room has (the host counts them). */
function WatchersFact() {
  const t = useT();
  const online = useOnline();
  const { watchers, room } = online;
  if (!room) return null;
  return (
    <p className="sve-hint" data-testid="online-watchers" data-n={watchers}>
      {t("online.watchersLabel")}
      {t("online.watchersCount", { n: watchers, max: roomSeats(online) })}
    </p>
  );
}

interface WatchingProps {
  phase: Extract<OnlinePhase, { kind: "connected" }>;
  identified: boolean;
  going: boolean;
  onGame: () => void;
}

/**
 * A spectator, connected to the host: how, how fast, whether the programs are the same (another version's games can't be
 * followed); the game being played (to watch it) or the next one awaited; the chat, read only.
 */
function Watching({ phase, identified, going, onGame }: WatchingProps) {
  const t = useT();
  const { names } = useOnline();
  const same = identified ? samePrograms(phase.peer) : null;
  return (
    <div className="sve-online-step" data-testid="online-watching">
      <p className="sve-online-ok" data-testid="online-connected">
        {t("online.spectating")}
      </p>
      <ul className="sve-online-facts">
        <li>
          {t("online.viaLabel")}
          <span data-testid="online-via">{t(`online.via.${phase.via}` as const)}</span>
        </li>
        <li>
          {t("online.routeLabel")}
          {t(`online.route.${phase.route}` as const)}
        </li>
        <li>
          {t("online.rttLabel")}
          <span data-testid="online-rtt">{phase.rtt === null ? "…" : `${phase.rtt} ms`}</span>
        </li>
        <li className={same === false ? "sve-problem" : undefined} data-testid="online-same">
          {same === null ? t("online.peerUnknown") : same ? t("online.peerSame") : t("online.watchDifferent")}
        </li>
        <Versions peer={phase.peer} />
        {names ? (
          <li data-testid="online-players">
            {t("online.playersLabel")}
            {t("online.playersVs", { a: nameOr(names[0], t), b: nameOr(names[1], t) })}
          </li>
        ) : null}
      </ul>
      <WatchersFact />
      {going ? (
        <div className="sve-online-game" data-testid="online-game">
          <p>{t("online.watchGoing")}</p>
          <button type="button" className="sve-primary" onClick={onGame} data-testid="online-to-game">
            {t("online.toWatch")}
          </button>
        </div>
      ) : (
        <p className="sve-hint" data-testid="online-watch-waiting">
          {t("online.watchWaiting")}
        </p>
      )}
      <Chat />
      <button type="button" onClick={leave} data-testid="online-leave">
        {t("online.leaveWatch")}
      </button>
    </div>
  );
}

/** What this computer can reach of what online play needs (net/check.ts), to compare when two players can't connect. */
function NetworkCheckPanel() {
  const t = useT();
  const [result, setResult] = useState<NetworkCheck | "checking" | null>(null);
  const [copied, setCopied] = useState(false);
  const run = () => {
    setResult("checking");
    setCopied(false);
    void checkNetwork().then(setResult);
  };
  if (result === null || result === "checking") {
    return (
      <button type="button" className="sve-online-check-button" disabled={result === "checking"} onClick={run} data-testid="online-check">
        {t(result === "checking" ? "online.checking" : "online.check")}
      </button>
    );
  }
  const lines = [
    ...result.relays.map((r) => t("online.checkRelays", { name: t(`online.via.${r.via}` as const), reached: r.reached, total: r.total })),
    `${t("online.checkStun")}${result.stun.map((s) => `${s.url.replace(/^stun:/, "")} ${s.ok ? "✓" : "✗"}`).join(" · ")}`,
  ];
  const noRelay = result.relays.every((r) => r.reached === 0);
  const noStun = result.stun.every((s) => !s.ok);
  const verdict = noRelay ? t("online.checkNoRelays") : noStun ? t("online.checkNoStun") : t("online.checkOk");
  const copy = () =>
    void hostApi.copyText([...lines, verdict].join("\n")).then(
      () => setCopied(true),
      () => setCopied(false),
    );
  return (
    <div className="sve-online-check" data-testid="online-check-result">
      <ul>
        {lines.map((line, i) => (
          <li key={i}>{line}</li>
        ))}
      </ul>
      <p className={noRelay || noStun ? "sve-problem" : "sve-online-ok-text"}>{verdict}</p>
      <div className="sve-online-join">
        <button type="button" onClick={copy}>
          {t(copied ? "online.copied" : "online.copyResult")}
        </button>
        <button type="button" onClick={run}>
          {t("online.checkAgain")}
        </button>
      </div>
    </div>
  );
}

/** Codes by hand, the host: its connection code, then the guest's reply code. */
function ManualHost({ offer, accepted }: { offer: string | null; accepted: boolean }) {
  const t = useT();
  const [reply, setReply] = useState("");
  if (offer === null) return <p className="sve-hint">{t("online.making")}</p>;
  return (
    <div className="sve-online-step">
      <p>{t("online.offerHelp")}</p>
      <CodeBox code={offer} testId="online-offer-code" />
      <p>{t("online.pasteReply")}</p>
      <textarea value={reply} onChange={(e) => setReply(e.target.value)} rows={3} data-testid="online-reply-input" />
      <button type="button" className="sve-primary" disabled={reply.trim() === "" || accepted} onClick={() => void acceptReply(reply)} data-testid="online-connect">
        {t(accepted ? "online.connecting" : "online.connect")}
      </button>
      <button type="button" onClick={cancel}>
        {t("online.cancel")}
      </button>
    </div>
  );
}

interface ConnectedProps {
  phase: Extract<OnlinePhase, { kind: "connected" }>;
  identified: boolean;
  going: boolean;
  onGame: () => void;
  onEditDecks: () => void;
}

/** A program's version and platform as a person reads them ("0.2.1 · Android"); programs before 0.2.1 don't say. */
function programLabel(app: string | undefined, platform: string | undefined, t: Translate): string {
  if (!app) return t("online.versionOld");
  const where =
    platform === "android" ? t("online.platform.android") : platform === "ios" ? t("online.platform.ios") : platform === "pc" ? t("online.platform.pc") : null;
  return where ? `${app} · ${where}` : app;
}

/** Both programs' versions: the same version plays together, on a computer or on a phone. */
function Versions({ peer }: { peer: { app?: string; platform?: string } | null }) {
  const t = useT();
  return (
    <li data-testid="online-versions">
      {t("online.versionsLabel")}
      {t("online.versions", { mine: programLabel(APP_VERSION, PLATFORM, t), theirs: peer ? programLabel(peer.app, peer.platform, t) : "…" })}
    </li>
  );
}

/** Connected: how, how fast, the same programs or not; the game in progress, or the next one's preparation; the chat. */
function Connected({ phase, identified, going, onGame, onEditDecks }: ConnectedProps) {
  const t = useT();
  const online = useOnline();
  const same = identified ? samePrograms(phase.peer) : null;
  return (
    <div className="sve-online-step">
      <p className="sve-online-ok" data-testid="online-connected">
        {t("online.connected")}
      </p>
      <ul className="sve-online-facts">
        <li>
          {t("online.viaLabel")}
          <span data-testid="online-via">{t(`online.via.${phase.via}` as const)}</span>
        </li>
        <li>
          {t("online.routeLabel")}
          {t(`online.route.${phase.route}` as const)}
        </li>
        <li>
          {t("online.rttLabel")}
          <span data-testid="online-rtt">{phase.rtt === null ? "…" : `${phase.rtt} ms`}</span>
        </li>
        <li className={same === false ? "sve-problem" : undefined} data-testid="online-same">
          {same === null ? t("online.peerUnknown") : same ? t("online.peerSame") : t("online.peerDifferent")}
        </li>
        <Versions peer={phase.peer} />
        <li data-testid="online-peer-name">
          {t("online.peerNameLabel")}
          {phase.peer ? nameOr(phase.peer.name, t) : "…"}
        </li>
      </ul>
      <WatchersFact />
      {online.room?.server && online.records ? (
        <p className="sve-hint" data-testid="online-share" data-kept={gameKept() ? "yes" : "no"}>
          {t(gameKept() ? "online.shareYes" : "online.shareNo")}
        </p>
      ) : null}
      {going && online.game ? (
        <div className="sve-online-game" data-testid="online-game">
          <p>{t("online.gameGoing", { deck: online.game.opponent })}</p>
          <button type="button" className="sve-primary" onClick={onGame} data-testid="online-to-game">
            {t("online.toGame")}
          </button>
        </div>
      ) : (
        <Prep role={phase.role === "host" ? "host" : "guest"} same={same} onEditDecks={onEditDecks} />
      )}
      <Chat />
      <button type="button" onClick={() => leaveAsking(t)} data-testid="online-leave">
        {t(going ? "online.leaveGame" : "online.leave")}
      </button>
    </div>
  );
}

/** "Standard · restriction list: 01_26_JPN · first player: a random player chooses". */
function rulesText(rules: Rules, t: ReturnType<typeof useT>): string {
  const summary = t("online.rulesSummary", { format: t(`format.${rules.format}`), list: rules.list ?? t("format.noList"), order: t(`turnOrder.${rules.turnOrder}`) });
  return rules.undo ? `${summary} · ${t("online.rulesUndo")}` : summary;
}

/**
 * The next game: the host's rules (the host sets them here, in its settings: the format and restriction list the deck builder
 * uses, the setup's first player), each player's deck checked under them, ready or not. Both ready: the game starts.
 */
function Prep({ role, same, onEditDecks }: { role: "host" | "guest"; same: boolean | null; onEditDecks: () => void }) {
  const t = useT();
  const settings = useSettings();
  const catalog = useApp((s) => s.catalog);
  const { prep } = useOnline();
  const [decks, setDecks] = useState<DeckFileEntry[] | null>(null);
  const [status, setStatus] = useState<{ deck: DeckFile; problems: FormatProblem[] } | null>(null);
  const file = settings.setupDecks[0];
  const rules = prep.rules;

  // The host's rules follow its settings.
  useEffect(() => {
    if (role === "host") updateRules();
  }, [role, settings.format, settings.restrictionLists, settings.setupTurnOrder, settings.allowUndo]);
  useEffect(() => {
    hostApi.listDecks().then(setDecks, (err: unknown) => reportError(String(err)));
  }, []);
  // This player's deck, checked under the game's rules.
  useEffect(() => {
    let live = true;
    setStatus(null);
    if (!catalog || !rules) return;
    hostApi
      .loadDeck(file)
      .then(async (deck) => {
        const problems = await problemsUnder(rules, deck, catalog);
        if (live) setStatus({ deck, problems });
      })
      .catch((err: unknown) => reportError(`${file}: ${errorText(err, t)}`));
    return () => {
      live = false;
    };
  }, [file, rules, catalog]);

  const ctx = catalog ? { catalog, lang: settings.cardLang, t } : null;
  const isReady = prep.mine !== null;
  const canReady = same === true && rules !== null && catalog !== null && status !== null && status.problems.length === 0;
  return (
    <div className="sve-online-prep" data-testid="online-prep">
      <section>
        <h3>{t("online.rules")}</h3>
        {role === "host" ? (
          // Taking the rules back needs "not ready" first: they are the ones the other player's deck was checked under.
          <fieldset className="sve-online-rules" disabled={isReady}>
            <FormatPicker />
            <TurnOrderField testId="online-turn-order" />
            <UndoField testId="online-undo" />
          </fieldset>
        ) : (
          <>
            <p data-testid="online-rules">{rules ? rulesText(rules, t) : "…"}</p>
            <p className="sve-hint">{t("online.hostSetsRules")}</p>
          </>
        )}
      </section>
      <section>
        <h3>{t("online.yourDeck")}</h3>
        <label className="sve-field">
          <span>{t("setup.deck")}</span>
          <select value={file} disabled={isReady} onChange={(e) => updateSettings({ setupDecks: [e.target.value, settings.setupDecks[1]] })} data-testid="online-deck">
            {!decks?.some((d) => d.file === file) ? <option value={file}>{file}</option> : null}
            {(decks ?? []).map((d) => (
              <option key={d.file} value={d.file}>
                {d.name} ({d.file})
              </option>
            ))}
          </select>
        </label>
        <div className="sve-deck-status">
          {status === null ? (
            <span className="sve-note">{t("setup.loadingDeck")}</span>
          ) : (
            <>
              <span>{t("setup.deckSummary", { main: cardCount(status.deck.main), evolve: cardCount(status.deck.evolve) })}</span>
              {status.problems.length === 0 ? <span className="sve-ok">{t("setup.deckOk")}</span> : null}
              {status.problems.length > 0 && ctx && rules ? (
                <div className="sve-problems" data-testid="online-deck-problems">
                  {t("setup.deckProblems", { format: t(`format.${rules.format}`) })}
                  <ul>
                    {status.problems.map((problem, i) => (
                      <li key={i}>{formatProblemText(problem, ctx)}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </>
          )}
        </div>
        <div className="sve-online-join">
          {isReady ? (
            <button type="button" disabled={prep.starting} onClick={() => void ready(null)} data-testid="online-unready">
              {t("online.unready")}
            </button>
          ) : (
            <button
              type="button"
              className="sve-primary"
              disabled={!canReady}
              onClick={() => {
                if (status && rules && catalog) void ready(readyDeckOf(status.deck, rules, catalog));
              }}
              data-testid="online-ready"
            >
              {t("online.ready")}
            </button>
          )}
          <button type="button" className="sve-link-button" disabled={isReady} onClick={onEditDecks}>
            {t("setup.editDecks")}
          </button>
        </div>
      </section>
      <section>
        <h3>{t("online.opponent")}</h3>
        <p data-testid="online-opponent" data-ready={prep.theirs !== null && prep.theirsProblems?.length === 0 ? "yes" : "no"}>
          {prep.theirs === null
            ? t("online.opponentChoosing")
            : prep.theirsProblems === null
              ? t("online.opponentChecking")
              : prep.theirsProblems.length === 0
                ? t("online.opponentReady", { deck: prep.theirs.name })
                : t("online.opponentProblems", { deck: prep.theirs.name })}
        </p>
        {prep.theirsProblems && prep.theirsProblems.length > 0 && ctx ? (
          <ul className="sve-problems">
            {prep.theirsProblems.map((problem, i) => (
              <li key={i}>{formatProblemText(problem, ctx)}</li>
            ))}
          </ul>
        ) : null}
      </section>
      <p className={prep.starting ? "sve-online-ok-text" : "sve-hint"} data-testid="online-prep-status">
        {t(prep.starting ? "online.starting" : "online.bothReady")}
      </p>
    </div>
  );
}
