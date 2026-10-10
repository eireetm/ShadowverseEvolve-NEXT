import { opponentOf, type CardView, type DefId, type HiddenCardView, type MainAction, type PlayerId, type PlayerSideView, type PlayerView } from "./core";
import { CARD_FEATURE_COLUMNS, type CardFeatureTable, type RefFilter } from "./card-features";
import { COUNTER_KINDS, infoDefOf, PLAYER_TYPES_V1, type KnownDeck, type PlayerType } from "./encoder";
import {
  cardToken,
  defFacts,
  emptyDiagnosticsV2,
  evolveRefColumns,
  hasLiveRef,
  odds,
  refDomain,
  relColumns,
  REL_COLUMNS_V2,
  type EncodeDiagnosticsV2,
  type Multiset,
  type RefDomain,
  type RefToken,
  type RefTrace,
  type TokenZone,
} from "./encoder-v2-refs";

/**
 * Encoder v2: a position as one player sees it, stored as tokens (D20–D22). A global block (159 whole numbers: v1's game and
 * side numbers, what the viewer can do now, counters, and per side the evolve matchings, the deck's main traits and the
 * odds of what the opponent's hidden hand holds); one token per card the viewer sees or remembers that can matter (hands,
 * fields, EX areas, cemetery cards with a live ability, equipment) with what it is now, what can be done with it, its evolve
 * options, its copies left, the cards it shares a trait or class with, and what its references count (encoder-v2-refs);
 * and one entry per (pile, definition) with its number of copies (cemeteries, banished cards, evolve decks, my deck, the
 * opponent's unseen cards). A card is never its id or name: it is its definition's index (a pointer to the card table's
 * row, D21) and a per-game row of list-level facts (gdef: copies in each list, the deck's trait slots, evolve partners in
 * the list). The pooled vector (poolV2, 6,735 values) is derived from these arrays. Fair (D23): only the view, both lists
 * and the table; whatever the viewer can't see is drawn from the cards it hasn't seen.
 */
export const ENCODER_V2_VERSION = 2;

/** What the encoder needs besides the view, fixed for a game (by seat). */
export interface EncoderV2Context {
  table: CardFeatureTable;
  decks: readonly [KnownDeck, KnownDeck];
  players: readonly [PlayerType, PlayerType];
}

// ---- Zones ----

/** Token zones (card tokens) and pile zones (one entry per definition), by code. */
export const ZONES_V2 = [
  { code: 0, name: "hand.me", kind: "card" },
  { code: 1, name: "field.me", kind: "card" },
  { code: 2, name: "ex.me", kind: "card" },
  { code: 3, name: "hand.oppKnown", kind: "card" },
  { code: 4, name: "field.opp", kind: "card" },
  { code: 5, name: "ex.opp", kind: "card" },
  { code: 6, name: "cemLive.me", kind: "card" },
  { code: 7, name: "cemLive.opp", kind: "card" },
  { code: 8, name: "equip.me", kind: "card" },
  { code: 9, name: "equip.opp", kind: "card" },
  { code: 16, name: "cem.me", kind: "pile" },
  { code: 17, name: "cem.opp", kind: "pile" },
  { code: 18, name: "ban.me", kind: "pile" },
  { code: 19, name: "ban.opp", kind: "pile" },
  { code: 20, name: "evoDown.me", kind: "pile" },
  { code: 21, name: "evoUp.me", kind: "pile" },
  { code: 22, name: "evoUp.opp", kind: "pile" },
  { code: 23, name: "evoLeft.opp", kind: "pile" },
  { code: 24, name: "deck.me", kind: "pile" },
  { code: 25, name: "unseen.opp", kind: "pile" },
  { code: 26, name: "misc.me", kind: "pile" },
  { code: 27, name: "misc.opp", kind: "pile" },
] as const;
const Z = Object.fromEntries(ZONES_V2.map((z) => [z.name, z.code])) as Record<(typeof ZONES_V2)[number]["name"], number>;

// ---- Columns ----

const KW_NOW = ["quick", "ward", "storm", "rush", "assail", "intimidate", "drain", "bane", "aura", "stack", "drive"] as const;
const KW_BASIC = ["quick", "ward", "storm", "rush", "assail", "intimidate", "drain", "bane", "aura", "stack"] as const;
const SIDE_STATS = [
  "leaderDefense",
  "pp",
  "maxPp",
  "ep",
  "sep",
  "turnsPassed",
  "deckCount",
  "hand.count",
  "hand.hidden",
  "field.count",
  "field.hidden",
  "ex.count",
  "cemetery.count",
  "banished.count",
  "banished.hidden",
  "evolveDeck.faceDown",
  "evolveDeck.faceUp",
  "evolveZone.count",
  "raceZone.count",
  "driveZone.count",
  "triggerZone.count",
  "equipmentZone.count",
];
const CLASSES = CARD_FEATURE_COLUMNS.filter((c) => c.startsWith("cls."));
const UNIVERSES = CARD_FEATURE_COLUMNS.filter((c) => c.startsWith("uni."));
const PHASES = ["setup", "start", "main", "end", "over"] as const;
const ACT = ["nPlay", "nAttackers", "nAttackLeader", "reachNow", "nEvolve", "canSuperEvolve", "nActivate"];
const ODDS = ["quick", "ward", "charge", "removal", "aoe", "heal", "summon", "draw"] as const;

/** The global block (159): v1's mask, players, game numbers, actions and counters (same names), then encoder v2's own. */
export const GLOBAL_COLUMNS_V2: readonly string[] = [
  "mask.decides",
  ...["me.medium", "me.easy", "opp.medium", "opp.easy"].map((c) => `player.${c}`),
  ...[
    "turn",
    "me.first",
    "me.active",
    "first.known",
    ...PHASES.map((p) => `phase.${p}`),
    "attack.inProgress",
    "resolution.count",
    ...SIDE_STATS.map((s) => `me.${s}`),
    ...SIDE_STATS.map((s) => `opp.${s}`),
    ...[...CLASSES, ...UNIVERSES].map((c) => `me.${c}`),
    ...[...CLASSES, ...UNIVERSES].map((c) => `opp.${c}`),
  ].map((c) => `g.${c}`),
  ...ACT.map((c) => `act.${c}`),
  ...[...COUNTER_KINDS, "other"].map((c) => `counters.me.${c}`),
  ...[...COUNTER_KINDS, "other"].map((c) => `counters.opp.${c}`),
  "g.opp.hand.known",
  "g.opp.unseen",
  "g.me.evo.matchField",
  "g.me.evo.matchAll",
  "g.opp.evo.matchField",
  "g.opp.evo.matchAll",
  ...[1, 2, 3, 4].map((k) => `g.me.slot.${k}`),
  ...[1, 2, 3, 4].map((k) => `g.opp.slot.${k}`),
  "g.slot.shared",
  ...ODDS.map((o) => `g.opp.odds.${o}`),
  "g.opp.listExact",
];
const G = new Map(GLOBAL_COLUMNS_V2.map((c, i) => [c, i]));
const gi = (n: string) => G.get(n)!;
const WHO = ["me", "opp"] as const;
/** The global block's positions, found once. */
const GI = {
  mask: gi("mask.decides"),
  player: WHO.map((w) => PLAYER_TYPES_V1.map((t) => gi(`player.${w}.${t}`))),
  turn: gi("g.turn"),
  first: gi("g.me.first"),
  active: gi("g.me.active"),
  firstKnown: gi("g.first.known"),
  phase: PHASES.map((p) => gi(`g.phase.${p}`)),
  attack: gi("g.attack.inProgress"),
  resolution: gi("g.resolution.count"),
  side: WHO.map((w) => SIDE_STATS.map((n) => gi(`g.${w}.${n}`))),
  cls: WHO.map((w) => CLASSES.map((c) => gi(`g.${w}.${c}`))),
  uni: WHO.map((w) => UNIVERSES.map((u) => gi(`g.${w}.${u}`))),
  act: ACT.map((a) => gi(`act.${a}`)),
  counters: WHO.map((w) => COUNTER_KINDS.map((k) => gi(`counters.${w}.${k}`))),
  countersOther: WHO.map((w) => gi(`counters.${w}.other`)),
  handKnown: gi("g.opp.hand.known"),
  unseen: gi("g.opp.unseen"),
  matchField: WHO.map((w) => gi(`g.${w}.evo.matchField`)),
  matchAll: WHO.map((w) => gi(`g.${w}.evo.matchAll`)),
  slot: WHO.map((w) => [1, 2, 3, 4].map((k) => gi(`g.${w}.slot.${k}`))),
  shared: gi("g.slot.shared"),
  odds: ODDS.map((f) => gi(`g.opp.odds.${f}`)),
  listExact: gi("g.opp.listExact"),
};
const CLASS_COL = CLASSES.map((c) => CARD_FEATURE_COLUMNS.indexOf(c));

const KW_NOW_COLUMNS = [...KW_NOW.map((k) => `kw.now.${k}`), "kw.now.driveChecks"];
/** What a card is now (38): v1's field columns, then given abilities, lost abilities, remembered, unknown definition. */
const DYN_V2 = [
  "atk.now",
  "def.now",
  "dmg",
  "atk.delta",
  "def.delta",
  "cost.now",
  "follower.now",
  "type.changed",
  "engaged",
  "evolved.now",
  "superEvolved",
  "boxed",
  ...KW_NOW_COLUMNS,
  "kw.gained",
  "ctr.total",
  "ctr.stack",
  "ctr.kinds",
  "link.race",
  "link.drive",
  "link.equipment",
  "atk.engaged",
  "def.engaged",
  "ward.standing",
  "gift.n",
  "lost",
  "hiddenKnown",
  "unknownDef",
];
const A_V2 = ["a.play", "a.attackLeader", "a.attackFollowers", "a.evolve", "a.evolveEp", "a.superEvolve", "a.activate", "a.attackedBy"];
const EVO_V2 = ["evo.left", "evo.can", "evo.dAtk", "evo.dDef", "evo.onEvolve", "evo.refN", "evo.refOk", "evo.scale"];
const SELF_V2 = ["self.left", "self.cem"];
const SHARE_V2 = ["share.trait.field", "share.trait.hand", "share.trait.cemetery", "share.trait.pool", "share.class.field", "share.class.cemetery"];

export const CARD_HEADER_V2 = ["zone", "def", "gd"] as const;
/** A card token's body (100): DYN 38, A 8, EVO 8, SELF 2, SHARE 6, REL 38. */
export const CARD_BODY_COLUMNS_V2: readonly string[] = [...DYN_V2, ...A_V2, ...EVO_V2, ...SELF_V2, ...SHARE_V2, ...REL_COLUMNS_V2];
export const CARD_WIDTH_V2 = CARD_HEADER_V2.length + CARD_BODY_COLUMNS_V2.length;
export const PILE_COLUMNS_V2 = ["zone", "def", "gd", "mult"] as const;
export const GDEF_HEADER_V2 = ["def", "seat"] as const;
/** A (seat, definition) row's list-level facts (23). */
export const GDEF_COLUMNS_V2: readonly string[] = [
  "list.main",
  "list.evolve",
  ...[1, 2, 3, 4].map((k) => `tr.own.${k}`),
  ...[1, 2, 3, 4].map((k) => `tr.foe.${k}`),
  "tr.other",
  ...[1, 2, 3, 4].map((k) => `rf.own.${k}`),
  ...[1, 2, 3, 4].map((k) => `rf.foe.${k}`),
  "rf.other",
  "evo.inList",
  "evo.pAtk",
  "evo.pDef",
];
const B = new Map(CARD_BODY_COLUMNS_V2.map((c, i) => [c, i]));
const ROW = new Map(CARD_FEATURE_COLUMNS.map((c, i) => [c, i]));
const ATK = ROW.get("atk")!;
const DEF = ROW.get("def")!;
const COST = ROW.get("cost")!;
const FOLLOWER = ROW.get("type.follower")!;
const DRIVE = ROW.get("kw.driveChecks")!;
const KW_COL = KW_BASIC.map((k) => ROW.get(`kw.${k}`)!);
const BODY0 = CARD_HEADER_V2.length;

/** The A columns that apply in each card zone (−1 there when the viewer isn't deciding; 0 elsewhere). */
const A_APPLIES: Record<number, readonly string[]> = {
  [Z["field.me"]]: ["a.attackLeader", "a.attackFollowers", "a.evolve", "a.evolveEp", "a.superEvolve", "a.activate"],
  [Z["field.opp"]]: ["a.attackedBy"],
  [Z["hand.me"]]: ["a.play", "a.activate"],
  [Z["ex.me"]]: ["a.play", "a.activate"],
  [Z["cemLive.me"]]: ["a.play", "a.activate"],
};

/** The pooled vector's groups (D22's default head): card groups pool static ‖ gdef ‖ body, pile groups static ‖ gdef. */
export const POOL_LAYOUT_V2: readonly { name: string; zones: readonly number[]; kind: "card" | "pile"; parts: readonly ("count" | "sum" | "max")[] }[] = [
  { name: "hand.me", zones: [Z["hand.me"]], kind: "card", parts: ["count", "sum", "max"] },
  { name: "field.me", zones: [Z["field.me"]], kind: "card", parts: ["count", "sum", "max"] },
  { name: "field.opp", zones: [Z["field.opp"]], kind: "card", parts: ["count", "sum", "max"] },
  { name: "ex.me", zones: [Z["ex.me"]], kind: "card", parts: ["count", "sum", "max"] },
  { name: "ex.opp", zones: [Z["ex.opp"]], kind: "card", parts: ["count", "sum"] },
  { name: "hand.oppKnown", zones: [Z["hand.oppKnown"]], kind: "card", parts: ["count", "sum"] },
  { name: "other.me", zones: [Z["cemLive.me"], Z["equip.me"]], kind: "card", parts: ["count", "sum"] },
  { name: "other.opp", zones: [Z["cemLive.opp"], Z["equip.opp"]], kind: "card", parts: ["count", "sum"] },
  { name: "cem.me", zones: [Z["cem.me"]], kind: "pile", parts: ["count", "sum", "max"] },
  { name: "cem.opp", zones: [Z["cem.opp"]], kind: "pile", parts: ["count", "sum", "max"] },
  ...(["ban.me", "ban.opp", "evoDown.me", "evoUp.me", "evoUp.opp", "evoLeft.opp", "deck.me", "unseen.opp", "misc.me", "misc.opp"] as const).map((n) => ({ name: n, zones: [Z[n]], kind: "pile" as const, parts: ["count", "sum"] as ("count" | "sum")[] })),
];
const CARD_FEATURES = [...CARD_FEATURE_COLUMNS, ...GDEF_COLUMNS_V2, ...CARD_BODY_COLUMNS_V2];
const PILE_FEATURES = [...CARD_FEATURE_COLUMNS, ...GDEF_COLUMNS_V2];

export interface EncoderV2Schema {
  version: number;
  zones: typeof ZONES_V2;
  global: { names: readonly string[]; masked: readonly number[] };
  card: { header: readonly string[]; body: readonly string[]; width: number; applies: Readonly<Record<number, readonly string[]>> };
  pile: { names: readonly string[] };
  gdef: { header: readonly string[]; names: readonly string[] };
  pooled: { dims: number; names: readonly string[]; groups: readonly { name: string; start: number; end: number }[]; masked: readonly number[] };
  playerTypes: readonly PlayerType[];
}

let schemaCache: EncoderV2Schema | null = null;
/** Every array's names and the pooled vector's layout. */
export function encoderV2Schema(): EncoderV2Schema {
  if (schemaCache) return schemaCache;
  const names: string[] = [...GLOBAL_COLUMNS_V2];
  const groups: { name: string; start: number; end: number }[] = [];
  const masked: number[] = ACT.map((c) => G.get(`act.${c}`)!);
  for (const g of POOL_LAYOUT_V2) {
    const start = names.length;
    const features = g.kind === "card" ? CARD_FEATURES : PILE_FEATURES;
    const applies = new Set(g.zones.flatMap((z) => A_APPLIES[z] ?? []));
    for (const part of g.parts) {
      if (part === "count") {
        names.push(`${g.name}.count`);
        continue;
      }
      for (const c of features) {
        if (g.kind === "card" && applies.has(c)) masked.push(names.length);
        names.push(`${g.name}.${part}.${c}`);
      }
    }
    groups.push({ name: g.name, start, end: names.length });
  }
  schemaCache = {
    version: ENCODER_V2_VERSION,
    zones: ZONES_V2,
    global: { names: GLOBAL_COLUMNS_V2, masked: ACT.map((c) => G.get(`act.${c}`)!) },
    card: { header: CARD_HEADER_V2, body: CARD_BODY_COLUMNS_V2, width: CARD_WIDTH_V2, applies: A_APPLIES },
    pile: { names: PILE_COLUMNS_V2 },
    gdef: { header: GDEF_HEADER_V2, names: GDEF_COLUMNS_V2 },
    pooled: { dims: names.length, names, groups, masked: masked.sort((a, b) => a - b) },
    playerTypes: PLAYER_TYPES_V1,
  };
  return schemaCache;
}

// ---- Per game ----

/** What encoding needs per game (from the context only): lists, trait slots, gdef rows (made as needed), the definitions. */
export interface PreparedV2 {
  ctx: EncoderV2Context;
  /** Definition ids by index − 1 (the table's definitions, sorted). */
  defIds: readonly DefId[];
  /** Per seat: up to 4 trait indices (−1 when missing) and their copies in the lists. */
  slots: readonly [readonly number[], readonly number[]];
  slotCopies: readonly [readonly number[], readonly number[]];
  /** gdef rows by gd (allocated as (seat, definition) pairs are first used), and their keys. */
  gdKeys: { seat: PlayerId; def: DefId }[];
  gdRows: Int16Array[];
  /** gd by seat and definition. */
  gdIndex: [Map<DefId, number>, Map<DefId, number>];
  /** The table's rows as nonzero (column, value) pairs, by definition index (made as needed; the values are never negative). */
  sparse: Map<number, { cols: Int32Array; vals: Int32Array }>;
}

/** A filter's positive trait atoms (not under a "not"). */
function positiveTraits(f: RefFilter, out: Set<string>, negated = false): void {
  if (f.t === "trait" && !negated) out.add(f.v);
  else if (f.t === "and" || f.t === "or") for (const a of f.args) positiveTraits(a, out, negated);
  else if (f.t === "not") positiveTraits(f.arg, out, !negated);
}

/** The traits a definition's references look for (positive atoms), as trait indices. */
function refTraits(table: CardFeatureTable, def: DefId): Set<number> {
  const names = new Set<string>();
  for (const r of table.refsOf(def)) positiveTraits(r.filter, names);
  const index = new Map(table.file.traits.map((t, i) => [t, i]));
  return new Set([...names].map((n) => index.get(n) ?? -1).filter((i) => i >= 0));
}

/** Per game, from the context only. */
export function prepareV2(ctx: EncoderV2Context): PreparedV2 {
  const table = ctx.table;
  const slotsOf = (seat: PlayerId) => {
    const c = new Map<number, number>();
    const rc = new Map<number, number>();
    for (const list of [ctx.decks[seat].main, ctx.decks[seat].evolve]) {
      for (const [d, n] of list) {
        for (const t of table.traitsOf(d)) c.set(t, (c.get(t) ?? 0) + n);
        for (const t of refTraits(table, d)) rc.set(t, (rc.get(t) ?? 0) + n);
      }
    }
    const ranked = [...c.keys()].filter((t) => c.get(t)! > 0).sort((a, b) => c.get(b)! - c.get(a)! || (rc.get(b) ?? 0) - (rc.get(a) ?? 0) || a - b);
    const top = ranked.slice(0, 4);
    return { slots: [0, 1, 2, 3].map((k) => top[k] ?? -1), copies: [0, 1, 2, 3].map((k) => (top[k] === undefined ? 0 : c.get(top[k]!)!)) };
  };
  const s0 = slotsOf(0);
  const s1 = slotsOf(1);
  return { ctx, defIds: Object.keys(table.file.rows).sort(), slots: [s0.slots, s1.slots], slotCopies: [s0.copies, s1.copies], gdKeys: [], gdRows: [], gdIndex: [new Map(), new Map()], sparse: new Map() };
}

/** A (seat, definition) row (§5 of the plan's encoder v2): copies in the seat's lists, trait slots, evolve partners listed. */
export function gdefRow(prep: PreparedV2, seat: PlayerId, def: DefId): Int16Array {
  const table = prep.ctx.table;
  const r = new Int16Array(GDEF_COLUMNS_V2.length);
  const own = prep.slots[seat];
  const foe = prep.slots[opponentOf(seat)];
  const list = prep.ctx.decks[seat];
  let i = 0;
  r[i++] = list.main.get(def) ?? 0;
  r[i++] = list.evolve.get(def) ?? 0;
  const traits = table.traitsOf(def);
  for (const s of own) r[i++] = s >= 0 && traits.includes(s) ? 1 : 0;
  for (const s of foe) r[i++] = s >= 0 && traits.includes(s) ? 1 : 0;
  r[i++] = traits.filter((t) => !own.includes(t) && !foe.includes(t)).length;
  const rf = refTraits(table, def);
  for (const s of own) r[i++] = s >= 0 && rf.has(s) ? 1 : 0;
  for (const s of foe) r[i++] = s >= 0 && rf.has(s) ? 1 : 0;
  r[i++] = [...rf].filter((t) => !own.includes(t) && !foe.includes(t)).length;
  const d = defFacts(table, def);
  let inList = 0;
  let pAtk: number | null = null;
  let pDef: number | null = null;
  for (const q of table.partnersOf(def)) {
    const n = list.evolve.get(q) ?? 0;
    if (n === 0) continue;
    inList += n;
    const Q = defFacts(table, q);
    pAtk = Math.max(pAtk ?? -Infinity, (Q.atk ?? 0) - (d.atk ?? 0));
    pDef = Math.max(pDef ?? -Infinity, (Q.dfn ?? 0) - (d.dfn ?? 0));
  }
  r[i++] = inList;
  r[i++] = clamp(pAtk ?? 0, -20, 20);
  r[i++] = clamp(pDef ?? 0, -20, 20);
  return r;
}

/** The game-local index of a (seat, definition) row, made when first used. */
function gdOf(prep: PreparedV2, seat: PlayerId, def: DefId): number {
  let gd = prep.gdIndex[seat].get(def);
  if (gd === undefined) {
    gd = prep.gdKeys.length;
    prep.gdIndex[seat].set(def, gd);
    prep.gdKeys.push({ seat, def });
    prep.gdRows.push(gdefRow(prep, seat, def));
  }
  return gd;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

// ---- Encoding a view ----

/** A view as encoder v2 stores it: the global block, card tokens and pile entries in canonical order. */
export interface EncodedV2 {
  global: Int16Array;
  /** nCards rows of CARD_WIDTH_V2: zone, def (index), gd, body. */
  cards: Int16Array;
  /** nPiles rows of 4: zone, def (index), gd, mult. */
  piles: Int16Array;
  nCards: number;
  nPiles: number;
  /** Each card row's card id (for the print and the tests; never stored). */
  cardIds: readonly string[];
}

const visible = (c: CardView | HiddenCardView): c is CardView => !c.hidden;
const COLUMN = new Map(CARD_FEATURE_COLUMNS.map((c, i) => [c, i]));
const col = (n: string) => COLUMN.get(n)!;
const counterTotal = (c: CardView) => {
  let n = 0;
  for (const v of Object.values(c.counters)) n += v;
  return n;
};
/** Saturates to int16 (counted). */
function sat(v: number, diag?: EncodeDiagnosticsV2): number {
  if (v > 32767 || v < -32768) {
    if (diag) diag.saturations += 1;
    return v > 0 ? 32767 : -32768;
  }
  return v;
}

/** The viewer's main phase actions now (null: the viewer isn't deciding one). */
function actionsOf(view: PlayerView): MainAction[] | null {
  const d = view.decision;
  return d && d.type === "mainPhase" && d.player === view.viewer ? d.actions : null;
}

/** A maximum bipartite matching's size (Kuhn's augmenting paths; the size is unique whatever the order). */
function matching(left: readonly (readonly number[])[], nRight: number): number {
  const owner = new Array<number>(nRight).fill(-1);
  const tryAt = (u: number, seen: boolean[]): boolean => {
    for (const v of left[u]!) {
      if (seen[v]) continue;
      seen[v] = true;
      if (owner[v] === -1 || tryAt(owner[v]!, seen)) {
        owner[v] = u;
        return true;
      }
    }
    return false;
  };
  let size = 0;
  for (let u = 0; u < left.length; u++) if (tryAt(u, new Array<boolean>(nRight).fill(false))) size += 1;
  return size;
}

const FAMILIES = new WeakMap<CardFeatureTable, Map<DefId, number>>();
/** The odds families (§6.4) a definition is in, as bits in ODDS order (cached per table). */
function familiesOf(table: CardFeatureTable, def: DefId): number {
  let m = FAMILIES.get(table);
  if (!m) FAMILIES.set(table, (m = new Map()));
  let bits = m.get(def);
  if (bits === undefined) {
    bits = 0;
    ODDS.forEach((f, i) => {
      if (inFamily(table, def, f)) bits! |= 1 << i;
    });
    m.set(def, bits);
  }
  return bits;
}

/** Odds families (§6.4) on a definition's table row. */
function inFamily(table: CardFeatureTable, def: DefId, f: (typeof ODDS)[number]): boolean {
  const r = table.row(def);
  const v = (n: string) => r[col(n)]!;
  switch (f) {
    case "quick":
      return v("kw.quick") + v("act.quick") > 0;
    case "ward":
      return v("kw.ward") > 0;
    case "charge":
      return v("kw.storm") + v("kw.rush") + v("kw.assail") > 0;
    case "removal":
      return v("fx.dmg") + v("fx.destroy") + v("fx.banish") > 0;
    case "aoe":
      return v("fx.aoe") > 0;
    case "heal":
      return v("fx.heal") > 0;
    case "summon":
      return v("fx.summon") > 0;
    case "draw":
      return v("fx.draw") + v("fx.search") > 0;
  }
}

interface Token {
  zone: number;
  t: RefToken;
  body: Int32Array;
  defIndex: number;
  gd: number;
}

/**
 * Encodes `view` (the view of `me`). `trace` collects each token's reference lines by card id (for describeV2). Card tokens
 * are sorted by zone, definition index, then body; pile entries by zone and definition index.
 */
export function encodeV2(view: PlayerView, me: PlayerId, prep: PreparedV2, diag?: EncodeDiagnosticsV2, trace?: Map<string, RefTrace[]>): EncodedV2 {
  if (view.viewer !== me) throw new Error(`the view is player ${view.viewer}'s, not ${me}'s`);
  const ctx = prep.ctx;
  const table = ctx.table;
  if (!PLAYER_TYPES_V1.includes(ctx.players[0]) || !PLAYER_TYPES_V1.includes(ctx.players[1])) throw new Error(`a player type encoder v2 doesn't know: ${ctx.players.join(", ")}`);
  const opp = opponentOf(me);
  const mine = view.players[me];
  const theirs = view.players[opp];
  const dom = refDomain(view, me, table, ctx.decks, diag);
  const actions = actionsOf(view);
  const deciding = actions !== null;
  const oppLeader = theirs.leader?.id ?? null;
  const glob = new Int16Array(GLOBAL_COLUMNS_V2.length);

  // What each card of mine may do now, and how many of my attacks each enemy card faces.
  const act = new Map<string, { attackLeader: number; attackFollowers: number; evolve: number; evolveEp: number; superEvolve: number; activate: number; play: number }>();
  const attackedBy = new Map<string, number>();
  const actOf = (id: string) => {
    let a = act.get(id);
    if (!a) act.set(id, (a = { attackLeader: 0, attackFollowers: 0, evolve: 0, evolveEp: 0, superEvolve: 0, activate: 0, play: 0 }));
    return a;
  };
  let nPlay = 0;
  let nActivate = 0;
  let canSuperEvolve = 0;
  const attackers = new Set<string>();
  const leaderAttackers = new Set<string>();
  const evolvers = new Set<string>();
  for (const a of actions ?? []) {
    if (a.type === "play") {
      actOf(a.card).play = 1;
      nPlay += 1;
    } else if (a.type === "attack") {
      attackers.add(a.attacker);
      if (a.target === oppLeader) {
        actOf(a.attacker).attackLeader = 1;
        leaderAttackers.add(a.attacker);
      } else actOf(a.attacker).attackFollowers += 1;
      attackedBy.set(a.target, (attackedBy.get(a.target) ?? 0) + 1);
    } else if (a.type === "evolve") {
      evolvers.add(a.card);
      const x = actOf(a.card);
      if (a.superEvolve) {
        x.superEvolve = 1;
        canSuperEvolve = 1;
      } else if (a.useEvolutionPoint) x.evolveEp = 1;
      else x.evolve = 1;
    } else if (a.type === "activate") {
      actOf(a.card).activate += 1;
      nActivate += 1;
    }
  }

  // ---- Global block: v1's part ----
  const set = (i: number, v: number) => {
    glob[i] = sat(v, diag);
  };
  set(GI.mask, deciding ? 1 : 0);
  [me, opp].forEach((side, w) => PLAYER_TYPES_V1.forEach((t, j) => set(GI.player[w]![j]!, ctx.players[side] === t ? 1 : 0)));
  set(GI.turn, view.turn);
  set(GI.first, view.firstPlayer === me ? 1 : 0);
  set(GI.active, view.activePlayer === me ? 1 : 0);
  set(GI.firstKnown, view.firstPlayer !== null ? 1 : 0);
  PHASES.forEach((p, j) => set(GI.phase[j]!, view.phase === p ? 1 : 0));
  set(GI.attack, view.attack !== null ? 1 : 0);
  set(GI.resolution, view.resolution.length);
  const allHidden = (cards: readonly (CardView | HiddenCardView)[]) => {
    let n = 0;
    for (const c of cards) if (c.hidden) n += 1;
    return n;
  };
  [mine, theirs].forEach((s, w) => {
    let faceDown = 0;
    for (const c of s.evolveDeck) if (c.hidden || !c.faceUp) faceDown += 1;
    const values = [
      s.leaderDefense,
      s.playPoints,
      s.maxPlayPoints,
      s.evolutionPoints,
      s.superEvolutionPoints,
      s.turnsPassed,
      s.deckCount,
      s.hand.length,
      allHidden(s.hand),
      s.field.length,
      allHidden(s.field),
      s.ex.length,
      s.cemetery.length,
      s.banished.length,
      allHidden(s.banished),
      faceDown,
      s.evolveDeck.length - faceDown,
      s.evolveZone.length,
      s.raceZone.length,
      s.driveZone.length,
      s.triggerZone.length,
      s.equipmentZone.length,
    ];
    const idx = GI.side[w]!;
    for (let j = 0; j < values.length; j++) set(idx[j]!, values[j]!);
    const leaderRow = s.leader ? table.row(infoDefOf(view, s.leader, table)) : null;
    CLASS_COL.forEach((c, j) => set(GI.cls[w]![j]!, leaderRow ? leaderRow[c]! : 0));
    UNIVERSES.forEach((u, j) => set(GI.uni[w]![j]!, s.universe !== null && `uni.${s.universe}` === u ? 1 : 0));
  });
  let reach = 0;
  for (const id of leaderAttackers) {
    const c = mine.field.find((x) => x.id === id);
    // Damage of 0 or less isn't dealt (CR 1.3.2.2).
    if (c && visible(c)) reach += Math.max(0, c.attack ?? 0);
  }
  // What I can do now: "not known" (−1) unless I'm deciding.
  [nPlay, attackers.size, leaderAttackers.size, reach, evolvers.size, canSuperEvolve, nActivate].forEach((v, j) => set(GI.act[j]!, deciding ? v : -1));
  [mine, theirs].forEach((s, w) => {
    const byKind = new Map<string, number>();
    for (const c of [s.leader, ...s.field, ...s.ex]) {
      if (!c || !visible(c)) continue;
      for (const k in c.counters) byKind.set(k, (byKind.get(k) ?? 0) + c.counters[k]!);
    }
    let other = 0;
    for (const [k, v] of byKind) if (!(COUNTER_KINDS as readonly string[]).includes(k)) other += v;
    COUNTER_KINDS.forEach((k, j) => set(GI.counters[w]![j]!, byKind.get(k) ?? 0));
    set(GI.countersOther[w]!, other);
  });

  // ---- Global block: encoder v2's part ----
  set(GI.handKnown, dom.knownHandOpp.length);
  set(GI.unseen, dom.N);
  const evolvable = (def: DefId) => {
    const d = defFacts(table, def);
    return d.type === "follower" && !d.evolved && d.actEvolve >= 1;
  };
  [me, opp].forEach((side, w) => {
    // Face-down evolve cards: mine I see; the opponent's are their evolve list minus what I see (D6).
    const down: DefId[] = [];
    if (side === me) for (const c of mine.evolveDeck) if (visible(c) && !c.faceUp) down.push(c.def);
    if (side === opp) for (const [d, n] of dom.evoLeftOpp) for (let i = 0; i < n; i++) down.push(d);
    const field: DefId[] = [];
    for (const c of view.players[side].field) if (visible(c) && c.evolvedWith === null && !c.abilitiesLost) field.push(infoDefOf(view, c, table));
    const hand: DefId[] = side === me ? mine.hand.filter(visible).map((c) => infoDefOf(view, c, table)) : dom.knownHandOpp.map((k) => k.def);
    const edges = (defs: readonly DefId[]) =>
      defs.filter(evolvable).map((d) => {
        const partners = table.partnersOf(d);
        const e: number[] = [];
        down.forEach((q, i) => {
          if (partners.includes(q)) e.push(i);
        });
        return e;
      });
    const fieldEdges = down.length > 0 ? edges(field) : [];
    set(GI.matchField[w]!, down.length > 0 ? matching(fieldEdges, down.length) : 0);
    set(GI.matchAll[w]!, down.length > 0 ? matching([...fieldEdges, ...edges(hand)], down.length) : 0);
  });
  for (let k = 0; k < 4; k++) {
    set(GI.slot[0]![k]!, prep.slotCopies[me][k]!);
    set(GI.slot[1]![k]!, prep.slotCopies[opp][k]!);
  }
  set(GI.shared, prep.slots[me].filter((t) => t >= 0 && prep.slots[opp].includes(t)).length);
  let knownBits = 0;
  for (const k of dom.knownHandOpp) knownBits |= familiesOf(table, k.def);
  const K = ODDS.map(() => 0);
  for (const [d, n] of dom.unseen) {
    const bits = familiesOf(table, d);
    if (bits) for (let i = 0; i < ODDS.length; i++) if (bits & (1 << i)) K[i]! += n;
  }
  const hu = Math.min(dom.hiddenHandOpp, dom.N);
  for (let i = 0; i < ODDS.length; i++) set(GI.odds[i]!, knownBits & (1 << i) ? 1000 : odds(dom.N, K[i]!, hu, 0, { kind: "atLeast", n: 1 }).p);
  set(GI.listExact, 1);

  // ---- Card tokens ----
  const links = { race: new Map<string, number>(), drive: new Map<string, number>(), equipment: new Map<string, number>() };
  for (const side of view.players) {
    for (const [zone, map] of [
      [side.raceZone, links.race],
      [side.driveZone, links.drive],
      [side.equipmentZone, links.equipment],
    ] as const) {
      for (const c of zone) if (c.linkedTo !== null) map.set(c.linkedTo, (map.get(c.linkedTo) ?? 0) + 1);
    }
  }
  const tokens: Token[] = [];
  const add = (zone: number, side: PlayerId, t: RefToken) => {
    const d = defFacts(table, t.def);
    if (!d.known && diag) diag.unknownDefs += 1;
    tokens.push({ zone, t, body: new Int32Array(CARD_BODY_COLUMNS_V2.length), defIndex: d.index, gd: gdOf(prep, side, t.def) });
  };
  const cardsOf = (side: PlayerId, which: TokenZone, list: readonly (CardView | HiddenCardView)[], zone: number, live = false) => {
    for (const c of list) {
      if (!visible(c)) continue;
      const t = cardToken(dom, which, side, c);
      if (live && !hasLiveRef(dom, t)) continue;
      add(zone, side, t);
    }
  };
  cardsOf(me, "hand", mine.hand, Z["hand.me"]);
  cardsOf(me, "field", mine.field, Z["field.me"]);
  cardsOf(me, "ex", mine.ex, Z["ex.me"]);
  for (const k of dom.knownHandOpp) {
    if (k.card) add(Z["hand.oppKnown"], opp, cardToken(dom, "hand", opp, k.card));
    else add(Z["hand.oppKnown"], opp, { zone: "hand", side: opp, id: k.id, def: k.def, phys: k.def, card: null });
  }
  cardsOf(opp, "field", theirs.field, Z["field.opp"]);
  cardsOf(opp, "ex", theirs.ex, Z["ex.opp"]);
  cardsOf(me, "cemetery", mine.cemetery, Z["cemLive.me"], true);
  cardsOf(opp, "cemetery", theirs.cemetery, Z["cemLive.opp"], true);
  cardsOf(me, "equipmentZone", mine.equipmentZone, Z["equip.me"]);
  cardsOf(opp, "equipmentZone", theirs.equipmentZone, Z["equip.opp"]);

  // Per view, for the share and self columns: the cards of each side the viewer sees or remembers (field, hand, cemetery,
  // by information definition), each side's pool (my deck; the opponent's unseen cards) and cemetery by physical card.
  type Known = { id: string; traits: readonly number[]; cls: number };
  const knownOf = (cards: readonly { id: string; def: DefId }[]): Known[] =>
    cards.map((k) => {
      const f = defFacts(table, k.def);
      return { id: k.id, traits: f.traits, cls: f.cls };
    });
  const visibleDefs = (side: PlayerId, zone: "field" | "hand" | "cemetery") => (view.players[side][zone] as (CardView | HiddenCardView)[]).filter(visible).map((c) => ({ id: c.id, def: infoDefOf(view, c, table) }));
  const share = ([me, opp] as const).map((side) => ({
    field: knownOf(visibleDefs(side, "field")),
    hand: knownOf(side === opp ? dom.knownHandOpp : visibleDefs(side, "hand")),
    cemetery: knownOf(visibleDefs(side, "cemetery")),
    pool: [...(side === me ? dom.deckMe : dom.unseen)].map(([d, n]) => ({ n, traits: defFacts(table, d).traits })),
    poolCopies: side === me ? dom.deckMe : dom.unseen,
    cem: view.players[side].cemetery.reduce((m, c) => m.set(c.def, (m.get(c.def) ?? 0) + 1), new Map<DefId, number>()),
  }));
  const sideIndex = (side: PlayerId) => (side === me ? 0 : 1);
  const sharesTrait = (a: readonly number[], b: readonly number[]) => {
    for (const x of a) if (b.includes(x)) return true;
    return false;
  };
  const REL0 = B.get(REL_COLUMNS_V2[0]!)!;
  const A0 = B.get(A_V2[0]!)!;
  const EVO0 = B.get(EVO_V2[0]!)!;

  for (const tok of tokens) {
    const { t, body } = tok;
    const R = defFacts(table, t.def);
    const row = table.row(t.def);
    const c = t.card;
    // DYN (38), in DYN_V2's order: what it is now.
    let k = 0;
    if (c) {
      const atk = c.attack ?? 0;
      const dfn = c.defense ?? 0;
      const follower = c.type === "follower";
      body[k++] = atk;
      body[k++] = dfn;
      body[k++] = c.damage;
      body[k++] = follower ? atk - row[ATK]! : 0;
      body[k++] = follower ? dfn + c.damage - row[DEF]! : 0;
      body[k++] = c.cost ?? 0;
      body[k++] = follower ? 1 : 0;
      body[k++] = c.type !== R.type ? 1 : 0;
      body[k++] = c.engaged ? 1 : 0;
      body[k++] = c.evolvedWith !== null ? 1 : 0;
      body[k++] = c.superEvolved ? 1 : 0;
      body[k++] = c.boxed ? 1 : 0;
      for (const kw of KW_NOW) body[k++] = c.keywords.includes(kw) ? 1 : 0;
      body[k++] = c.keywords.includes("twinDrive") ? 2 : c.keywords.includes("singleDrive") ? 1 : 0;
      let gained = 0;
      for (let j = 0; j < KW_BASIC.length; j++) gained += Math.max(0, (c.keywords.includes(KW_BASIC[j]!) ? 1 : 0) - row[KW_COL[j]!]!);
      body[k++] = gained;
      body[k++] = counterTotal(c);
      body[k++] = c.counters.stack ?? 0;
      body[k++] = Object.values(c.counters).filter((v) => v > 0).length;
      body[k++] = links.race.get(c.id) ?? 0;
      body[k++] = links.drive.get(c.id) ?? 0;
      body[k++] = links.equipment.get(c.id) ?? 0;
      body[k++] = c.engaged ? atk : 0;
      body[k++] = c.engaged ? dfn : 0;
      body[k++] = c.keywords.includes("ward") && !c.engaged ? 1 : 0;
      body[k++] = c.gifts.length;
      body[k++] = c.abilitiesLost ? 1 : 0;
      body[k++] = 0;
    } else {
      // A remembered hidden card: its definition's printed facts; the rest 0.
      body[0] = row[ATK]!;
      body[1] = row[DEF]!;
      body[5] = row[COST]!;
      body[6] = row[FOLLOWER]!;
      for (let j = 0; j < KW_BASIC.length; j++) body[12 + j] = row[KW_COL[j]!]!;
      body[12 + KW_BASIC.length] = row[DRIVE]! > 0 ? 1 : 0;
      body[13 + KW_BASIC.length] = row[DRIVE]!;
      body[DYN_V2.length - 2] = 1;
      k = DYN_V2.length - 1;
    }
    body[k++] = R.known ? 0 : 1;
    // A (8): what I can do with it now (−1 for an applicable column when I'm not deciding).
    const applies = A_APPLIES[tok.zone];
    if (applies) {
      const a = act.get(t.id);
      for (const name of applies) {
        const j = A0 + A_V2.indexOf(name);
        if (!deciding) body[j] = -1;
        else
          body[j] =
            name === "a.play"
              ? (a?.play ?? 0)
              : name === "a.attackLeader"
                ? (a?.attackLeader ?? 0)
                : name === "a.attackFollowers"
                  ? (a?.attackFollowers ?? 0)
                  : name === "a.evolve"
                    ? (a?.evolve ?? 0)
                    : name === "a.evolveEp"
                      ? (a?.evolveEp ?? 0)
                      : name === "a.superEvolve"
                        ? (a?.superEvolve ?? 0)
                        : name === "a.activate"
                          ? (a?.activate ?? 0)
                          : (attackedBy.get(t.id) ?? 0);
      }
    }
    // EVO (8): a follower that can still evolve, and what it would become.
    if (R.type === "follower" && !R.evolved && !(c && c.evolvedWith !== null)) {
      const partners = table.partnersOf(t.def);
      let left = 0;
      let dAtk: number | null = null;
      let dDef: number | null = null;
      let onEvolve = 0;
      const seenQ: DefId[] = [];
      const consider = (q: DefId, n: number) => {
        left += n;
        if (seenQ.includes(q)) return;
        seenQ.push(q);
        const Q = defFacts(table, q);
        dAtk = Math.max(dAtk ?? -Infinity, (Q.atk ?? 0) - (R.atk ?? 0));
        dDef = Math.max(dDef ?? -Infinity, (Q.dfn ?? 0) - (R.dfn ?? 0));
        onEvolve = Math.max(onEvolve, Q.autoOnEvolve);
      };
      if (partners.length > 0) {
        if (t.side === me) {
          for (const e of mine.evolveDeck) if (visible(e) && !e.faceUp && partners.includes(e.def)) consider(e.def, 1);
        } else for (const [d, n] of dom.evoLeftOpp) if (partners.includes(d)) consider(d, n);
      }
      body[EVO0] = left;
      body[EVO0 + 1] = R.actEvolve >= 1 && left >= 1 ? 1 : 0;
      body[EVO0 + 2] = clamp(dAtk ?? 0, -20, 20);
      body[EVO0 + 3] = clamp(dDef ?? 0, -20, 20);
      body[EVO0 + 4] = onEvolve;
      if (seenQ.length > 0 && (tok.zone === Z["field.me"] || tok.zone === Z["field.opp"])) {
        const e = evolveRefColumns(dom, t, seenQ, diag);
        body[EVO0 + 5] = e.refN;
        body[EVO0 + 6] = e.refOk;
        body[EVO0 + 7] = e.scale;
      }
    }
    // SELF (2): copies of its physical card still unseen in its owner's list, and in its owner's cemetery.
    const own = share[sideIndex(c?.owner ?? t.side)]!;
    let at = EVO0 + EVO_V2.length;
    body[at++] = Math.min(3, own.poolCopies.get(t.phys) ?? 0);
    body[at++] = Math.min(3, own.cem.get(t.phys) ?? 0);
    // SHARE (6): the controller's other cards sharing a printed trait, or a class other than Neutral.
    const ctl = share[sideIndex(t.side)]!;
    const traits = R.traits;
    const count = (list: readonly Known[], byClass: boolean) => {
      let n = 0;
      for (const x of list) if (x.id !== t.id && (byClass ? R.cls !== 0 && x.cls === R.cls : traits.length > 0 && sharesTrait(traits, x.traits))) n += 1;
      return Math.min(63, n);
    };
    body[at++] = count(ctl.field, false);
    body[at++] = count(ctl.hand, false);
    body[at++] = count(ctl.cemetery, false);
    let inPool = 0;
    if (traits.length > 0) for (const x of ctl.pool) if (sharesTrait(traits, x.traits)) inPool += x.n;
    body[at++] = Math.min(63, inPool);
    body[at++] = count(ctl.field, true);
    body[at++] = count(ctl.cemetery, true);
    // REL (38): what it counts.
    const lines: RefTrace[] | undefined = trace ? [] : undefined;
    relColumns(dom, t, body, REL0, diag, lines);
    if (trace && lines) trace.set(t.id, lines);
  }

  // Canonical order: zone, definition index, body (as stored, int16).
  for (const tok of tokens) for (let j = 0; j < tok.body.length; j++) tok.body[j] = sat(tok.body[j]!, diag);
  tokens.sort((a, b) => {
    if (a.zone !== b.zone) return a.zone - b.zone;
    if (a.defIndex !== b.defIndex) return a.defIndex - b.defIndex;
    for (let j = 0; j < a.body.length; j++) if (a.body[j] !== b.body[j]) return a.body[j]! - b.body[j]!;
    return 0;
  });
  const cards = new Int16Array(tokens.length * CARD_WIDTH_V2);
  tokens.forEach((tok, i) => {
    const at = i * CARD_WIDTH_V2;
    cards[at] = tok.zone;
    cards[at + 1] = tok.defIndex;
    cards[at + 2] = tok.gd;
    cards.set(tok.body, at + BODY0);
  });

  // ---- Pile entries ----
  const piles: { zone: number; defIndex: number; gd: number; mult: number }[] = [];
  const pile = (zone: number, side: PlayerId, m: ReadonlyMap<DefId, number>) => {
    for (const [d, n] of m) {
      if (n <= 0) continue;
      const f = defFacts(table, d);
      if (!f.known && diag) diag.unknownDefs += 1;
      piles.push({ zone, defIndex: f.index, gd: gdOf(prep, side, d), mult: n });
    }
  };
  const byDef = (cards: readonly (CardView | HiddenCardView)[], keep: (c: CardView) => boolean = () => true) => {
    const m: Multiset = new Map();
    for (const c of cards) if (visible(c) && keep(c)) m.set(c.def, (m.get(c.def) ?? 0) + 1);
    return m;
  };
  pile(Z["cem.me"], me, byDef(mine.cemetery));
  pile(Z["cem.opp"], opp, byDef(theirs.cemetery));
  pile(Z["ban.me"], me, byDef(mine.banished));
  pile(Z["ban.opp"], opp, byDef(theirs.banished));
  pile(Z["evoDown.me"], me, byDef(mine.evolveDeck, (c) => !c.faceUp));
  pile(Z["evoUp.me"], me, byDef(mine.evolveDeck, (c) => c.faceUp));
  pile(Z["evoUp.opp"], opp, byDef(theirs.evolveDeck, (c) => c.faceUp));
  pile(Z["evoLeft.opp"], opp, dom.evoLeftOpp);
  pile(Z["deck.me"], me, dom.deckMe);
  pile(Z["unseen.opp"], opp, dom.unseen);
  pile(Z["misc.me"], me, byDef([...mine.raceZone, ...mine.driveZone, ...mine.triggerZone]));
  pile(Z["misc.opp"], opp, byDef([...theirs.raceZone, ...theirs.driveZone, ...theirs.triggerZone]));
  piles.sort((a, b) => a.zone - b.zone || a.defIndex - b.defIndex || a.gd - b.gd);
  const pileArr = new Int16Array(piles.length * PILE_COLUMNS_V2.length);
  piles.forEach((p, i) => pileArr.set([p.zone, p.defIndex, p.gd, sat(p.mult, diag)], i * PILE_COLUMNS_V2.length));

  return { global: glob, cards, piles: pileArr, nCards: tokens.length, nPiles: piles.length, cardIds: tokens.map((t) => t.t.id) };
}

// ---- The pooled vector ----

/**
 * The pooled vector (6,735, encoderV2Schema().pooled) from the stored arrays: the global block, then per group the count, the
 * sum (piles weighted by their copies) and, for some groups, the column-wise max of static ‖ gdef (‖ body for cards). The
 * masked positions are −1 when the viewer isn't deciding (written after pooling).
 */
export function poolV2(enc: Pick<EncodedV2, "global" | "cards" | "piles" | "nCards" | "nPiles">, prep: PreparedV2, out?: Float64Array): Float64Array {
  const schema = encoderV2Schema();
  const v = out ?? new Float64Array(schema.pooled.dims);
  v.fill(0);
  v.set(enc.global, 0);
  const nStatic = CARD_FEATURE_COLUMNS.length;
  const nGdef = GDEF_COLUMNS_V2.length;
  const nBody = CARD_BODY_COLUMNS_V2.length;
  // Each group's place in the vector (count, sum, max), by the zone codes that feed it.
  const places: ({ count: number; sum: number; max: number; seen: boolean } | undefined)[] = [];
  let at = GLOBAL_COLUMNS_V2.length;
  for (const g of POOL_LAYOUT_V2) {
    const width = g.kind === "card" ? nStatic + nGdef + nBody : nStatic + nGdef;
    const place = { count: at, sum: at + 1, max: g.parts.includes("max") ? at + 1 + width : -1, seen: false };
    for (const z of g.zones) places[z] = place;
    at += 1 + width * (g.parts.length - 1);
  }
  const sparseOf = (index: number) => {
    let sp = prep.sparse.get(index);
    if (!sp) {
      const pairs = index > 0 ? (prep.ctx.table.file.rows[prep.defIds[index - 1]!] ?? []) : [];
      if (pairs.some((x) => x[1] < 0)) throw new Error(`card-features.json: a negative value in ${prep.defIds[index - 1]}'s row (the pooled max assumes none)`);
      sp = { cols: Int32Array.from(pairs.map((x) => x[0])), vals: Int32Array.from(pairs.map((x) => x[1])) };
      prep.sparse.set(index, sp);
    }
    return sp;
  };
  for (const isCard of [true, false]) {
    const n = isCard ? enc.nCards : enc.nPiles;
    const stride = isCard ? CARD_WIDTH_V2 : PILE_COLUMNS_V2.length;
    const arr = isCard ? enc.cards : enc.piles;
    for (let i = 0; i < n; i++) {
      const r = i * stride;
      const place = places[arr[r]!];
      if (!place) continue;
      const mult = isCard ? 1 : arr[r + 3]!;
      const first = !place.seen;
      place.seen = true;
      v[place.count]! += mult;
      const { sum, max } = place;
      // Static: nonzero entries only (never negative, so a max starting at 0 is the max).
      const sp = sparseOf(arr[r + 1]!);
      for (let k = 0; k < sp.cols.length; k++) {
        const c = sp.cols[k]!;
        const x = sp.vals[k]!;
        v[sum + c]! += mult * x;
        if (max >= 0 && x > v[max + c]!) v[max + c] = x;
      }
      const gd = prep.gdRows[arr[r + 2]!]!;
      const gs = sum + nStatic;
      const gm = max + nStatic;
      for (let j = 0; j < nGdef; j++) {
        const x = gd[j]!;
        v[gs + j]! += mult * x;
        if (max >= 0 && (first || x > v[gm + j]!)) v[gm + j] = x;
      }
      if (isCard) {
        const bs = gs + nGdef;
        const bm = gm + nGdef;
        const b0 = r + BODY0;
        for (let j = 0; j < nBody; j++) {
          const x = arr[b0 + j]!;
          v[bs + j]! += x;
          if (max >= 0 && (first || x > v[bm + j]!)) v[bm + j] = x;
        }
      }
    }
  }
  if (enc.global[0] === 0) for (const i of schema.pooled.masked) v[i] = -1;
  return v;
}

// ---- Reading back ----

/** The global block's values by name, and a card row's or a pooled vector's. */
export function decodeV2(enc: Pick<EncodedV2, "global" | "cards" | "nCards">): { global(name: string): number; card(i: number, name: string): number } {
  return {
    global: (name) => {
      const i = G.get(name);
      if (i === undefined) throw new Error(`no global feature ${name}`);
      return enc.global[i]!;
    },
    card: (i, name) => {
      const j = name === "zone" ? 0 : name === "def" ? 1 : name === "gd" ? 2 : BODY0 + (B.get(name) ?? NaN);
      if (Number.isNaN(j)) throw new Error(`no card feature ${name}`);
      return enc.cards[i * CARD_WIDTH_V2 + j]!;
    },
  };
}

export { emptyDiagnosticsV2 };

/** Names for the print (cards by definition, traits by their Japanese string, keywords, counters); ids when not given. */
export interface DescribeV2Names {
  card?(def: DefId): string;
  trait?(trait: string): string;
  keyword?(keyword: string): string;
}

const PLAYER_NAMES: Record<PlayerType, string> = { medium: "中等 Bot", easy: "简单 Bot" };
const ZONE_CN: Record<string, string> = {
  "hand.me": "我方手牌",
  "field.me": "我方场上",
  "ex.me": "我方额外区",
  "hand.oppKnown": "对手手牌（看得到 / 记得的）",
  "field.opp": "对方场上",
  "ex.opp": "对方额外区",
  "cemLive.me": "我方墓场（有起作用的能力）",
  "cemLive.opp": "对方墓场（有起作用的能力）",
  "equip.me": "我方装备区",
  "equip.opp": "对方装备区",
  "cem.me": "我方墓场",
  "cem.opp": "对方墓场",
  "ban.me": "我方消失领域",
  "ban.opp": "对方消失领域（正面）",
  "evoDown.me": "我方进化牌组（背面）",
  "evoUp.me": "我方进化牌组（正面）",
  "evoUp.opp": "对方进化牌组（正面）",
  "evoLeft.opp": "对方剩下的进化卡",
  "deck.me": "我方牌组（剩下的牌，不知道顺序）",
  "unseen.opp": "对手没见过的牌（手牌 + 牌组 + 背面）",
  "misc.me": "我方其他区（赛道 / 驾驶 / 判定）",
  "misc.opp": "对方其他区（赛道 / 驾驶 / 判定）",
};
const CLASS_CN = ["中立", "精灵", "皇家护卫", "巫师", "龙族", "梦魇", "主教"];
const DEAD_CN: Record<string, string> = { resolved: "已结算，不计", notOnField: "只在场上起作用", abilitiesLost: "能力已失去", onEvolve: "进化时才计（看进化列）", notInZone: "不在这里起作用", notPlayable: "不能从这里使用", notSuperEvolvable: "不能超进化", notEvolvable: "已进化" };
const CLS_CN: Record<string, string> = { gate: "门槛", avail: "可选的对象", scale: "按数量", aff: "受影响的", bonus: "额外 / 分支", luck: "靠运气" };

/**
 * The position as encoder v2 stores it, in Chinese, for a person to check against the game. Encoded first; every number
 * printed with [向量里有] comes from the arrays; names (cards, traits) and per-reference lines are [只打印].
 */
export function describeV2(view: PlayerView, me: PlayerId, prep: PreparedV2, names: DescribeV2Names = {}): string {
  const trace = new Map<string, RefTrace[]>();
  const diag = emptyDiagnosticsV2();
  const enc = encodeV2(view, me, prep, diag, trace);
  const d = decodeV2(enc);
  const g = d.global;
  const table = prep.ctx.table;
  const cardName = (def: DefId) => names.card?.(def) ?? def;
  const traitName = (i: number) => (i < 0 ? "-" : (names.trait?.(table.file.traits[i]!) ?? table.file.traits[i]!));
  const opp = opponentOf(me);
  const who = (p: PlayerId | null) => (p === null ? "未定" : p === me ? "我" : "对手");
  const deciding = g("mask.decides") === 1;
  const L: string[] = [];
  L.push(
    `[向量里有] 编码器 v${ENCODER_V2_VERSION} · 第 ${g("g.turn")} 回合 · 行动方：${who(view.activePlayer)} · 先手：${who(view.firstPlayer)} · 我=${PLAYER_NAMES[prep.ctx.players[me]]} 对手=${PLAYER_NAMES[prep.ctx.players[opp]]} · 全局 ${GLOBAL_COLUMNS_V2.length} 维 + 卡 ${enc.nCards} 张 / 牌堆 ${enc.nPiles} 项 · ${deciding ? "我在决定" : "不是我在决定（能做什么 = 不知道）"}`,
  );
  for (const [s, side] of [
    ["me", me],
    ["opp", opp],
  ] as const) {
    const leader = view.players[side].leader;
    const cls = leader ? defFacts(table, infoDefOf(view, leader, table)).cls : -1;
    const universe = view.players[side].universe;
    L.push(
      `[向量里有] ${s === "me" ? "我" : "对手"}：${cls >= 0 ? CLASS_CN[cls] : "无主战者"}${universe ? ` · ${universe}` : ""} · 体力 ${g(`g.${s}.leaderDefense`)} · PP ${g(`g.${s}.pp`)}/${g(`g.${s}.maxPp`)} · 手牌 ${g(`g.${s}.hand.count`)}${s === "opp" ? `（背面 ${g("g.opp.hand.hidden")}，看得到或记得 ${g("g.opp.hand.known")}）` : ""} · 牌组 ${g(`g.${s}.deckCount`)}${s === "opp" ? ` · 对手没见过的牌 ${g("g.opp.unseen")} 张` : ""} · 进化：场上能同时进化 ${g(`g.${s}.evo.matchField`)} 个，算上手牌 ${g(`g.${s}.evo.matchAll`)} 个`,
    );
    L.push(`  [向量里有] 类型槽（张数）${[1, 2, 3, 4].map((k) => g(`g.${s}.slot.${k}`)).join(" / ")} · [只打印] 名称 ${prep.slots[side].map(traitName).join(" / ")}`);
  }
  L.push(`[向量里有] 两边共同的类型槽 ${g("g.slot.shared")} 个 · 对手手牌里有……的概率（按没见过的牌均匀估计）：${ODDS.map((f) => `${f} ${(g(`g.opp.odds.${f}`) / 10).toFixed(1)}%`).join(" · ")}`);
  for (const zone of ZONES_V2.filter((z) => z.kind === "card")) {
    const rows = [...Array(enc.nCards).keys()].filter((i) => enc.cards[i * CARD_WIDTH_V2] === zone.code);
    if (rows.length === 0) continue;
    L.push(`[向量里有] ${ZONE_CN[zone.name]} ${rows.length} 张`);
    for (const i of rows) {
      const c = (name: string) => d.card(i, name);
      const defIndex = c("def");
      const def = defIndex > 0 ? prep.defIds[defIndex - 1]! : "?";
      const R = defFacts(table, def);
      const gd = prep.gdRows[c("gd")]!;
      const slotBits = [0, 1, 2, 3].filter((k) => gd[2 + k] === 1).map((k) => k + 1);
      const kws = KW_NOW.filter((k) => c(`kw.now.${k}`) === 1).map((k) => names.keyword?.(k) ?? k);
      const stats = R.type === "follower" || c("follower.now") === 1 ? ` 攻 ${c("atk.now")} / 守 ${c("def.now")}` : "";
      const evo =
        R.type === "follower" && !R.evolved && c("evolved.now") === 0
          ? c("evo.left") > 0
            ? ` · 可进化：剩 ${c("evo.left")} 张（${c("evo.dAtk") >= 0 ? "+" : ""}${c("evo.dAtk")}/${c("evo.dDef") >= 0 ? "+" : ""}${c("evo.dDef")}）`
            : " · 不可进化（剩 0 张）"
          : "";
      L.push(
        `  · [只打印] ${cardName(def)}（${CLASS_CN[R.cls]} · ${R.type}）[向量里有] 费用 ${c("cost.now")}${stats}${kws.length ? ` · ${kws.join("、")}` : ""}${c("hiddenKnown") ? " · 记得的手牌" : ""}${slotBits.length ? ` · 本方类型槽 ${slotBits.join(",")}` : ""}${evo} · 同类型：场上 ${c("share.trait.field")} 手牌 ${c("share.trait.hand")} 墓场 ${c("share.trait.cemetery")} 牌池 ${c("share.trait.pool")} · 剩 ${c("self.left")} 张、墓场 ${c("self.cem")} 张`,
      );
      const rel = REL_COLUMNS_V2.map((n) => [n, c(n)] as const).filter(([, v]) => v !== 0);
      if (rel.length) L.push(`      [向量里有] ${rel.map(([n, v]) => `${n}=${v}`).join(" ")}`);
      for (const x of trace.get(enc.cardIds[i]!) ?? []) {
        if (!x.live) {
          L.push(`      [只打印] ${x.ref.timing} · ${x.ref.where}：${DEAD_CN[x.why] ?? x.why}`);
          continue;
        }
        if (x.partial || !x.count) {
          L.push(`      [只打印] ${x.ref.timing} · ${x.ref.where}：有读不懂的部分（只算进 rel.partial）`);
          continue;
        }
        const k = x.count;
        const head = `${x.ref.timing} · ${x.ref.where}${x.key.length ? `（${x.key.join("、")} 时）` : ""} · ${CLS_CN[x.cls!]}`;
        if (k.luck) {
          L.push(`      [只打印] ${head}：牌组顶 ${k.luck.t} 张，${x.odds ? `${(x.odds.p / 10).toFixed(1)}%` : ""}（剩 ${k.luck.N} 张里 ${k.luck.K} 张）`);
          continue;
        }
        const hidden = k.slots > 0 ? `，另有看不到的 ${k.slots} 张约 ${(x.e16 / 16).toFixed(2)} 张` : "";
        const test = x.test ? `，${x.test.kind} ${x.test.n}：${x.odds!.determined ? (x.odds!.value ? "满足" : "不满足") : `满足的概率 ${(x.odds!.p / 10).toFixed(1)}%（不确定）`}` : "";
        L.push(`      [只打印] ${head}：确定的 ${k.m} 张${k.m !== k.inPlace ? `（原地 ${k.inPlace}）` : ""}${hidden}${test}`);
      }
    }
  }
  for (const zone of ZONES_V2.filter((z) => z.kind === "pile")) {
    const rows = [...Array(enc.nPiles).keys()].filter((i) => enc.piles[i * 4] === zone.code);
    if (rows.length === 0) continue;
    const total = rows.reduce((s, i) => s + enc.piles[i * 4 + 3]!, 0);
    L.push(`[向量里有] ${ZONE_CN[zone.name]} ${total} 张：[只打印] ${rows.map((i) => `${cardName(prep.defIds[enc.piles[i * 4 + 1]! - 1] ?? "?")}×${enc.piles[i * 4 + 3]}`).join(" · ")}`);
  }
  const bad = Object.entries(diag).filter(([, v]) => v !== 0);
  if (bad.length) L.push(`[诊断] ${bad.map(([k, v]) => `${k}=${v}`).join(" ")}`);
  return L.join("\n") + "\n";
}
