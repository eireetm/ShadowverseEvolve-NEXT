import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { WebSocketServer } from "ws";
import { readConfig } from "../../server/src/config";
import { recordFiles } from "../../server/src/records";
import { startRelay, type Relay } from "../../server/src/relay";
import type { PeerLink } from "../src/net/link";
import { cleanName, parseMessage, type JoinAs, type NetMessage } from "../src/net/messages";
import { meet, type Admission } from "../src/net/rooms";
import { checkServer, serverNetwork, watchLobby, type JoinMode, type LobbyRoom, type ProblemAt, type RoomInfo, type ServerProblem, type ServerRoom } from "../src/net/server";
import { parseServerConfig, type ServerSettings } from "../src/net/server-config";

// The online server as a network rooms meet on (src/net/server.ts), against the server's own relay (packages/server) run
// here: the same room protocol as on the public networks (rooms.test.ts), the server's seats, and what it says when
// something is wrong — no such room, a code taken, a wrong key, no server there, the connection closed. And a room looked
// for on several servers (people of two servers playing together).

const KEY = "key-for-the-tests";
let server: Server | null = null;
let relay: Relay | null = null;
/** More servers (another relay each), for the rooms looked for on several. */
const others: { server: Server; relay: Relay }[] = [];
const meetings: { cancel(): void }[] = [];

afterEach(async () => {
  for (const m of meetings.splice(0)) m.cancel();
  relay?.close();
  relay = null;
  await new Promise<void>((done) => (server ? server.close(() => done()) : done()));
  server = null;
  for (const other of others.splice(0)) {
    other.relay.close();
    await new Promise<void>((done) => other.server.close(() => done()));
  }
});

/** The relay on a free port of this machine (plain ws://), with `seats` spectator seats a room. */
async function startServer(seats = 3): Promise<ServerSettings> {
  server = createServer();
  relay = startRelay(server, { ...readConfig(`[keys]\ntests = ${KEY}\n`).config, spectators: seats });
  await new Promise<void>((done) => server!.listen(0, "127.0.0.1", () => done()));
  return { name: "test", address: `ws://127.0.0.1:${(server.address() as AddressInfo).port}`, key: KEY };
}

/** Another server (its own relay and key, `seats` spectator seats a room): another group's. */
async function startAnother(seats = 3): Promise<{ settings: ServerSettings; relay: Relay }> {
  const key = "another-key-for-the-tests";
  const other = { server: createServer(), relay: null as unknown as Relay };
  other.relay = startRelay(other.server, { ...readConfig(`[keys]\nfriends = ${key}\n`).config, spectators: seats });
  await new Promise<void>((done) => other.server.listen(0, "127.0.0.1", () => done()));
  others.push(other);
  return { settings: { name: "another", address: `ws://127.0.0.1:${(other.server.address() as AddressInfo).port}`, key }, relay: other.relay };
}

const until = async (check: () => boolean, ms = 4000): Promise<void> => {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error("timed out");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
};

/**
 * A program in room `code` on the server (or looked for on each of several; with the room's `password`, if any): its links,
 * what each brought, the seats it was told, the problems it heard (and where), the server the room was found on.
 */
function program(settings: ServerSettings | ServerSettings[], code: string, role: "host" | JoinAs, mode: JoinMode, password: string | null = null) {
  const links: { link: PeerLink; as: JoinAs; got: NetMessage[]; closed: boolean }[] = [];
  const problems: ServerProblem[] = [];
  const where: ProblemAt[] = [];
  const found: ServerSettings[] = [];
  let seats = -1;
  let full = false;
  const open = (as: JoinAs) => links.filter((l) => l.as === as && !l.closed).length;
  const admit = (as: JoinAs): Admission => (as === "player" ? (open("player") > 0 ? "full" : "yes") : open("watch") < seats ? "yes" : "full");
  const meeting = meet(
    code,
    role,
    null,
    {
      onLink: (link, as) => {
        const entry = { link, as, got: [] as NetMessage[], closed: false };
        link.onMessage = (m) => entry.got.push(m);
        link.onClose = () => {
          entry.closed = true;
        };
        links.push(entry);
      },
      onFull: () => {
        full = true;
      },
      admit,
    },
    undefined,
    [
      serverNetwork(
        settings,
        mode,
        {
          onWelcome: (n) => (seats = n),
          onProblem: (p, at) => {
            problems.push(p);
            where.push(at);
          },
          onServer: (s) => found.push(s),
        },
        password,
      ),
    ],
  );
  meetings.push(meeting);
  return { links, meeting, problems, where, found, seats: () => seats, isFull: () => full, players: () => open("player"), watchers: () => open("watch") };
}

describe("rooms on the online server", () => {
  it("the host takes in the other player and as many spectators as the server says; messages go both ways", async () => {
    const settings = await startServer(2);
    const host = program(settings, "SRV001", "host", "create");
    await until(() => host.seats() === 2);
    const early = program(settings, "SRV001", "watch", "join");
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(early.links).toHaveLength(0);
    const guest = program(settings, "SRV001", "player", "join");
    await until(() => host.players() === 1 && guest.links.length === 1);
    // The spectator who came first is taken in once the other player is.
    await until(() => host.watchers() === 1 && early.links.length === 1);
    const late = program(settings, "SRV001", "watch", "join");
    await until(() => host.watchers() === 2 && late.links.length === 1);
    const third = program(settings, "SRV001", "watch", "join");
    const second = program(settings, "SRV001", "player", "join");
    await until(() => third.isFull() && second.isFull());
    expect([host.watchers(), host.players()]).toEqual([2, 1]);
    // Through the server, and said so.
    expect(guest.links[0]!.link.via).toBe("server");
    expect(await guest.links[0]!.link.route()).toBe("server");

    host.links.find((l) => l.as === "player")!.link.send({ t: "chat", text: "to the guest" });
    guest.links[0]!.link.send({ t: "chat", text: "to the host" });
    early.links[0]!.link.send({ t: "ping", n: 1 });
    await until(() => guest.links[0]!.got.length === 1 && host.links.find((l) => l.as === "player")!.got.length === 1);
    expect(guest.links[0]!.got).toEqual([{ t: "chat", text: "to the guest" }]);
    await until(() => host.links.find((l) => l.as === "watch" && l.got.length > 0) !== undefined);
    expect(late.links[0]!.got).toEqual([]);

    // The other player leaves: the host stays with its spectators; the other player comes back ("any": the room is there).
    guest.meeting.cancel();
    await until(() => host.players() === 0);
    const back = program(settings, "SRV001", "player", "any");
    await until(() => host.players() === 1 && back.links.length === 1);
    expect(host.problems).toEqual([]);
  });

  it("a room with a password takes only those who say it; a server too old for passwords makes no room with one", async () => {
    const settings = await startServer(2);
    const host = program(settings, "PASS01", "host", "create", "135790");
    await until(() => host.seats() === 2);
    const none = program(settings, "PASS01", "player", "join");
    const wrong = program(settings, "PASS01", "player", "join", "000000");
    await until(() => none.problems.length > 0 && wrong.problems.length > 0);
    expect([none.problems, wrong.problems, host.players()]).toEqual([["password"], ["password"], 0]);
    const guest = program(settings, "PASS01", "player", "join", "135790");
    await until(() => host.players() === 1 && guest.links.length === 1);
    const watcher = program(settings, "PASS01", "watch", "join", "135790");
    await until(() => host.watchers() === 1 && watcher.links.length === 1);
    // A server before 1.2.0 keeps no password: a room made with one would be open, so none is made; joining needs none.
    const old = new WebSocketServer({ port: 0, host: "127.0.0.1" });
    const joins: unknown[] = [];
    old.on("connection", (ws) =>
      ws.on("message", (data) => {
        const m = JSON.parse(String(data)) as { t: string };
        if (m.t === "hello") ws.send(JSON.stringify({ t: "welcome", v: 1, id: "old", seats: 2, records: false }));
        else if (m.t === "join") joins.push(m);
      }),
    );
    try {
      await new Promise<void>((done) => old.once("listening", () => done()));
      const oldSettings = { ...settings, address: `ws://127.0.0.1:${(old.address() as AddressInfo).port}` };
      const locked = program(oldSettings, "PASS02", "host", "create", "111111");
      await until(() => locked.problems.length > 0);
      expect(locked.problems).toEqual(["nopassword"]);
      program(oldSettings, "PASS03", "player", "join", "111111");
      await until(() => joins.length === 1);
      expect(joins).toEqual([{ t: "join", room: "PASS03", mode: "join", password: "111111" }]);
    } finally {
      old.close();
    }
  });

  it("says at once that a room isn't there, or is there already, or is full", async () => {
    const settings = await startServer(0);
    const nobody = program(settings, "NOROOM", "player", "join");
    await until(() => nobody.problems.length === 1);
    expect(nobody.problems).toEqual(["missing"]);
    program(settings, "TAKEN1", "host", "create");
    await new Promise((resolve) => setTimeout(resolve, 100));
    const again = program(settings, "TAKEN1", "host", "create");
    await until(() => again.problems.length === 1);
    expect(again.problems).toEqual(["exists"]);
    // No spectator seats: the two players and two more fit; the next is turned away by the server.
    for (let i = 0; i < 3; i++) program(settings, "TAKEN1", "player", "join");
    await new Promise((resolve) => setTimeout(resolve, 150));
    const crowd = program(settings, "TAKEN1", "watch", "join");
    await until(() => crowd.problems.length === 1);
    expect(crowd.problems).toEqual(["full"]);
  });

  it("says a wrong key, a server that isn't there, and a connection the server closed", async () => {
    const settings = await startServer();
    const wrong = program({ ...settings, key: "not-the-key-1" }, "ROOM01", "host", "create");
    await until(() => wrong.problems.length === 1);
    expect(wrong.problems).toEqual(["key"]);
    const host = program(settings, "ROOM01", "host", "create");
    const guest = program(settings, "ROOM01", "player", "join");
    await until(() => host.players() === 1 && guest.links.length === 1);
    // The server goes away: the links close, and why is said.
    relay!.close();
    await until(() => guest.links[0]!.closed && host.links[0]!.closed);
    await until(() => host.problems.length === 1 && guest.problems.length === 1);
    expect([host.problems, guest.problems]).toEqual([["closed"], ["closed"]]);
    await new Promise<void>((done) => server!.close(() => done()));
    server = null;
    const gone = program(settings, "ROOM02", "host", "create");
    await until(() => gone.problems.length === 1);
    expect(gone.problems).toEqual(["unreachable"]);
  });

  it("checks a server: it takes the key (the round trip, its seats), or why not", async () => {
    const settings = await startServer(7);
    expect(await checkServer(settings)).toMatchObject({ ok: true, seats: 7 });
    expect(await checkServer({ ...settings, key: "not-the-key-1" })).toEqual({ ok: false, problem: "key" });
    expect(await checkServer({ ...settings, address: "ws://127.0.0.1:9" })).toEqual({ ok: false, problem: "unreachable" });
  });
});

describe("rooms on several online servers", () => {
  /** A server nobody runs (its connections are refused). */
  const DOWN: ServerSettings = { name: "down", address: "ws://127.0.0.1:9", key: "a-key-nobody-takes" };

  it("a code is looked for on each server at once: the room is the one found, and said to be there", async () => {
    const mine = await startServer(2);
    const theirs = await startAnother(5);
    const host = program(theirs.settings, "TWO001", "host", "create");
    await until(() => host.seats() === 5);
    const guest = program([mine, theirs.settings], "TWO001", "player", "join");
    await until(() => host.players() === 1 && guest.links.length === 1);
    // On the other server: its seats, its connection; nothing left on the first one.
    expect([guest.found, guest.seats(), guest.problems]).toEqual([[theirs.settings], 5, []]);
    await until(() => relay!.status().connections === 0);
    const watcher = program([mine, theirs.settings], "TWO001", "watch", "join");
    await until(() => host.watchers() === 1 && watcher.links.length === 1);
    host.links.find((l) => l.as === "player")!.link.send({ t: "chat", text: "from the other server" });
    await until(() => guest.links[0]!.got.length === 1);
    expect(guest.links[0]!.got).toEqual([{ t: "chat", text: "from the other server" }]);
    // A room is made on one server only, the first one given.
    const second = program([theirs.settings, mine], "TWO002", "host", "create");
    await until(() => second.seats() === 5);
    expect([theirs.relay.status().rooms, relay!.status().rooms]).toEqual([2, 0]);
  });

  it("no such room anywhere; a server it couldn't be looked for on is said; one that has it says why not", async () => {
    const mine = await startServer();
    const theirs = await startAnother(4);
    const nowhere = program([mine, theirs.settings], "NONE01", "player", "join");
    await until(() => nowhere.problems.length === 1);
    expect([nowhere.problems, nowhere.where]).toEqual([["missing"], [{ server: null, unasked: null }]]);
    // One server can't be reached: the room isn't on the other, and may be on that one.
    const half = program([mine, DOWN], "NONE01", "player", "join");
    await until(() => half.problems.length === 1);
    expect([half.problems, half.where]).toEqual([["missing"], [{ server: null, unasked: { server: DOWN, problem: "unreachable" } }]]);
    // A locked room on the other server: its password, said of that server (and its seats).
    program(theirs.settings, "LOCK01", "host", "create", "246802");
    await until(() => theirs.relay.status().rooms === 1);
    const asked = program([mine, theirs.settings], "LOCK01", "watch", "join");
    await until(() => asked.problems.length === 1);
    expect([asked.problems, asked.where, asked.found, asked.seats()]).toEqual([["password"], [{ server: theirs.settings, unasked: null }], [theirs.settings], 4]);
    // No server takes this program: the first one's problem.
    const refused = program([{ ...mine, key: "not-the-key-1" }, DOWN], "NONE02", "player", "join");
    await until(() => refused.problems.length === 1);
    expect([refused.problems, refused.where]).toEqual([["key"], [{ server: { ...mine, key: "not-the-key-1" }, unasked: null }]]);
  });
});

describe("the server's lobby and the games it keeps", () => {
  const info = (over: Partial<RoomInfo> = {}): RoomInfo => ({ name: "小明", format: "standard", list: "10_26_JPN", turnOrder: "choose", public: true, players: 1, watchers: 0, playing: false, ...over });

  it("lists the rooms their hosts describe as public, and follows them; the room's handle comes once it is joined", async () => {
    const settings = await startServer(4);
    const seen: LobbyRoom[][] = [];
    const lobby = watchLobby(settings, (rooms) => seen.push(rooms), () => undefined);
    meetings.push({ cancel: () => lobby.close() });
    await until(() => seen.length === 1);
    expect(seen[0]).toEqual([]);
    let handle: ServerRoom | null = null;
    const host = meet("LOBBY1", "host", null, { onLink: () => undefined, onFull: () => undefined }, undefined, [
      serverNetwork(settings, "create", { onProblem: () => undefined, onRoom: (room) => (handle = room) }),
    ]);
    meetings.push(host);
    await until(() => handle !== null);
    handle!.describe(info());
    await until(() => seen.length === 2);
    expect(seen[1]).toEqual([{ code: "LOBBY1", name: "小明", format: "standard", list: "10_26_JPN", turnOrder: "choose", players: 1, watchers: 0, playing: false, seats: 4, locked: false }]);
    handle!.describe(info({ public: false }));
    await until(() => seen.length === 3);
    expect(seen[2]).toEqual([]);
    // The host leaves: nothing to list (and nothing changes for a private room).
    handle!.describe(info({ players: 2 }));
    await until(() => seen.length === 4);
    host.cancel();
    await until(() => seen.length === 5);
    expect(seen[4]).toEqual([]);
  });

  it("keeps a finished game sent by the players' programs once, and says whether it keeps games", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sve-gui-records-"));
    try {
      const base = readConfig(`[keys]\ntests = ${KEY}\n`).config;
      server = createServer();
      relay = startRelay(server, { ...base, records: { ...base.records, dir } });
      await new Promise<void>((done) => server!.listen(0, "127.0.0.1", () => done()));
      const settings: ServerSettings = { name: "test", address: `ws://127.0.0.1:${(server.address() as AddressInfo).port}`, key: KEY };
      const handles: ServerRoom[] = [];
      let records: boolean | null = null;
      for (const role of ["host", "player"] as const) {
        meetings.push(
          meet("KEEP01", role, null, { onLink: () => undefined, onFull: () => undefined }, undefined, [
            serverNetwork(settings, role === "host" ? "create" : "join", { onProblem: () => undefined, onWelcome: (_, r) => (records = r), onRoom: (room) => handles.push(room) }),
          ]),
        );
        await until(() => handles.length === (role === "host" ? 1 : 2));
      }
      expect(records).toBe(true);
      const game = { format: "sve-online-record", version: 1, replay: { options: { seed: "s1" }, inputs: [] } };
      expect(await handles[0]!.record("s1", game)).toBe("kept");
      expect(await handles[1]!.record("s1", game)).toBe("again");
      expect(recordFiles(dir).map((f) => f.games)).toEqual([1]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("names and sharing in the programs' hello", () => {
  it("are kept clean: no control characters, at most 16 characters; a watched game carries the players' names", () => {
    expect(cleanName("  小明\u0000‮  的\n名字 ")).toBe("小明 的 名字");
    expect(cleanName("一二三四五六七八九十一二三四五六七八")).toHaveLength(16);
    const hello = { t: "hello", version: "online-3", cards: "c", engine: "e", name: " 小红\u0007 ", share: true };
    expect(parseMessage(hello)).toEqual({ t: "hello", version: "online-3", cards: "c", engine: "e", name: "小红", share: true });
    expect(parseMessage({ ...hello, name: "", share: "yes" })).toEqual({ t: "hello", version: "online-3", cards: "c", engine: "e" });
  });
});

describe("the online server's configuration", () => {
  it("is the text its owner's program prints: the name, the address, the key; or nothing", () => {
    const text = "; comment\n[server]\nname = 北京\naddress = wss://203.0.113.7\nkey = abcdefgh12345678\n";
    expect(parseServerConfig(text)).toEqual({ servers: [{ name: "北京", address: "wss://203.0.113.7", key: "abcdefgh12345678" }], problems: [], parts: 1 });
    // No name: the address is the name; no server at all; a wrong address or no key said.
    expect(parseServerConfig("address = ws://127.0.0.1:7461\r\nkey = abcdefgh\r\n").servers[0]?.name).toBe("127.0.0.1:7461");
    expect(parseServerConfig("﻿; nothing here\n")).toEqual({ servers: [], problems: [], parts: 0 });
    expect(parseServerConfig("address = 203.0.113.7\nkey = short").problems).toEqual([
      { at: 1, problem: "serverConfig.badAddress" },
      { at: 1, problem: "serverConfig.noKey" },
    ]);
  });

  it("says several servers, a [server] part each, in its order; a wrong part is said by its place and left out", () => {
    const two = "[server]\nname = 北京\naddress = wss://203.0.113.7\nkey = abcdefgh12345678\n\n[server]\nname = 右手杯\naddress = wss://example.cn/sve-ws/\nkey = 12345678abcdefgh\n";
    const servers = [
      { name: "北京", address: "wss://203.0.113.7", key: "abcdefgh12345678" },
      { name: "右手杯", address: "wss://example.cn/sve-ws/", key: "12345678abcdefgh" },
    ];
    expect(parseServerConfig(two)).toEqual({ servers, problems: [], parts: 2 });
    // Another section (a server's own file's) says no server; the same server again, and a part without its key, are said.
    const more = `${two}[rooms]\nspectators = 10\n[server]\naddress = WSS://203.0.113.7/\nkey = zyxwvuts\n[server]\nname = 第三\naddress = wss://198.51.100.1\n`;
    expect(parseServerConfig(more)).toEqual({
      servers,
      problems: [
        { at: 3, problem: "serverConfig.twice" },
        { at: 4, problem: "serverConfig.noKey" },
      ],
      parts: 4,
    });
  });
});
