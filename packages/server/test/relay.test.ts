import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { constants, gunzipSync } from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { APP_ID, clientConfigText, newConfigText, newKey, readConfig, withKey, withoutKey, type ServerConfig } from "../src/config";
import { recordFiles } from "../src/records";
import { CLOSE, RELAY_PROTOCOL, startRelay, type Relay } from "../src/relay";

// The online server's relay (src/relay.ts): keys, rooms by code, messages passed in a room, comings and goings, the limits.

const KEY = "key-for-tests-1";
const OTHER = "key-for-tests-2";

function configWith(change: Partial<ServerConfig> = {}, limits: Partial<ServerConfig["limits"]> = {}): ServerConfig {
  const base = readConfig(`[keys]\nfriends = ${KEY}\nothers = ${OTHER}\n`).config;
  return { ...base, spectators: 2, ...change, limits: { ...base.limits, ...limits } };
}

let server: Server | null = null;
let relay: Relay | null = null;
const sockets: WebSocket[] = [];

afterEach(async () => {
  for (const ws of sockets.splice(0)) ws.terminate();
  relay?.close();
  relay = null;
  await new Promise<void>((done) => (server ? server.close(() => done()) : done()));
  server = null;
});

async function start(config: ServerConfig = configWith()): Promise<string> {
  server = createServer();
  relay = startRelay(server, config);
  await new Promise<void>((done) => server!.listen(0, "127.0.0.1", () => done()));
  return `ws://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

/** A program connected to the relay: what it was sent, in order, and how its connection closed. */
interface Client {
  ws: WebSocket;
  send(message: object): void;
  /** The next message of this kind (waits for it). */
  next(t: string): Promise<Record<string, unknown>>;
  closed: Promise<{ code: number; reason: string }>;
  received: Record<string, unknown>[];
}

function connect(url: string): Promise<Client> {
  const ws = new WebSocket(url);
  sockets.push(ws);
  const received: Record<string, unknown>[] = [];
  const waiting: { t: string; done: (m: Record<string, unknown>) => void }[] = [];
  let seen = 0;
  const closed = new Promise<{ code: number; reason: string }>((done) => ws.on("close", (code, reason) => done({ code, reason: reason.toString() })));
  ws.on("message", (data) => {
    const m = JSON.parse(data.toString()) as Record<string, unknown>;
    received.push(m);
    const at = waiting.findIndex((w) => w.t === m.t);
    if (at >= 0) waiting.splice(at, 1)[0]!.done(m);
  });
  const client: Client = {
    ws,
    received,
    closed,
    send: (message) => ws.send(JSON.stringify(message)),
    next: (t) => {
      // A message of this kind already here and not taken yet.
      const i = received.findIndex((m, k) => k >= seen && m.t === t);
      if (i >= 0) {
        seen = i + 1;
        return Promise.resolve(received[i]!);
      }
      return new Promise((done) =>
        waiting.push({
          t,
          done: (m) => {
            seen = received.indexOf(m) + 1;
            done(m);
          },
        }),
      );
    },
  };
  return new Promise((done, fail) => {
    ws.on("open", () => done(client));
    ws.on("error", fail);
  });
}

/** Connected and welcomed with this key. */
async function welcomed(url: string, key = KEY): Promise<Client & { id: string; seats: number }> {
  const c = await connect(url);
  c.send({ t: "hello", v: RELAY_PROTOCOL, app: APP_ID, key });
  const w = await c.next("welcome");
  return Object.assign(c, { id: w.id as string, seats: w.seats as number });
}

async function inRoom(url: string, room: string, mode: "create" | "join" | "any", key = KEY) {
  const c = await welcomed(url, key);
  c.send({ t: "join", room, mode });
  const answer = await Promise.race([c.next("joined"), c.next("nojoin")]);
  return Object.assign(c, { answer });
}

describe("the relay", () => {
  it("welcomes a program with a key (its id, the spectator seats), and refuses a wrong key, version or app", async () => {
    const url = await start();
    const ok = await welcomed(url);
    expect(ok.id).toMatch(/^[\w-]{12}$/);
    expect(ok.seats).toBe(2);
    for (const [hello, why] of [
      [{ t: "hello", v: RELAY_PROTOCOL, app: APP_ID, key: "wrong-key-123" }, "key"],
      [{ t: "hello", v: RELAY_PROTOCOL + 1, app: APP_ID, key: KEY }, "version"],
      [{ t: "hello", v: RELAY_PROTOCOL, app: "another-app", key: KEY }, "app"],
    ] as const) {
      const c = await connect(url);
      c.send(hello);
      expect((await c.next("refused")).why).toBe(why);
      expect((await c.closed).code).toBe(CLOSE.refused);
    }
    // Nothing but a hello is heard before it.
    const early = await connect(url);
    early.send({ t: "join", room: "ABCDEF", mode: "create" });
    early.send({ t: "hello", v: RELAY_PROTOCOL, app: APP_ID, key: KEY });
    await early.next("welcome");
    expect(early.received.map((m) => m.t)).toEqual(["welcome"]);
  });

  it("makes a room, lets others in, passes messages within it, and tells who comes and goes", async () => {
    const url = await start();
    const host = await inRoom(url, "HPXSZ3", "create");
    expect(host.answer).toEqual({ t: "joined", peers: [] });
    // The same code can't be made twice; a code nobody made can't be joined.
    expect((await inRoom(url, "HPXSZ3", "create")).answer).toEqual({ t: "nojoin", why: "exists" });
    expect((await inRoom(url, "NOSUCH", "join")).answer).toEqual({ t: "nojoin", why: "missing" });
    const guest = await inRoom(url, "HPXSZ3", "join");
    expect(guest.answer).toEqual({ t: "joined", peers: [host.id] });
    expect(await host.next("peer")).toEqual({ t: "peer", id: guest.id });
    // Messages go to the one they are for, from whom they came.
    guest.send({ t: "to", id: host.id, d: { t: "join", as: "player" } });
    expect(await host.next("from")).toEqual({ t: "from", id: guest.id, d: { t: "join", as: "player" } });
    host.send({ t: "to", id: guest.id, d: { t: "select" } });
    expect(await guest.next("from")).toEqual({ t: "from", id: host.id, d: { t: "select" } });
    // Another room's program can't be reached.
    const stranger = await inRoom(url, "OTHER1", "create");
    stranger.send({ t: "to", id: host.id, d: { t: "chat", text: "hi" } });
    host.send({ t: "to", id: guest.id, d: { n: 2 } });
    expect((await guest.next("from")).d).toEqual({ n: 2 });
    expect(host.received.filter((m) => m.t === "from")).toHaveLength(1);
    // "any": into the room there is (a spectator coming back).
    const watcher = await inRoom(url, "HPXSZ3", "any");
    expect(watcher.answer).toEqual({ t: "joined", peers: [host.id, guest.id] });
    guest.ws.close();
    expect(await host.next("gone")).toEqual({ t: "gone", id: guest.id });
    expect(await watcher.next("gone")).toEqual({ t: "gone", id: guest.id });
    // The last one out: the room is gone; "any" makes it again (the host coming back).
    host.ws.close();
    watcher.ws.close();
    await watcher.closed;
    await new Promise((done) => setTimeout(done, 50));
    expect((await inRoom(url, "HPXSZ3", "join")).answer).toEqual({ t: "nojoin", why: "missing" });
    expect((await inRoom(url, "HPXSZ3", "any")).answer).toEqual({ t: "joined", peers: [] });
  });

  it("has room for the two players, the spectator seats and two more; and as many rooms as max_rooms", async () => {
    const url = await start(configWith({ spectators: 2, maxRooms: 2 }));
    await inRoom(url, "ROOM01", "create");
    for (let i = 0; i < 5; i++) expect((await inRoom(url, "ROOM01", "join")).answer.t).toBe("joined");
    expect((await inRoom(url, "ROOM01", "join")).answer).toEqual({ t: "nojoin", why: "full" });
    expect((await inRoom(url, "ROOM02", "create")).answer.t).toBe("joined");
    expect((await inRoom(url, "ROOM03", "create")).answer).toEqual({ t: "nojoin", why: "busy" });
  });

  it("closes a connection over the limits: too many from one address, too fast, too large", async () => {
    const url = await start(configWith({}, { maxConnectionsPerIp: 2, messagesPerSecond: 1, maxMessageBytes: 2048 }));
    await welcomed(url);
    await welcomed(url);
    const third = await connect(url);
    expect((await third.next("refused")).why).toBe("busy");
    for (const s of sockets.splice(0)) s.close();
    await new Promise((done) => setTimeout(done, 100));
    // A burst of ten seconds' worth is fine; more is closed.
    const fast = await inRoom(url, "FAST01", "create");
    for (let i = 0; i < 12; i++) fast.send({ t: "to", id: "nobody", d: i });
    expect(await fast.next("closed")).toEqual({ t: "closed", why: "limit" });
    expect((await fast.closed).code).toBe(CLOSE.limit);
    const big = await inRoom(url, "BIG001", "create");
    big.send({ t: "to", id: "nobody", d: "x".repeat(4096) });
    expect((await big.closed).code).toBe(1009);
  });

  it("closes the connections of a key that was removed or changed, and takes a new key at once", async () => {
    const config = configWith();
    const url = await start(config);
    const friend = await inRoom(url, "ROOM01", "create");
    const other = await inRoom(url, "ROOM01", "join", OTHER);
    expect(relay!.status()).toMatchObject({ connections: 2, rooms: 1, keys: { friends: { connections: 1, connects: 1, rooms: 1 }, others: { connections: 1 } } });
    relay!.configure({ ...config, keys: new Map([["others", OTHER], ["new", "a-new-key-1"]]) });
    expect(await friend.next("closed")).toEqual({ t: "closed", why: "revoked" });
    expect((await friend.closed).code).toBe(CLOSE.revoked);
    expect(other.ws.readyState).toBe(WebSocket.OPEN);
    expect((await welcomed(url, "a-new-key-1")).seats).toBe(2);
    const refused = await connect(url);
    refused.send({ t: "hello", v: RELAY_PROTOCOL, app: APP_ID, key: KEY });
    expect((await refused.next("refused")).why).toBe("key");
    // The hour's numbers start again after they are taken.
    expect(relay!.takeHour().refused).toEqual({ key: 1 });
    expect(relay!.status().refused).toEqual({});
  });
});

describe("the lobby and the games kept", () => {
  const info = (over: Record<string, unknown> = {}) => ({ t: "info", name: "小明", format: "standard", list: "10_26_JPN", turnOrder: "choose", public: true, players: 1, watchers: 0, playing: false, ...over });

  it("lists the rooms their hosts made public, with what the host says of them, and follows their changes", async () => {
    const url = await start(configWith({ spectators: 3 }));
    const lobby = await welcomed(url);
    lobby.send({ t: "lobby" });
    expect(await lobby.next("rooms")).toEqual({ t: "rooms", rooms: [] });
    const host = await inRoom(url, "PUB001", "create");
    host.send(info({ name: "  小明\u0000\n的名字太长了一二三四五六七八九十  " }));
    const listed = (await lobby.next("rooms")).rooms as Record<string, unknown>[];
    expect(listed).toEqual([{ code: "PUB001", name: "小明 的名字太长了一二三四五六七", format: "standard", list: "10_26_JPN", turnOrder: "choose", players: 1, watchers: 0, playing: false, seats: 3 }]);
    // A private room isn't listed; only the host's word counts.
    const secret = await inRoom(url, "PRV001", "create");
    secret.send(info({ public: false, name: "秘密" }));
    const guest = await inRoom(url, "PUB001", "join");
    guest.send(info({ name: "冒名" }));
    host.send(info({ players: 2, playing: true }));
    const later = (await lobby.next("rooms")).rooms as Record<string, unknown>[];
    expect(later.map((r) => [r.code, r.name, r.players, r.playing])).toEqual([["PUB001", "小明", 2, true]]);
    // The host gone, the one left speaks for the room; everyone gone, it isn't listed.
    host.ws.close();
    await guest.next("gone");
    guest.send(info({ name: "小红" }));
    expect(((await lobby.next("rooms")).rooms as Record<string, unknown>[]).map((r) => r.name)).toEqual(["小红"]);
    guest.ws.close();
    expect(await lobby.next("rooms")).toEqual({ t: "rooms", rooms: [] });
    expect(relay!.status().lobby).toEqual({ following: 1, listed: 0 });
  });

  it("keeps a finished game once (both players send it), up to a key's day, in a file a month", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sve-records-"));
    try {
      const base = configWith();
      const config = { ...base, records: { ...base.records, dir, perKeyPerDay: 2 } };
      const url = await start(config);
      const a = await welcomed(url);
      expect(a.received[0]).toMatchObject({ records: true });
      const game = (id: string) => ({ t: "record", id, d: { id, inputs: [[0, { type: "mulligan", redraw: false }]], app: "0.3.0" } });
      a.send(game("seed-1"));
      expect(await a.next("recorded")).toEqual({ t: "recorded", id: "seed-1", kept: "kept" });
      const b = await welcomed(url);
      b.send(game("seed-1"));
      expect(await b.next("recorded")).toEqual({ t: "recorded", id: "seed-1", kept: "again" });
      a.send(game("seed-2"));
      await a.next("recorded");
      a.send(game("seed-3"));
      expect((await a.next("recorded")).kept).toBe("quota");
      const files = recordFiles(dir);
      expect(files.map((f) => [f.file.replace(/^.*[\\/]/, ""), f.games])).toEqual([[`${new Date().toISOString().slice(0, 7)}.jsonl.gz`, 2]]);
      const lines = gunzipSync(readFileSync(files[0]!.file), { finishFlush: constants.Z_SYNC_FLUSH }).toString().trim().split("\n").map((l) => JSON.parse(l));
      expect(lines.map((l) => [l.key, l.record.id])).toEqual([["friends", "seed-1"], ["friends", "seed-2"]]);
      expect(relay!.status().keys.friends!.records).toBe(2);
      // Turned off: nothing is kept, and the apps are told so when they connect.
      relay!.configure({ ...config, records: { ...config.records, enabled: false } });
      a.send(game("seed-4"));
      expect((await a.next("recorded")).kept).toBe("off");
      expect((await welcomed(url)).received[0]).toMatchObject({ records: false });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("the configuration file", () => {
  it("is read with defaults for what is missing or wrong, and says what was wrong", () => {
    const { config, problems } = readConfig("[server]\nport = 70000\nname = 北京\n[rooms]\nspectators = 12\n[keys]\nshort = abc\nok = 12345678\n");
    expect(config).toMatchObject({ name: "北京", port: 443, spectators: 12, maxRooms: 1000, tlsCert: null, keys: new Map([["ok", "12345678"]]) });
    expect(config.limits.maxMessageBytes).toBe(256 * 1024);
    expect(problems).toHaveLength(2);
  });

  it("a new server's file: its key, its certificate files, the defaults; the text an app needs", () => {
    const key = newKey();
    expect(key).toMatch(/^[\w-]{32}$/);
    const text = newConfigText("wss://203.0.113.7", "first", key, "/etc/sve-server/tls/fullchain.pem", "/etc/sve-server/tls/privkey.pem");
    const { config, problems } = readConfig(text);
    expect(problems).toEqual([]);
    expect(config).toMatchObject({ address: "wss://203.0.113.7", port: 443, tlsCert: "/etc/sve-server/tls/fullchain.pem", spectators: 10, keys: new Map([["first", key]]) });
    expect(clientConfigText(config, "first")).toContain(`address = wss://203.0.113.7\nkey = ${key}`);
    expect(clientConfigText(config, "nobody")).toBeNull();
  });

  it("keys are added, changed and removed without touching the rest of the file", () => {
    const text = "; my notes\n[server]\nport = 8443\n\n[keys]\n; friends\nqq = 11111111\n\n[limits]\nmax_rooms = 5\n";
    const added = withKey(text, "朋友A", "22222222");
    expect(added).toBe("; my notes\n[server]\nport = 8443\n\n[keys]\n; friends\nqq = 11111111\n朋友A = 22222222\n\n[limits]\nmax_rooms = 5\n");
    expect(withKey(added, "qq", "33333333")).toContain("qq = 33333333\n朋友A = 22222222");
    expect(withoutKey(added, "qq")).toBe("; my notes\n[server]\nport = 8443\n\n[keys]\n; friends\n朋友A = 22222222\n\n[limits]\nmax_rooms = 5\n");
    expect(withoutKey(added, "nobody")).toBeNull();
    expect(readConfig(withKey("[server]\nport = 1\n", "a", "44444444")).config.keys).toEqual(new Map([["a", "44444444"]]));
  });
});
