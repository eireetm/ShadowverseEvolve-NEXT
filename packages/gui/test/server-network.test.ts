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
import { checkServer, serverNetwork, watchLobby, type JoinMode, type LobbyRoom, type RoomInfo, type ServerProblem, type ServerRoom } from "../src/net/server";
import { parseServerConfig, type ServerSettings } from "../src/net/server-config";

// The online server as a network rooms meet on (src/net/server.ts), against the server's own relay (packages/server) run
// here: the same room protocol as on the public networks (rooms.test.ts), the server's seats, and what it says when
// something is wrong — no such room, a code taken, a wrong key, no server there, the connection closed.

const KEY = "key-for-the-tests";
let server: Server | null = null;
let relay: Relay | null = null;
const meetings: { cancel(): void }[] = [];

afterEach(async () => {
  for (const m of meetings.splice(0)) m.cancel();
  relay?.close();
  relay = null;
  await new Promise<void>((done) => (server ? server.close(() => done()) : done()));
  server = null;
});

/** The relay on a free port of this machine (plain ws://), with `seats` spectator seats a room. */
async function startServer(seats = 3): Promise<ServerSettings> {
  server = createServer();
  relay = startRelay(server, { ...readConfig(`[keys]\ntests = ${KEY}\n`).config, spectators: seats });
  await new Promise<void>((done) => server!.listen(0, "127.0.0.1", () => done()));
  return { name: "test", address: `ws://127.0.0.1:${(server.address() as AddressInfo).port}`, key: KEY };
}

const until = async (check: () => boolean, ms = 4000): Promise<void> => {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error("timed out");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
};

/**
 * A program in room `code` on the server (with the room's `password`, if any): its links, what each brought, the seats it was
 * told, the problems it heard.
 */
function program(settings: ServerSettings, code: string, role: "host" | JoinAs, mode: JoinMode, password: string | null = null) {
  const links: { link: PeerLink; as: JoinAs; got: NetMessage[]; closed: boolean }[] = [];
  const problems: ServerProblem[] = [];
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
    [serverNetwork(settings, mode, { onWelcome: (n) => (seats = n), onProblem: (p) => problems.push(p) }, password)],
  );
  meetings.push(meeting);
  return { links, meeting, problems, seats: () => seats, isFull: () => full, players: () => open("player"), watchers: () => open("watch") };
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
    expect(parseServerConfig(text)).toEqual({ server: { name: "北京", address: "wss://203.0.113.7", key: "abcdefgh12345678" }, problems: [] });
    // No name: the address is the name; no server at all; a wrong address or no key said.
    expect(parseServerConfig("address = ws://127.0.0.1:7461\r\nkey = abcdefgh\r\n").server?.name).toBe("127.0.0.1:7461");
    expect(parseServerConfig("﻿; nothing here\n")).toEqual({ server: null, problems: [] });
    expect(parseServerConfig("address = 203.0.113.7\nkey = short").problems).toEqual(["serverConfig.badAddress", "serverConfig.noKey"]);
  });
});
