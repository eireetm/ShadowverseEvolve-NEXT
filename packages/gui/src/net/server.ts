// The online server as a network rooms can meet on (rooms.ts), beside the public ones: the programs connect to the server
// (a WebSocket, wss:// to the server's address), say who they are with the key its owner gave, and meet in room <code>;
// the server tells who is there and who comes and goes, and passes their messages. It stands in for Trystero's rooms as far
// as they are used there (as local-network.ts does for the tests), so the room's protocol — the host, the seats, the
// spectators, the game — is the same as on the public networks; only the wire is the server's, not WebRTC. The server's
// side is packages/server (its relay.ts says the messages).
import type { JsonValue, MessageAction, Room } from "trystero";
import { APP_ID } from "./relays";
import type { Network } from "./rooms";
import type { ServerSettings } from "./server-config";

/** The server's protocol (packages/server/src/relay.ts RELAY_PROTOCOL). */
export const RELAY_PROTOCOL = 1;

/**
 * What can go wrong with the server: it refused this program (its key, its version, too busy), the room isn't there (or is
 * there already, or full), it couldn't be reached, or it closed the connection (over its limits, the key revoked, or any
 * other reason).
 */
export type ServerProblem = "key" | "version" | "app" | "busy" | "missing" | "exists" | "full" | "unreachable" | "limit" | "revoked" | "closed";

/** How a program comes into the room: making it (the host), joining one that is there, or either (coming back). */
export type JoinMode = "create" | "join" | "any";

export interface ServerMeetingHandlers {
  /** The server took this program in: its spectator seats per room. */
  onWelcome?: (seats: number) => void;
  onProblem: (problem: ServerProblem) => void;
}

/** How long the server has to answer before it counts as unreachable. */
const ANSWER_MS = 12_000;

const PROBLEMS = new Set<string>(["key", "version", "app", "busy", "missing", "exists", "full", "limit", "revoked"]);
const problemOf = (why: unknown): ServerProblem => (typeof why === "string" && PROBLEMS.has(why) ? (why as ServerProblem) : "closed");

/** The server as a network to meet in one room on: `mode` says how this program comes in. */
export function serverNetwork(server: ServerSettings, mode: JoinMode, handlers: ServerMeetingHandlers): Network {
  return { via: "server", join: ((_config: unknown, code: string) => joinServer(server, code, mode, handlers)) as unknown as Network["join"], relays: [server.address] };
}

function joinServer(server: ServerSettings, code: string, mode: JoinMode, handlers: ServerMeetingHandlers): Room {
  const peers = new Set<string>();
  const actions = new Map<string, MessageAction<JsonValue>>();
  let left = false;
  let welcomed = false;
  let reported = false;
  const report = (problem: ServerProblem) => {
    if (reported || left) return;
    reported = true;
    handlers.onProblem(problem);
  };
  let socket: WebSocket | null = null;
  const send = (message: object) => {
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
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
      socket?.close(1000);
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
  // Connect once the caller has set its handlers (rooms.ts sets them right after joining).
  setTimeout(() => {
    if (left) return;
    try {
      socket = new WebSocket(server.address);
    } catch {
      return report("unreachable");
    }
    const ws = socket;
    const timer = setTimeout(() => {
      if (!welcomed) {
        report("unreachable");
        ws.close();
      }
    }, ANSWER_MS);
    ws.onopen = () => send({ t: "hello", v: RELAY_PROTOCOL, app: APP_ID, key: server.key });
    ws.onmessage = (event: MessageEvent) => {
      if (left || typeof event.data !== "string") return;
      let m: Record<string, unknown>;
      try {
        m = JSON.parse(event.data) as Record<string, unknown>;
      } catch {
        return;
      }
      switch (m.t) {
        case "welcome":
          welcomed = true;
          clearTimeout(timer);
          handlers.onWelcome?.(typeof m.seats === "number" ? m.seats : 0);
          send({ t: "join", room: code, mode });
          break;
        case "joined":
          if (Array.isArray(m.peers)) for (const id of m.peers) if (typeof id === "string") meetPeer(id);
          break;
        case "peer":
          if (typeof m.id === "string") meetPeer(m.id);
          break;
        case "gone":
          if (typeof m.id === "string") losePeer(m.id);
          break;
        case "from":
          if (typeof m.id === "string" && peers.has(m.id)) {
            const action = actions.get("sve") ?? [...actions.values()][0];
            void action?.onMessage?.(m.d as JsonValue, { peerId: m.id } as Parameters<NonNullable<MessageAction<JsonValue>["onMessage"]>>[1]);
          }
          break;
        case "refused":
        case "nojoin":
        case "closed":
          report(problemOf(m.why));
          break;
        default:
          break;
      }
    };
    ws.onclose = (event: CloseEvent) => {
      clearTimeout(timer);
      if (left) return;
      // Why (a refusal was said before the close), then everyone in the room is gone for this program: a joining program
      // leaves the room with its link (rooms.ts), and would hear nothing more.
      report(!welcomed ? "unreachable" : event.code === 4008 ? "limit" : event.code === 4003 ? "revoked" : "closed");
      for (const id of [...peers]) losePeer(id);
    };
  }, 0);
  return room as unknown as Room;
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
