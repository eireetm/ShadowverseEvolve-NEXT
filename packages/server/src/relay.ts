// The relay: the apps connect with a WebSocket, say who they are (the app and one of the server's keys), and meet in a room by
// its code; the server passes their messages to one another in the room and tells them who comes and who goes. It knows
// nothing of the game: the two programs play it (each runs the same engine and sends only its player's answers), and the
// room's protocol (who is the host, the seats, the spectators) is theirs too — the server is the meeting place and the wire,
// as the public relays and the WebRTC connection are without it. Besides: the lobby (the rooms their hosts made public,
// with what the host says of them: its name, the rules, who is in) and the finished games both players let the server keep
// (records.ts). Everything is within limits (message sizes and rates, rooms, connections), so a key that leaks can't do more
// than play.
//
// The messages, JSON (app → server):
//   hello {v, app, key}           first, within 10 seconds        → welcome {v, id, seats, records, passwords} | refused {why}, closed
//   join {room, mode, password?}  create: a new room; join: one that exists; any: either   → joined {peers} | nojoin {why}
//                                 (a room made with a password, 6 digits, takes only the programs that say it)
//   to {id, d}                    d to the program `id` of the room                         → that program gets from {id, d}
//   info {name, format, list, turnOrder, public, players, watchers, playing}   the room's host: what the lobby shows of it
//   lobby {}                      (not in a room) the public rooms now, and again whenever they change → rooms {rooms}
//   record {id, d}                a finished game to keep                                     → recorded {id, kept}
// and (server → app) peer {id} / gone {id}: a program came into the room / left it; closed {why}: closed by the server.
import { createHash, randomBytes } from "node:crypto";
import type { IncomingMessage, Server } from "node:http";
import { WebSocketServer, type RawData, type WebSocket } from "ws";
import { APP_ID, type ServerConfig } from "./config";
import { recordStore, type Kept, type RecordStore } from "./records";

/** The relay's own protocol (the apps' online protocol is theirs). */
export const RELAY_PROTOCOL = 1;

/** Room codes: what the apps make (6 letters and digits), with room to spare. */
const ROOM_CODE = /^[A-Za-z0-9-]{1,32}$/;

/** A room's password: 6 digits (the app that makes the room draws them). */
const PASSWORD = /^[0-9]{6}$/;

/** Wrong passwords an address may say in an hour (at this pace 6 digits can't be guessed). */
export const WRONG_PASSWORDS_PER_HOUR = 20;

/** WebSocket close codes the apps read. */
export const CLOSE = { refused: 4001, limit: 4008, revoked: 4003, shutdown: 4010 } as const;

type Refusal = "version" | "app" | "key" | "busy";

/** What a room's host says of it for the lobby. */
export interface RoomInfo {
  /** The host's name ("" : none given). */
  name: string;
  format: string;
  list: string | null;
  turnOrder: string;
  /** Listed in the lobby (else joined by its code only). */
  public: boolean;
  /** Players in it (1: the host waits for the other), spectators, and whether a game is being played. */
  players: number;
  watchers: number;
  playing: boolean;
}

/** A room as the lobby lists it. */
export interface LobbyRoom extends Omit<RoomInfo, "public"> {
  code: string;
  /** Its spectator seats (the server's). */
  seats: number;
  /** Coming in (to play or to watch) needs its password. */
  locked: boolean;
}

interface Room {
  code: string;
  members: Map<string, Conn>;
  /** The program that made it (its host), the one whose info is taken; another member's once it has gone. */
  owner: string;
  info: RoomInfo | null;
  /** The password its maker gave (null: none): every program coming in must say it. */
  password: string | null;
}

interface Conn {
  id: string;
  ws: WebSocket;
  ip: string;
  /** The key it said (and its name), once welcomed. */
  key: string | null;
  keyName: string | null;
  room: Room | null;
  /** It follows the lobby. */
  lobby: boolean;
  /** Token buckets: messages and bytes it may still send now. */
  messages: number;
  bytes: number;
  refilled: number;
  /** It answered the last ping. */
  alive: boolean;
  hello: NodeJS.Timeout | null;
}

/** What each key did in the current hour. */
interface KeyUse {
  connects: number;
  rooms: number;
  bytes: number;
  records: number;
}

export interface RelayStatus {
  connections: number;
  rooms: number;
  /** Connections following the lobby, and the rooms it lists. */
  lobby: { following: number; listed: number };
  /** Per key name: connections now, and this hour's connects, rooms made, bytes passed and games kept. */
  keys: Record<string, { connections: number } & KeyUse>;
  /** This hour's refused connections, by reason. */
  refused: Record<string, number>;
}

export interface Relay {
  /** The configuration changed (the file was read again): new keys and limits; connections of removed keys are closed. */
  configure(config: ServerConfig): void;
  status(): RelayStatus;
  /** The hour's numbers, for the log, and a new hour begins. */
  takeHour(): RelayStatus;
  close(): void;
}

const hashOf = (key: string): string => createHash("sha256").update(key).digest("hex");

const newId = (): string => randomBytes(9).toString("base64url");

/** The client's address as a person reads it (IPv4 without the IPv6 prefix). */
function addressOf(req: IncomingMessage): string {
  const raw = req.socket.remoteAddress ?? "?";
  return raw.startsWith("::ffff:") ? raw.slice(7) : raw;
}

/** A name as the apps show it (their cleanName): no control characters, spaces collapsed, at most 16 characters. */
function cleanName(text: string): string {
  return [...text.replace(/[\t\n\r]+/g, " ").replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\ufeff]/g, "").replace(/\s+/g, " ").trim()].slice(0, 16).join("").trim();
}

const shortString = (v: unknown, max = 40): v is string => typeof v === "string" && v.length <= max;
const count = (v: unknown, max: number): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= max;

/** What a host said of its room, or null when it isn't that. */
function infoOf(m: Record<string, unknown>): RoomInfo | null {
  if (!shortString(m.name, 64) || !shortString(m.format) || !(m.list === null || shortString(m.list)) || !shortString(m.turnOrder)) return null;
  if (typeof m.public !== "boolean" || typeof m.playing !== "boolean" || !count(m.players, 2) || !count(m.watchers, 1000)) return null;
  return { name: cleanName(m.name), format: m.format, list: m.list, turnOrder: m.turnOrder, public: m.public, players: m.players, watchers: m.watchers, playing: m.playing };
}

/**
 * Serve the relay on `server` (HTTP or HTTPS): WebSocket upgrades at any path. `log` gets a line per notable event; `store`
 * keeps the games sent (by default where the configuration says).
 */
export function startRelay(server: Server, initial: ServerConfig, log: (line: string) => void = () => undefined, pingMs = 25_000, store?: RecordStore): Relay {
  let config = initial;
  const records = store ?? recordStore(config.records, log);
  let byHash = new Map<string, string>();
  const setKeys = () => (byHash = new Map([...config.keys].map(([name, key]) => [hashOf(key), name])));
  setKeys();
  const conns = new Set<Conn>();
  const perIp = new Map<string, number>();
  /** Wrong room passwords said from each address since `since` (counted again after an hour). */
  const wrong = new Map<string, { n: number; since: number }>();
  const rooms = new Map<string, Room>();
  let hour = new Map<string, KeyUse>();
  let refused = new Map<string, number>();
  const use = (name: string): KeyUse => {
    let u = hour.get(name);
    if (!u) hour.set(name, (u = { connects: 0, rooms: 0, bytes: 0, records: 0 }));
    return u;
  };

  // maxPayload: a larger message closes the connection (1009) before it is read.
  const wss = new WebSocketServer({ server, maxPayload: config.limits.maxMessageBytes });

  const send = (c: Conn, message: object): void => {
    if (c.ws.readyState === c.ws.OPEN) c.ws.send(JSON.stringify(message));
  };

  // ---- The lobby: the public rooms, sent to those following it now and (a moment after) whenever they change ----
  const listed = (): LobbyRoom[] =>
    [...rooms.values()]
      .filter((r) => r.info?.public)
      .map((r) => {
        const { public: _, ...shown } = r.info!;
        return { code: r.code, ...shown, seats: config.spectators, locked: r.password !== null };
      });
  let lobbyTimer: NodeJS.Timeout | null = null;
  const lobbyChanged = (): void => {
    lobbyTimer ??= setTimeout(() => {
      lobbyTimer = null;
      const message = { t: "rooms", rooms: listed() };
      for (const c of conns) if (c.lobby) send(c, message);
    }, 300);
  };

  const refuse = (c: Conn, why: Refusal): void => {
    refused.set(why, (refused.get(why) ?? 0) + 1);
    send(c, { t: "refused", why });
    c.ws.close(CLOSE.refused, why);
  };
  const leaveRoom = (c: Conn): void => {
    const room = c.room;
    if (!room) return;
    c.room = null;
    room.members.delete(c.id);
    for (const m of room.members.values()) send(m, { t: "gone", id: c.id });
    if (room.members.size === 0) rooms.delete(room.code);
    if (room.info?.public) lobbyChanged();
  };
  const drop = (c: Conn): void => {
    if (!conns.delete(c)) return;
    if (c.hello) clearTimeout(c.hello);
    leaveRoom(c);
    const n = (perIp.get(c.ip) ?? 1) - 1;
    if (n <= 0) perIp.delete(c.ip);
    else perIp.set(c.ip, n);
  };
  /** Whether the connection may send this message now (token buckets: a minute's worth of burst). */
  const within = (c: Conn, size: number): boolean => {
    const now = Date.now();
    const seconds = (now - c.refilled) / 1000;
    c.refilled = now;
    const { messagesPerSecond, bytesPerSecond } = config.limits;
    c.messages = Math.min(messagesPerSecond * 10, c.messages + seconds * messagesPerSecond);
    c.bytes = Math.min(bytesPerSecond * 64, c.bytes + seconds * bytesPerSecond);
    c.messages -= 1;
    c.bytes -= size;
    return c.messages >= 0 && c.bytes >= 0;
  };

  const welcome = (c: Conn, m: Record<string, unknown>): void => {
    if (m.v !== RELAY_PROTOCOL) return refuse(c, "version");
    if (m.app !== APP_ID) return refuse(c, "app");
    const key = typeof m.key === "string" ? m.key : "";
    const name = byHash.get(hashOf(key));
    if (name === undefined) {
      log(`refused ${c.ip}: no such key`);
      return refuse(c, "key");
    }
    if (c.hello) clearTimeout(c.hello);
    c.hello = null;
    c.key = key;
    c.keyName = name;
    use(name).connects += 1;
    send(c, { t: "welcome", v: RELAY_PROTOCOL, id: c.id, seats: config.spectators, records: config.records.enabled, passwords: true });
  };

  const join = (c: Conn, m: Record<string, unknown>): void => {
    const code = typeof m.room === "string" ? m.room : "";
    const mode = m.mode;
    if (c.room || !ROOM_CODE.test(code) || (mode !== "create" && mode !== "join" && mode !== "any")) return;
    c.lobby = false;
    let room = rooms.get(code);
    if (room && mode === "create") return send(c, { t: "nojoin", why: "exists" });
    if (!room && mode === "join") return send(c, { t: "nojoin", why: "missing" });
    const password = typeof m.password === "string" && PASSWORD.test(m.password) ? m.password : null;
    if (room && room.password !== null) {
      // An address that said too many wrong passwords this hour gets into no locked room, whatever it says now (else
      // guessing on would find it); below that, a wrong (or no) password counts.
      const now = Date.now();
      let tries = wrong.get(c.ip);
      if (!tries || now - tries.since > 3_600_000) wrong.set(c.ip, (tries = { n: 0, since: now }));
      if (tries.n >= WRONG_PASSWORDS_PER_HOUR) return send(c, { t: "nojoin", why: "tries" });
      if (password !== room.password) {
        tries.n += 1;
        if (tries.n === WRONG_PASSWORDS_PER_HOUR) log(`${c.ip}: ${WRONG_PASSWORDS_PER_HOUR} wrong room passwords in an hour`);
        return send(c, { t: "nojoin", why: "password" });
      }
    }
    if (!room) {
      if (rooms.size >= config.maxRooms) {
        log(`no room for ${c.keyName}: ${rooms.size} rooms (max_rooms)`);
        return send(c, { t: "nojoin", why: "busy" });
      }
      room = { code, members: new Map(), owner: c.id, info: null, password };
      rooms.set(code, room);
      use(c.keyName!).rooms += 1;
    }
    // The two players, the spectators, and a little room for programs coming back while their old connection lingers.
    if (room.members.size >= 2 + config.spectators + 2) return send(c, { t: "nojoin", why: "full" });
    for (const other of room.members.values()) send(other, { t: "peer", id: c.id });
    send(c, { t: "joined", peers: [...room.members.keys()] });
    room.members.set(c.id, c);
    c.room = room;
  };

  /** The room's host says what the lobby shows of it (its owner's word; another member's once the owner has gone). */
  const describe = (c: Conn, m: Record<string, unknown>): void => {
    const room = c.room;
    const info = infoOf(m);
    if (!room || !info) return;
    if (room.owner !== c.id && room.members.has(room.owner)) return;
    room.owner = c.id;
    const was = JSON.stringify(room.info);
    room.info = info;
    if (JSON.stringify(info) !== was && (info.public || JSON.parse(was ?? "null")?.public)) lobbyChanged();
  };

  const keep = (c: Conn, m: Record<string, unknown>): void => {
    if (!shortString(m.id, 128) || typeof m.d !== "object" || m.d === null) return;
    const kept: Kept = records.keep(m.id, c.keyName!, m.d);
    if (kept === "kept") use(c.keyName!).records += 1;
    send(c, { t: "recorded", id: m.id, kept });
  };

  wss.on("connection", (ws: WebSocket, req: IncomingMessage) => {
    const ip = addressOf(req);
    const c: Conn = { id: newId(), ws, ip, key: null, keyName: null, room: null, lobby: false, messages: 0, bytes: 0, refilled: Date.now(), alive: true, hello: null };
    c.messages = config.limits.messagesPerSecond * 10;
    c.bytes = config.limits.bytesPerSecond * 64;
    conns.add(c);
    perIp.set(ip, (perIp.get(ip) ?? 0) + 1);
    ws.on("close", () => drop(c));
    ws.on("error", () => drop(c));
    ws.on("pong", () => (c.alive = true));
    if (conns.size > config.limits.maxConnections || perIp.get(ip)! > config.limits.maxConnectionsPerIp) {
      log(`refused ${ip}: too many connections (${conns.size} in all, ${perIp.get(ip)} from it)`);
      return refuse(c, "busy");
    }
    c.hello = setTimeout(() => ws.close(CLOSE.refused, "no hello"), 10_000);
    ws.on("message", (data: RawData, binary: boolean) => {
      const size = Array.isArray(data) ? data.reduce((s, b) => s + b.length, 0) : (data as Buffer | ArrayBuffer).byteLength;
      if (!within(c, size)) {
        log(`closed ${c.keyName ?? "?"} ${ip}: over the limits (messages_per_second, kb_per_second)`);
        send(c, { t: "closed", why: "limit" });
        return ws.close(CLOSE.limit, "limit");
      }
      if (binary) return;
      let m: unknown;
      try {
        m = JSON.parse(data.toString());
      } catch {
        return;
      }
      if (typeof m !== "object" || m === null) return;
      const msg = m as Record<string, unknown>;
      if (c.key === null) {
        if (msg.t === "hello") welcome(c, msg);
        return;
      }
      if (msg.t === "join") join(c, msg);
      else if (msg.t === "to" && typeof msg.id === "string" && c.room) {
        const to = c.room.members.get(msg.id);
        if (!to || to === c) return;
        use(c.keyName!).bytes += size;
        send(to, { t: "from", id: c.id, d: msg.d });
      } else if (msg.t === "info") describe(c, msg);
      else if (msg.t === "lobby" && !c.room) {
        c.lobby = true;
        send(c, { t: "rooms", rooms: listed() });
      } else if (msg.t === "record") keep(c, msg);
    });
  });

  // Connections that don't answer a ping by the next one are gone (a phone that lost its network keeps no socket open).
  const pinger = setInterval(() => {
    const now = Date.now();
    for (const [ip, tries] of wrong) if (now - tries.since > 3_600_000) wrong.delete(ip);
    for (const c of conns) {
      if (!c.alive) {
        c.ws.terminate();
        drop(c);
        continue;
      }
      c.alive = false;
      c.ws.ping();
    }
  }, pingMs);

  const status = (): RelayStatus => {
    const keys: RelayStatus["keys"] = {};
    const none = (): KeyUse => ({ connects: 0, rooms: 0, bytes: 0, records: 0 });
    for (const name of new Set([...config.keys.keys(), ...hour.keys()])) keys[name] = { connections: 0, ...(hour.get(name) ?? none()) };
    for (const c of conns) if (c.keyName !== null) (keys[c.keyName] ??= { connections: 0, ...none() }).connections += 1;
    const following = [...conns].filter((c) => c.lobby).length;
    return { connections: conns.size, rooms: rooms.size, lobby: { following, listed: listed().length }, keys, refused: Object.fromEntries(refused) };
  };

  return {
    configure(next) {
      config = next;
      setKeys();
      records.configure(next.records);
      wss.options.maxPayload = next.limits.maxMessageBytes;
      // A key removed or changed: its connections end now.
      for (const c of conns) {
        if (c.keyName !== null && next.keys.get(c.keyName) !== c.key) {
          send(c, { t: "closed", why: "revoked" });
          c.ws.close(CLOSE.revoked, "revoked");
        }
      }
      lobbyChanged();
    },
    status,
    takeHour() {
      const s = status();
      hour = new Map();
      refused = new Map();
      return s;
    },
    close() {
      clearInterval(pinger);
      if (lobbyTimer) clearTimeout(lobbyTimer);
      for (const c of conns) c.ws.close(CLOSE.shutdown, "shutdown");
      wss.close();
    },
  };
}
