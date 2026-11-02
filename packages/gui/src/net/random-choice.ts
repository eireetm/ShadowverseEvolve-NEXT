// What the random match (random-match.ts) may go to, from the online servers' lobbies: without connections, for the tests.
import type { FormatId } from "../engine/protocol";
import type { LobbyQueue, LobbyRoom } from "./server";
import type { ServerSettings } from "./server-config";

/** The game looked for: its format and restriction list (the room's other rules are its host's). */
export interface RandomWanted {
  format: FormatId;
  list: string | null;
}

/** One server's lobby, as it last said. */
export interface LobbyHeard {
  server: ServerSettings;
  rooms: readonly LobbyRoom[];
  queues: readonly LobbyQueue[];
}

/** A room to enter, or a queue to go to. `key` says which, across the servers. */
export type RandomTarget = { kind: "room"; key: string; server: ServerSettings; room: LobbyRoom } | { kind: "queue"; key: string; server: ServerSettings; queue: LobbyQueue };

/** A public room this program can enter: of the game looked for, without a password, with the other player's seat free. */
export function roomFits(room: LobbyRoom, wanted: RandomWanted): boolean {
  return room.format === wanted.format && room.list === wanted.list && room.locked !== true && !room.playing && room.players < 2;
}

/** Whether a queue waits for the game looked for. */
export function queueFits(queue: LobbyQueue, wanted: RandomWanted): boolean {
  return queue.format === wanted.format && queue.list === wanted.list;
}

/** Everything the lobbies offer for the game looked for, but this program's own room and what `skip` says not to go to. */
export function targetsOf(lobbies: readonly LobbyHeard[], wanted: RandomWanted, own: { address: string; code: string } | null, skip: (key: string) => boolean): RandomTarget[] {
  const targets: RandomTarget[] = [];
  for (const { server, rooms, queues } of lobbies) {
    for (const room of rooms) {
      if (!roomFits(room, wanted) || (own?.address === server.address && own.code === room.code)) continue;
      targets.push({ kind: "room", key: `${server.address} room ${room.code}`, server, room });
    }
    for (const queue of queues) {
      if (queueFits(queue, wanted)) targets.push({ kind: "queue", key: `${server.address} queue ${queue.id}`, server, queue });
    }
  }
  return targets.filter((target) => !skip(target.key));
}

/**
 * How long a program with a room of its own waits, once it sees another room, before leaving its own for it. Two people who
 * made a room at the same moment meet in one of them: the larger code goes first, and the other one has someone coming before
 * its own wait is over. A room whose host isn't looking (one made by hand) gets someone either way.
 */
export function switchDelay(ownCode: string, otherCode: string): number {
  return ownCode > otherCode ? 1000 : 5000;
}

/**
 * What a program with a room of its own may leave it for now: a queue at once, a room once it has been seen for its wait
 * (`seen`: when each one was first seen, kept up to date here).
 */
export function dueTargets(targets: readonly RandomTarget[], ownCode: string, seen: Map<string, number>, now: number): RandomTarget[] {
  for (const key of [...seen.keys()]) if (!targets.some((target) => target.key === key)) seen.delete(key);
  return targets.filter((target) => {
    if (target.kind === "queue") return true;
    const first = seen.get(target.key) ?? now;
    seen.set(target.key, first);
    return now - first >= switchDelay(ownCode, target.room.code);
  });
}
