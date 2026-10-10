import { CARD_CLASSES, opponentOf, type CardView, type DefId, type HiddenCardView, type PlayerId, type PlayerSideView, type PlayerView } from "./core";
import { CARD_FEATURE_COLUMNS, refPartial, type CardFeatureTable, type CardRef, type RefFilter, type RefTest } from "./card-features";
import { infoDefOf, type KnownDeck } from "./encoder";

/**
 * Encoder v2's counting of what a card counts (its references in the card feature table, version 3), in a position as one
 * player sees it. Fair by construction: only the viewer's PlayerView (with the cards it remembers, HiddenCardView.known),
 * both decks' card lists and the table — never the real game, never a card's own code. What the viewer can't see is counted
 * from the cards it hasn't seen: an exact count for what it sees or knows (its own deck is its list minus every card of
 * its own it sees), and for the opponent's hidden cards a draw from their unseen cards (the uniform-draw prior: a
 * hypergeometric distribution, computed exactly with whole numbers). The deck's top cards are luck: nobody knows their
 * order (CR 4.5.2), so they are a draw too, even for a position the viewer once saw.
 * Each card gets 38 REL columns: how many of its references are live where it is, and, by kind of reference (a gate, a
 * choice of target, a quantity, a bonus, luck...), how many are met, uncertain, and how far from met.
 */

/** The diagnostics encoder v2 counts (the tools require the first group 0 over the data, and report the second). */
export interface EncodeDiagnosticsV2 {
  saturations: number;
  unknownDefs: number;
  poolClamps: number;
  poolMismatch: number;
  noTest: number;
  refRandom: number;
  maskBad: number;
  knownNotInList: number;
  refZoneOther: number;
  oppAlt: number;
}

export function emptyDiagnosticsV2(): EncodeDiagnosticsV2 {
  return { saturations: 0, unknownDefs: 0, poolClamps: 0, poolMismatch: 0, noTest: 0, refRandom: 0, maskBad: 0, knownNotInList: 0, refZoneOther: 0, oppAlt: 0 };
}

/** A card token's 38 REL columns, in order. */
export const REL_COLUMNS_V2: readonly string[] = [
  "rel.live",
  "rel.dead",
  "rel.partial",
  "rel.moved",
  "rel.unc",
  "gate.n",
  "gate.ok",
  "gate.unc",
  "gate.p",
  "gate.gap",
  "avail.n",
  "avail.ok",
  "avail.unc",
  "avail.p",
  "avail.m",
  "scale.n",
  "scale.m",
  "scale.rem",
  "scale.e16",
  "aff.n",
  "aff.m",
  "aff.e16",
  "bonus.n",
  "bonus.ok",
  "bonus.unc",
  "luck.n",
  "luck.p",
  "luck.e16",
  "alt.groups",
  "alt.ok",
  "alt.unc",
  "rz.own.field",
  "rz.own.cemetery",
  "rz.own.hand",
  "rz.own.deck",
  "rz.own.other",
  "rz.opp.field",
  "rz.opp.other",
];
const REL = new Map(REL_COLUMNS_V2.map((c, i) => [c, i]));

// ---- What a definition is, from its table row (process cache by table) ----

/** A definition's printed facts and the table's flags the encoder reads. */
export interface DefFacts {
  def: DefId;
  /** 1-based position in the table's sorted definitions; 0: not in the table. */
  index: number;
  known: boolean;
  type: string;
  cost: number | null;
  atk: number | null;
  dfn: number | null;
  evolved: boolean;
  token: boolean;
  entersEngaged: boolean;
  /** Indices into the table's traits (CR 2.4). */
  traits: readonly number[];
  /** Index into CARD_CLASSES. */
  cls: number;
  /** It can remove an enemy card (damage, destroy, banish); or that, or damage to each. */
  removal: boolean;
  removalOrAoe: boolean;
  actEvolve: number;
  autoOnEvolve: number;
  playFromCemetery: boolean;
}

const COLUMN = new Map(CARD_FEATURE_COLUMNS.map((c, i) => [c, i]));
const col = (name: string) => COLUMN.get(name)!;
const TYPE_NAMES = ["follower", "amulet", "spell", "crest", "equipment"] as const;
const FACTS = new WeakMap<CardFeatureTable, { facts: Map<DefId, DefFacts>; index: Map<DefId, number>; traitIndex: Map<string, number>; preds: Map<string, Pred>; byObject: WeakMap<RefFilter, Pred> }>();

function tableCache(table: CardFeatureTable) {
  let c = FACTS.get(table);
  if (!c) {
    const ids = Object.keys(table.file.rows).sort();
    c = { facts: new Map(), index: new Map(ids.map((id, i) => [id, i + 1])), traitIndex: new Map(table.file.traits.map((t, i) => [t, i])), preds: new Map(), byObject: new WeakMap() };
    FACTS.set(table, c);
  }
  return c;
}

/** A definition's facts, read from its table row once per process. */
export function defFacts(table: CardFeatureTable, def: DefId): DefFacts {
  const cache = tableCache(table);
  let f = cache.facts.get(def);
  if (f) return f;
  const row = table.row(def);
  const type = TYPE_NAMES.find((t) => row[col(`type.${t}`)] === 1) ?? "leader";
  const cls = CARD_CLASSES.findIndex((_, i) => row[col(CARD_FEATURE_COLUMNS.filter((x) => x.startsWith("cls."))[i]!)] === 1);
  const follower = type === "follower";
  const removal = row[col("fx.dmg")]! + row[col("fx.destroy")]! + row[col("fx.banish")]! > 0;
  f = {
    def,
    index: cache.index.get(def) ?? 0,
    known: table.known(def),
    type,
    cost: row[col("cost.null")] === 1 || !table.known(def) ? null : row[col("cost")]!,
    atk: follower ? row[col("atk")]! : null,
    dfn: follower ? row[col("def")]! : null,
    evolved: row[col("evolved")] === 1,
    token: row[col("token")] === 1,
    entersEngaged: row[col("entersEngaged")] === 1,
    traits: table.traitsOf(def),
    cls: Math.max(0, cls),
    removal,
    removalOrAoe: removal || row[col("fx.aoe")]! > 0,
    actEvolve: row[col("act.evolve")]!,
    autoOnEvolve: row[col("auto.onEvolve")]!,
    playFromCemetery: row[col("play.fromCemetery")]! > 0,
  };
  cache.facts.set(def, f);
  return f;
}

// ---- A card as references read it ----

/**
 * What a reference's filter reads of a card (the scripts' g.info): its information definition, current type, cost, attack
 * and defense, whether it is evolved, a token, engaged or racing, its id (for "not this card") and its printed traits and
 * class. A card of a pile (a definition only) has its printed facts and no id.
 */
export interface Facts {
  info: DefId;
  type: string;
  cost: number | null;
  atk: number | null;
  dfn: number | null;
  evolved: boolean;
  token: boolean;
  engaged: boolean;
  racing: boolean;
  id: string | null;
  traits: readonly number[];
  cls: number;
}

/** A definition's printed facts as a card (a pile entry, a remembered card, a card about to enter or die). */
export function factsOfDef(table: CardFeatureTable, def: DefId, id: string | null = null, engaged = false): Facts {
  const d = defFacts(table, def);
  return { info: def, type: d.type, cost: d.cost, atk: d.atk, dfn: d.dfn, evolved: d.evolved, token: d.token, engaged, racing: false, id, traits: d.traits, cls: d.cls };
}

type Pred = (f: Facts, self: string | null) => boolean;

/** A reference's filter as a test on a card (compiled once per process per filter). */
export function compileFilter(table: CardFeatureTable, filter: RefFilter): Pred {
  const cache = tableCache(table);
  const known = cache.byObject.get(filter);
  if (known) return known;
  const key = JSON.stringify(filter);
  let p = cache.preds.get(key);
  if (p) {
    cache.byObject.set(filter, p);
    return p;
  }
  const build = (f: RefFilter): Pred => {
    switch (f.t) {
      case "any":
      case "other":
        return () => true;
      case "type":
        return (x) => x.type === f.v;
      case "trait": {
        const i = cache.traitIndex.get(f.v) ?? -1;
        return (x) => i >= 0 && x.traits.includes(i);
      }
      case "class": {
        const i = (CARD_CLASSES as readonly string[]).indexOf(f.v);
        return (x) => x.cls === i;
      }
      case "defs": {
        const s = new Set(f.v);
        return (x) => s.has(x.info);
      }
      // Names are compiled into definitions by the table; one left as a name matches nothing it can tell.
      case "name":
      case "nameIncludes":
        return () => false;
      case "costMin":
        return (x) => x.cost !== null && x.cost >= f.v;
      case "costMax":
        return (x) => x.cost !== null && x.cost <= f.v;
      case "atkMin":
        return (x) => x.atk !== null && x.atk >= f.v;
      case "atkMax":
        return (x) => x.atk !== null && x.atk <= f.v;
      case "defMin":
        return (x) => x.dfn !== null && x.dfn >= f.v;
      case "defMax":
        return (x) => x.dfn !== null && x.dfn <= f.v;
      case "evolved":
        return (x) => x.evolved;
      case "unevolved":
        return (x) => !x.evolved;
      case "token":
        return (x) => x.token;
      case "notSelf":
        return (x, self) => x.id === null || x.id !== self;
      case "racing":
        return (x) => x.racing;
      case "engaged":
        return (x) => x.engaged;
      case "and": {
        const ps = f.args.map(build);
        return (x, s) => ps.every((q) => q(x, s));
      }
      case "or": {
        const ps = f.args.map(build);
        return (x, s) => ps.some((q) => q(x, s));
      }
      case "not": {
        const q = build(f.arg);
        return (x, s) => !q(x, s);
      }
    }
  };
  p = build(filter);
  cache.preds.set(key, p);
  cache.byObject.set(filter, p);
  return p;
}

// ---- Exact arithmetic: the hypergeometric draw ----

const PASCAL: bigint[][] = [[1n]];
/** C(n, k) exactly (a Pascal table, extended as needed). */
export function binom(n: number, k: number): bigint {
  if (k < 0 || k > n || n < 0) return 0n;
  while (PASCAL.length <= n) {
    const prev = PASCAL[PASCAL.length - 1]!;
    const row = [1n];
    for (let i = 1; i < prev.length; i++) row.push(prev[i - 1]! + prev[i]!);
    row.push(1n);
    PASCAL.push(row);
  }
  return PASCAL[n]![k]!;
}

/** a / b rounded half-up to thousandths: floor((2000a + b) / (2b)). */
export function round1000(a: bigint, b: bigint): number {
  return Number((2000n * a + b) / (2n * b));
}

/** The expected matches of n draws from N cards with K matching, in sixteenths, rounded half-up (0 when N is 0). */
export function e16(N: number, K: number, n: number): number {
  if (N === 0) return 0;
  return Math.floor((32 * n * K + N) / (2 * N));
}

/** Whether a count meets a test (RefTest's kind and n). */
export function meets(t: Pick<RefTest, "kind" | "n">, count: number): boolean {
  switch (t.kind) {
    case "atLeast":
      return count >= t.n;
    case "atMost":
      return count <= t.n;
    case "exactly":
      return count === t.n;
    case "notExactly":
      return count !== t.n;
  }
}

export interface Odds {
  /** The test has one value whatever the hidden cards are. */
  determined: boolean;
  /** Its value when determined. */
  value: boolean;
  /** Thousandths: 0 / 1000 when determined, else 1–999. */
  p: number;
  /** The smallest and largest number of hidden matches possible. */
  lo: number;
  hi: number;
}

const MEMO = new Map<string, Odds>();
/**
 * A test on m + X, X the matches among n cards drawn from N with K matching (X ≡ 0 when n is 0): determined when every
 * possible X gives the same answer (then 0 or 1000), else the exact probability in thousandths, kept within 1–999 (only what
 * the viewer's knowledge makes certain is 0 or 1).
 */
export function odds(N: number, K: number, n: number, m: number, t: Pick<RefTest, "kind" | "n">): Odds {
  const lo = n === 0 || N === 0 ? 0 : Math.max(0, n - (N - K));
  const hi = n === 0 || N === 0 ? 0 : Math.min(K, n);
  const first = meets(t, m + lo);
  let determined = true;
  for (let x = lo + 1; x <= hi; x++) if (meets(t, m + x) !== first) determined = false;
  if (determined) return { determined, value: first, p: first ? 1000 : 0, lo, hi };
  const key = `${N},${K},${n},${m},${t.kind},${t.n}`;
  const memo = MEMO.get(key);
  if (memo) return memo;
  let num = 0n;
  for (let x = lo; x <= hi; x++) if (meets(t, m + x)) num += binom(K, x) * binom(N - K, n - x);
  const p = Math.min(999, Math.max(1, round1000(num, binom(N, n))));
  const out = { determined: false, value: false, p, lo, hi };
  if (MEMO.size >= 65536) MEMO.clear();
  MEMO.set(key, out);
  return out;
}

// ---- The counting domain: what the viewer sees and knows, by side and zone ----

/** The zones a reference names that are counted (leader and "other" are not: the reference is partial). */
export const COUNTED_ZONES = ["field", "cemetery", "hand", "deck", "ex", "evolveDeck", "banished", "evolveZone"] as const;
export type CountedZone = (typeof COUNTED_ZONES)[number];

/** Cards of a zone: exact ones (each with its facts and copies), and slots of the opponent's unseen cards. */
export interface Part {
  exact: { f: Facts; n: number }[];
  unknown: number;
}

/** A multiset of definitions (a pile, a pool). */
export type Multiset = Map<DefId, number>;

export interface RefDomain {
  view: PlayerView;
  me: PlayerId;
  table: CardFeatureTable;
  /** By seat, by zone. */
  zones: [Record<CountedZone, Part>, Record<CountedZone, Part>];
  /** My deck: my main list minus every card of mine I see (its composition is exact; its order is not known). */
  deckMe: Multiset;
  deckMeN: number;
  /** U: the opponent's main list minus their cards I see or remember; the pool their hidden cards are drawn from. */
  unseen: Multiset;
  N: number;
  /** The opponent's evolve list minus their evolve cards I see (exact under D6: lists are known). */
  evoLeftOpp: Multiset;
  /** My face-down evolve deck (I see it, CR 4.6.2). */
  evoDownMe: Multiset;
  /** The opponent's hidden hand cards I don't remember. */
  hiddenHandOpp: number;
  /** The opponent's hand cards I see or remember, with whether I see them now. */
  knownHandOpp: { id: string; def: DefId; revealed: boolean; card: CardView | null }[];
  /** Pool entries' facts (cached per view). */
  poolFacts: Map<DefId, Facts>;
  /** Cards with a race-zone card linked to them. */
  racing: Set<string>;
}

const visible = (c: CardView | HiddenCardView): c is CardView => !c.hidden;

/** A visible card's facts (its information definition's printed traits and class, its current type, cost and stats). */
export function factsOfCard(dom: Pick<RefDomain, "view" | "table" | "racing">, c: CardView): Facts {
  const info = infoDefOf(dom.view, c, dom.table);
  const r = defFacts(dom.table, info);
  return {
    info,
    type: c.type,
    cost: c.cost,
    atk: c.attack,
    dfn: c.defense,
    evolved: r.evolved || c.evolvedWith !== null,
    token: defFacts(dom.table, c.def).token,
    engaged: c.engaged,
    racing: dom.racing.has(c.id),
    id: c.id,
    traits: r.traits,
    cls: r.cls,
  };
}

/** The one place a remembered hidden card is read (HiddenCardView.known, D19). */
function remembered(c: CardView | HiddenCardView): DefId | null {
  return c.hidden ? (c.known?.def ?? null) : null;
}

/** A list minus the cards seen; clamps a negative to 0 (counted). */
function minus(list: ReadonlyMap<DefId, number>, seen: ReadonlyMap<DefId, number>, diag?: EncodeDiagnosticsV2): Multiset {
  const out: Multiset = new Map();
  for (const [def, n] of list) {
    let left = n - (seen.get(def) ?? 0);
    if (left < 0) {
      if (diag) diag.poolClamps += 1;
      left = 0;
    }
    if (left > 0) out.set(def, left);
  }
  return out;
}

const total = (m: ReadonlyMap<DefId, number>) => {
  let n = 0;
  for (const v of m.values()) n += v;
  return n;
};

/**
 * The cards of an owner the view shows (v1's rule: every visible card of theirs in every zone of both sides and the
 * resolution zone, face-down evolve cards left out: they are in the evolve list's pile).
 */
export function seenCards(view: PlayerView, owner: PlayerId): Multiset {
  const m: Multiset = new Map();
  const add = (c: CardView | HiddenCardView) => {
    if (visible(c) && c.owner === owner) m.set(c.def, (m.get(c.def) ?? 0) + 1);
  };
  for (const side of view.players) {
    for (const zone of [side.hand, side.field, side.ex, side.cemetery, side.banished, side.evolveZone, side.raceZone, side.driveZone, side.triggerZone, side.equipmentZone]) for (const c of zone) add(c);
    for (const c of side.evolveDeck) if (!(visible(c) && !c.faceUp)) add(c);
  }
  for (const c of view.resolution) add(c);
  return m;
}

const hiddenCount = (cards: readonly (CardView | HiddenCardView)[]) => cards.filter((c) => c.hidden && remembered(c) === null).length;
const faceDownEvolve = (s: PlayerSideView) => s.evolveDeck.filter((c) => c.hidden || !c.faceUp).length;

/** The counting domain of a view (once per view). */
export function refDomain(view: PlayerView, me: PlayerId, table: CardFeatureTable, decks: readonly [KnownDeck, KnownDeck], diag?: EncodeDiagnosticsV2): RefDomain {
  if (view.viewer !== me) throw new Error(`the view is player ${view.viewer}'s, not ${me}'s`);
  const opp = opponentOf(me);
  const racing = new Set<string>();
  for (const side of view.players) for (const c of side.raceZone) if (c.linkedTo !== null) racing.add(c.linkedTo);
  const base = { view, table, racing };
  const theirs = view.players[opp];

  // The opponent's cards I remember (hand, field, banished): exact, and out of their unseen pool.
  const rememberedOpp: Multiset = new Map();
  for (const zone of [theirs.hand, theirs.field, theirs.banished]) {
    for (const c of zone) {
      const d = remembered(c);
      if (d === null) continue;
      rememberedOpp.set(d, (rememberedOpp.get(d) ?? 0) + 1);
      if (!decks[opp].main.has(d) && diag) diag.knownNotInList += 1;
    }
  }
  const seenMe = seenCards(view, me);
  const seenOpp = seenCards(view, opp);
  const deckMe = minus(decks[me].main, seenMe, diag);
  const seenOrRemembered: Multiset = new Map(seenOpp);
  for (const [d, n] of rememberedOpp) seenOrRemembered.set(d, (seenOrRemembered.get(d) ?? 0) + n);
  const unseen = minus(decks[opp].main, seenOrRemembered, diag);
  const evoLeftOpp = minus(decks[opp].evolve, seenOpp, diag);
  const evoDownMe: Multiset = new Map();
  for (const c of view.players[me].evolveDeck) if (visible(c) && !c.faceUp) evoDownMe.set(c.def, (evoDownMe.get(c.def) ?? 0) + 1);
  const hiddenHandOpp = hiddenCount(theirs.hand);
  const N = total(unseen);
  if (diag) {
    if (total(deckMe) !== view.players[me].deckCount) diag.poolMismatch += 1;
    if (N !== hiddenHandOpp + theirs.deckCount + hiddenCount(theirs.banished) + hiddenCount(theirs.field)) diag.poolMismatch += 1;
    if (total(evoLeftOpp) !== faceDownEvolve(theirs)) diag.poolMismatch += 1;
    if (total(minus(decks[me].evolve, seenMe)) !== faceDownEvolve(view.players[me])) diag.poolMismatch += 1;
  }

  const poolFacts = new Map<DefId, Facts>();
  const pf = (def: DefId) => {
    let f = poolFacts.get(def);
    if (!f) poolFacts.set(def, (f = factsOfDef(table, def)));
    return f;
  };
  const pile = (m: Multiset): Part => ({ exact: [...m].map(([d, n]) => ({ f: pf(d), n })), unknown: 0 });
  const cards = (list: readonly (CardView | HiddenCardView)[]): Part => {
    const part: Part = { exact: [], unknown: 0 };
    for (const c of list) {
      if (visible(c)) part.exact.push({ f: factsOfCard(base, c), n: 1 });
      else {
        const d = remembered(c);
        if (d !== null) part.exact.push({ f: factsOfDef(table, d, c.id), n: 1 });
        else part.unknown += 1;
      }
    }
    return part;
  };
  const zonesOf = (p: PlayerId): Record<CountedZone, Part> => {
    const s = view.players[p];
    const mine = p === me;
    const z: Record<CountedZone, Part> = {
      field: cards(s.field),
      cemetery: cards(s.cemetery),
      hand: cards(s.hand),
      deck: mine ? pile(deckMe) : { exact: [], unknown: s.deckCount },
      ex: cards(s.ex),
      evolveDeck: mine ? cards(s.evolveDeck) : { exact: [...cards(s.evolveDeck.filter((c) => visible(c) && c.faceUp)).exact, ...pile(evoLeftOpp).exact], unknown: 0 },
      banished: cards(s.banished),
      evolveZone: cards(s.evolveZone),
    };
    // My own zones hold no card I can't see (the deck is its pile).
    if (mine && diag) for (const k of COUNTED_ZONES) if (k !== "deck" && z[k].unknown > 0) diag.poolMismatch += 1;
    if (mine) for (const k of COUNTED_ZONES) if (k !== "deck") z[k].unknown = 0;
    return z;
  };
  const knownHandOpp: RefDomain["knownHandOpp"] = [];
  for (const c of theirs.hand) {
    if (visible(c)) knownHandOpp.push({ id: c.id, def: infoDefOf(view, c, table), revealed: true, card: c });
    else if (remembered(c) !== null) knownHandOpp.push({ id: c.id, def: remembered(c)!, revealed: false, card: null });
  }
  const zones: [Record<CountedZone, Part>, Record<CountedZone, Part>] = [zonesOf(0), zonesOf(1)];
  return { view, me, table, zones, deckMe, deckMeN: total(deckMe), unseen, N, evoLeftOpp, evoDownMe, hiddenHandOpp, knownHandOpp, poolFacts, racing };
}

// ---- A card token and its references ----

/** Where a token is: the Core zone (its side is `side`). */
export type TokenZone = "hand" | "field" | "ex" | "cemetery" | "equipmentZone";

/** A card whose references are counted: a visible card, or an opponent's hand card the viewer remembers. */
export interface RefToken {
  zone: TokenZone;
  /** The player whose zone it is in (its controller). */
  side: PlayerId;
  id: string;
  /** Its information definition (whose references count). */
  def: DefId;
  /** Its physical definition. */
  phys: DefId;
  /** Null for a remembered hidden card. */
  card: CardView | null;
}

/** A token for a visible card. */
export function cardToken(dom: Pick<RefDomain, "view" | "table">, zone: TokenZone, side: PlayerId, c: CardView): RefToken {
  return { zone, side, id: c.id, def: infoDefOf(dom.view, c, dom.table), phys: c.def, card: c };
}

/** The classes of references (first match wins). */
export type RefClass = "luck" | "scale" | "avail" | "gate" | "bonus" | "aff";
const AVAIL_WHERE = new Set(["target", "targetCondition", "choose", "filter", "search", "searchEach", "fromEvolveDeck", "topCard", "canPay", "pay"]);

export function refClass(r: CardRef): RefClass {
  if (r.chance) return "luck";
  if (r.scaled) return "scale";
  if (AVAIL_WHERE.has(r.where)) return "avail";
  if (r.test?.role === "gate") return "gate";
  if (r.test) return "bonus";
  return "aff";
}

/** How a reference is counted for a token: where the card is, or where it goes when its ability happens. */
export type Placement = "inPlace" | "play" | "die" | "evolve";

/** Why a reference is not live (null: it is). */
export function liveness(dom: RefDomain, t: RefToken, r: CardRef): { live: boolean; why: string; placement: Placement } {
  const R = defFacts(dom.table, t.def);
  const onBoard = t.zone === "field" || t.zone === "equipmentZone" || (t.zone === "ex" && R.type === "crest");
  if (onBoard && t.card && (t.card.abilitiesLost || t.card.boxed)) return { live: false, why: "abilitiesLost", placement: "inPlace" };
  // What an equipment token gives its follower goes with the follower's abilities (lost, Boxed: CR 5.31.2).
  if (r.key === "equipment" && t.card?.linkedTo) {
    const follower = dom.view.players.flatMap((s) => s.field).find((c) => c.id === t.card!.linkedTo);
    if (follower && !follower.hidden && (follower.abilitiesLost || follower.boxed)) return { live: false, why: "abilitiesLost", placement: "inPlace" };
  }
  // Cards are played from the hand, the EX area (a crest there is not played) and, for some, the cemetery.
  const playable = t.zone === "hand" || (t.zone === "ex" && R.type !== "crest") || (t.zone === "cemetery" && R.playFromCemetery);
  const from = r.from as readonly string[];
  switch (r.timing) {
    case "fanfare":
    case "spell":
      return playable ? { live: true, why: "", placement: "play" } : { live: false, why: "resolved", placement: "inPlace" };
    case "fromHand":
      return playable && from.includes(t.zone) ? { live: true, why: "", placement: "inPlace" } : { live: false, why: "notPlayable", placement: "inPlace" };
    case "lastWords":
      return t.zone === "field" ? { live: true, why: "", placement: "die" } : { live: false, why: "notOnField", placement: "inPlace" };
    case "onEvolve":
      return { live: false, why: "onEvolve", placement: "inPlace" };
    // A follower super-evolves only as it evolves (CR 12.2.4; an evolved card can't evolve again, 12.2.5): like On Evolve,
    // counted through the follower that would evolve (evolveRefColumns).
    case "onSuperEvolve":
      return { live: false, why: "onEvolve", placement: "inPlace" };
    case "evolve":
      return t.zone === "field" && t.card?.evolvedWith === null ? { live: true, why: "", placement: "inPlace" } : { live: false, why: "notEvolvable", placement: "inPlace" };
    default:
      // A card's own keywords mean nothing in its cemetery unless it can be played from there.
      if (r.key === "selfKeywords" && t.zone === "cemetery" && !R.playFromCemetery) return { live: false, why: "notInZone", placement: "inPlace" };
      return from.includes(t.zone) ? { live: true, why: "", placement: "inPlace" } : { live: false, why: "notInZone", placement: "inPlace" };
  }
}

/** A change of the counting domain: the token's card leaves its zone, and a card enters one. */
interface Move {
  remove: { side: PlayerId; zone: CountedZone; id: string } | null;
  add: { side: PlayerId; zone: CountedZone; f: Facts } | null;
  /** Evolve: the card itself counts with these facts. */
  replace: { id: string; f: Facts } | null;
}
const STAY: Move = { remove: null, add: null, replace: null };

/** The move a placement makes for a token (CR: a played card leaves its zone, a follower or amulet enters the field...). */
function moveOf(dom: RefDomain, t: RefToken, placement: Placement, timing: string): Move {
  if (placement === "play") {
    const zone: CountedZone | null = t.zone === "hand" || t.zone === "ex" || t.zone === "cemetery" ? t.zone : null;
    const R = defFacts(dom.table, t.def);
    // A fanfare's card enters its controller's field (a follower or amulet) or EX area (a crest); a spell enters nothing.
    const enters = timing === "fanfare" ? (R.type === "follower" || R.type === "amulet" ? "field" : R.type === "crest" ? "ex" : null) : null;
    return {
      remove: zone ? { side: t.side, zone, id: t.id } : null,
      add: enters ? { side: t.side, zone: enters, f: { ...factsOfDef(dom.table, t.def, t.id, R.entersEngaged), evolved: false } } : null,
      replace: null,
    };
  }
  if (placement === "die") {
    // It leaves the field; a token ceases to exist (CR 9.1.4.4), any other card goes to its owner's cemetery as a new object
    // with its physical definition's facts (4.1.4.1).
    const P = defFacts(dom.table, t.phys);
    const owner = t.card?.owner ?? t.side;
    return { remove: { side: t.side, zone: "field", id: t.id }, add: P.token ? null : { side: owner, zone: "cemetery", f: factsOfDef(dom.table, t.phys, t.id) }, replace: null };
  }
  return STAY;
}

/** One reference counted: the certain count (after the move), by zone, and the hidden part. */
export interface RefCount {
  m: number;
  /** The certain count where the card is (no move). */
  inPlace: number;
  /** Certain counts by (own / opp relative to the token's controller, zone). */
  byZone: Map<string, number>;
  /** Slots of the opponent's unseen cards the reference counts, and how many of their unseen cards match. */
  slots: number;
  K: number;
  /** Luck: draws from a pool (the deck's top), certain count 0. */
  luck: { N: number; K: number; t: number } | null;
}

function countRef(dom: RefDomain, r: CardRef, t: RefToken, self: string, move: Move): RefCount {
  const pred = compileFilter(dom.table, r.filter);
  const ctrl = t.side;
  const other = opponentOf(ctrl);
  const sides: PlayerId[] = r.side === "own" ? [ctrl] : r.side === "opp" ? [other] : [ctrl, other];
  if (r.chance === "top") {
    // The top N cards of a deck (CR 5.11): a draw from what the viewer knows is in it, never the real order (D23).
    const q = sides[0]!;
    const pool = q === dom.me ? dom.deckMe : dom.unseen;
    const N = q === dom.me ? dom.deckMeN : dom.N;
    let K = 0;
    for (const [d, n] of pool) if (pred(poolFact(dom, d), self)) K += n;
    const deckCount = dom.view.players[q].deckCount;
    return { m: 0, inPlace: 0, byZone: new Map(), slots: 0, K: 0, luck: { N, K, t: Math.min(r.top ?? 1, deckCount, N) } };
  }
  let m = 0;
  let inPlace = 0;
  let slots = 0;
  const byZone = new Map<string, number>();
  // "With different names": the certain part counts distinct information definitions (the table has no names; a name's
  // definitions are its printings, merged).
  const distinctNow = r.distinct ? new Set<DefId>() : null;
  const distinctMoved = r.distinct ? new Set<DefId>() : null;
  for (const q of sides) {
    for (const z of r.zones) {
      if (!(COUNTED_ZONES as readonly string[]).includes(z)) continue;
      const part = dom.zones[q][z as CountedZone];
      let here = 0;
      let moved = 0;
      for (const e of part.exact) {
        const f = move.replace && e.f.id === move.replace.id ? move.replace.f : e.f;
        const hit = pred(e.f, self) ? e.n : 0;
        if (hit > 0) distinctNow?.add(e.f.info);
        here += hit;
        if (move.remove && move.remove.side === q && move.remove.zone === z && e.f.id === move.remove.id) continue;
        const after = f === e.f ? hit : pred(f, self) ? e.n : 0;
        if (after > 0) distinctMoved?.add(f.info);
        moved += after;
      }
      if (move.add && move.add.side === q && move.add.zone === z && pred(move.add.f, self)) {
        moved += 1;
        distinctMoved?.add(move.add.f.info);
      }
      slots += part.unknown;
      inPlace += here;
      m += moved;
      const key = `${q === ctrl ? "own" : "opp"}.${z}`;
      byZone.set(key, (byZone.get(key) ?? 0) + moved);
    }
  }
  if (distinctNow && distinctMoved) {
    inPlace = distinctNow.size;
    m = distinctMoved.size;
  }
  let K = 0;
  if (slots > 0) for (const [d, n] of dom.unseen) if (pred(poolFact(dom, d), self)) K += n;
  return { m, inPlace, byZone, slots, K, luck: null };
}

function poolFact(dom: RefDomain, def: DefId): Facts {
  let f = dom.poolFacts.get(def);
  if (!f) dom.poolFacts.set(def, (f = factsOfDef(dom.table, def)));
  return f;
}

/** What one reference of a token gives (the trace sink's line, and what the columns sum). */
export interface RefTrace {
  index: number;
  ref: CardRef;
  live: boolean;
  why: string;
  partial: boolean;
  cls: RefClass | null;
  /** The choice key (alt tokens without the opponent's choices): empty for a base reference. */
  key: string[];
  placement: Placement;
  count: RefCount | null;
  /** The test used (the reference's, or "at least 1" for a choice of target or luck), and its odds. */
  test: Pick<RefTest, "kind" | "n"> | null;
  odds: Odds | null;
  /** Expected hidden (or lucky) matches in sixteenths. */
  e16: number;
  /** Genuinely uncertain: a hidden part or luck with more than one possible count. */
  unc: boolean;
}

/** The test a reference is judged by: its own, or "at least 1" for a choice of target and luck. */
function testOf(r: CardRef, cls: RefClass): Pick<RefTest, "kind" | "n"> | null {
  if (r.test) return r.test;
  return cls === "avail" || cls === "luck" ? { kind: "atLeast", n: 1 } : null;
}

const ZONE_BUCKET: Record<string, "field" | "cemetery" | "hand" | "deck" | "other"> = { field: "field", cemetery: "cemetery", hand: "hand", deck: "deck" };
const cap = (v: number, hi: number) => Math.min(hi, Math.max(0, v));

/** Evaluates one reference of a token with a placement (exported for the evolve columns and the tests). */
export function evaluateRef(dom: RefDomain, t: RefToken, r: CardRef, index: number, diag?: EncodeDiagnosticsV2, override?: { placement: Placement; move: Move; live: boolean; why: string }): RefTrace {
  const zonesOk = r.zones.every((z) => (COUNTED_ZONES as readonly string[]).includes(z));
  if (!zonesOk && diag) diag.refZoneOther += 1;
  if (r.chance === "random" && diag) diag.refRandom += 1;
  const opp = (r.alt ?? []).filter((a) => a.startsWith("opp") || a.startsWith("!opp"));
  if (opp.length > 0 && diag) diag.oppAlt += 1;
  const key = (r.alt ?? []).filter((a) => !(a.startsWith("opp") || a.startsWith("!opp"))).sort();
  const lv = override ?? liveness(dom, t, r);
  // A side "?" or a deck-top look at both decks can't be counted as written.
  const partial = refPartial(r.filter) || r.side === "?" || !zonesOk || (r.chance !== undefined && r.side !== "own" && r.side !== "opp") || r.chance === "random";
  const cls = partial ? null : refClass(r);
  if (cls === "aff" && r.threshold && diag) diag.noTest += 1;
  const trace: RefTrace = { index, ref: r, live: lv.live, why: lv.why, partial, cls, key, placement: lv.placement, count: null, test: null, odds: null, e16: 0, unc: false };
  if (!lv.live || partial) return trace;
  // Different names among hidden cards can't be drawn as one count: partial when it needs two or more.
  if (r.distinct && (r.test?.n ?? 1) >= 2 && countRef(dom, r, t, t.id, STAY).slots > 0) {
    trace.partial = true;
    trace.cls = null;
    return trace;
  }
  // "Not this card": the card itself; for an equipment token's passive given to its follower, the equipped follower.
  const self = r.key === "equipment" && t.card?.linkedTo ? t.card.linkedTo : t.id;
  const move = override?.move ?? moveOf(dom, t, lv.placement, r.timing);
  const count = countRef(dom, r, t, self, move);
  trace.count = count;
  const test = testOf(r, cls!);
  trace.test = test;
  if (count.luck) {
    const { N, K, t: draws } = count.luck;
    trace.e16 = Math.min(1008, e16(N, K, draws));
    if (test) trace.odds = odds(N, K, draws, 0, test);
    trace.unc = N > 0 && Math.max(0, draws - (N - K)) < Math.min(K, draws);
  } else {
    trace.e16 = count.slots > 0 ? Math.min(1008, e16(dom.N, count.K, count.slots)) : 0;
    if (count.slots > dom.N && diag) diag.poolMismatch += 1;
    const n = Math.min(count.slots, dom.N);
    if (test) trace.odds = odds(dom.N, count.K, n, count.m, test);
    trace.unc = n > 0 && Math.max(0, n - (dom.N - count.K)) < Math.min(count.K, n);
  }
  return trace;
}

/** Distance from a test's flip, for a determined-false test (min 15 is applied by the caller). */
function gap(t: Pick<RefTest, "kind" | "n">, m: number, o: Odds): number {
  switch (t.kind) {
    case "atLeast":
      return t.n - (m + o.hi);
    case "atMost":
      return m + o.lo - t.n;
    case "exactly": {
      let best = Infinity;
      for (let x = o.lo; x <= o.hi; x++) best = Math.min(best, Math.abs(m + x - t.n));
      return best;
    }
    case "notExactly":
      return 1;
  }
}

/**
 * A token's 38 REL columns (REL_COLUMNS_V2) into `out` at `at`; returns each reference's trace when `trace` is given.
 * Class columns read the base references (no player's choice); references under a choice count in rel.*, rz.* and the
 * choice groups (alt.*) only, so exclusive options aren't added up.
 */
export function relColumns(dom: RefDomain, t: RefToken, out: Int32Array | number[], at = 0, diag?: EncodeDiagnosticsV2, trace?: RefTrace[]): void {
  const refs = dom.table.refsOf(t.def);
  const R = defFacts(dom.table, t.def);
  const put = (name: string, v: number) => {
    out[at + REL.get(name)!] = (out[at + REL.get(name)!] ?? 0) + v;
  };
  const max = (name: string, v: number) => {
    out[at + REL.get(name)!] = Math.max(out[at + REL.get(name)!] ?? 0, Math.min(63, v));
  };
  for (let i = 0; i < REL_COLUMNS_V2.length; i++) out[at + i] = 0;
  const traces = refs.map((r, i) => evaluateRef(dom, t, r, i, diag));
  if (trace) trace.push(...traces);
  for (const x of traces) {
    if (!x.live) {
      put("rel.dead", 1);
      continue;
    }
    put("rel.live", 1);
    if (x.partial) {
      put("rel.partial", 1);
      continue;
    }
    const c = x.count!;
    if (!c.luck && c.m !== c.inPlace) put("rel.moved", 1);
    const oppChoice = (x.ref.alt ?? []).some((a) => a.startsWith("opp") || a.startsWith("!opp"));
    if (x.unc || oppChoice) put("rel.unc", 1);
    if (x.cls !== "luck") {
      const buckets = new Map<string, number>();
      for (const [k, v] of c.byZone) {
        const [who, zone] = k.split(".") as [string, string];
        const b = who === "own" ? `rz.own.${ZONE_BUCKET[zone] ?? "other"}` : zone === "field" ? "rz.opp.field" : "rz.opp.other";
        buckets.set(b, (buckets.get(b) ?? 0) + v);
      }
      for (const [b, v] of buckets) max(b, v);
    }
    if (x.key.length > 0) continue;
    const o = x.odds;
    switch (x.cls) {
      case "gate":
      case "avail": {
        const p = x.cls;
        put(`${p}.n`, 1);
        if (o!.determined && o!.value) put(`${p}.ok`, 1);
        if (!o!.determined) {
          put(`${p}.unc`, 1);
          put(`${p}.p`, o!.p);
        }
        if (p === "gate" && o!.determined && !o!.value) put("gate.gap", Math.min(15, gap(x.test!, c.m, o!)));
        if (p === "avail") put("avail.m", Math.min(63, c.m));
        break;
      }
      case "scale":
        put("scale.n", 1);
        put("scale.m", Math.min(63, c.m));
        if (R.removalOrAoe) put("scale.rem", Math.min(63, c.m));
        put("scale.e16", x.e16);
        break;
      case "aff":
        put("aff.n", 1);
        put("aff.m", Math.min(63, c.m));
        put("aff.e16", x.e16);
        break;
      case "bonus":
        put("bonus.n", 1);
        if (o!.determined && o!.value) put("bonus.ok", 1);
        if (!o!.determined) put("bonus.unc", 1);
        break;
      case "luck":
        put("luck.n", 1);
        put("luck.p", o!.p);
        put("luck.e16", x.e16);
        break;
    }
  }
  // Choice groups (D23): per ability, its maximal keys are the options; an option's factors are the ability's gate and
  // target references whose key is within it (base ones included). Options aren't exclusive ("choose up to N").
  const byAbility = new Map<string, RefTrace[]>();
  for (const x of traces) {
    if (!x.live || x.partial) continue;
    const a = `${x.ref.ability}|${x.ref.key ?? ""}`;
    byAbility.set(a, [...(byAbility.get(a) ?? []), x]);
  }
  for (const xs of byAbility.values()) {
    const keys = [...new Map(xs.filter((x) => x.key.length > 0).map((x) => [x.key.join(","), x.key])).values()];
    const options = keys.filter((k) => !keys.some((o) => o !== k && o.length > k.length && k.every((a) => o.includes(a))));
    for (const option of options) {
      put("alt.groups", 1);
      const factors = xs.filter((x) => (x.cls === "gate" || x.cls === "avail") && x.key.every((a) => option.includes(a)));
      if (factors.some((x) => x.odds!.determined && !x.odds!.value)) continue;
      if (factors.every((x) => x.odds!.determined && x.odds!.value)) put("alt.ok", 1);
      else put("alt.unc", 1);
    }
  }
}

/** Whether a card in its cemetery has a live reference (a cemLive token). */
export function hasLiveRef(dom: RefDomain, t: RefToken): boolean {
  return dom.table.refsOf(t.def).some((r) => liveness(dom, t, r).live);
}

/**
 * The evolve columns' reference part (evo.refN, evo.refOk, evo.scale) for a follower on the field: each distinct evolve
 * card q it could evolve with has its on-evolve references counted with the follower staying where it is, its facts made
 * q's (CR 5.16.1.2: printed type, traits, class, attack and defense; evolved; its current cost; engaged as it is); the q with
 * the most met references, then the largest quantity, then the lowest definition index is reported.
 */
export function evolveRefColumns(dom: RefDomain, t: RefToken, partners: readonly DefId[], diag?: EncodeDiagnosticsV2): { refN: number; refOk: number; scale: number } {
  // Super-evolving needs a super-evolution point and 7 turns passed (6 going second) (CR 12.2.4, 3.2.6).
  const side = dom.view.players[t.side];
  const superOk = side.superEvolutionPoints >= 1 && side.turnsPassed >= (dom.view.firstPlayer === t.side ? 7 : 6);
  const none = { refN: 0, refOk: 0, scale: 0 };
  if (t.zone !== "field" || !t.card || t.card.abilitiesLost || t.card.boxed) return none;
  let best: { refN: number; refOk: number; scale: number; index: number } | null = null;
  for (const q of [...new Set(partners)].sort()) {
    const Q = defFacts(dom.table, q);
    const f: Facts = { info: q, type: Q.type, cost: t.card.cost, atk: Q.atk, dfn: Q.dfn, evolved: true, token: defFacts(dom.table, t.phys).token, engaged: t.card.engaged, racing: dom.racing.has(t.id), id: t.id, traits: Q.traits, cls: Q.cls };
    const move: Move = { remove: null, add: null, replace: { id: t.id, f } };
    const qt: RefToken = { ...t, def: q };
    let refN = 0;
    let refOk = 0;
    let scale = 0;
    dom.table.refsOf(q).forEach((r, i) => {
      if (r.timing !== "onEvolve" && !(r.timing === "onSuperEvolve" && superOk)) return;
      const x = evaluateRef(dom, qt, r, i, diag, { placement: "evolve", move, live: true, why: "" });
      if (x.partial || x.key.length > 0) return;
      if (x.cls === "gate" || x.cls === "avail") {
        refN += 1;
        if (x.odds!.determined && x.odds!.value) refOk += 1;
      } else if (x.cls === "scale") scale += Math.min(63, x.count!.m);
    });
    const cand = { refN, refOk, scale, index: Q.index };
    if (!best || cand.refOk > best.refOk || (cand.refOk === best.refOk && (cand.scale > best.scale || (cand.scale === best.scale && cand.index < best.index)))) best = cand;
  }
  return best ? { refN: cap(best.refN, 10), refOk: cap(best.refOk, 10), scale: cap(best.scale, 630) } : none;
}
