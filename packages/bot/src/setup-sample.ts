/**
 * A sample of the game as a player knows it at a decision of the setup (CR 6.2: the turn order, the mulligans, 6.2.1.8), for
 * the mulligan by simulation (mulligan-sim.ts), from the core's public API only. GameSession.determinized refuses a game
 * before its first main phase (its copies between anchors are replayed from the last checkpoint, and the setup has only the
 * one at its start), so the same sample is built here as a game replayed from that start:
 *
 *   1. What the player can't see is dealt again exactly as determinized deals it (CR 4.1.2: the opponent's hand and deck
 *      together — their deck list counts as known —, the opponent's facedown evolve deck and banished cards, the player's
 *      own deck, whose order nobody knows, CR 4.5.2; kept: the cards the pending decision shows, the revealed ones and those
 *      the player remembers): each pool's identities sorted, shuffled with seedRng("determinize:<seed>"), dealt to the
 *      pool's cards in zone order. Future random results come from seedRng("determinize-rng:<seed>").
 *   2. The game is built again from its setup checkpoint with those identities: a card's identity goes back to the card it
 *      was at the checkpoint (CR 4.1.4: a card moved is a new card, with the same definition, so every move of the setup is
 *      followed back through the events), and the checkpoint's random state is set so that the setup's own shuffles and
 *      turn-order draw (CR 6.2.1.4, 6.2.1.6) end exactly at the sample's future state: the core's generator (sfc32) is run
 *      backwards over as many steps as the setup takes, each deck is put in the order those shuffles take to the order the
 *      real ones gave (so every card is where it really was), and the turn-order answer is given for the player that draw
 *      picks so that the same player goes first.
 *   3. The rebuilt game is compared with the sample it must be (the live state with the identities dealt again, the future
 *      random state, the same pending decision): anything else throws (the mulligan then counts the sample as failed).
 *
 * The one difference from determinized's copy: what the other player remembers of the cards it put at the bottom of its
 * deck with its own redraw (CR 6.2.1.8; the engine notes it, CR 4.1.5.1) stays in the rebuilt game, now about the cards
 * dealt there, where determinized drops it. It is the other player's memory of its own sampled cards, not of the real ones,
 * so the sample stays fair; it shows only when the player deciding goes second after the first player redrew.
 *
 * Unlike a copy made between anchors, the rebuilt game's checkpoint holds the sample itself: it can be copied at once, and
 * its copies are the same sample.
 */
import { randomInt, seedRng, shuffleInPlace, type Answer, type CardId, type CardInstance, type Decision, type Engine, type GameEvent, type GameSession, type GameSnapshot, type GameState, type PlayerId, type RngState } from "./core";

/** A card's identity: what determinize deals again (only the definition and the printing move; the rest stays with the slot). */
interface Identity {
  def: string;
  printing: string;
}

/** The zones dealt again together (determinize's pools): a hand with its deck, the evolve deck, the banished cards. */
const POOL_ZONES = [["hand", "deck"], ["evolveDeck"], ["banished"]] as const;

/**
 * CR 4.1.2 — who may look at a card of a pool's zones: a hand its owner only (4.7.2); a deck nobody (4.5.2); the evolve deck
 * its owner, and faceup cards everyone (4.6.2, 4.2.3.1); the banished zone faceup cards everyone, facedown ones their owner
 * (4.10.2).
 */
function visibleTo(card: CardInstance, viewer: PlayerId): boolean {
  switch (card.zone) {
    case "hand":
      return viewer === card.controller;
    case "deck":
      return false;
    case "evolveDeck":
    case "banished":
      return card.faceUp || viewer === card.controller;
    default:
      throw new Error(`setup sample: a ${card.zone} card in a hidden pool`);
  }
}

/** The cards a setup decision shows its player (the hand of a mulligan; nothing for the turn order). */
function shown(d: Decision | null, viewer: PlayerId): CardId[] {
  if (!d || d.player !== viewer) return [];
  if (d.type === "mulligan") return [...d.hand];
  if (d.type === "chooseTurnOrder") return [];
  throw new Error(`setup sample: a ${d.type} decision in the setup`);
}

/**
 * The pools of cards `viewer` can't identify, in determinize's order (each player, each group of zones, zone order): not
 * shown by the decision, not revealed (CR 5.21), not visible to them, not remembered by them.
 */
export function hiddenPools(state: Readonly<GameState>, viewer: PlayerId, keep: ReadonlySet<CardId>): CardId[][] {
  const hidden = (id: CardId) => {
    const card = state.cards[id]!;
    return !keep.has(id) && !state.revealed.includes(id) && !visibleTo(card, viewer) && !card.knownBy?.includes(viewer);
  };
  const pools: CardId[][] = [];
  for (const p of [0, 1] as const) {
    const zones = state.players[p].zones;
    for (const group of POOL_ZONES) pools.push(group.flatMap((zone) => zones[zone]).filter(hidden));
  }
  return pools;
}

const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const cloneJson = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

/**
 * Each pool's identities dealt again (1 above): sorted first, so the sample depends only on which cards are hidden. A copy
 * of the core's dealing in determinize (exported for the test that holds it to GameSession.determinized past the setup).
 */
export function dealt(state: Readonly<GameState>, pools: readonly CardId[][], seed: string): Map<CardId, Identity> {
  const rng = seedRng(`determinize:${seed}`);
  const out = new Map<CardId, Identity>();
  for (const pool of pools) {
    if (pool.length < 2) continue;
    const identities = pool.map((id) => ({ def: state.cards[id]!.def, printing: state.cards[id]!.printing }));
    identities.sort((a, b) => compare(a.def, b.def) || compare(a.printing, b.printing));
    shuffleInPlace(rng, identities);
    pool.forEach((id, i) => out.set(id, identities[i]!));
  }
  return out;
}

// ---- The generator, stepped (sfc32: rng.ts) ----

/** One step forward: randomInt over the whole 32-bit range draws exactly one output (no rejection). */
const stepForward = (s: RngState): void => {
  randomInt(s, 0x1_0000_0000);
};

/** The inverse of 9 modulo 2^32 (9 · 0x38e38e39 = 2^33 + 1). */
const INV9 = 0x38e38e39;

/**
 * One sfc32 step backwards: the state before the step that gave `s`. Forward: t = a + b + d; a' = b ^ (b >>> 9);
 * b' = 9c; c' = rotl(c, 21) + t; d' = d + 1 (all modulo 2^32). Each line is undone in turn.
 */
export function stepBack(s: RngState): RngState {
  const [a1, b1, c1, d1] = s;
  const d = (d1 - 1) | 0;
  // x ^ (x >>> 9) undone: the xor of y's shifts by 0, 9, 18 and 27.
  const b = a1 ^ (a1 >>> 9) ^ (a1 >>> 18) ^ (a1 >>> 27);
  const c = Math.imul(b1, INV9);
  const rot = (c << 21) | (c >>> 11);
  const t = (c1 - rot) | 0;
  const a = (t - b - d) | 0;
  return [a >>> 0, b >>> 0, c >>> 0, d >>> 0];
}

const sameRng = (x: RngState, y: RngState): boolean => x.every((v, i) => v === y[i]);

/** Steps forward from `from` to `to` (null: not within `limit`). */
function stepsBetween(from: RngState, to: RngState, limit = 20_000): number | null {
  const s: RngState = [...from];
  for (let n = 0; n <= limit; n++) {
    if (sameRng(s, to)) return n;
    stepForward(s);
  }
  return null;
}

/** The state `n` steps before `s`. */
function back(s: RngState, n: number): RngState {
  let out: RngState = [...s];
  for (let i = 0; i < n; i++) out = stepBack(out);
  return out;
}

// ---- The real setup, followed ----

/** What the setup did between its checkpoint and the pending decision, as the replay of its inputs shows. */
interface SetupFacts {
  /** A card id → the id it had before its last move (CR 4.1.4). */
  parent: Map<CardId, CardId>;
  /** Each player's deck as the setup shuffled it (CR 6.2.1.4): the checkpoint's order, the cards put out before it removed. */
  shuffled: [CardId[], CardId[]];
  /** The cards put out of each deck before the shuffle (a Starting Amulet onto the field, CR 14.4.3.1). */
  removed: [CardId[], CardId[]];
  /** The player the turn-order draw picked (CR 6.2.1.6), null when the game fixes who goes first. */
  chooser: PlayerId | null;
  /** The decks after the real shuffle. */
  orders: [CardId[], CardId[]];
  /** The generator's steps from the checkpoint to the pending decision. */
  steps: number;
}

/** The setup's facts from a replay of the snapshot, checked against the game (throws where the flow isn't the one known). */
function setupFacts(engine: Engine, session: GameSession, snap: GameSnapshot): SetupFacts {
  const replay = engine.restore({ format: 1, checkpoint: snap.checkpoint, inputs: [] });
  const events: GameEvent[] = [...replay.startupEvents];
  for (const input of snap.inputs) events.push(...replay.act(input));
  const parent = new Map<CardId, CardId>();
  const removed: [CardId[], CardId[]] = [[], []];
  let shuffledYet = false;
  for (const e of events) {
    if (e.type === "deckShuffled") shuffledYet = true;
    if (e.type !== "cardsMoved") continue;
    for (const m of e.moves) {
      if (m.card !== null && m.newCard !== null && m.newCard !== m.card) parent.set(m.newCard, m.card);
      if (!shuffledYet && m.card !== null && m.from?.zone === "deck") removed[m.from.player].push(m.card);
    }
  }
  const start = snap.checkpoint;
  const out = new Set([...removed[0], ...removed[1]]);
  const shuffled: [CardId[], CardId[]] = [start.players[0].zones.deck.filter((id) => !out.has(id)), start.players[1].zones.deck.filter((id) => !out.has(id))];
  // CR 6.2.1.4 each deck shuffled, player 0's first; CR 6.2.1.6 the player who decides the turn order drawn at random.
  const rng: RngState = [...start.rng];
  const orders: [CardId[], CardId[]] = [[...shuffled[0]], [...shuffled[1]]];
  shuffleInPlace(rng, orders[0]);
  shuffleInPlace(rng, orders[1]);
  const chooser = start.config.firstPlayer === null ? (randomInt(rng, 2) as PlayerId) : null;
  const live = session.state;
  if (!sameRng(rng, live.rng) || !sameRng(rng, replay.state.rng)) throw new Error("setup sample: the setup drew random numbers other than its shuffles and turn order");
  const steps = stepsBetween(start.rng, rng);
  if (steps === null) throw new Error("setup sample: the setup's random steps can't be counted");
  if ((chooser !== null) !== (snap.inputs[0]?.type === "chooseTurnOrder")) throw new Error("setup sample: the turn order wasn't decided as the setup does");
  return { parent, shuffled, removed, chooser, orders, steps };
}

/** A card's id at the checkpoint (the card it was before every move since). */
function ancestor(facts: SetupFacts, id: CardId): CardId {
  let at = id;
  for (let guard = 0; facts.parent.has(at) && guard < 1000; guard++) at = facts.parent.get(at)!;
  return at;
}

// ---- Rebuilt ----

/** Structural equality of two JSON values (key order ignored). */
function same(x: unknown, y: unknown): boolean {
  if (x === y) return true;
  if (typeof x !== "object" || typeof y !== "object" || x === null || y === null || Array.isArray(x) !== Array.isArray(y)) return false;
  if (Array.isArray(x)) return x.length === (y as unknown[]).length && x.every((v, i) => same(v, (y as unknown[])[i]));
  const a = x as Record<string, unknown>;
  const b = y as Record<string, unknown>;
  const keys = Object.keys(a).filter((k) => a[k] !== undefined);
  const others = Object.keys(b).filter((k) => b[k] !== undefined);
  return keys.length === others.length && keys.every((k) => same(a[k], b[k]));
}

/** A sample at the setup, and how many of its dealt cards keep the other player's memory of them (the header). */
export interface SetupSample {
  world: GameSession;
  memoryKept: number;
}

/**
 * A copy of `session` as `viewer` knows it at its pending decision, during the setup (the header) or past it
 * (determinized). Throws when the session has no checkpoints, or when the rebuilt game isn't the sample it must be.
 */
export function setupSample(engine: Engine, session: GameSession, viewer: PlayerId, seed: string): SetupSample {
  const snap = session.snapshot();
  if (snap.checkpoint.anchor?.kind === "mainPhase") return { world: session.determinized(viewer, seed), memoryKept: 0 };
  if (snap.checkpoint.anchor?.kind !== "setup") throw new Error("setup sample: the game's checkpoint is neither the setup nor a main phase");
  const facts = setupFacts(engine, session, snap);
  const live = session.state;
  const pools = hiddenPools(live, viewer, new Set(shown(session.decision, viewer)));
  const identities = dealt(live, pools, seed);
  const future = seedRng(`determinize-rng:${seed}`);

  // 2. The checkpoint: the identities on the cards they were, the generator set back, the decks put in order.
  const checkpoint = cloneJson(snap.checkpoint);
  for (const [id, x] of identities) {
    const card = checkpoint.cards[ancestor(facts, id)];
    if (!card) throw new Error(`setup sample: ${id} wasn't a card at the setup's checkpoint`);
    card.def = x.def;
    card.printing = x.printing;
  }
  let steps = facts.steps;
  let start: RngState | null = null;
  let indices: [number[], number[]] = [[], []];
  let chooser: PlayerId | null = null;
  // The setup's draws from the new start, played as the setup plays them; a rejection in randomInt takes one step more, so
  // the count is found again until the draws end at the sample's future state (practically always at once).
  for (let attempt = 0; attempt < 8 && start === null; attempt++) {
    const from = back(future, steps);
    const s: RngState = [...from];
    const idx: [number[], number[]] = [facts.shuffled[0].map((_, i) => i), facts.shuffled[1].map((_, i) => i)];
    shuffleInPlace(s, idx[0]);
    shuffleInPlace(s, idx[1]);
    const drawn = facts.chooser === null ? null : (randomInt(s, 2) as PlayerId);
    if (sameRng(s, future)) {
      start = from;
      indices = idx;
      chooser = drawn;
    } else steps = stepsBetween(from, s) ?? steps + 1;
  }
  if (start === null) throw new Error("setup sample: no start of the generator ends the setup at the sample's state");
  checkpoint.rng = start;
  for (const p of [0, 1] as const) {
    // After the shuffle, place k holds the card that was at indices[p][k]: put the real order's k-th card there.
    const order = new Array<CardId>(indices[p].length);
    indices[p].forEach((from, k) => (order[from] = facts.orders[p][k]!));
    // The cards put out before the shuffle first: the setup takes the first one it finds (CR 14.4.3.1, any one will do).
    checkpoint.players[p].zones.deck = [...facts.removed[p], ...order];
  }
  const inputs: Answer[] = cloneJson(snap.inputs) as Answer[];
  if (facts.chooser !== null) {
    const first = inputs[0];
    if (first?.type !== "chooseTurnOrder") throw new Error("setup sample: no turn order answer");
    const goesFirst = first.goFirst ? facts.chooser : ((1 - facts.chooser) as PlayerId);
    inputs[0] = { type: "chooseTurnOrder", goFirst: chooser === goesFirst };
  }
  const world = engine.restore({ format: 1, checkpoint, inputs });

  // 3. The rebuilt game against the sample: the live state with the identities dealt again and the future random state.
  const expected = cloneJson(live) as GameState;
  for (const [id, x] of identities) {
    const card = expected.cards[id]!;
    card.def = x.def;
    card.printing = x.printing;
    delete card.knownBy;
  }
  expected.rng = [...future];
  const got = cloneJson(world.state) as GameState;
  let memoryKept = 0;
  for (const id of identities.keys()) {
    const card = got.cards[id];
    if (!card) continue;
    if (card.knownBy?.includes(viewer)) throw new Error(`setup sample: ${viewer} would remember ${id}, dealt again`);
    if (card.knownBy?.length) memoryKept += 1;
    delete card.knownBy;
  }
  if (!same(got, expected) || !same(world.decision, session.decision)) throw new Error("setup sample: the rebuilt game isn't the sample");
  return { world, memoryKept };
}

/** setupSample for an engine, as the mulligan by simulation takes it (mulligan-sim.ts MulliganWorld). */
export const setupWorld =
  (engine: Engine) =>
  (session: GameSession, viewer: PlayerId, seed: string): GameSession =>
    setupSample(engine, session, viewer, seed).world;
