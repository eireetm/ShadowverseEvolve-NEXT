// The online server as a network rooms can meet on (rooms.ts), beside the public ones: the programs connect to the server
// (a WebSocket, wss:// to the server's address), say who they are with the key its owner gave, and meet in room <code>;
// the server tells who is there and who comes and goes, and passes their messages. It stands in for Trystero's rooms as far
// as they are used there (as local-network.ts does for the tests), so the room's protocol — the host, the seats, the
// spectators, the game — is the same as on the public networks; only the wire is the server's, not WebRTC. Besides, the
// room's host tells the server what its lobby shows of the room (the host's name, the rules, who is in), a program can
// follow the lobby (watchLobby), and a finished game can be sent for the server to keep. With several servers configured
// (people of several servers playing together), a room is on one of them: a code typed in is looked for on all of them at
// once, and the room is the one found. The server's side is packages/server (its relay.ts says the messages). A server may
// also offer queues beside its rooms: people waiting on a site of its own, to meet with a deck that site takes (seekQueue; the
// random match goes to them). packages/server has none: the lobby of a server that offers them lists them.
import type { JsonValue, MessageAction, Room } from "trystero";
import type { ReadyDeck } from "./messages";
import { APP_ID } from "./relays";
import type { Network } from "./rooms";
import type { ServerSettings } from "./server-config";

/** The server's protocol (packages/server/src/relay.ts RELAY_PROTOCOL). */
export const RELAY_PROTOCOL = 1;

/**
 * What can go wrong with the server: it refused this program (its key, its version, too busy), the room isn't there (or is
 * there already, or full; or its password wasn't said, or this address said too many wrong ones lately), it couldn't be
 * reached, it closed the connection (over its limits, the key revoked, or any other reason), or it is too old to keep a
 * room's password ("nopassword": a room made with one would be open to all).
 */
export type ServerProblem =
  | "key"
  | "version"
  | "app"
  | "busy"
  | "missing"
  | "exists"
  | "full"
  | "password"
  | "tries"
  | "unreachable"
  | "limit"
  | "revoked"
  | "closed"
  | "nopassword";

/** How a program comes into the room: making it (the host), joining one that is there, or either (coming back). */
export type JoinMode = "create" | "join" | "any";

/**
 * Where a problem is: the server it is about (null: each server looked at said there is no such room), and a server the
 * room couldn't be looked for on, with why (the room may be there).
 */
export interface ProblemAt {
  server: ServerSettings | null;
  unasked: { server: ServerSettings; problem: ServerProblem } | null;
}

export interface ServerMeetingHandlers {
  /** The server of the room took this program in: its spectator seats per room, and whether it keeps finished games. */
  onWelcome?: (seats: number, records: boolean) => void;
  onProblem: (problem: ServerProblem, at: ProblemAt) => void;
  /** The server the room is on, once it is found there (joined, or it said why not: its password, its seats). */
  onServer?: (server: ServerSettings) => void;
  /** The room's handle, once the room is joined (to describe it for the lobby, to send a finished game). */
  onRoom?: (room: ServerRoom) => void;
}

/** What a room's host tells the server's lobby about it (packages/server relay.ts RoomInfo). */
export interface RoomInfo {
  name: string;
  format: string;
  list: string | null;
  turnOrder: string;
  public: boolean;
  players: number;
  watchers: number;
  playing: boolean;
}

/**
 * A room as the lobby lists it: its code, what its host said (the public flag aside), the server's spectator seats, and
 * whether coming in needs its password (an older server doesn't say: none).
 */
export interface LobbyRoom extends Omit<RoomInfo, "public"> {
  code: string;
  seats: number;
  locked?: boolean;
}

/**
 * A queue the lobby lists beside the rooms, on a server that offers one: people waiting on a site of its own for a game of this
 * format and restriction list. Only this is said of them: `id` is what to ask for (seekQueue).
 */
export interface LobbyQueue {
  id: string;
  format: string;
  list: string | null;
}

/** What a program going to a queue tells its site, which makes a game only with a deck and a program it takes. */
export interface SeekRequest {
  /** Its person's name ("": none given), and whether they let their games be kept. */
  name: string;
  share: boolean;
  /** The deck, as it will be made ready in the game's room. */
  deck: ReadyDeck;
  /** The program (net/online.ts thisProgram), and its restriction list's contents (lists.ts listFingerprint). */
  version: string;
  engine: string;
  cards: string;
  listHash: string | null;
}

/** The game a queue's site made with this program: its room, this program's seat in it, and the key to come in with if not its own. */
export interface Sought {
  room: string;
  token: string;
  key?: string;
}

/** What happened to a game sent to be kept (packages/server records.ts), or "unsent": no answer, no connection. */
export type Kept = "kept" | "off" | "again" | "quota" | "disk" | "error" | "unsent";

/** A room joined on the server, beside its connections: what the lobby shows of it, and a finished game to keep. */
export interface ServerRoom {
  describe(info: RoomInfo): void;
  record(id: string, game: unknown): Promise<Kept>;
}

/** How long the server has to answer before it counts as unreachable. */
const ANSWER_MS = 12_000;
/** How long a queue's site has to check a deck and make a game. */
const SEEK_MS = 20_000;

const PROBLEMS = new Set<string>(["key", "version", "app", "busy", "missing", "exists", "full", "password", "tries", "limit", "revoked"]);
const problemOf = (why: unknown): ServerProblem => (typeof why === "string" && PROBLEMS.has(why) ? (why as ServerProblem) : "closed");

/**
 * The server as a network to meet in one room on: `mode` says how this program comes in, `password` the room's (6 digits;
 * made with it, the room takes only those who say it). Joining (`join`) a room on one of several servers looks for it on
 * each of them at once; a room is made, or come back to, on one server (the first given).
 */
export function serverNetwork(
  servers: ServerSettings | readonly ServerSettings[],
  mode: JoinMode,
  handlers: ServerMeetingHandlers,
  password: string | null = null,
): Network {
  const list = Array.isArray(servers) ? servers : [servers as ServerSettings];
  const used = mode === "join" ? list : list.slice(0, 1);
  return {
    via: "server",
    join: ((_config: unknown, code: string) => joinServer(used, code, mode, handlers, password)) as unknown as Network["join"],
    relays: used.map((s) => s.address),
  };
}

/**
 * The problem of a room looked for on several servers, once none of them took this program in: one that has the room said
 * why not (its password, its seats); else no such room where it could be looked for (and one where it couldn't, if any);
 * else the first server's own problem.
 */
function settled(tries: readonly { server: ServerSettings; failed: ServerProblem | null }[]): { problem: ServerProblem; at: ProblemAt; there: number | null } {
  const there = tries.findIndex((a) => a.failed === "password" || a.failed === "tries" || a.failed === "full");
  if (there >= 0) return { problem: tries[there]!.failed!, at: { server: tries[there]!.server, unasked: null }, there };
  if (tries.some((a) => a.failed === "missing")) {
    const other = tries.find((a) => a.failed !== "missing");
    return {
      problem: "missing",
      at: { server: tries.length === 1 ? tries[0]!.server : null, unasked: other ? { server: other.server, problem: other.failed! } : null },
      there: null,
    };
  }
  return { problem: tries[0]!.failed!, at: { server: tries[0]!.server, unasked: null }, there: null };
}

/** One server's connection while a room is looked for (or made, or come back to) there. */
interface Try {
  server: ServerSettings;
  socket: WebSocket | null;
  welcomed: boolean;
  seats: number;
  records: boolean;
  /** Why it can't take this program into the room (null: not said yet). */
  failed: ServerProblem | null;
  /** Closed by this side: the room is on another server, or the attempt is over. */
  dropped: boolean;
}

function joinServer(servers: readonly ServerSettings[], code: string, mode: JoinMode, handlers: ServerMeetingHandlers, password: string | null): Room {
  const peers = new Set<string>();
  const actions = new Map<string, MessageAction<JsonValue>>();
  let left = false;
  let reported = false;
  const report = (problem: ServerProblem, at: ProblemAt) => {
    if (reported || left) return;
    reported = true;
    handlers.onProblem(problem, at);
  };
  const tries: Try[] = servers.map((server) => ({ server, socket: null, welcomed: false, seats: 0, records: false, failed: null, dropped: false }));
  /** One server only: what it says goes at once, as it says it. */
  const single = tries.length === 1;
  /** The server's connection the room is on, once joined there. */
  let chosen: Try | null = null;
  let joined = false;
  /** The latest description, sent once the room is joined (and again when it changes). */
  let described: RoomInfo | null = null;
  const waitingRecords = new Map<string, (kept: Kept) => void>();
  const sendOn = (a: Try | null, message: object) => {
    if (a?.socket?.readyState === WebSocket.OPEN) a.socket.send(JSON.stringify(message));
  };
  const send = (message: object) => sendOn(chosen, message);
  const drop = (a: Try) => {
    a.dropped = true;
    a.socket?.close(1000);
  };
  /** A server that can't take this program into the room: when none is left, why (from all of them). */
  const fail = (a: Try, problem: ServerProblem) => {
    if (a.failed !== null || chosen) return;
    a.failed = problem;
    if (single) return report(problem, { server: a.server, unasked: null });
    drop(a);
    if (tries.some((t) => t.failed === null)) return;
    const end = settled(tries);
    if (end.there !== null) {
      const at = tries[end.there]!;
      handlers.onWelcome?.(at.seats, at.records);
      handlers.onServer?.(at.server);
    }
    report(end.problem, end.at);
  };
  const handle: ServerRoom = {
    describe(info) {
      described = info;
      if (joined) send({ t: "info", ...info });
    },
    record(id, game) {
      if (!joined || chosen?.socket?.readyState !== WebSocket.OPEN) return Promise.resolve("unsent");
      return new Promise((done) => {
        const timer = setTimeout(() => {
          waitingRecords.delete(id);
          done("unsent");
        }, ANSWER_MS);
        waitingRecords.set(id, (kept) => {
          clearTimeout(timer);
          done(kept);
        });
        send({ t: "record", id, d: game });
      });
    },
  };
  const room = {
    onPeerJoin: null as ((peerId: string) => void) | null,
    onPeerLeave: null as ((peerId: string) => void) | null,
    makeAction<T>(name: string): MessageAction<T & JsonValue> {
      const action: MessageAction<JsonValue> = {
        onMessage: null,
        onReceiveProgress: null,
        send: async (data, options) => {
          const target = options?.target;
          const to = target === undefined || target === null ? [...peers] : Array.isArray(target) ? target : [target];
          for (const id of to) send({ t: "to", id, d: data });
        },
      };
      actions.set(name, action);
      return action as MessageAction<T & JsonValue>;
    },
    getPeers: () => ({}),
    leave: async () => {
      left = true;
      for (const a of tries) a.socket?.close(1000);
    },
  };
  const meetPeer = (id: string) => {
    if (peers.has(id)) return;
    peers.add(id);
    room.onPeerJoin?.(id);
  };
  const losePeer = (id: string) => {
    if (peers.delete(id)) room.onPeerLeave?.(id);
  };
  const closeProblem = (code: number): ServerProblem => (code === 4008 ? "limit" : code === 4003 ? "revoked" : "closed");
  /** What a server said on its connection `a` (`timer`: its time to welcome this program). */
  const hear = (a: Try, m: Record<string, unknown>, timer: ReturnType<typeof setTimeout>) => {
    switch (m.t) {
      case "welcome":
        a.welcomed = true;
        clearTimeout(timer);
        a.seats = typeof m.seats === "number" ? m.seats : 0;
        a.records = m.records === true;
        // Several servers: said of the one the room is found on.
        if (single) handlers.onWelcome?.(a.seats, a.records);
        // An older server that keeps no passwords (its welcome doesn't say it does) would make this room open to all: not made
        // there. (Joining one there needs none: it can't have one.)
        if (password !== null && m.passwords !== true && mode !== "join") {
          fail(a, "nopassword");
          a.socket?.close(1000);
          break;
        }
        sendOn(a, { t: "join", room: code, mode, ...(password !== null ? { password } : {}) });
        break;
      case "joined":
        // The same code on two servers (a rare draw): the room is the first one found.
        if (chosen) {
          drop(a);
          break;
        }
        chosen = a;
        for (const other of tries) if (other !== a) drop(other);
        if (!single) handlers.onWelcome?.(a.seats, a.records);
        handlers.onServer?.(a.server);
        joined = true;
        if (described) send({ t: "info", ...described });
        handlers.onRoom?.(handle);
        if (Array.isArray(m.peers)) for (const id of m.peers) if (typeof id === "string") meetPeer(id);
        break;
      case "recorded":
        if (a !== chosen) break;
        if (typeof m.id === "string") waitingRecords.get(m.id)?.(typeof m.kept === "string" ? (m.kept as Kept) : "error");
        waitingRecords.delete(String(m.id));
        break;
      case "peer":
        if (a === chosen && typeof m.id === "string") meetPeer(m.id);
        break;
      case "gone":
        if (a === chosen && typeof m.id === "string") losePeer(m.id);
        break;
      case "from":
        if (a === chosen && typeof m.id === "string" && peers.has(m.id)) {
          const action = actions.get("sve") ?? [...actions.values()][0];
          void action?.onMessage?.(m.d as JsonValue, { peerId: m.id } as Parameters<NonNullable<MessageAction<JsonValue>["onMessage"]>>[1]);
        }
        break;
      case "refused":
      case "nojoin":
      case "closed":
        if (a === chosen) report(problemOf(m.why), { server: a.server, unasked: null });
        else fail(a, problemOf(m.why));
        break;
      default:
        break;
    }
  };
  const connect = (a: Try) => {
    let ws: WebSocket;
    try {
      ws = new WebSocket(a.server.address);
    } catch {
      return fail(a, "unreachable");
    }
    a.socket = ws;
    const timer = setTimeout(() => {
      if (!a.welcomed) {
        fail(a, "unreachable");
        ws.close();
      }
    }, ANSWER_MS);
    ws.onopen = () => sendOn(a, { t: "hello", v: RELAY_PROTOCOL, app: APP_ID, key: a.server.key });
    ws.onmessage = (event: MessageEvent) => {
      if (left || a.dropped || typeof event.data !== "string") return;
      let m: Record<string, unknown>;
      try {
        m = JSON.parse(event.data) as Record<string, unknown>;
      } catch {
        return;
      }
      hear(a, m, timer);
    };
    ws.onclose = (event: CloseEvent) => {
      clearTimeout(timer);
      if (a !== chosen) {
        if (!left && !a.dropped) fail(a, a.welcomed ? closeProblem(event.code) : "unreachable");
        return;
      }
      joined = false;
      for (const done of waitingRecords.values()) done("unsent");
      waitingRecords.clear();
      if (left) return;
      // Why (a refusal was said before the close), then everyone in the room is gone for this program: a joining program
      // leaves the room with its link (rooms.ts), and would hear nothing more.
      report(closeProblem(event.code), { server: a.server, unasked: null });
      for (const id of [...peers]) losePeer(id);
    };
  };
  // Connect once the caller has set its handlers (rooms.ts sets them right after joining).
  setTimeout(() => {
    if (left) return;
    for (const a of tries) connect(a);
  }, 0);
  return room as unknown as Room;
}

/**
 * Follow the server's lobby: the public rooms now and whenever they change (`onRooms`; the queues it lists beside them,
 * `onQueues`), until closed. A lost connection is made again after a few seconds (meanwhile `onProblem` says why, and the list
 * is empty).
 */
export function watchLobby(
  server: ServerSettings,
  onRooms: (rooms: LobbyRoom[]) => void,
  onProblem: (problem: ServerProblem | null) => void,
  onQueues?: (queues: LobbyQueue[]) => void,
): { close(): void } {
  let closed = false;
  let socket: WebSocket | null = null;
  let again: ReturnType<typeof setTimeout> | null = null;
  const connect = () => {
    if (closed) return;
    let ws: WebSocket;
    try {
      ws = new WebSocket(server.address);
    } catch {
      onProblem("unreachable");
      again = setTimeout(connect, 5000);
      return;
    }
    socket = ws;
    let welcomed = false;
    let refusal: ServerProblem | null = null;
    ws.onopen = () => ws.send(JSON.stringify({ t: "hello", v: RELAY_PROTOCOL, app: APP_ID, key: server.key }));
    ws.onmessage = (event: MessageEvent) => {
      let m: Record<string, unknown> = {};
      try {
        m = JSON.parse(String(event.data)) as Record<string, unknown>;
      } catch {
        return;
      }
      if (m.t === "welcome") {
        welcomed = true;
        onProblem(null);
        ws.send(JSON.stringify({ t: "lobby" }));
      } else if (m.t === "refused") refusal = problemOf(m.why);
      else if (m.t === "rooms" && Array.isArray(m.rooms)) {
        onRooms(m.rooms.filter(lobbyRoom));
        onQueues?.(Array.isArray(m.queues) ? m.queues.filter(lobbyQueue) : []);
      }
    };
    ws.onclose = () => {
      if (closed) return;
      onRooms([]);
      onQueues?.([]);
      onProblem(refusal ?? (welcomed ? "closed" : "unreachable"));
      // A refusal (the key) won't change by itself: try again later all the same, the owner may fix it meanwhile.
      again = setTimeout(connect, refusal ? 30_000 : 5000);
    };
  };
  connect();
  return {
    close() {
      closed = true;
      if (again) clearTimeout(again);
      socket?.close(1000);
    },
  };
}

/** Whether a listed room is one (the server checked what its host said; this checks the shape). */
function lobbyRoom(v: unknown): v is LobbyRoom {
  if (typeof v !== "object" || v === null) return false;
  const r = v as Record<string, unknown>;
  return (
    typeof r.code === "string" &&
    typeof r.name === "string" &&
    typeof r.format === "string" &&
    (r.list === null || typeof r.list === "string") &&
    typeof r.players === "number" &&
    typeof r.watchers === "number" &&
    typeof r.seats === "number" &&
    typeof r.playing === "boolean" &&
    (r.locked === undefined || typeof r.locked === "boolean")
  );
}

/** Whether a listed queue is one (its shape: the older servers list none). */
function lobbyQueue(v: unknown): v is LobbyQueue {
  if (typeof v !== "object" || v === null) return false;
  const q = v as Record<string, unknown>;
  return typeof q.id === "string" && typeof q.format === "string" && (q.list === null || typeof q.list === "string");
}

/**
 * Go to a queue of the server's lobby: connect, say who this is and what it comes with, and leave with the site's answer. The
 * game it made with this program, or null: not taken, whyever (no reason is given: the deck, the program, nobody waiting any
 * more), or no answer.
 */
export function seekQueue(server: ServerSettings, queue: string, request: SeekRequest): Promise<Sought | null> {
  return new Promise((done) => {
    let settled = false;
    let ws: WebSocket | undefined;
    const finish = (answer: Sought | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      ws?.close(1000);
      done(answer);
    };
    const timer = setTimeout(() => finish(null), SEEK_MS);
    try {
      ws = new WebSocket(server.address);
    } catch {
      finish(null);
      return;
    }
    const socket = ws;
    socket.onopen = () => socket.send(JSON.stringify({ t: "hello", v: RELAY_PROTOCOL, app: APP_ID, key: server.key }));
    socket.onmessage = (event: MessageEvent) => {
      let m: Record<string, unknown> = {};
      try {
        m = JSON.parse(String(event.data)) as Record<string, unknown>;
      } catch {
        return;
      }
      if (m.t === "welcome") socket.send(JSON.stringify({ t: "seek", id: queue, ...request }));
      else if (m.t === "sought") finish(soughtOf(m));
      else if (m.t === "refused") finish(null);
    };
    socket.onclose = () => finish(null);
  });
}

/** The site's answer, when it made a game. */
function soughtOf(m: Record<string, unknown>): Sought | null {
  if (typeof m.room !== "string" || typeof m.token !== "string" || m.room === "" || m.token === "") return null;
  return { room: m.room, token: m.token, ...(typeof m.key === "string" && m.key !== "" ? { key: m.key } : {}) };
}

/** The server as the game's room of a queue wants it: its address says this program's seat, with the key the site gave. */
export function seatServer(server: ServerSettings, sought: Sought): ServerSettings {
  const join = server.address.includes("?") ? "&" : "?";
  return { ...server, address: `${server.address}${join}lt=${encodeURIComponent(sought.token)}`, key: sought.key ?? server.key };
}

/** What a check of the server found: it takes this program (its round trip and spectator seats), or the problem. */
export type ServerCheck = { ok: true; ms: number; seats: number } | { ok: false; problem: ServerProblem };

/** Connect to the server and say who this is, then leave: whether it is reachable and takes the key. */
export function checkServer(server: ServerSettings): Promise<ServerCheck> {
  return new Promise((done) => {
    const started = performance.now();
    let settled = false;
    const finish = (result: ServerCheck, ws?: WebSocket) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      ws?.close(1000);
      done(result);
    };
    const timer = setTimeout(() => finish({ ok: false, problem: "unreachable" }, ws), ANSWER_MS);
    let ws: WebSocket | undefined;
    try {
      ws = new WebSocket(server.address);
    } catch {
      finish({ ok: false, problem: "unreachable" });
      return;
    }
    const socket = ws;
    socket.onopen = () => socket.send(JSON.stringify({ t: "hello", v: RELAY_PROTOCOL, app: APP_ID, key: server.key }));
    socket.onmessage = (event: MessageEvent) => {
      let m: Record<string, unknown> = {};
      try {
        m = JSON.parse(String(event.data)) as Record<string, unknown>;
      } catch {
        // not the server
      }
      if (m.t === "welcome") finish({ ok: true, ms: Math.round(performance.now() - started), seats: typeof m.seats === "number" ? m.seats : 0 }, socket);
      else if (m.t === "refused") finish({ ok: false, problem: problemOf(m.why) }, socket);
    };
    socket.onclose = () => finish({ ok: false, problem: "unreachable" });
  });
}
