// Online play, in the online screen's module: making the connection (a room code on the public networks or on the online
// server, or codes passed by hand), preparing a game (the host's rules, each player's locked deck, a seed both players make),
// and the game itself: this program's answers go to the other program, the other's come to this engine worker, each with the
// sender's state (engine/game-host.ts). After a lost connection, the same room connects again and the answers the other side
// is missing are sent again. Spectators ("观战": two seats a room on the public networks, as many as the online server says
// on it) join the host's room: the host tells them the game (its options and its inputs so far) and passes on both players'
// answers and the chat; they can't do anything else. Each program says its person's name (the other player's and the
// spectators' screens show it) and whether they let the online server keep their games. On the server, the host describes
// its room for the lobby (its name, the rules, who is in), and a finished game both players let it keep is sent to it (both
// programs send it: the server keeps it once). In a room that allows it, a player takes back their last answer while the other
// player hasn't answered since: the other program checks that and takes it back too, then the asker does — both play the
// same inputs again (and the host's spectators follow). The state lives in net/state.ts.
import type { Catalog } from "../app/catalog";
import { getSettings, subscribeSettings } from "../app/settings";
import { engine, getApp } from "../app/store";
import { APP_VERSION, PLATFORM } from "../app/version";
import { DECK_FORMAT, toDeckList, type DeckFile } from "../decks/format";
import type { FromWorker, GameOptions, RecordedInput } from "../engine/protocol";
import { checkDeck } from "../formats/check";
import { leadersFor, type FormatProblem } from "../formats/formats";
import { listFingerprint, restrictionList } from "../formats/lists";
import { newRoomCode, newRoomPassword } from "./codes";
import type { PeerLink } from "./link";
import { answerConnection, BadCodeError, offerConnection, type ManualAttempt } from "./manual";
import type { MessageKey } from "../i18n";
import { BACKLOG_PIECE, CHAT_MAX, cleanName, MAX_SPECTATOR_SEATS, SPECTATOR_SEATS, watchedOptions, type Hello, type JoinAs, type NetMessage, type ReadyDeck, type Rules, type WatchedGame } from "./messages";
import type { TurnServer } from "./relays";
import { meet, type Admission, type Meeting, type MeetingHandlers } from "./rooms";
import { serverNetwork, type JoinMode, type ServerProblem, type ServerRoom } from "./server";
import { currentServer } from "./server-config";
import { currentLink, gameStarted, getOnline, NO_PREP, setChatRelay, setLink, setOnline, setUndoRequest, type OnlineRole, type Prep } from "./state";

export { sendChat, useOnline, getOnline, canChat, type OnlinePhase } from "./state";

/** The protocol these messages follow (a program with another one can't play with this one, or watch its games). */
export const PROTOCOL = "online-5";

declare const __ENGINE_FINGERPRINT__: string;
/** The rules code's fingerprint (vite.config.ts); "dev" where the build didn't make one (tests). */
export const ENGINE = typeof __ENGINE_FINGERPRINT__ === "string" ? __ENGINE_FINGERPRINT__ : "dev";

/** This program's person's name, as shown ("": none given). */
const myName = (): string => cleanName(getSettings().playerName);

/** What this program tells the other one: who it is (the card data's fingerprint once the catalog is known), its person. */
function helloOf(cards: string): Hello {
  const name = myName();
  return { t: "hello", version: PROTOCOL, cards, engine: ENGINE, app: APP_VERSION, platform: PLATFORM, ...(name ? { name } : {}), share: getSettings().shareGames };
}

let hello: Hello = helloOf("");

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const randomHex = (bytes: number): string => [...crypto.getRandomValues(new Uint8Array(bytes))].map((b) => b.toString(16).padStart(2, "0")).join("");

/**
 * A short fingerprint of the card pool (definitions and how complete their scripts are): two programs play the same cards.
 * The restriction lists don't count: only the one a room uses has to be the same, and the rules say which (listProblem).
 */
export async function cardsFingerprint(catalog: Catalog): Promise<string> {
  return (await sha256(JSON.stringify({ cards: catalog.cards.map((card) => [card.id, card.status]) }))).slice(0, 16);
}

export { listProblem } from "../formats/lists";

export async function identify(catalog: Catalog): Promise<void> {
  hello = helloOf(await cardsFingerprint(catalog));
  // Connected before the fingerprint was ready: the other side learns it now.
  currentLink()?.send(hello);
  for (const w of watchers) w.link.send(hello);
}

// The person changed their name, whether the server may keep their games, or whether their rooms are public: the other
// side hears it, the game shows it, the lobby lists it.
subscribeSettings(() => {
  const next = helloOf(hello.cards);
  if (next.name !== hello.name || next.share !== hello.share) {
    hello = next;
    currentLink()?.send(hello);
    for (const w of watchers) w.link.send(hello);
    nameTheGame();
  }
  describeRoom();
});

/** The other program, as it last said (it stays known after the connection is gone: the game it played is still shown). */
let lastPeer: Hello | null = null;

/** The players' names of the game this program plays: its person's at its seat, the other's at the other seat. */
function nameTheGame(): void {
  const game = getOnline().game;
  if (!game || game.seat === null) return;
  const mine = myName();
  const theirs = lastPeer?.name ?? "";
  setOnline({ names: game.seat === 0 ? [mine, theirs] : [theirs, mine] });
}

/** Whether the other program can play with this one (null: not known yet). A spectator's must be the same too. */
export function samePrograms(peer: Hello | null): boolean | null {
  return peer === null || hello.cards === "" ? null : peer.version === hello.version && peer.cards === hello.cards && peer.engine === hello.engine;
}

/** A deck file locked for a game: the leader the engine plays with, the other one shown (Cross Craft, formats.ts leadersFor). */
export function readyDeckOf(deck: DeckFile, rules: Rules, catalog: Catalog): ReadyDeck {
  const { leader, second } = leadersFor(deck, rules.format, catalog);
  return { name: deck.name, deck: toDeckList(deck, leader), leader2: second };
}

/** The deck file a locked deck came from (as far as the check needs it). */
function deckFileOf(ready: ReadyDeck): DeckFile {
  const counts = (cards: readonly string[]) => {
    const out: Record<string, number> = {};
    for (const card of cards) out[card] = (out[card] ?? 0) + 1;
    return out;
  };
  return {
    format: DECK_FORMAT,
    version: 1,
    name: ready.name,
    ...(ready.deck.leader ? { leader: ready.deck.leader } : {}),
    ...(ready.leader2 ? { leader2: ready.leader2 } : {}),
    main: counts(ready.deck.main),
    evolve: counts(ready.deck.evolve),
  };
}

/** A deck's problems under the game's rules (the check the deck's own program made before sending it, made here again). */
export function problemsUnder(rules: Rules, deck: DeckFile, catalog: Catalog): Promise<FormatProblem[]> {
  return checkDeck(deck, rules.format, restrictionList(rules.list), catalog);
}

// The attempt under way, and the connection. The host's room (`meeting`) stays while it is connected: spectators come to it,
// and the other player comes back to it after a lost connection.
let meeting: Meeting | null = null;
let attempt: (ManualAttempt & { accept?: (reply: string) => Promise<void> }) | null = null;
let pinger: number | null = null;
let pingSent = new Map<number, number>();
let pingSeq = 0;
/** When the other side last answered a ping, and how many pings it hasn't answered since. */
let lastPong = 0;
let unanswered = 0;
/** A spectator: after a lost connection, it looks for the host's room again by itself (this timer). */
let rewatch: number | null = null;

const turn = (): TurnServer | null => {
  const t = getSettings().turn;
  return t.urls.trim() !== "" ? t : null;
};

function stopLooking(): void {
  meeting?.cancel();
  meeting = null;
  serverRoom = null;
  attempt?.cancel();
  attempt = null;
  if (rewatch !== null) window.clearTimeout(rewatch);
  rewatch = null;
}

function disconnect(): void {
  endAsking();
  if (pinger !== null) window.clearInterval(pinger);
  pinger = null;
  pingSent = new Map();
  const link = currentLink();
  if (link) {
    link.onClose = null;
    link.onMessage = null;
    link.close();
  }
  setLink(null);
}

/** Whether a game over the connection is being played (not over yet). */
function playing(): boolean {
  const update = getApp().update;
  return getOnline().game !== null && update?.online != null && !update.result;
}

/** Whether leaving now would concede a game in progress (the screens ask first). A spectator concedes nothing. */
export const leavingConcedes = (): boolean => playing() && getOnline().game?.seat !== null;

const setPrep = (change: Partial<Prep>): void => setOnline({ prep: { ...getOnline().prep, ...change } });

/** Keep measuring the round trip on the connection, and notice when it is gone (no answer for a while). */
function startPinging(peer: PeerLink, lost: () => void): void {
  lastPong = performance.now();
  unanswered = 0;
  const ping = () => {
    // A network that dropped may leave the connection open for half a minute: no answer for a while means it is gone. (Pings
    // unanswered, not only time: a hidden tab runs its timers late.)
    if (unanswered >= 4 && performance.now() - lastPong > 15_000) return lost();
    const n = ++pingSeq;
    pingSent.set(n, performance.now());
    unanswered++;
    peer.send({ t: "ping", n });
  };
  ping();
  pinger = window.setInterval(ping, 3000);
  // The route is known once the connection has settled.
  for (const ms of [800, 4000]) {
    window.setTimeout(() => {
      if (currentLink() !== peer) return;
      void peer.route().then((route) => {
        const phase = getOnline().phase;
        if (currentLink() === peer && phase.kind === "connected") setOnline({ phase: { ...phase, route } });
      });
    }, ms);
  }
}

function pong(n: number): void {
  const phase = getOnline().phase;
  const sentAt = pingSent.get(n);
  pingSent.delete(n);
  lastPong = performance.now();
  unanswered = 0;
  if (sentAt !== undefined && phase.kind === "connected") setOnline({ phase: { ...phase, rtt: Math.round(performance.now() - sentAt) } });
}

/** Connected to the other player: say who this program is, keep measuring the round trip, answer; a game in progress goes on. */
function connected(role: "host" | "guest", peer: PeerLink): void {
  // A joining program's room now belongs to its link (closing the link leaves it); the host keeps its room.
  if (role === "guest") meeting = null;
  attempt = null;
  disconnect();
  setLink(peer);
  const game = getOnline().game;
  const going = playing();
  resetSeed();
  setOnline({
    phase: { kind: "connected", role, via: peer.via, route: "unknown", rtt: null, peer: null },
    error: null,
    // A new connection prepares a new game (the host's rules again); after a lost one, the game in progress goes on.
    ...(going ? { prep: { ...getOnline().prep, starting: false } } : { chat: [], prep: { ...NO_PREP, rules: role === "host" ? hostRules() : null } }),
  });
  const lost = () => {
    disconnect();
    resetSeed();
    setOnline({ phase: { kind: "closed", reason: "lost" }, prep: { ...getOnline().prep, starting: false } });
    describeRoom();
  };
  peer.onMessage = (message) => void receive(message);
  peer.onClose = lost;
  peer.send(hello);
  if (role === "host") {
    sendRules();
    peer.send({ t: "watchers", n: watchers.length });
    describeRoom();
  }
  if (going && game) peer.send({ t: "resume", game: game.id, have: getApp().update?.inputCount ?? 0 });
  startPinging(peer, lost);
}

async function receive(message: NetMessage): Promise<void> {
  const state = getOnline();
  const phase = state.phase;
  if (phase.kind !== "connected") return;
  const link = currentLink();
  switch (message.t) {
    case "hello":
      lastPeer = message;
      setOnline({ phase: { ...phase, peer: message } });
      nameTheGame();
      await seedStep();
      break;
    case "chat":
      // A spectator's line, passed on by the host (the guest's side), or the other player's.
      if (message.watcher !== undefined && phase.role === "guest") {
        setOnline({ chat: [...state.chat, { from: "watcher" as const, name: message.watcher, text: message.text }].slice(-200) });
        break;
      }
      setOnline({ chat: [...state.chat, { from: "peer" as const, text: message.text }].slice(-200) });
      // The host's spectators read the other player's lines too (the other player is player 2).
      if (phase.role === "host") toWatchers({ t: "chat", text: message.text, seat: 1 });
      break;
    case "ping":
      link?.send({ t: "pong", n: message.n });
      break;
    case "pong":
      pong(message.n);
      break;
    case "watchers":
      if (phase.role === "guest") setOnline({ watchers: message.n });
      break;
    case "bye":
      disconnect();
      resetSeed();
      setOnline({ phase: { kind: "closed", reason: "left" }, prep: { ...state.prep, starting: false } });
      break;
    case "rules":
      // The host set (or changed) the rules: decks are checked again, so nobody is ready any more.
      if (phase.role === "guest") {
        resetSeed();
        const wasReady = state.prep.mine !== null;
        setOnline({ prep: { ...NO_PREP, rules: message.rules } });
        if (wasReady) link?.send({ t: "ready", deck: null });
      }
      break;
    case "ready": {
      if (!message.deck) {
        resetSeed();
        setPrep({ theirs: null, theirsProblems: null, starting: false });
        break;
      }
      setPrep({ theirs: message.deck, theirsProblems: null });
      const { rules } = getOnline().prep;
      const catalog = getApp().catalog;
      if (!rules || !catalog) break;
      const problems = await problemsUnder(rules, deckFileOf(message.deck), catalog);
      // Still the deck that was checked (not taken back or changed meanwhile).
      if (getOnline().prep.theirs !== message.deck) break;
      setPrep({ theirsProblems: problems });
      await seedStep();
      break;
    }
    case "commit":
      if (phase.role === "guest") {
        commit = message.hash;
        await seedStep();
      }
      break;
    case "nonce":
      if (phase.role === "host" && secret) {
        nonce = message.value;
        await seedStep();
      }
      break;
    case "start":
      if (phase.role === "guest" && commit && nonce && (await sha256(message.secret)) === commit) {
        secret = message.secret;
        await seedStep();
      }
      break;
    case "input":
      if (state.game) {
        // The host's spectators see the other player's answers too.
        if (phase.role === "host") toWatchers(message);
        engine.send({ kind: "remoteInput", index: message.index, input: message.input, hash: message.hash });
      }
      break;
    case "undo": {
      // The other player takes back their last answers: when the room allows it and this player hasn't answered since (the
      // engine checks), here too; then the other program does.
      const game = state.game;
      if (!game || game.seat === null) break;
      const ok = await takeBack(message.from, (1 - game.seat) as 0 | 1);
      if (ok) tookBack(message.from);
      currentLink()?.send({ t: ok ? "undoOk" : "undoNo", from: message.from });
      break;
    }
    case "undoOk":
      if (asking?.from === message.from && state.game && state.game.seat !== null) {
        if (await takeBack(message.from, state.game.seat)) tookBack(message.from);
        endAsking();
      }
      break;
    case "undoNo":
      if (asking?.from === message.from) endAsking();
      break;
    case "resume":
      // The other side is back: the answers of this side it hasn't played.
      if (state.game && message.game === state.game.id) {
        for (const m of sent) if (m.index >= message.have || m.input.type === "concede") link?.send({ t: "input", index: m.index, input: m.input, hash: m.hash });
      }
      break;
    default:
      break;
  }
}

// Preparing a game. The seed in three steps: with both decks locked, the host sends the hash of a secret;
// the guest answers with a random part; the host reveals its secret; the seed is the hash of both. Neither can choose it.
// From the host's first step on, neither player can take their deck back: the host may be starting the game already.
let secret: string | null = null;
let commit: string | null = null;
let nonce: string | null = null;

function resetSeed(): void {
  secret = null;
  commit = null;
  nonce = null;
}

async function seedStep(): Promise<void> {
  const { phase, prep } = getOnline();
  const link = currentLink();
  if (phase.kind !== "connected" || phase.role === "spectator" || !link || !prep.mine || !prep.theirs || !prep.rules) return;
  // The other deck checked here too, and the two programs the same.
  if (prep.theirsProblems?.length !== 0 || samePrograms(phase.peer) !== true) return;
  if (phase.role === "host") {
    if (!secret) {
      secret = randomHex(16);
      setPrep({ starting: true });
      link.send({ t: "commit", hash: await sha256(secret) });
    } else if (nonce) {
      const seed = (await sha256(`${secret}:${nonce}`)).slice(0, 24);
      link.send({ t: "start", secret });
      begin(seed, 0);
    }
  } else if (commit && !nonce) {
    nonce = randomHex(16);
    setPrep({ starting: true });
    link.send({ t: "nonce", value: nonce });
  } else if (commit && nonce && secret) {
    begin((await sha256(`${secret}:${nonce}`)).slice(0, 24), 1);
  }
}

/** The game's options, the same on both sides (but whose seat is whose): the host's deck is player 1's. */
export function onlineOptions(seed: string, rules: Rules, host: ReadyDeck, guest: ReadyDeck, seat: 0 | 1): GameOptions {
  return {
    seed,
    decks: [host.deck, guest.deck],
    deckNames: [host.name, guest.name],
    controllers: seat === 0 ? ["human", "remote"] : ["remote", "human"],
    deckRestrictions: rules.format === "standard",
    format: rules.format,
    restrictionList: rules.list,
    secondLeaders: [host.leader2, guest.leader2],
    showEveryMainPhase: true,
    askEveryQuickWindow: true,
    manualActions: false,
    turnOrder: rules.turnOrder,
    allowUndo: rules.undo,
  };
}

/** A game's options as a spectator's program needs them (messages.ts watchedOptions makes them back), with its backlog's size. */
function watchedGame(options: GameOptions, backlog: number): WatchedGame {
  return {
    id: options.seed,
    decks: options.decks,
    deckNames: options.deckNames,
    deckRestrictions: options.deckRestrictions,
    format: options.format ?? (options.deckRestrictions ? "standard" : "unlimited"),
    restrictionList: options.restrictionList ?? null,
    secondLeaders: options.secondLeaders ?? [null, null],
    turnOrder: options.turnOrder ?? "choose",
    backlog,
    players: getOnline().names ?? [myName(), lastPeer?.name ?? ""],
    allowUndo: options.allowUndo === true,
  };
}

/** This program's answers of the game in progress, to send again after reconnecting. */
let sent: Extract<FromWorker, { kind: "localInput" }>[] = [];

function begin(seed: string, seat: 0 | 1): void {
  const { prep } = getOnline();
  resetSeed();
  if (!prep.rules || !prep.mine || !prep.theirs) return;
  const [host, guest] = seat === 0 ? [prep.mine, prep.theirs] : [prep.theirs, prep.mine];
  sent = [];
  engine.send({ kind: "settings", settings: playSettings() });
  const options = onlineOptions(seed, prep.rules, host, guest, seat);
  engine.send({ kind: "start", options });
  setOnline({ game: { id: seed, seat }, prep: { ...NO_PREP, rules: prep.rules } });
  nameTheGame();
  // The host's spectators watch the new game from its start.
  if (seat === 0) toWatchers({ t: "watch", game: watchedGame(options, 0) });
  describeRoom();
  gameStarted();
}

/** The engine's settings for a game over the connection (played or watched): nothing hidden shown, no manual debugging. */
function playSettings() {
  const settings = getSettings();
  return { paused: false, revealAll: false, manualDebug: false, announceQuick: settings.announceQuick, attackPauseMs: Math.min(settings.botDelayMs, 500) };
}

// The engine worker's answers of this program's person go to the other program (and the host's, to its spectators); a
// finished game is said to the lobby and, when both players allow it, kept on the server.
engine.subscribe((message) => {
  if (message.kind === "update" && message.update.result && message.update.online && !message.update.online.spectating) {
    describeRoom();
    void keepGame(message.update.seed);
    return;
  }
  if (message.kind !== "localInput" || !getOnline().game) return;
  sent.push(message);
  const input: NetMessage = { t: "input", index: message.index, input: message.input, hash: message.hash };
  currentLink()?.send(input);
  toWatchers(input);
});

// ---- Taking an answer back (a room that allows it) ----

/** This program asked the other to take back the inputs from `from` on (its person's answers wait meanwhile). */
let asking: { from: number; timer: number } | null = null;
/** The engine's answers to "takeBack", in order. */
const takingBack: ((ok: boolean) => void)[] = [];

engine.subscribe((message) => {
  if (message.kind === "tookBack") takingBack.shift()?.(message.ok);
});

/** The engine takes back the inputs from `from` on, `seat`'s (null: a spectator following); whether it did. */
function takeBack(from: number, seat: 0 | 1 | null): Promise<boolean> {
  return new Promise((done) => {
    takingBack.push(done);
    engine.send({ kind: "takeBack", inputs: from, seat });
  });
}

/** Inputs from `from` on are taken back on both sides: not to be sent again; the host's spectators take them back too. */
function tookBack(from: number): void {
  sent = sent.filter((m) => m.index < from);
  if (getOnline().phase.kind === "connected" && getOnline().room?.role === "host") toWatchers({ t: "takeBack", from });
}

function endAsking(): void {
  if (!asking) return;
  window.clearTimeout(asking.timer);
  asking = null;
  engine.send({ kind: "hold", on: false });
}

/**
 * "Undo my last answer" in an online game whose room allows it: the other program is asked (it takes the answer back when
 * its player hasn't answered since), this person's answers waiting meanwhile. No answer within a while: nothing happens.
 */
function requestUndo(): void {
  const from = getApp().update?.online?.undo;
  const link = currentLink();
  if (from === null || from === undefined || !link || asking || getOnline().phase.kind !== "connected") return;
  engine.send({ kind: "hold", on: true });
  asking = { from, timer: window.setTimeout(endAsking, 10_000) };
  link.send({ t: "undo", from });
}
setUndoRequest(requestUndo);

/** The rules in this program's settings (the host's are the game's). What its spectators may do: on the online server only. */
function hostRules(): Rules {
  const settings = getSettings();
  const format = settings.format;
  const list = format === "unlimited" ? null : restrictionList(settings.restrictionLists[format]);
  const server = getOnline().room?.server === true;
  return {
    format,
    list: list?.id ?? null,
    listHash: list ? listFingerprint(list) : null,
    turnOrder: settings.setupTurnOrder,
    undo: settings.allowUndo,
    watchHands: server && settings.allowWatchHands,
    watchChat: server && settings.allowWatchChat,
  };
}

/** The host: the rules of the next game, from its settings (again whenever they change: both players are then not ready). */
export function updateRules(): void {
  const { phase, prep } = getOnline();
  if (phase.kind !== "connected" || phase.role !== "host" || playing()) return;
  const rules = hostRules();
  if (JSON.stringify(prep.rules) === JSON.stringify(rules)) return;
  resetSeed();
  setOnline({ prep: { ...NO_PREP, rules } });
  sendRules();
  currentLink()?.send({ t: "ready", deck: null });
  describeRoom();
}

/** The rules to the other player, and to the spectators (what they may do: see the hidden cards, write in the chat). */
function sendRules(): void {
  const rules = getOnline().prep.rules;
  if (!rules) return;
  currentLink()?.send({ t: "rules", rules });
  toWatchers({ t: "rules", rules });
}

/** Lock this player's deck for the next game (null: not ready any more). Both ready: the game starts. */
export async function ready(deck: ReadyDeck | null): Promise<void> {
  const { phase, prep } = getOnline();
  if (phase.kind !== "connected" || phase.role === "spectator" || (deck === null && prep.starting)) return;
  if (!deck) resetSeed();
  setPrep({ mine: deck });
  currentLink()?.send({ t: "ready", deck });
  await seedStep();
}

// ---- The host's spectators ----

/** A spectator connected to the host: what it was sent waits until it has the game's inputs so far (its backlog). */
interface Watcher {
  link: PeerLink;
  ready: boolean;
  queue: NetMessage[];
  /** When it last said something (it pings every few seconds): a silent one is let go. */
  lastSeen: number;
  /** Its person's name, as its hello said ("": none given): its chat lines say it. */
  name: string;
}

let watchers: Watcher[] = [];
/** Checks the spectators now and then (while there are any). */
let watcherTimer: number | null = null;

/** The host: whether it takes in a program asking for a seat (rooms.ts): the other player's while it has none, or a spectator's. */
function admit(as: JoinAs): Admission {
  if (as === "player") return currentLink() ? "full" : "yes";
  return watchers.length < roomSeats() ? "yes" : "full";
}

/** The spectator seats of this program's room: as many as the online server says, or the public networks' two. */
function roomSeats(): number {
  const { room, seats } = getOnline();
  return room?.server ? seats : SPECTATOR_SEATS;
}

function toWatchers(message: NetMessage): void {
  for (const w of watchers) {
    if (w.ready) w.link.send(message);
    else w.queue.push(message);
  }
}

/** Everyone connected to the host learns how many spectators there are. */
function countWatchers(): void {
  const n = watchers.length;
  setOnline({ watchers: n });
  currentLink()?.send({ t: "watchers", n });
  for (const w of watchers) w.link.send({ t: "watchers", n });
  describeRoom();
}

function addWatcher(link: PeerLink): void {
  const w: Watcher = { link, ready: false, queue: [], lastSeen: performance.now(), name: "" };
  watchers = [...watchers, w];
  link.onMessage = (message) => {
    w.lastSeen = performance.now();
    if (message.t === "ping") link.send({ t: "pong", n: message.n });
    else if (message.t === "bye") dropWatcher(w);
    else if (message.t === "hello") w.name = message.name ?? "";
    else if (message.t === "chat") watcherSaid(w, message.text);
  };
  link.onClose = () => dropWatcher(w);
  link.send(hello);
  // What it may do here (see the hidden cards, write in the chat).
  const rules = getOnline().prep.rules ?? hostRules();
  link.send({ t: "rules", rules });
  countWatchers();
  watcherTimer ??= window.setInterval(dropSilentWatchers, 5000);
  void sendGame(w);
}

function dropWatcher(w: Watcher, say = false): void {
  if (!watchers.includes(w)) return;
  watchers = watchers.filter((x) => x !== w);
  if (say) w.link.send({ t: "bye" });
  w.link.onMessage = null;
  w.link.onClose = null;
  w.link.close();
  if (watchers.length === 0 && watcherTimer !== null) {
    window.clearInterval(watcherTimer);
    watcherTimer = null;
  }
  countWatchers();
}

/** Spectators who haven't said anything for a while are gone (their seats are free again). */
function dropSilentWatchers(): void {
  const now = performance.now();
  for (const w of watchers) if (now - w.lastSeen > 20_000) dropWatcher(w);
}

/**
 * A spectator who came: the game in progress (its options, then its inputs so far, in pieces), or none; then what was
 * passed on meanwhile (answers that came while the game was being read out of the engine).
 */
async function sendGame(w: Watcher): Promise<void> {
  const replay = playing() ? await engine.exportReplay() : null;
  if (!watchers.includes(w)) return;
  if (!replay || replay.options.seed !== getOnline().game?.id) {
    w.link.send({ t: "watch", game: null });
  } else {
    w.link.send({ t: "watch", game: watchedGame(replay.options, replay.inputs.length) });
    for (let start = 0; start < replay.inputs.length; start += BACKLOG_PIECE) {
      w.link.send({ t: "backlog", start, inputs: replay.inputs.slice(start, start + BACKLOG_PIECE) });
    }
  }
  w.ready = true;
  for (const message of w.queue.splice(0)) w.link.send(message);
}

/** Let the spectators go: told so (they stop watching), or not (the host makes its room again: they come back by themselves). */
function dropWatchers(say = true): void {
  for (const w of [...watchers]) dropWatcher(w, say);
  setOnline({ watchers: 0 });
}

// The host's own chat lines (state.ts sendChat): its spectators read them too (the host is player 1).
setChatRelay((text) => {
  if (getOnline().phase.kind === "connected") toWatchers({ t: "chat", text, seat: 0 });
});

/**
 * A spectator wrote in the chat: in a room whose rules let spectators write, the host shows it and passes it on to the other
 * player and the other spectators, with the spectator's name (otherwise it is not heard).
 */
function watcherSaid(w: Watcher, text: string): void {
  const line = text.trim().slice(0, CHAT_MAX);
  const rules = getOnline().prep.rules ?? hostRules();
  if (line === "" || !rules.watchChat) return;
  setOnline({ chat: [...getOnline().chat, { from: "watcher" as const, name: w.name, text: line }].slice(-200) });
  const said: NetMessage = { t: "chat", text: line, watcher: w.name };
  currentLink()?.send(said);
  for (const other of watchers) {
    if (other === w) continue;
    if (other.ready) other.link.send(said);
    else other.queue.push(said);
  }
}

// ---- A spectator's side ----

/** The game being watched as it comes from the host: its options, and its inputs so far until all of them are here. */
let incoming: { game: WatchedGame; inputs: RecordedInput[] } | null = null;

/** A spectator connected to the host: it hears the game and the chat; after a lost connection it looks for the room again. */
function watching(peer: PeerLink): void {
  meeting = null;
  disconnect();
  setLink(peer);
  incoming = null;
  setOnline({ phase: { kind: "connected", role: "spectator", via: peer.via, route: "unknown", rtt: null, peer: null }, error: null });
  const lost = () => {
    disconnect();
    setOnline({ phase: { kind: "closed", reason: "lost" } });
    // A spectator only watches: it comes back by itself (the host sends the game again).
    const room = getOnline().room;
    if (room?.role === "spectator") rewatch = window.setTimeout(() => watchRoom(room.code, true, room.server, room.password), 2000);
  };
  peer.onMessage = (message) => hear(message);
  peer.onClose = lost;
  peer.send(hello);
  startPinging(peer, lost);
}

function hear(message: NetMessage): void {
  const state = getOnline();
  const phase = state.phase;
  if (phase.kind !== "connected" || phase.role !== "spectator") return;
  switch (message.t) {
    case "hello":
      setOnline({ phase: { ...phase, peer: message } });
      break;
    case "ping":
      currentLink()?.send({ t: "pong", n: message.n });
      break;
    case "pong":
      pong(message.n);
      break;
    case "watchers":
      setOnline({ watchers: message.n });
      break;
    case "chat":
      if (message.seat !== undefined) setOnline({ chat: [...state.chat, { from: message.seat, text: message.text }].slice(-200) });
      else if (message.watcher !== undefined) setOnline({ chat: [...state.chat, { from: "watcher" as const, name: message.watcher, text: message.text }].slice(-200) });
      break;
    case "rules":
      // What the host lets its spectators do: write in the chat (state.ts canChat), see the hidden cards (the engine).
      setOnline({ prep: { ...NO_PREP, rules: message.rules } });
      engine.send({ kind: "spectatorReveal", allowed: message.rules.watchHands });
      break;
    case "watch":
      // Another program's games can't be followed (CR-wise the same engine is needed: the fingerprints).
      if (samePrograms(phase.peer) !== true) break;
      incoming = message.game ? { game: message.game, inputs: [] } : null;
      if (!message.game) setOnline({ game: null });
      else if (message.game.backlog === 0) startWatching();
      break;
    case "backlog":
      if (!incoming || message.start !== incoming.inputs.length) break;
      incoming.inputs.push(...message.inputs);
      if (incoming.inputs.length >= incoming.game.backlog) startWatching();
      break;
    case "input":
      if (state.game && !incoming) engine.send({ kind: "remoteInput", index: message.index, input: message.input, hash: message.hash });
      break;
    case "takeBack":
      if (state.game && !incoming) void takeBack(message.from, null);
      break;
    case "bye":
      disconnect();
      setOnline({ phase: { kind: "closed", reason: "left" } });
      break;
    default:
      break;
  }
}

/** The game and its inputs so far are here: the engine plays them at once, then follows the players' answers. */
function startWatching(): void {
  const coming = incoming;
  if (!coming) return;
  incoming = null;
  // A spectator keeps "reveal all" as it set it while watching this room (it is off when it came: watchRoom); it shows
  // the hidden cards only when the host allows it (the rules it sent).
  const { revealAll: _, ...settings } = playSettings();
  engine.send({ kind: "settings", settings });
  engine.send({ kind: "spectate", options: watchedOptions(coming.game), inputs: coming.inputs });
  engine.send({ kind: "spectatorReveal", allowed: getOnline().prep.rules?.watchHands === true });
  const continuing = getOnline().game?.id === coming.game.id;
  setOnline({ game: { id: coming.game.id, seat: null }, names: coming.game.players ?? null });
  // A new game shows by itself; the same game again (after a lost connection) just goes on.
  if (!continuing) gameStarted();
}

/**
 * Watch the games in room `code` (a spectator's seat), on the online server (`server`, with the room's `password` if it has
 * one) or the public networks; `again`: after a lost connection (the game shown stays).
 */
export function watchRoom(code: string, again = false, server = false, password: string | null = null): void {
  stopLooking();
  disconnect();
  dropWatchers();
  setOnline({
    phase: { kind: "joining", code, as: "watch" },
    error: null,
    room: { code, role: "spectator", server, password },
    ...(again ? {} : { game: null, chat: [], watchers: 0, prep: NO_PREP }),
  });
  if (!again) {
    // A new room to watch: nothing hidden shown until its host allows it and this spectator turns "reveal all" on.
    engine.send({ kind: "settings", settings: { revealAll: false } });
    engine.send({ kind: "spectatorReveal", allowed: false });
  }
  meeting = meetRoom(code, "watch", server, again ? "any" : "join", password, {
    onLink: (peer) => watching(peer),
    onFull: () => {
      stopLooking();
      setOnline({ phase: { kind: "closed", reason: "watchFull" } });
    },
  });
}

/** A spectator: which side of the table is at the bottom. */
export function spectatorSide(perspective: 0 | 1): void {
  engine.send({ kind: "spectatorSide", perspective });
}

// ---- Rooms, codes by hand, leaving ----

/**
 * Meet in room `code`: on the public networks, or on the online server (`server`) — making the room, joining one that is
 * there, or either (coming back after a lost connection), with the room's `password` (the server's rooms only; made with
 * one, the room takes only those who say it). Without a server configured, nothing (the error says so).
 */
function meetRoom(code: string, role: "host" | JoinAs, server: boolean, mode: JoinMode, password: string | null, handlers: MeetingHandlers): Meeting | null {
  if (!server) return meet(code, role, turn(), handlers);
  const settings = currentServer();
  if (!settings) {
    setOnline({ phase: { kind: "idle" }, error: "online.server.none", room: null });
    return null;
  }
  return meet(code, role, null, handlers, undefined, [
    serverNetwork(
      settings,
      mode,
      {
        onWelcome: (seats, records) => setOnline({ seats: Math.max(0, Math.min(MAX_SPECTATOR_SEATS, seats)), records }),
        onProblem: (problem) => serverProblem(problem, role, mode),
        onRoom: (room) => {
          serverRoom = room;
          describeRoom();
        },
      },
      password,
    ),
  ]);
}

/** The room joined on the online server (to describe it for the lobby, to send a finished game), while there is one. */
let serverRoom: ServerRoom | null = null;

/** The host of a room on the server: what the lobby shows of it — its name, the rules, who is in, whether it plays. */
function describeRoom(): void {
  const { room, prep } = getOnline();
  if (!serverRoom || room?.role !== "host" || !room.server) return;
  const rules = prep.rules ?? hostRules();
  serverRoom.describe({
    name: myName(),
    format: rules.format,
    list: rules.list,
    turnOrder: rules.turnOrder,
    public: getSettings().publicRooms,
    players: currentLink() ? 2 : 1,
    watchers: watchers.length,
    playing: playing(),
  });
}

/** Whether the online server keeps this game: it keeps games, and both players allow it (the other's word, as last said). */
export function gameKept(): boolean {
  const { room, records } = getOnline();
  return !!room?.server && records && getSettings().shareGames && lastPeer?.share === true;
}

/** The games sent to be kept (a game is sent once). */
const sentGames = new Set<string>();

/**
 * A finished online game, sent for the server to keep when both players allow it: the replay of the game (its seed, both
 * decks, every answer: the program can play it again), with the version and fingerprints of the program that played it. No
 * names, no chat. Both players' programs send it; the server keeps it once.
 */
async function keepGame(seed: string): Promise<void> {
  const game = getOnline().game;
  if (!game || game.id !== seed || game.seat === null || sentGames.has(seed) || !gameKept() || !serverRoom) return;
  sentGames.add(seed);
  const replay = await engine.exportReplay();
  if (!replay || replay.options.seed !== seed || !serverRoom) return;
  await serverRoom.record(seed, { format: "sve-online-record", version: 1, app: APP_VERSION, platform: PLATFORM, engine: ENGINE, cards: hello.cards, replay });
}

/** A host's tries at a room code the server doesn't have yet (another host may have just made the code drawn). */
let hostTries = 0;

/**
 * Something went wrong with the online server. No such room, or no seat: said as on the public networks. Its code taken: the
 * host draws another. Otherwise (the server refused this program, couldn't be reached, or closed the connection) the attempt
 * ends with what went wrong; a connection made ends by itself through its link, and a game in progress waits for a new one.
 */
function serverProblem(problem: ServerProblem, role: "host" | JoinAs, mode: JoinMode): void {
  const { phase } = getOnline();
  if (problem === "exists" && role === "host" && mode === "create" && phase.kind === "hosting" && hostTries < 5) {
    hostTries += 1;
    return hostRoom(undefined, false, true);
  }
  if (problem === "missing" || problem === "full" || problem === "password" || problem === "tries") {
    stopLooking();
    const reason = problem === "full" ? (role === "watch" ? "watchFull" : "full") : problem;
    setOnline({ phase: { kind: "closed", reason }, error: null });
    return;
  }
  const error: MessageKey = `online.server.${problem}`;
  if (phase.kind === "connected") {
    if (problem !== "closed") setOnline({ error });
    return;
  }
  stopLooking();
  setOnline({ phase: playing() ? { kind: "closed", reason: "lost" } : { kind: "idle" }, error });
}

/**
 * Make a room — on the online server (`server`) or the public networks: its code, to pass to the other player; wait for them
 * (and spectators). On the server, a password too when the host chose one (6 random digits, to pass with the code; asked of
 * the other player and the spectators). `again`: the same room once more after a lost connection (its spectators aren't told
 * to go: they come back by themselves).
 */
export function hostRoom(code = newRoomCode(), again = false, server = false): void {
  stopLooking();
  disconnect();
  dropWatchers(!again);
  if (getOnline().phase.kind !== "hosting") hostTries = 0;
  // The same room again, or another code for it (the server had the one drawn): the same password.
  const kept = again || hostTries > 0 ? (getOnline().room?.password ?? null) : null;
  const password = server ? (kept ?? (!again && getSettings().roomPassword ? newRoomPassword() : null)) : null;
  setOnline({ phase: { kind: "hosting", code }, error: null, room: { code, role: "host", server, password } });
  meeting = meetRoom(code, "host", server, again ? "any" : "create", password, {
    onLink: (peer, as) => (as === "player" ? connected("host", peer) : addWatcher(peer)),
    onFull: () => undefined,
    admit,
  });
}

/**
 * Join the room of this code (already normalized: codes.ts normalizeRoomCode), on the online server (`server`, with the
 * room's `password` if it has one) or the public networks; `again`: after a lost connection (on the server, the room is
 * waited for if it isn't there).
 */
export function joinRoom(code: string, server = false, again = false, password: string | null = null): void {
  stopLooking();
  disconnect();
  dropWatchers();
  setOnline({ phase: { kind: "joining", code, as: "player" }, error: null, room: { code, role: "guest", server, password } });
  meeting = meetRoom(code, "player", server, again ? "any" : "join", password, {
    onLink: (peer) => connected("guest", peer),
    onFull: () => {
      stopLooking();
      setOnline({ phase: { kind: "closed", reason: "full" } });
    },
  });
}

/**
 * After losing the connection: the same room again, in the same role, the same way. The host makes its room again (its own
 * network may have dropped); until then the other player can come back to the room it stayed in.
 */
export function reconnect(): void {
  const room = getOnline().room;
  if (!room) return;
  if (room.role === "host") hostRoom(room.code, true, room.server);
  else if (room.role === "spectator") watchRoom(room.code, true, room.server, room.password);
  else joinRoom(room.code, room.server, true, room.password);
}

/** Codes by hand, the host: make the connection code. */
export async function hostManually(): Promise<void> {
  stopLooking();
  disconnect();
  dropWatchers();
  setOnline({ phase: { kind: "manualHost", offer: null, accepted: false }, error: null, room: null });
  try {
    const made = await offerConnection(turn());
    if (getOnline().phase.kind !== "manualHost") return made.cancel();
    attempt = made;
    setOnline({ phase: { kind: "manualHost", offer: made.code, accepted: false } });
    void made.link.then((peer) => {
      if (attempt === made) connected("host", peer);
    });
  } catch {
    setOnline({ phase: { kind: "idle" }, error: "online.failed" });
  }
}

/** Codes by hand, the host: the guest's reply code completes the connection. */
export async function acceptReply(reply: string): Promise<void> {
  const phase = getOnline().phase;
  if (phase.kind !== "manualHost" || !attempt?.accept) return;
  try {
    await attempt.accept(reply);
    setOnline({ phase: { ...phase, accepted: true }, error: null });
  } catch (err) {
    setOnline({ error: err instanceof BadCodeError ? "online.badReply" : "online.failed" });
  }
}

/** Codes by hand, the guest: from the host's connection code, the reply code. */
export async function joinManually(offer: string): Promise<void> {
  stopLooking();
  disconnect();
  dropWatchers();
  setOnline({ phase: { kind: "manualGuest", reply: null }, error: null, room: null });
  try {
    const made = await answerConnection(offer, turn());
    if (getOnline().phase.kind !== "manualGuest") return made.cancel();
    attempt = made;
    setOnline({ phase: { kind: "manualGuest", reply: made.code } });
    void made.link.then((peer) => {
      if (attempt === made) connected("guest", peer);
    });
  } catch (err) {
    setOnline({ phase: { kind: "idle" }, error: err instanceof BadCodeError ? "online.badOffer" : "online.failed" });
  }
}

/** Stop looking for the other player: back to the start, or, while a game waits for its connection, to the lost connection. */
export function cancel(): void {
  if (!playing() || getOnline().room?.role === "spectator") return leave();
  // The host stays in its room for the other player to come back.
  if (getOnline().room?.role !== "host") stopLooking();
  setOnline({ phase: { kind: "closed", reason: "lost" }, error: null });
}

/**
 * Stop looking, or leave the connection (the other side is told). Leaving a game in progress concedes it (CR 1.2.3: a
 * player may concede at any time); without a connection, the other side learns nothing more and sees the connection lost.
 * A spectator just goes.
 */
export function leave(): void {
  const { game } = getOnline();
  const link = currentLink();
  if (game && game.seat !== null && playing()) {
    const concede: NetMessage = { t: "input", index: 0, input: { type: "concede", player: game.seat }, hash: "" };
    link?.send(concede);
    toWatchers(concede);
    engine.send({ kind: "concede", seat: game.seat });
  }
  link?.send({ t: "bye" });
  dropWatchers();
  stopLooking();
  disconnect();
  resetSeed();
  incoming = null;
  setOnline({ phase: { kind: "idle" }, error: null, prep: NO_PREP, game: null, room: null, watchers: 0, names: null });
  serverRoom = null;
}

/** The role of the connection (or of the room being looked for), for the screens. */
export function onlineRole(): OnlineRole | null {
  const { phase, room } = getOnline();
  return phase.kind === "connected" ? phase.role : (room?.role ?? null);
}
