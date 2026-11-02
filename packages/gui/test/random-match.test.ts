import { describe, expect, it } from "vitest";
import { dueTargets, queueFits, roomFits, switchDelay, targetsOf, type LobbyHeard, type RandomWanted } from "../src/net/random-choice";
import type { LobbyQueue, LobbyRoom } from "../src/net/server";

const WANTED: RandomWanted = { format: "standard", list: "10_26_JPN" };

function room(code: string, change: Partial<LobbyRoom> = {}): LobbyRoom {
  return { code, name: "host", format: "standard", list: "10_26_JPN", turnOrder: "choose", players: 1, watchers: 0, playing: false, seats: 2, ...change };
}

const server = (address: string) => ({ name: address, address, key: "a test key" });

function lobby(address: string, rooms: LobbyRoom[], queues: LobbyQueue[] = []): LobbyHeard {
  return { server: server(address), rooms, queues };
}

describe("what the random match may go to", () => {
  it("a public room of the same format and list, without a password, with the other player's seat free", () => {
    expect(roomFits(room("A"), WANTED)).toBe(true);
    expect(roomFits(room("A", { locked: false }), WANTED)).toBe(true);
    expect(roomFits(room("A", { locked: true }), WANTED)).toBe(false);
    expect(roomFits(room("A", { playing: true }), WANTED)).toBe(false);
    expect(roomFits(room("A", { players: 2 }), WANTED)).toBe(false);
    expect(roomFits(room("A", { format: "crossover" }), WANTED)).toBe(false);
    expect(roomFits(room("A", { list: "08_26_CHN" }), WANTED)).toBe(false);
    expect(roomFits(room("A", { list: null }), WANTED)).toBe(false);
    // The room's other rules are its host's.
    expect(roomFits(room("A", { turnOrder: "player1" }), WANTED)).toBe(true);
    // No list is a choice too.
    expect(roomFits(room("A", { list: null }), { format: "standard", list: null })).toBe(true);
  });

  it("a queue waiting for the same format and list", () => {
    expect(queueFits({ id: "jp", format: "standard", list: "10_26_JPN" }, WANTED)).toBe(true);
    expect(queueFits({ id: "cn", format: "standard", list: "08_26_CHN" }, WANTED)).toBe(false);
    expect(queueFits({ id: "x", format: "crossover", list: "10_26_JPN" }, WANTED)).toBe(false);
  });

  it("from all the servers, but its own room and what it was told to skip", () => {
    const lobbies = [lobby("ws://a", [room("A"), room("OWN"), room("L", { locked: true })], [{ id: "jp", format: "standard", list: "10_26_JPN" }]), lobby("ws://b", [room("OWN"), room("B")])];
    const keys = (own: { address: string; code: string } | null, skip: (key: string) => boolean = () => false) => targetsOf(lobbies, WANTED, own, skip).map((target) => target.key);
    expect(keys(null)).toEqual(["ws://a room A", "ws://a room OWN", "ws://a queue jp", "ws://b room OWN", "ws://b room B"]);
    // The same code on another server is another room.
    expect(keys({ address: "ws://a", code: "OWN" })).toEqual(["ws://a room A", "ws://a queue jp", "ws://b room OWN", "ws://b room B"]);
    expect(keys(null, (key) => key.includes("queue") || key.endsWith("A"))).toEqual(["ws://a room OWN", "ws://b room OWN", "ws://b room B"]);
  });

  it("two people with a room each meet in one of them: the larger code leaves first", () => {
    expect(switchDelay("B", "A")).toBeLessThan(switchDelay("A", "B"));
  });

  it("with a room of its own: a queue at once, a room after its wait, the wait begun again when the room comes back", () => {
    const seen = new Map<string, number>();
    const targets = targetsOf([lobby("ws://a", [room("A"), room("Z")], [{ id: "jp", format: "standard", list: "10_26_JPN" }])], WANTED, null, () => false);
    const due = (at: number, from = targets) => dueTargets(from, "M", seen, at).map((target) => target.key);
    expect(due(1000)).toEqual(["ws://a queue jp"]);
    // "M" is larger than "A": it goes there soon; "Z" is larger than "M": it is the one to come here, so it waits longer.
    expect(due(1000 + switchDelay("M", "A"))).toEqual(["ws://a room A", "ws://a queue jp"]);
    expect(due(1000 + switchDelay("M", "Z"))).toEqual(["ws://a room A", "ws://a room Z", "ws://a queue jp"]);
    // Gone from the lobby, then back: seen anew.
    expect(due(9000, targets.slice(1))).toEqual(["ws://a room Z", "ws://a queue jp"]);
    expect(due(9000)).toEqual(["ws://a room Z", "ws://a queue jp"]);
  });
});
