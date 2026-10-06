import {
  opponentOf,
  type CardView,
  type DefId,
  type HiddenCardView,
  type MainAction,
  type PlayerId,
  type PlayerSideView,
  type PlayerView,
  type PrintingId,
} from "./core";
import { BRIEF_COLUMNS, CARD_FEATURE_COLUMNS, POOLED_COLUMNS, type CardFeatureTable } from "./card-features";

/**
 * Encoder v1: a position as one player sees it (their PlayerView), plus what that player knows besides (both decks' card
 * lists, D6 of the plan; who plays each side), as a fixed-length vector of whole numbers for a value network. Viewer-relative
 * ("me" and "opponent", never seats); only what the view shows (it can't leak a hidden card: the same view gives the same
 * vector whatever the hidden cards are); never a card's id or name: a card counts by its row of the card feature table, so
 * cards no data has seen are still read. Each zone's cards are pooled (the sum and the largest value of each column), so
 * their order doesn't matter. What the viewer could do now (their main phase actions) is known only when they are deciding;
 * otherwise those values are −1 ("not known"), not 0. One layout (ENCODER_LAYOUT) gives the order, the names and the widths.
 */
export const ENCODER_VERSION = 1;

/** The bots a side may be played by (v1: the stage 1 data's). The value of a position depends on who plays on. */
export const PLAYER_TYPES_V1 = ["medium", "easy"] as const;
export type PlayerType = (typeof PLAYER_TYPES_V1)[number];

/** A deck's card list, as definition counts (the leader left out): what both players know of each deck (D6). */
export interface KnownDeck {
  main: ReadonlyMap<DefId, number>;
  evolve: ReadonlyMap<DefId, number>;
}

/** What the encoder needs besides the view, fixed for a game. */
export interface EncoderContext {
  table: CardFeatureTable;
  /** By seat. */
  decks: readonly [KnownDeck, KnownDeck];
  /** By seat. */
  players: readonly [PlayerType, PlayerType];
}

/** Things to count while encoding (the tools require them all 0 over the data). */
export interface EncodeDiagnostics {
  saturations: number;
  poolClamps: number;
  poolMismatch: number;
  unknownDefs: number;
}

/** A deck list's printings as definition counts. */
export function knownDeck(definitionOf: (printing: PrintingId) => DefId, list: { main: readonly PrintingId[]; evolve: readonly PrintingId[] }): KnownDeck {
  const count = (cards: readonly PrintingId[]) => {
    const m = new Map<DefId, number>();
    for (const p of cards) {
      const d = definitionOf(p);
      m.set(d, (m.get(d) ?? 0) + 1);
    }
    return m;
  };
  return { main: count(list.main), evolve: count(list.evolve) };
}

const KW_NOW = ["quick", "ward", "storm", "rush", "assail", "intimidate", "drain", "bane", "aura", "stack", "drive"] as const;
const KW_BASIC = ["quick", "ward", "storm", "rush", "assail", "intimidate", "drain", "bane", "aura", "stack"] as const;
export const COUNTER_KINDS = [
  "stack",
  "arrow",
  "battery",
  "bunclie",
  "calamity",
  "curse",
  "divineWater",
  "dormancy",
  "fable",
  "fightingSpirit",
  "fusion",
  "gigabyte",
  "grace",
  "lightning",
  "mana",
  "pain",
  "passion",
  "prayer",
  "reversal",
  "seasonal",
  "soul",
  "spell",
] as const;
const KW_NOW_COLUMNS = [...KW_NOW.map((k) => `kw.now.${k}`), "kw.now.driveChecks"];
/** A field card's columns besides its table row: what it is now (35). */
const DYN_FIELD = [
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
  "unknownDef",
];
const DYN_HAND = [...KW_NOW_COLUMNS, "unknownDef"];
const DYN_EX = [...KW_NOW_COLUMNS, "ctr.total", "ctr.stack", "unknownDef"];
const A_FIELD_ME = ["a.attackLeader", "a.attackFollowers", "a.evolve", "a.evolveEp", "a.superEvolve", "a.activate"];
const A_FIELD_OPP = ["a.attackedBy"];
const A_HAND = ["a.play"];
const A_EX = ["a.play", "a.activate"];
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

/** A group of the vector: plain values, or a zone's cards pooled (each pool a copy of the row's columns). */
interface Group {
  name: string;
  columns: readonly string[];
  /** For a zone: the pools, in order ("sum", "max"); none for plain values. */
  pools?: readonly ("sum" | "max")[];
  /** Columns (of `columns`) that are "not known" (−1) unless the viewer is deciding. */
  masked?: readonly string[];
}

/** The vector's layout, in order: every name and width comes from here. */
export const ENCODER_LAYOUT: readonly Group[] = [
  { name: "mask", columns: ["decides"] },
  { name: "player", columns: ["me.medium", "me.easy", "opp.medium", "opp.easy"] },
  {
    name: "g",
    columns: [
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
    ],
  },
  { name: "act", columns: ACT, masked: ACT },
  { name: "field.me", columns: [...POOLED_COLUMNS, ...DYN_FIELD, ...A_FIELD_ME], pools: ["sum", "max"], masked: A_FIELD_ME },
  { name: "field.opp", columns: [...POOLED_COLUMNS, ...DYN_FIELD, ...A_FIELD_OPP], pools: ["sum", "max"], masked: A_FIELD_OPP },
  { name: "hand.me", columns: [...POOLED_COLUMNS, ...DYN_HAND, ...A_HAND], pools: ["sum", "max"], masked: A_HAND },
  { name: "hand.oppRevealed", columns: BRIEF_COLUMNS, pools: ["sum"] },
  { name: "ex.me", columns: [...POOLED_COLUMNS, ...DYN_EX, ...A_EX], pools: ["sum", "max"], masked: A_EX },
  { name: "ex.opp", columns: [...POOLED_COLUMNS, ...DYN_EX], pools: ["sum"] },
  { name: "pool.me.deck", columns: ["count", ...POOLED_COLUMNS.map((c) => `sum.${c}`)] },
  { name: "pool.opp.handDeck", columns: ["count", ...POOLED_COLUMNS.map((c) => `sum.${c}`)] },
  { name: "pool.me.evolveLeft", columns: ["count", ...POOLED_COLUMNS.map((c) => `sum.${c}`)] },
  { name: "pool.opp.evolveLeft", columns: ["count", ...POOLED_COLUMNS.map((c) => `sum.${c}`)] },
  { name: "cemetery.me", columns: BRIEF_COLUMNS, pools: ["sum"] },
  { name: "cemetery.opp", columns: BRIEF_COLUMNS, pools: ["sum"] },
  { name: "banished.me", columns: BRIEF_COLUMNS, pools: ["sum"] },
  { name: "banished.opp", columns: BRIEF_COLUMNS, pools: ["sum"] },
  { name: "equipment.me", columns: BRIEF_COLUMNS, pools: ["sum"] },
  { name: "equipment.opp", columns: BRIEF_COLUMNS, pools: ["sum"] },
  { name: "counters.me", columns: [...COUNTER_KINDS, "other"] },
  { name: "counters.opp", columns: [...COUNTER_KINDS, "other"] },
];

/** The vector's names, groups and masked positions. */
export interface EncoderSchema {
  version: number;
  dims: number;
  names: readonly string[];
  groups: readonly { name: string; start: number; end: number }[];
  /** The positions that are −1 when the viewer isn't deciding, and the position of the "deciding" flag. */
  masked: readonly number[];
  maskIndicator: number;
  maskFill: -1;
  playerTypes: readonly PlayerType[];
}

let schemaCache: EncoderSchema | null = null;
export function encoderSchema(): EncoderSchema {
  if (schemaCache) return schemaCache;
  const names: string[] = [];
  const groups: { name: string; start: number; end: number }[] = [];
  const masked: number[] = [];
  for (const g of ENCODER_LAYOUT) {
    const start = names.length;
    const maskedCols = new Set(g.masked ?? []);
    for (const pool of g.pools ?? [null]) {
      for (const c of g.columns) {
        if (maskedCols.has(c)) masked.push(names.length);
        names.push(pool ? `${g.name}.${pool}.${c}` : `${g.name}.${c}`);
      }
    }
    groups.push({ name: g.name, start, end: names.length });
  }
  schemaCache = { version: ENCODER_VERSION, dims: names.length, names, groups, masked, maskIndicator: names.indexOf("mask.decides"), maskFill: -1, playerTypes: PLAYER_TYPES_V1 };
  return schemaCache;
}

const COLUMN = new Map(CARD_FEATURE_COLUMNS.map((c, i) => [c, i]));
const POOLED_INDEX = POOLED_COLUMNS.map((c) => COLUMN.get(c)!);
const BRIEF_INDEX = BRIEF_COLUMNS.map((c) => COLUMN.get(c)!);
const CLASS_INDEX = CLASSES.map((c) => COLUMN.get(c)!);
const TYPE_COLUMNS = ["follower", "amulet", "spell", "crest", "equipment"] as const;
const TYPE_INDEX = TYPE_COLUMNS.map((t) => COLUMN.get(`type.${t}`)!);
const ATK_INDEX = COLUMN.get("atk")!;
const DEF_INDEX = COLUMN.get("def")!;
const KW_BASIC_INDEX = KW_BASIC.map((k) => COLUMN.get(`kw.${k}`)!);

const visible = (c: CardView | HiddenCardView): c is CardView => !c.hidden;
const counterTotal = (c: CardView) => {
  let n = 0;
  for (const v of Object.values(c.counters)) n += v;
  return n;
};

/**
 * The definition whose information a card shows (CR 5.16.1.2 an evolved follower shows its evolve card's; 2.14 a double-faced
 * card showing its back, the back face's) — the view gives the physical definition, so it is rebuilt from the evolve zone
 * and the table's back faces, as the engine does.
 */
export function infoDefOf(view: PlayerView, card: CardView, table: CardFeatureTable): DefId {
  if (card.evolvedWith !== null) {
    for (const side of view.players) {
      const evolve = side.evolveZone.find((e) => e.id === card.evolvedWith);
      if (evolve) return evolve.backFace ? (table.file.backFace[evolve.def] ?? evolve.def) : evolve.def;
    }
  }
  return card.backFace ? (table.file.backFace[card.def] ?? card.def) : card.def;
}

/** The viewer's main phase actions now, by card (null: the viewer isn't deciding a main phase action). */
function actionsOf(view: PlayerView): MainAction[] | null {
  const d = view.decision;
  return d && d.type === "mainPhase" && d.player === view.viewer ? d.actions : null;
}

/** Writes values in layout order into a vector (saturating to the int16 range). */
class Writer {
  at = 0;
  constructor(
    readonly out: Int16Array,
    readonly diag: EncodeDiagnostics | undefined,
  ) {}
  put(v: number): void {
    let x = v;
    if (x > 32767 || x < -32768) {
      x = x > 0 ? 32767 : -32768;
      if (this.diag) this.diag.saturations += 1;
    }
    this.out[this.at++] = x;
  }
  /** A zone: the rows pooled (sum, then max: an empty zone gives 0s). */
  pooled(rows: readonly Int32Array[], width: number, pools: readonly ("sum" | "max")[]): void {
    for (const pool of pools) {
      if (pool === "sum") {
        for (let j = 0; j < width; j++) {
          let v = 0;
          for (const r of rows) v += r[j]!;
          this.put(v);
        }
      } else {
        for (let j = 0; j < width; j++) {
          let v = rows.length > 0 ? -2147483648 : 0;
          for (const r of rows) if (r[j]! > v) v = r[j]!;
          this.put(v);
        }
      }
    }
  }
}

/** Encodes `view` (the view of `me`): a vector of ENCODER_LAYOUT's width (encoderSchema().dims). */
export function encode(view: PlayerView, me: PlayerId, ctx: EncoderContext, out?: Int16Array, diag?: EncodeDiagnostics): Int16Array {
  if (view.viewer !== me) throw new Error(`the view is player ${view.viewer}'s, not ${me}'s`);
  const schema = encoderSchema();
  const vec = out ?? new Int16Array(schema.dims);
  const w = new Writer(vec, diag);
  const opp = opponentOf(me);
  const mine = view.players[me];
  const theirs = view.players[opp];
  const table = ctx.table;
  const actions = actionsOf(view);
  const deciding = actions !== null;
  const oppLeader = theirs.leader?.id ?? null;

  // What each card of mine may do now (main phase actions), and how many of my attacks each enemy card faces.
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
  for (const a of actions ?? []) {
    if (a.type === "play") {
      actOf(a.card).play = 1;
      nPlay += 1;
    } else if (a.type === "attack") {
      if (a.target === oppLeader) actOf(a.attacker).attackLeader = 1;
      else actOf(a.attacker).attackFollowers += 1;
      attackedBy.set(a.target, (attackedBy.get(a.target) ?? 0) + 1);
    } else if (a.type === "evolve") {
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

  // Cards linked to a card on the field (race, drive, equipment), by the card they are linked to.
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

  const tableRow = (def: DefId): Int16Array => {
    if (!table.known(def) && diag) diag.unknownDefs += 1;
    return table.row(def);
  };
  const kwNow = (c: CardView, out: Int32Array, at: number) => {
    const has = c.keywords;
    let i = at;
    for (const k of KW_NOW) out[i++] = has.includes(k) ? 1 : 0;
    out[i++] = has.includes("twinDrive") ? 2 : has.includes("singleDrive") ? 1 : 0;
    return i;
  };
  const putPooledPart = (out: Int32Array, row: Int16Array) => {
    for (let j = 0; j < POOLED_INDEX.length; j++) out[j] = row[POOLED_INDEX[j]!]!;
    return POOLED_INDEX.length;
  };

  // A field card's row: its information definition's pooled columns, what it is now, and (mine or theirs) its actions.
  const fieldRow = (c: CardView, mineSide: boolean): Int32Array => {
    const width = POOLED_INDEX.length + DYN_FIELD.length + (mineSide ? A_FIELD_ME.length : A_FIELD_OPP.length);
    const r = new Int32Array(width);
    const def = infoDefOf(view, c, table);
    const row = tableRow(def);
    let i = putPooledPart(r, row);
    const atk = c.attack ?? 0;
    const dfn = c.defense ?? 0;
    const follower = c.type === "follower";
    let printedType: string = "leader";
    for (let k = 0; k < TYPE_INDEX.length; k++) if (row[TYPE_INDEX[k]!] === 1) printedType = TYPE_COLUMNS[k]!;
    r[i++] = atk;
    r[i++] = dfn;
    r[i++] = c.damage;
    r[i++] = follower ? atk - row[ATK_INDEX]! : 0;
    r[i++] = follower ? dfn + c.damage - row[DEF_INDEX]! : 0;
    r[i++] = c.cost ?? 0;
    r[i++] = follower ? 1 : 0;
    r[i++] = c.type !== printedType ? 1 : 0;
    r[i++] = c.engaged ? 1 : 0;
    r[i++] = c.evolvedWith !== null ? 1 : 0;
    r[i++] = c.superEvolved ? 1 : 0;
    r[i++] = c.boxed ? 1 : 0;
    i = kwNow(c, r, i);
    let gained = 0;
    for (let k = 0; k < KW_BASIC.length; k++) gained += Math.max(0, (c.keywords.includes(KW_BASIC[k]!) ? 1 : 0) - row[KW_BASIC_INDEX[k]!]!);
    r[i++] = gained;
    r[i++] = counterTotal(c);
    r[i++] = c.counters.stack ?? 0;
    r[i++] = Object.values(c.counters).filter((v) => v > 0).length;
    r[i++] = links.race.get(c.id) ?? 0;
    r[i++] = links.drive.get(c.id) ?? 0;
    r[i++] = links.equipment.get(c.id) ?? 0;
    r[i++] = c.engaged ? atk : 0;
    r[i++] = c.engaged ? dfn : 0;
    r[i++] = c.keywords.includes("ward") && !c.engaged ? 1 : 0;
    r[i++] = table.known(def) ? 0 : 1;
    if (mineSide) {
      const a = act.get(c.id);
      r[i++] = a?.attackLeader ?? 0;
      r[i++] = a?.attackFollowers ?? 0;
      r[i++] = a?.evolve ?? 0;
      r[i++] = a?.evolveEp ?? 0;
      r[i++] = a?.superEvolve ?? 0;
      r[i++] = a?.activate ?? 0;
    } else r[i++] = attackedBy.get(c.id) ?? 0;
    return r;
  };
  const handRow = (c: CardView): Int32Array => {
    const r = new Int32Array(POOLED_INDEX.length + DYN_HAND.length + A_HAND.length);
    const def = infoDefOf(view, c, table);
    let i = putPooledPart(r, tableRow(def));
    i = kwNow(c, r, i);
    r[i++] = table.known(def) ? 0 : 1;
    r[i++] = act.get(c.id)?.play ?? 0;
    return r;
  };
  const exRow = (c: CardView, mineSide: boolean): Int32Array => {
    const r = new Int32Array(POOLED_INDEX.length + DYN_EX.length + (mineSide ? A_EX.length : 0));
    const def = infoDefOf(view, c, table);
    let i = putPooledPart(r, tableRow(def));
    i = kwNow(c, r, i);
    r[i++] = counterTotal(c);
    r[i++] = c.counters.stack ?? 0;
    r[i++] = table.known(def) ? 0 : 1;
    if (mineSide) {
      r[i++] = act.get(c.id)?.play ?? 0;
      r[i++] = act.get(c.id)?.activate ?? 0;
    }
    return r;
  };
  const briefSum = (cards: readonly (CardView | HiddenCardView)[]) => {
    const sum = new Int32Array(BRIEF_INDEX.length);
    for (const c of cards) {
      if (!visible(c)) continue;
      const row = tableRow(infoDefOf(view, c, table));
      for (let j = 0; j < BRIEF_INDEX.length; j++) sum[j]! += row[BRIEF_INDEX[j]!]!;
    }
    for (const v of sum) w.put(v);
  };

  // 1–2: the flag, who plays.
  w.put(deciding ? 1 : 0);
  for (const side of [me, opp]) for (const t of PLAYER_TYPES_V1) w.put(ctx.players[side] === t ? 1 : 0);
  if (!PLAYER_TYPES_V1.includes(ctx.players[0]) || !PLAYER_TYPES_V1.includes(ctx.players[1])) throw new Error(`a player type encoder v1 doesn't know: ${ctx.players.join(", ")}`);

  // 3: the game and both sides.
  w.put(view.turn);
  w.put(view.firstPlayer === me ? 1 : 0);
  w.put(view.activePlayer === me ? 1 : 0);
  w.put(view.firstPlayer !== null ? 1 : 0);
  for (const p of PHASES) w.put(view.phase === p ? 1 : 0);
  w.put(view.attack !== null ? 1 : 0);
  w.put(view.resolution.length);
  const sideStats = (s: PlayerSideView) => {
    const hidden = (cards: readonly (CardView | HiddenCardView)[]) => cards.filter((c) => c.hidden).length;
    const faceDown = s.evolveDeck.filter((c) => c.hidden || !c.faceUp).length;
    for (const v of [
      s.leaderDefense,
      s.playPoints,
      s.maxPlayPoints,
      s.evolutionPoints,
      s.superEvolutionPoints,
      s.turnsPassed,
      s.deckCount,
      s.hand.length,
      hidden(s.hand),
      s.field.length,
      hidden(s.field),
      s.ex.length,
      s.cemetery.length,
      s.banished.length,
      hidden(s.banished),
      faceDown,
      s.evolveDeck.length - faceDown,
      s.evolveZone.length,
      s.raceZone.length,
      s.driveZone.length,
      s.triggerZone.length,
      s.equipmentZone.length,
    ])
      w.put(v);
  };
  sideStats(mine);
  sideStats(theirs);
  for (const s of [mine, theirs]) {
    // Its class only; a test game without a leader has the engine's system leader, no card (no class: not an unknown card).
    const leaderRow = s.leader ? table.row(infoDefOf(view, s.leader, table)) : null;
    for (const j of CLASS_INDEX) w.put(leaderRow ? leaderRow[j]! : 0);
    for (const u of UNIVERSES) w.put(s.universe !== null && `uni.${s.universe}` === u ? 1 : 0);
  }

  // 4: what I can do now, in all (masked below when I'm not deciding).
  const attackers = new Set<string>();
  const leaderAttackers = new Set<string>();
  const evolvers = new Set<string>();
  for (const a of actions ?? []) {
    if (a.type === "attack") {
      attackers.add(a.attacker);
      if (a.target === oppLeader) leaderAttackers.add(a.attacker);
    } else if (a.type === "evolve") evolvers.add(a.card);
  }
  let reach = 0;
  for (const id of leaderAttackers) {
    const c = mine.field.find((x) => x.id === id);
    // Attack can go below 0, but damage of 0 or less isn't dealt (CR 1.3.2.2): such a follower reaches nothing.
    if (c && visible(c)) reach += Math.max(0, c.attack ?? 0);
  }
  for (const v of [nPlay, attackers.size, leaderAttackers.size, reach, evolvers.size, canSuperEvolve, nActivate]) w.put(v);

  // 5–10: the zones of cards.
  const fieldMe = mine.field.filter(visible).map((c) => fieldRow(c, true));
  w.pooled(fieldMe, POOLED_INDEX.length + DYN_FIELD.length + A_FIELD_ME.length, ["sum", "max"]);
  const fieldOpp = theirs.field.filter(visible).map((c) => fieldRow(c, false));
  w.pooled(fieldOpp, POOLED_INDEX.length + DYN_FIELD.length + A_FIELD_OPP.length, ["sum", "max"]);
  const handMe = mine.hand.filter(visible).map(handRow);
  w.pooled(handMe, POOLED_INDEX.length + DYN_HAND.length + A_HAND.length, ["sum", "max"]);
  briefSum(theirs.hand);
  w.pooled(mine.ex.map((c) => exRow(c, true)), POOLED_INDEX.length + DYN_EX.length + A_EX.length, ["sum", "max"]);
  w.pooled(theirs.ex.map((c) => exRow(c, false)), POOLED_INDEX.length + DYN_EX.length, ["sum"]);

  // 11–14: the cards of each list not seen yet (the known lists minus every card of that owner the view shows).
  const seen = (owner: PlayerId, skipFaceDownEvolveDeck: boolean) => {
    const m = new Map<DefId, number>();
    const add = (c: CardView | HiddenCardView) => {
      if (visible(c) && c.owner === owner) m.set(c.def, (m.get(c.def) ?? 0) + 1);
    };
    for (const side of view.players) {
      for (const zone of [side.hand, side.field, side.ex, side.cemetery, side.banished, side.evolveZone, side.raceZone, side.driveZone, side.triggerZone, side.equipmentZone]) for (const c of zone) add(c);
      for (const c of side.evolveDeck) if (!(skipFaceDownEvolveDeck && visible(c) && !c.faceUp)) add(c);
    }
    for (const c of view.resolution) add(c);
    return m;
  };
  const poolOf = (list: ReadonlyMap<DefId, number>, shown: ReadonlyMap<DefId, number>, expected: number) => {
    const sum = new Int32Array(POOLED_INDEX.length);
    let count = 0;
    for (const [def, n] of list) {
      let left = n - (shown.get(def) ?? 0);
      if (left < 0) {
        if (diag) diag.poolClamps += 1;
        left = 0;
      }
      if (left === 0) continue;
      count += left;
      const row = tableRow(def);
      for (let j = 0; j < POOLED_INDEX.length; j++) sum[j]! += left * row[POOLED_INDEX[j]!]!;
    }
    if (count !== expected && diag) diag.poolMismatch += 1;
    w.put(count);
    for (const v of sum) w.put(v);
  };
  const hiddenCount = (cards: readonly (CardView | HiddenCardView)[]) => cards.filter((c) => c.hidden).length;
  const faceDownEvolve = (s: PlayerSideView) => s.evolveDeck.filter((c) => c.hidden || !c.faceUp).length;
  const seenMe = seen(me, true);
  const seenOpp = seen(opp, true);
  poolOf(ctx.decks[me].main, seenMe, mine.deckCount);
  poolOf(ctx.decks[opp].main, seenOpp, hiddenCount(theirs.hand) + theirs.deckCount + hiddenCount(theirs.banished) + hiddenCount(theirs.field));
  poolOf(ctx.decks[me].evolve, seenMe, faceDownEvolve(mine));
  poolOf(ctx.decks[opp].evolve, seenOpp, faceDownEvolve(theirs));

  // 15–17: cemeteries, banished cards, equipment.
  briefSum(mine.cemetery);
  briefSum(theirs.cemetery);
  briefSum(mine.banished);
  briefSum(theirs.banished);
  briefSum(mine.equipmentZone);
  briefSum(theirs.equipmentZone);

  // 18: counters by kind (the leader, the field and the EX area).
  for (const s of [mine, theirs]) {
    const byKind = new Map<string, number>();
    for (const c of [s.leader, ...s.field, ...s.ex]) {
      if (!c || !visible(c)) continue;
      for (const [k, v] of Object.entries(c.counters)) byKind.set(k, (byKind.get(k) ?? 0) + v);
    }
    let other = 0;
    for (const [k, v] of byKind) if (!(COUNTER_KINDS as readonly string[]).includes(k)) other += v;
    for (const k of COUNTER_KINDS) w.put(byKind.get(k) ?? 0);
    w.put(other);
  }

  if (w.at !== schema.dims) throw new Error(`encoder wrote ${w.at} values, the layout has ${schema.dims}`);
  // Not known unless I'm deciding: −1, written after pooling (a sum of −1s would read as a count).
  if (!deciding) for (const i of schema.masked) vec[i] = -1;
  return vec;
}

/** A vector's values by name. */
export function decode(vec: ArrayLike<number>): (name: string) => number {
  const schema = encoderSchema();
  const index = new Map(schema.names.map((n, i) => [n, i]));
  return (name) => {
    const i = index.get(name);
    if (i === undefined) throw new Error(`no feature ${name}`);
    return vec[i]!;
  };
}

const PLAYER_NAMES: Record<PlayerType, string> = { medium: "中等 Bot", easy: "简单 Bot" };

/** Names for the print: a card's (by definition), a keyword's and a counter's, in the reader's language; ids and keys when not given. */
export interface DescribeNames {
  card?(def: DefId): string;
  keyword?(keyword: string): string;
  counter?(kind: string): string;
}

/**
 * The position as encoder v1 reads it, in Chinese, for a person to check against the game (the user check of stage 1): the
 * numbers come from the vector itself (decode), the cards are listed from the view with what the vector counts of them.
 */
export function describe(view: PlayerView, me: PlayerId, ctx: EncoderContext, names: DescribeNames = {}): string {
  const x = encode(view, me, ctx);
  const get = decode(x);
  const schema = encoderSchema();
  const cardName = (def: DefId) => names.card?.(def) ?? def;
  const kwName = (k: string) => names.keyword?.(k) ?? k;
  const opp = opponentOf(me);
  const deciding = get("mask.decides") === 1;
  const who = (p: PlayerId | null) => (p === null ? "未定" : p === me ? "我" : "对手");
  const lines: string[] = [];
  lines.push(
    `编码器 v${ENCODER_VERSION} · 第 ${get("g.turn")} 回合 · 行动方：${who(view.activePlayer)} · 先手：${who(view.firstPlayer)} · 执棋者：我=${PLAYER_NAMES[ctx.players[me]]} 对手=${PLAYER_NAMES[ctx.players[opp]]} · 维度 ${schema.dims} · 现在能做什么：${deciding ? "知道（我在决定）" : "不知道（不是我在决定）"}`,
  );
  const sideLine = (label: string, s: "me" | "opp") =>
    `${label}：体力 ${get(`g.${s}.leaderDefense`)}  PP ${get(`g.${s}.pp`)}/${get(`g.${s}.maxPp`)}  EP ${get(`g.${s}.ep`)}  SEP ${get(`g.${s}.sep`)}  已过回合 ${get(`g.${s}.turnsPassed`)}  牌组 ${get(`g.${s}.deckCount`)}  手牌 ${get(`g.${s}.hand.count`)}${get(`g.${s}.hand.hidden`) ? `（看不到 ${get(`g.${s}.hand.hidden`)}）` : ""}  场上 ${get(`g.${s}.field.count`)}  EX ${get(`g.${s}.ex.count`)}  墓场 ${get(`g.${s}.cemetery.count`)}  除外 ${get(`g.${s}.banished.count`)}  进化牌组 背面 ${get(`g.${s}.evolveDeck.faceDown`)} / 正面 ${get(`g.${s}.evolveDeck.faceUp`)}  进化区 ${get(`g.${s}.evolveZone.count`)}`;
  lines.push(`[全局] ${sideLine("我", "me")}`);
  lines.push(`       ${sideLine("对手", "opp")}`);
  if (deciding) {
    lines.push(
      `[现在能做什么] 能出 ${get("act.nPlay")} · 能攻击的 ${get("act.nAttackers")} 张 · 能打主战者的 ${get("act.nAttackLeader")} 张（攻击力合计 ${get("act.reachNow")}）· 能进化 ${get("act.nEvolve")} 张 · 能超进化 ${get("act.canSuperEvolve") ? "是" : "否"} · 能启动 ${get("act.nActivate")} 次`,
    );
  }
  const keywordsOf = (c: CardView) => (c.keywords.length ? ` 关键词 ${c.keywords.map(kwName).join("、")}` : "");
  const countersOf = (c: CardView) => {
    const entries = Object.entries(c.counters).filter(([, v]) => v > 0);
    return entries.length ? ` 指示物 ${entries.map(([k, v]) => `${names.counter?.(k) ?? k}×${v}`).join("、")}` : "";
  };
  const fieldList = (label: string, s: PlayerSideView, mine: boolean) => {
    const cards = s.field.filter(visible);
    const hidden = s.field.length - cards.length;
    lines.push(`[${label} ${s.field.length} 张${hidden ? `（背面 ${hidden}）` : ""}]`);
    for (const [i, c] of cards.entries()) {
      const info = infoDefOf(view, c, ctx.table);
      const evolved = c.evolvedWith !== null ? (c.superEvolved ? "（已超进化）" : "（已进化）") : "";
      const stats = c.type === "follower" ? ` 攻 ${c.attack ?? 0} / 守 ${c.defense ?? 0}${c.damage ? `（已扣掉受到的 ${c.damage} 点伤害）` : ""}` : ` ${c.type === "amulet" ? "护符" : c.type}`;
      lines.push(`  ${i + 1}. ${cardName(info)}${evolved}${stats}  ${c.engaged ? "横置" : "未横置"}${keywordsOf(c)}${countersOf(c)}`);
    }
    const pre = mine ? "field.me" : "field.opp";
    if (cards.length) {
      lines.push(
        `  合计 / 最大：攻 ${get(`${pre}.sum.atk.now`)}/${get(`${pre}.max.atk.now`)} · 守 ${get(`${pre}.sum.def.now`)}/${get(`${pre}.max.def.now`)} · 随从 ${get(`${pre}.sum.follower.now`)} · 横置 ${get(`${pre}.sum.engaged`)} · 守护 ${get(`${pre}.sum.kw.now.ward`)}（未横置 ${get(`${pre}.sum.ward.standing`)}）· 已进化 ${get(`${pre}.sum.evolved.now`)}`,
      );
    }
    if (mine && deciding && cards.length) lines.push(`  能做（合计）：打主战者 ${get("field.me.sum.a.attackLeader")} · 攻击随从 ${get("field.me.sum.a.attackFollowers")} · 进化 ${get("field.me.sum.a.evolve")} · 用进化点进化 ${get("field.me.sum.a.evolveEp")} · 超进化 ${get("field.me.sum.a.superEvolve")} · 启动 ${get("field.me.sum.a.activate")}`);
  };
  fieldList("我方场上", view.players[me], true);
  fieldList("对方场上", view.players[opp], false);
  const hand = view.players[me].hand.filter(visible);
  lines.push(`[我方手牌 ${hand.length} 张] ${hand.map((c) => `${cardName(infoDefOf(view, c, ctx.table))}（${c.cost ?? "-"} 费）`).join(" · ") || "无"}${deciding ? `  · 能出 ${get("hand.me.sum.a.play")} 张` : ""}`);
  const ex = view.players[me].ex;
  if (ex.length) lines.push(`[我方 EX ${ex.length} 张] ${ex.map((c) => cardName(infoDefOf(view, c, ctx.table))).join(" · ")}`);
  if (view.players[opp].ex.length) lines.push(`[对方 EX ${view.players[opp].ex.length} 张] ${view.players[opp].ex.map((c) => cardName(infoDefOf(view, c, ctx.table))).join(" · ")}`);
  const poolLine = (label: string, pre: string) => {
    const costs = ["le1", "2", "3", "4", "5", "6", "ge7"].map((b) => `${b === "le1" ? "≤1" : b === "ge7" ? "≥7" : b}:${get(`${pre}.sum.cost.${b}`)}`).join(" ");
    const kinds = `随从 ${get(`${pre}.sum.type.follower`)} 法术 ${get(`${pre}.sum.type.spell`)} 护符 ${get(`${pre}.sum.type.amulet`)}`;
    const kws = ["ward", "storm", "rush", "bane", "drain", "aura", "intimidate", "assail", "quick"].map((k) => [k, get(`${pre}.sum.kw.${k}`)] as const).filter(([, v]) => v > 0).map(([k, v]) => `${kwName(k)} ${v}`).join(" ");
    lines.push(`[${label} ${get(`${pre}.count`)} 张] 费用 ${costs} · ${kinds}${kws ? ` · ${kws}` : ""}`);
  };
  poolLine("我方剩余牌组", "pool.me.deck");
  poolLine("对手手牌+牌组（看不到的）", "pool.opp.handDeck");
  lines.push(`[剩余进化牌] 我 ${get("pool.me.evolveLeft.count")} 张 / 对手 ${get("pool.opp.evolveLeft.count")} 张`);
  lines.push(`[墓场] 我 ${get("g.me.cemetery.count")} 张（随从 ${get("cemetery.me.sum.type.follower")}、法术 ${get("cemetery.me.sum.type.spell")}）/ 对手 ${get("g.opp.cemetery.count")} 张（随从 ${get("cemetery.opp.sum.type.follower")}、法术 ${get("cemetery.opp.sum.type.spell")}）`);
  const counterLine = (s: "me" | "opp") =>
    [...COUNTER_KINDS, "other"]
      .map((k) => [k, get(`counters.${s}.${k}`)] as const)
      .filter(([, v]) => v !== 0)
      .map(([k, v]) => `${k === "other" ? "其他" : (names.counter?.(k) ?? k)}×${v}`)
      .join("、") || "无";
  lines.push(`[指示物] 我：${counterLine("me")} / 对手：${counterLine("opp")}`);
  const nonzero = schema.names.map((n, i) => [n, x[i]!] as const).filter(([, v]) => v !== 0);
  lines.push(`[非零特征 ${nonzero.length} 个]`);
  for (let i = 0; i < nonzero.length; i += 6) lines.push(`  ${nonzero.slice(i, i + 6).map(([n, v]) => `${n}=${v}`).join("  ")}`);
  return lines.join("\n") + "\n";
}
