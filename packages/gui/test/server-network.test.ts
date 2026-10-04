import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { readConfig } from "../../server/src/config";
import { startRelay, type Relay } from "../../server/src/relay";
import type { PeerLink } from "../src/net/link";
import type { JoinAs, NetMessage } from "../src/net/messages";
import { meet, type Admission } from "../src/net/rooms";
import { checkServer, serverNetwork, type JoinMode, type ServerProblem } from "../src/net/server";
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

/** A program in room `code` on the server: its links, what each brought, the seats it was told, the problems it heard. */
function program(settings: ServerSettings, code: string, role: "host" | JoinAs, mode: JoinMode) {
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
    [serverNetwork(settings, mode, { onWelcome: (n) => (seats = n), onProblem: (p) => problems.push(p) })],
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
