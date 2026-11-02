// Random match ("随机匹配", a page of the online screen: online/RandomMatch.tsx). It follows the lobbies of all the online
// servers configured and goes, at random, to any public room without a password that plays the chosen format and restriction
// list; the room's other rules are its host's, and the chosen deck is made ready at once. A server may also list queues beside
// its rooms (people waiting on a site of its own, net/server.ts): the deck goes to the site, which checks it by its own rules.
// Taken, this program comes straight into the game's room, with the seat it was given; not taken, it isn't told why and goes on
// looking: a search doesn't end because of one place. Nothing found for a while, it makes a public room of its own, without a
// password, and goes on looking meanwhile, so that two people looking at the same time meet. What it goes to is chosen by
// random-choice.ts; the rooms are entered as a person would (net/online.ts), so a game begun is an online game like any other.
import { useSyncExternalStore } from "react";
import type { Catalog } from "../app/catalog";
import { getSettings } from "../app/settings";
import type { DeckFile } from "../decks/format";
import { listFingerprint, listProblem, restrictionList } from "../formats/lists";
import { cleanName, type Rules } from "./messages";
import { getOnline, hostRoom, joinRoom, leave, problemsUnder, ready, readyDeckOf, samePrograms, thisProgram } from "./online";
import { dueTargets, targetsOf, type RandomTarget, type RandomWanted } from "./random-choice";
import { seatServer, seekQueue, watchLobby, type LobbyQueue, type LobbyRoom, type ServerProblem } from "./server";
import type { ServerSettings } from "./server-config";
import { onGameStart, type OnlineState } from "./state";

/** How often the search looks at what has changed (the lobbies, the connection). */
const TICK_MS = 300;
/** Nothing found for this long (and up to as long again, so that two people don't do it at the same moment): a room of its own. */
const OWN_ROOM_AFTER_MS = 8000;
const OWN_ROOM_SPREAD_MS = 4000;
/** After a room that didn't work, or that couldn't be made: a moment before making one, for the lobbies to say what is new. */
const OWN_ROOM_AGAIN_MS = 2000;
/** A room's host has this long to take this program in; a queue's game longer (its other player learns of it by asking). */
const ENTER_ROOM_MS = 15_000;
const ENTER_GAME_MS = 30_000;
/** In a room: the game has to begin within this, or the search goes on (a host who went away, a guest who doesn't get ready). */
const MEET_MS = 60_000;
/** A room that didn't work isn't gone to again for this long. */
const SKIP_MS = 60_000;
/**
 * A queue that didn't take this program isn't asked again for this long. It isn't told why: it may be the deck, and it may be
 * that the person waiting has just been met by someone else.
 */
const REFUSED_MS = 30_000;

export type RandomStage =
  /** No search. */
  | "off"
  /** Looking (with a room of its own, waiting for someone, when `hosting`). */
  | "searching"
  /** Asking a queue's site. */
  | "asking"
  /** Going into a room. */
  | "entering"
  /** In a room with the other player: the game begins when both are ready. */
  | "meeting";

export interface RandomMatchState {
  stage: RandomStage;
  /** When the search began (ms since 1970). */
  since: number;
  hosting: boolean;
  /** The servers whose lobby can't be followed now, and why. */
  problems: readonly { server: ServerSettings; problem: ServerProblem }[];
}

const OFF: RandomMatchState = { stage: "off", since: 0, hosting: false, problems: [] };

let state: RandomMatchState = OFF;
const listeners = new Set<() => void>();

function setState(change: Partial<RandomMatchState>): void {
  state = { ...state, ...change };
  for (const listener of listeners) listener();
}

/** The search, as the page shows it. */
export function useRandomMatch(): RandomMatchState {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => state,
  );
}

interface Search {
  wanted: RandomWanted;
  deck: DeckFile;
  catalog: Catalog;
  servers: readonly ServerSettings[];
  lobbies: Map<string, { rooms: LobbyRoom[]; queues: LobbyQueue[]; problem: ServerProblem | null }>;
  closing: (() => void)[];
  /** Rooms and queues not to go to again before a time. */
  skipped: Map<string, number>;
  /** Rooms seen while having a room of its own: since when. */
  seen: Map<string, number>;
  /** Where this search is going (a room, a queue); null: nowhere, or waiting in its own room. */
  target: RandomTarget | null;
  /** When the stage began. */
  stageSince: number;
  /** When to make a room of its own, and on which of the servers (the next one after one that couldn't). */
  ownRoomAt: number;
  ownServer: number;
  ownRoom: { address: string; code: string } | null;
  /** The deck is being made ready. */
  readying: boolean;
}

let search: Search | null = null;

/** Begin looking for a game of this format and restriction list, with this deck, on these servers. */
export function startRandomMatch(wanted: RandomWanted, deck: DeckFile, catalog: Catalog, servers: readonly ServerSettings[]): void {
  if (search || servers.length === 0) return;
  // A connection left from before (the screen offers this search without one) would stand in the way.
  leave();
  const now = Date.now();
  const s: Search = {
    wanted,
    deck,
    catalog,
    servers,
    lobbies: new Map(),
    closing: [],
    skipped: new Map(),
    seen: new Map(),
    target: null,
    stageSince: now,
    ownRoomAt: now + OWN_ROOM_AFTER_MS + Math.random() * OWN_ROOM_SPREAD_MS,
    ownServer: 0,
    ownRoom: null,
    readying: false,
  };
  search = s;
  setState({ stage: "searching", since: now, hosting: false, problems: [] });
  for (const server of servers) {
    const heard = { rooms: [] as LobbyRoom[], queues: [] as LobbyQueue[], problem: null as ServerProblem | null };
    s.lobbies.set(server.address, heard);
    const lobby = watchLobby(
      server,
      (rooms) => {
        heard.rooms = rooms;
      },
      (problem) => {
        heard.problem = problem;
        if (search === s) setState({ problems: servers.flatMap((one) => (s.lobbies.get(one.address)?.problem ? [{ server: one, problem: s.lobbies.get(one.address)!.problem! }] : [])) });
      },
      (queues) => {
        heard.queues = queues;
      },
    );
    s.closing.push(() => lobby.close());
  }
  const timer = window.setInterval(tick, TICK_MS);
  s.closing.push(() => window.clearInterval(timer));
  // A game begun is what the search was for: the game screen shows by itself, and the room goes on as any room after it.
  s.closing.push(onGameStart(endSearch));
}

function endSearch(): void {
  const s = search;
  if (!s) return;
  search = null;
  for (const close of s.closing) close();
  state = OFF;
  for (const listener of listeners) listener();
}

/** Stop looking: the room this search made or went to is left (a game that has begun goes on: it isn't this search's any more). */
export function stopRandomMatch(): void {
  if (!search) return;
  const begun = getOnline().game !== null;
  endSearch();
  if (!begun) leave();
}

function tick(): void {
  const s = search;
  if (!s) return;
  const online = getOnline();
  if (online.game) return endSearch();
  const now = Date.now();
  if (state.stage === "searching") look(s, online, now);
  else if (state.stage === "entering") entering(s, online, now);
  else if (state.stage === "meeting") meeting(s, online, now);
}

function enter(stage: RandomStage, s: Search, change: Partial<RandomMatchState> = {}): void {
  s.stageSince = Date.now();
  setState({ stage, ...change });
}

/** What the lobbies offer now, that this search may go to. */
function targets(s: Search, now: number): RandomTarget[] {
  const lobbies = s.servers.map((server) => ({ server, rooms: s.lobbies.get(server.address)?.rooms ?? [], queues: s.lobbies.get(server.address)?.queues ?? [] }));
  return targetsOf(lobbies, s.wanted, s.ownRoom, (key) => (s.skipped.get(key) ?? 0) > now);
}

function look(s: Search, online: OnlineState, now: number): void {
  const { phase, room } = online;
  // Someone came to its own room.
  if (phase.kind === "connected") return enter("meeting", s);
  if (s.ownRoom && phase.kind !== "hosting") {
    // It couldn't be made there, or it is gone: the next server, in a moment.
    forgetOwnRoom(s, now);
    s.ownServer += 1;
  }
  // A code that was taken is drawn again (net/online.ts).
  if (s.ownRoom && room) s.ownRoom.code = room.code;
  const found = targets(s, now);
  const due = s.ownRoom ? dueTargets(found, s.ownRoom.code, s.seen, now) : found;
  const target = due[Math.floor(Math.random() * due.length)];
  if (target) return goTo(s, target);
  // A room of its own, on a server whose lobby it can follow.
  const servers = s.servers.filter((server) => !s.lobbies.get(server.address)?.problem);
  if (s.ownRoom || now < s.ownRoomAt || servers.length === 0) return;
  const server = servers[s.ownServer % servers.length]!;
  hostRoom(undefined, false, server, true);
  s.ownRoom = { address: server.address, code: getOnline().room?.code ?? "" };
  setState({ hosting: true });
}

function forgetOwnRoom(s: Search, now: number): void {
  leave();
  s.ownRoom = null;
  s.seen.clear();
  s.ownRoomAt = Math.max(s.ownRoomAt, now + OWN_ROOM_AGAIN_MS);
  setState({ hosting: false });
}

function goTo(s: Search, target: RandomTarget): void {
  s.target = target;
  s.ownRoom = null;
  s.seen.clear();
  if (target.kind === "room") {
    enter("entering", s, { hosting: false });
    joinRoom(target.room.code, target.server, false, null);
    return;
  }
  // Its own room is gone before the site makes a game with this program: nobody can come to it meanwhile.
  leave();
  enter("asking", s, { hosting: false });
  void ask(s, target, target.queue);
}

async function ask(s: Search, target: RandomTarget, queue: LobbyQueue): Promise<void> {
  const list = restrictionList(s.wanted.list);
  const sought = await seekQueue(target.server, queue.id, {
    name: cleanName(getSettings().playerName),
    share: getSettings().shareGames,
    deck: readyDeckOf(s.deck, s.wanted, s.catalog),
    ...thisProgram(),
    listHash: list ? listFingerprint(list) : null,
  });
  if (search !== s) return;
  if (!sought) {
    const now = Date.now();
    s.skipped.set(target.key, now + REFUSED_MS);
    s.target = null;
    s.ownRoomAt = Math.max(s.ownRoomAt, now + OWN_ROOM_AGAIN_MS);
    enter("searching", s);
    return;
  }
  enter("entering", s);
  joinRoom(sought.room, seatServer(target.server, sought), false, null);
}

function entering(s: Search, online: OnlineState, now: number): void {
  const { phase } = online;
  if (phase.kind === "connected") return enter("meeting", s);
  const wait = s.target?.kind === "queue" ? ENTER_GAME_MS : ENTER_ROOM_MS;
  if (phase.kind !== "joining" || now - s.stageSince > wait) goOn(s, now);
}

function meeting(s: Search, online: OnlineState, now: number): void {
  const { phase, prep } = online;
  if (phase.kind !== "connected") return goOn(s, now);
  const same = samePrograms(phase.peer);
  const rules = prep.rules;
  // Another version of the program, or a host who changed the game looked for (or whose list this program has another version of).
  if (same === false || (rules && (rules.format !== s.wanted.format || rules.list !== s.wanted.list || listProblem(rules) !== null))) return goOn(s, now);
  if (now - s.stageSince > MEET_MS && !prep.starting) return goOn(s, now);
  if (same === true && rules && !prep.mine && !s.readying) void makeReady(s, rules, now);
}

/** The chosen deck, ready in this room (again if the host's rules changed: the other rules are the host's to change). */
async function makeReady(s: Search, rules: Rules, now: number): Promise<void> {
  s.readying = true;
  const problems = await problemsUnder(rules, s.deck, s.catalog);
  s.readying = false;
  if (search !== s || state.stage !== "meeting" || getOnline().prep.rules !== rules || getOnline().prep.mine) return;
  if (problems.length > 0) return goOn(s, now);
  await ready(readyDeckOf(s.deck, rules, s.catalog));
}

/** This room didn't work: leave it, not to come back soon, and go on looking. */
function goOn(s: Search, now: number): void {
  if (s.target) s.skipped.set(s.target.key, now + SKIP_MS);
  s.target = null;
  s.readying = false;
  forgetOwnRoom(s, now);
  enter("searching", s);
}
