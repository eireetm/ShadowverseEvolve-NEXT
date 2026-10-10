// Encoder v2's files (rl:encode --encoder 2): a game's samples with their gdef rows numbered in the game's own order, shards of
// 1000 games as .npy arrays, and the checks that read the real game (tools only): the counts against the engine's (C12), the
// cards' own conditions (C13), the evolve cards against Core (C14), the pools against the real hidden cards (C15), hidden
// information (C16), every value in its range (C17) and how well the hidden counts are guessed (C23).
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  CARD_BODY_COLUMNS_V2,
  CARD_WIDTH_V2,
  GDEF_COLUMNS_V2,
  GLOBAL_COLUMNS_V2,
  IN_PLACE,
  PILE_COLUMNS_V2,
  REL_COLUMNS_V2,
  ZONES_V2,
  cardToken,
  e16,
  encodeV2,
  evaluateRef,
  gdIndexOf,
  meets,
  odds,
  refClass,
  refDomain,
  type CardFeatureTable,
  type CardRef,
  type EncodedV2,
  type PreparedV2,
} from "../../packages/bot/src";
import { opponentOf, type CardView, type DefId, type GameSession, type HiddenCardView, type PlayerId, type PlayerView } from "../../packages/core/src";
import { correspondingEvolveCards } from "../../packages/core/src/engine/abilities/evolve";
import type { G } from "../../packages/core/src/engine/runtime/context";
import { writeNpy } from "./npy";
import { checkReferences, matches, refCount } from "./ref-oracle";
import type { RefSite } from "./script-analysis";

const PILE_W = PILE_COLUMNS_V2.length;
const GDEF_W = 2 + GDEF_COLUMNS_V2.length;
const BODY0 = 3;
const REL0 = BODY0 + CARD_BODY_COLUMNS_V2.indexOf(REL_COLUMNS_V2[0]!);
const visible = (c: CardView | HiddenCardView): c is CardView => !c.hidden;

/**
 * A game's gdef rows in their stored order: every (seat, definition) its samples used plus both lists' definitions, by seat
 * then definition index (the order depends on nothing but the game). Returns the old gd → new gd map and the rows
 * ([def index, seat, 23 features]).
 */
export function finishGame(prep: PreparedV2): { remap: Int32Array; rows: Int16Array; count: number } {
  for (const seat of [0, 1] as PlayerId[]) for (const list of [prep.ctx.decks[seat].main, prep.ctx.decks[seat].evolve]) for (const d of list.keys()) gdIndexOf(prep, seat, d);
  const index = new Map(prep.defIds.map((d, i) => [d, i + 1]));
  const order = prep.gdKeys.map((k, gd) => ({ gd, seat: k.seat, def: k.def, i: index.get(k.def) ?? 0 })).sort((a, b) => a.seat - b.seat || a.i - b.i || (a.def < b.def ? -1 : a.def > b.def ? 1 : 0));
  const remap = new Int32Array(prep.gdKeys.length);
  const rows = new Int16Array(order.length * GDEF_W);
  order.forEach((o, k) => {
    remap[o.gd] = k;
    rows[k * GDEF_W] = o.i;
    rows[k * GDEF_W + 1] = o.seat;
    rows.set(prep.gdRows[o.gd]!, k * GDEF_W + 2);
  });
  return { remap, rows, count: order.length };
}

/** One shard's arrays, in sample order (by game, then sample point, then viewer 0 and 1, as y / side / w1). */
export class ShardV2 {
  private globs: Int16Array[] = [];
  private cards: Int16Array[] = [];
  private piles: Int16Array[] = [];
  private gdefs: Int16Array[] = [];
  private offC: number[] = [];
  private offP: number[] = [];
  private gbase: number[] = [];
  private nC = 0;
  private nP = 0;
  private nG = 0;
  /** By zone code: card tokens and pile entries counted, per sample (for stats.json). */
  readonly perZone = new Map<number, number[]>();
  /** Non-zero counts: global columns; (zone, body column) of card tokens; gdef columns; pile zones. */
  readonly nonzeroGlobal = new Array<number>(GLOBAL_COLUMNS_V2.length).fill(0);
  readonly nonzeroCard = new Map<number, number[]>();
  readonly nonzeroGdef = new Array<number>(GDEF_COLUMNS_V2.length).fill(0);
  /** Σ of each REL column over the card tokens (live / dead / uncertain references by class, for stats.json). */
  readonly relSums = new Array<number>(REL_COLUMNS_V2.length).fill(0);

  /** A game's samples (encoded with `prep`, this game's own). */
  addGame(prep: PreparedV2, samples: readonly EncodedV2[]): void {
    const f = finishGame(prep);
    const base = this.nG;
    this.gdefs.push(f.rows);
    this.nG += f.count;
    for (let k = 0; k < f.count; k++) for (let j = 0; j < GDEF_COLUMNS_V2.length; j++) if (f.rows[k * GDEF_W + 2 + j] !== 0) this.nonzeroGdef[j]! += 1;
    for (const e of samples) {
      this.offC.push(this.nC);
      this.offP.push(this.nP);
      this.gbase.push(base);
      this.globs.push(e.global);
      for (let j = 0; j < e.global.length; j++) if (e.global[j] !== 0) this.nonzeroGlobal[j]! += 1;
      const c = e.cards.slice();
      const zoneCount = new Map<number, number>();
      for (let r = 0; r < e.nCards; r++) {
        c[r * CARD_WIDTH_V2 + 2] = f.remap[c[r * CARD_WIDTH_V2 + 2]!]!;
        const zone = c[r * CARD_WIDTH_V2]!;
        zoneCount.set(zone, (zoneCount.get(zone) ?? 0) + 1);
        let nz = this.nonzeroCard.get(zone);
        if (!nz) this.nonzeroCard.set(zone, (nz = new Array<number>(CARD_BODY_COLUMNS_V2.length).fill(0)));
        for (let j = 0; j < CARD_BODY_COLUMNS_V2.length; j++) if (c[r * CARD_WIDTH_V2 + BODY0 + j] !== 0) nz[j]! += 1;
        for (let j = 0; j < REL_COLUMNS_V2.length; j++) this.relSums[j]! += c[r * CARD_WIDTH_V2 + REL0 + j]!;
      }
      const p = e.piles.slice();
      for (let r = 0; r < e.nPiles; r++) {
        p[r * PILE_W + 2] = f.remap[p[r * PILE_W + 2]!]!;
        const zone = p[r * PILE_W]!;
        zoneCount.set(zone, (zoneCount.get(zone) ?? 0) + p[r * PILE_W + 3]!);
      }
      for (const z of ZONES_V2) {
        let list = this.perZone.get(z.code);
        if (!list) this.perZone.set(z.code, (list = []));
        list.push(zoneCount.get(z.code) ?? 0);
      }
      this.cards.push(c.subarray(0, e.nCards * CARD_WIDTH_V2));
      this.piles.push(p.subarray(0, e.nPiles * PILE_W));
      this.nC += e.nCards;
      this.nP += e.nPiles;
    }
  }

  get rows(): number {
    return this.globs.length;
  }

  /** Writes the shard's arrays; returns each file's sha256 by name. */
  write(out: string, shard: number): Record<string, string> {
    const name = (kind: string) => `${kind}-${String(shard).padStart(4, "0")}.npy`;
    const cat = (parts: Int16Array[], total: number) => {
      const a = new Int16Array(total);
      let at = 0;
      for (const p of parts) {
        a.set(p, at);
        at += p.length;
      }
      return a;
    };
    const n = this.rows;
    const off = new Int32Array((n + 1) * 2);
    for (let i = 0; i < n; i++) {
      off[i * 2] = this.offC[i]!;
      off[i * 2 + 1] = this.offP[i]!;
    }
    off[n * 2] = this.nC;
    off[n * 2 + 1] = this.nP;
    writeNpy(join(out, name("glob")), cat(this.globs, n * GLOBAL_COLUMNS_V2.length), [n, GLOBAL_COLUMNS_V2.length]);
    writeNpy(join(out, name("card")), cat(this.cards, this.nC * CARD_WIDTH_V2), [this.nC, CARD_WIDTH_V2]);
    writeNpy(join(out, name("pile")), cat(this.piles, this.nP * PILE_W), [this.nP, PILE_W]);
    writeNpy(join(out, name("off")), off, [n + 1, 2]);
    writeNpy(join(out, name("gbase")), Int32Array.from(this.gbase), [n]);
    writeNpy(join(out, name("gdef")), cat(this.gdefs, this.nG * GDEF_W), [this.nG, GDEF_W]);
    return Object.fromEntries(["glob", "card", "pile", "off", "gbase", "gdef"].map((k) => [name(k), createHash("sha256").update(readFileSync(join(out, name(k)))).digest("hex")]));
  }

  sizes(): { cardRows: number; pileRows: number; gdefRows: number } {
    return { cardRows: this.nC, pileRows: this.nP, gdefRows: this.nG };
  }
}

// ---- Ranges (C17) ----

/** Each stored column's declared range (from the specification's tables; a column not listed is any int16). */
export function declaredRanges(maxRefs: number): { global: [number, number][]; body: [number, number][]; gdef: [number, number][] } {
  const R = maxRefs;
  const g = (name: string): [number, number] => {
    if (name === "mask.decides" || name.startsWith("player.") || name.startsWith("g.phase.") || /^g\.(me\.(first|active)|first\.known|attack\.inProgress)$/.test(name) || /\.(cls|uni)\./.test(name)) return [0, 1];
    if (name.startsWith("act.")) return [-1, 999];
    if (name.startsWith("counters.")) return [0, 999];
    if (name.startsWith("g.opp.odds.")) return [0, 1000];
    if (name === "g.opp.listExact") return [1, 1];
    if (/evo\.match/.test(name)) return [0, 10];
    if (name === "g.slot.shared") return [0, 4];
    if (name === "g.me.leaderDefense" || name === "g.opp.leaderDefense") return [-99, 999];
    return [0, 999];
  };
  const b = (name: string): [number, number] => {
    if (/^(atk|def)\.(now|delta|engaged)$|^cost\.now$/.test(name)) return [-99, 99];
    if (name === "dmg") return [0, 99];
    if (/^(follower\.now|type\.changed|engaged|evolved\.now|superEvolved|boxed|ward\.standing|lost|hiddenKnown|unknownDef)$/.test(name) || (name.startsWith("kw.now.") && name !== "kw.now.driveChecks")) return [0, 1];
    if (name === "kw.now.driveChecks") return [0, 2];
    if (name.startsWith("a.")) return [-1, 99];
    if (name === "evo.left" || name === "evo.refN" || name === "evo.refOk") return [0, 10];
    if (name === "evo.can") return [0, 1];
    if (name === "evo.dAtk" || name === "evo.dDef") return [-20, 20];
    if (name === "evo.onEvolve") return [0, 5];
    if (name === "evo.scale") return [0, 630];
    if (name.startsWith("self.")) return [0, 3];
    if (name.startsWith("share.") || name.startsWith("rz.")) return [0, 63];
    if (/^(rel\.\w+|gate\.(n|ok|unc)|avail\.(n|ok|unc)|scale\.n|aff\.n|bonus\.\w+|luck\.n)$/.test(name)) return [0, R];
    if (name === "gate.p" || name === "avail.p") return [0, 999 * R];
    if (name === "gate.gap") return [0, 15 * R];
    if (/^(avail|scale|aff)\.m$|^scale\.rem$/.test(name)) return [0, 63 * R];
    if (/\.e16$/.test(name)) return [0, 1008 * R];
    if (name === "luck.p") return [0, 1000 * R];
    if (name.startsWith("alt.")) return [0, 4 * R];
    return [-32768, 32767];
  };
  const d = (name: string): [number, number] => {
    if (name === "list.main") return [0, 40];
    if (name === "list.evolve" || name === "evo.inList" || name === "tr.other" || name === "rf.other") return [0, 10];
    if (name === "evo.pAtk" || name === "evo.pDef") return [-20, 20];
    return [0, 1];
  };
  return { global: GLOBAL_COLUMNS_V2.map(g), body: CARD_BODY_COLUMNS_V2.map(b), gdef: GDEF_COLUMNS_V2.map(d) };
}

/** Values out of their declared range in a sample (C17), with the first few names. */
export function rangeViolations(enc: EncodedV2, prep: PreparedV2, ranges: ReturnType<typeof declaredRanges>, out: Map<string, number>): number {
  let bad = 0;
  const note = (n: string) => {
    bad += 1;
    out.set(n, (out.get(n) ?? 0) + 1);
  };
  enc.global.forEach((v, j) => {
    const [lo, hi] = ranges.global[j]!;
    if (v < lo || v > hi) note(GLOBAL_COLUMNS_V2[j]!);
  });
  const cardZones = new Set<number>(ZONES_V2.filter((z) => z.kind === "card").map((z) => z.code));
  const pileZones = new Set<number>(ZONES_V2.filter((z) => z.kind === "pile").map((z) => z.code));
  for (let r = 0; r < enc.nCards; r++) {
    const at = r * CARD_WIDTH_V2;
    if (!cardZones.has(enc.cards[at]!)) note("card.zone");
    if (enc.cards[at + 1]! < 0 || enc.cards[at + 2]! < 0) note("card.pointer");
    for (let j = 0; j < CARD_BODY_COLUMNS_V2.length; j++) {
      const v = enc.cards[at + BODY0 + j]!;
      const [lo, hi] = ranges.body[j]!;
      if (v < lo || v > hi) note(CARD_BODY_COLUMNS_V2[j]!);
    }
  }
  for (let r = 0; r < enc.nPiles; r++) {
    const at = r * PILE_W;
    if (!pileZones.has(enc.piles[at]!)) note("pile.zone");
    if (enc.piles[at + 1]! < 0 || enc.piles[at + 2]! < 0) note("pile.pointer");
    if (enc.piles[at + 3]! < 1 || enc.piles[at + 3]! > 60) note("pile.mult");
  }
  for (const row of prep.gdRows) {
    row.forEach((v, j) => {
      const [lo, hi] = ranges.gdef[j]!;
      if (v < lo || v > hi) note(GDEF_COLUMNS_V2[j]!);
    });
  }
  return bad;
}

// ---- The features a network gathers (for the leak check) ----

/** A sample's features with the pointers replaced by what they point to, in canonical order. */
export function gatheredV2(enc: EncodedV2, prep: PreparedV2): string {
  const rows: string[] = [];
  for (let i = 0; i < enc.nCards; i++) {
    const r = enc.cards.subarray(i * CARD_WIDTH_V2, (i + 1) * CARD_WIDTH_V2);
    rows.push(`c${r[0]}:${r[1]}:${prep.gdRows[r[2]!]!.join(",")}:${r.subarray(3).join(",")}`);
  }
  for (let i = 0; i < enc.nPiles; i++) {
    const r = enc.piles.subarray(i * PILE_W, (i + 1) * PILE_W);
    rows.push(`p${r[0]}:${r[1]}:${prep.gdRows[r[2]!]!.join(",")}:${r[3]}`);
  }
  return `${enc.global.join(",")}|${rows.sort().join("|")}`;
}

// ---- Checks on the real game ----

/** What the checks on the real game add up (by shard, then over all). */
export function freshV2Checks() {
  return {
    // C12: in-place certain counts against the engine (refs without hidden slots).
    oracleCompared: 0,
    oracleDiffer: 0,
    oracleDifferRenamed: 0,
    // C13: the cards' own closures, predicted from the test.
    closureCalls: 0,
    // C14: evolve cards left against Core's corresponding evolve cards.
    evoCompared: 0,
    evoDiffer: 0,
    evoDifferRenamed: 0,
    // C15: pools against the real hidden cards; remembered cards against the real ones.
    poolsChecked: 0,
    poolsBad: 0,
    knownChecked: 0,
    knownBad: 0,
    // C16: hidden information.
    leakChecked: 0,
    leakBad: 0,
    leakDrift: 0,
    // C17.
    rangeBad: 0,
  };
}
export type V2Checks = ReturnType<typeof freshV2Checks>;

/** C23's numbers: hidden counts real against expected, the probabilities' reliability, luck against the real top cards. */
export interface Calibration {
  /** By "class|zones": Σ real, Σ expected (hidden part only), and per game (for a bootstrap interval). */
  hidden: Record<string, { real: number; expected: number; n: number; byGame: Record<number, [number, number]> }>;
  /** 10 bins of p (not determined): count, Σ p/1000, Σ outcome; Brier sum. */
  bins: { n: number; p: number; hit: number }[];
  brier: number;
  brierN: number;
  luck: { n: number; p: number; hit: number; brier: number };
  /** Every reference with odds at the checked views, by p: 0, 1–99, 100–199 … 900–999, 1000. */
  pHist: number[];
}
export function freshCalibration(): Calibration {
  return { hidden: {}, bins: Array.from({ length: 10 }, () => ({ n: 0, p: 0, hit: 0 })), brier: 0, brierN: 0, luck: { n: 0, p: 0, hit: 0, brier: 0 }, pHist: new Array<number>(12).fill(0) };
}

/**
 * C12 and C23 at one view: every visible card of both sides (field, EX, cemetery, equipment; my hand) and every reference
 * of it counted in place — the certain count against the engine's count on the real game (references with no hidden slots;
 * a card whose traits or names the engine reads otherwise than its printed ones is counted apart), and for references with
 * hidden slots or luck, the expectation and the probability against what the real cards give.
 */
export function oracleAtView(
  game: GameSession,
  view: PlayerView,
  me: PlayerId,
  table: CardFeatureTable,
  decks: Parameters<typeof refDomain>[3],
  sitesOf: (def: DefId) => readonly RefSite[] | undefined,
  checks: V2Checks,
  cal: Calibration,
  gameIndex: number,
  differ: Map<string, number>,
): void {
  const reader = game.reader();
  const dom = refDomain(view, me, table, decks);
  for (const side of [0, 1] as PlayerId[]) {
    const s = view.players[side];
    const zones: ["hand" | "field" | "ex" | "cemetery" | "equipmentZone", readonly (CardView | HiddenCardView)[]][] = [
      ["field", s.field],
      ["ex", s.ex],
      ["cemetery", s.cemetery],
      ["equipmentZone", s.equipmentZone],
      ...(side === me ? ([["hand", s.hand]] as ["hand", readonly (CardView | HiddenCardView)[]][]) : []),
    ];
    for (const [zone, cards] of zones) {
      for (const c of cards) {
        if (!visible(c)) continue;
        const t = cardToken(dom, zone, side, c);
        const refs = table.refsOf(t.def);
        const sites = sitesOf(t.def) ?? [];
        // The engine reads current traits and names; the table printed ones.
        const info = reader.info(c.id);
        const printed = table.traitsOf(t.def).map((i) => table.file.traits[i]!).sort().join(",");
        const renamed = [...info.traits].sort().join(",") !== printed;
        refs.forEach((r: CardRef, i) => {
          const site = sites[i];
          if (!site) return;
          const x = evaluateRef(dom, t, r, i, undefined, IN_PLACE);
          if (x.partial || !x.count) return;
          if (x.odds) cal.pHist[x.odds.p === 0 ? 0 : x.odds.p === 1000 ? 11 : 1 + Math.floor(x.odds.p / 100)]! += 1;
          const self = r.key === "equipment" && c.linkedTo ? c.linkedTo : c.id;
          const k = x.count;
          if (k.luck) {
            // The real top cards of the counted deck.
            const q = r.side === "own" ? side : opponentOf(side);
            const top = reader.cards(q, "deck").slice(0, k.luck.t);
            const real = top.filter((id) => matches(reader, id, site.filter, self)).length;
            const test = x.test ?? { kind: "atLeast", n: 1 };
            const o = odds(k.luck.N, k.luck.K, k.luck.t, 0, test);
            const hit = meets(test, real) ? 1 : 0;
            cal.luck.n += 1;
            cal.luck.p += o.p / 1000;
            cal.luck.hit += hit;
            cal.luck.brier += (o.p / 1000 - hit) ** 2;
            return;
          }
          const real = refCount(reader, site, side, self);
          if (k.slots === 0) {
            checks.oracleCompared += 1;
            if (real !== k.m) {
              if (renamed) checks.oracleDifferRenamed += 1;
              else {
                checks.oracleDiffer += 1;
                differ.set(t.def, (differ.get(t.def) ?? 0) + 1);
              }
            }
            return;
          }
          // A hidden part: expectation and probability against the real count.
          const key = `${refClass(r)}|${r.zones.join("+")}`;
          const exp = e16(dom.N, k.K, Math.min(k.slots, dom.N)) / 16;
          const h = (cal.hidden[key] ??= { real: 0, expected: 0, n: 0, byGame: {} });
          h.real += real - k.m;
          h.expected += exp;
          h.n += 1;
          const gc = (h.byGame[gameIndex] ??= [0, 0]);
          gc[0] += real - k.m;
          gc[1] += exp;
          if (x.test && x.odds && !x.odds.determined) {
            const hit = meets(x.test, real) ? 1 : 0;
            const bin = Math.min(9, Math.floor(x.odds.p / 100));
            cal.bins[bin]!.n += 1;
            cal.bins[bin]!.p += x.odds.p / 1000;
            cal.bins[bin]!.hit += hit;
            cal.brier += (x.odds.p / 1000 - hit) ** 2;
            cal.brierN += 1;
          }
        });
      }
    }
  }
}

/** C13: the cards' own closures at a position (ref-oracle's checkReferences, predicting from the test). */
export function closuresAt(positions: GameSession[], sitesOf: (def: DefId) => readonly RefSite[] | undefined, scripts: Parameters<typeof checkReferences>[2]): ReturnType<typeof checkReferences> {
  return checkReferences(positions, sitesOf, scripts);
}

/**
 * C14: for each unevolved follower of both sides on the field (and in my hand), the evolve cards Core would offer it (its
 * face-down evolve cards it corresponds to, CR 5.16.1.1.1, with its evolve abilities' own rules) against the token's evo.left.
 */
export function evoAtView(game: GameSession, view: PlayerView, me: PlayerId, enc: EncodedV2, checks: V2Checks, engine: { db: G["db"]; scripts: G["scripts"] }, scripts: Readonly<Record<string, { abilities?: readonly unknown[] }>>): void {
  // Core's own context, read only (as the card table's test builds it).
  const g: G = { state: game.state, db: engine.db, scripts: engine.scripts, emit: () => {} };
  const reader = game.reader();
  const at = new Map<string, number>();
  enc.cardIds.forEach((id, i) => at.set(id, i));
  const col = BODY0 + CARD_BODY_COLUMNS_V2.indexOf("evo.left");
  for (const side of [0, 1] as PlayerId[]) {
    const cards = [...view.players[side].field, ...(side === me ? view.players[side].hand : [])];
    for (const c of cards) {
      if (!visible(c) || c.evolvedWith !== null) continue;
      const i = at.get(c.id);
      if (i === undefined) continue;
      const info = reader.info(c.id);
      if (info.type !== "follower" || info.evolved) continue;
      const specs = ((scripts[info.def.id]?.abilities ?? []) as { kind?: string; evolve?: boolean; evolveNameIncludes?: string; evolveInto?: readonly string[] }[]).flatMap((a) =>
        a.kind === "activated" && a.evolve ? [{ nameIncludes: a.evolveNameIncludes, into: a.evolveInto }] : [],
      );
      const offered = new Set<string>();
      for (const spec of [{}, ...specs]) for (const o of correspondingEvolveCards(g, c.id, spec)) offered.add(o.card);
      const left = enc.cards[i * CARD_WIDTH_V2 + col]!;
      checks.evoCompared += 1;
      if (offered.size !== left) {
        if (info.names.some((n) => n !== info.def.name)) checks.evoDifferRenamed += 1;
        else checks.evoDiffer += 1;
      }
    }
  }
}

/**
 * C15 (F7): the counting domain's pools are the truth — my deck is my real deck; the opponent's unseen cards are their real
 * deck and their hidden hand, banished and field cards I don't remember; the face-down evolve cards are the real ones; every
 * remembered card is the real card.
 */
export function poolsAtView(game: GameSession, view: PlayerView, me: PlayerId, table: CardFeatureTable, decks: Parameters<typeof refDomain>[3], checks: V2Checks): void {
  const reader = game.reader();
  const dom = refDomain(view, me, table, decks);
  const opp = opponentOf(me);
  const real = (ids: readonly string[]) => {
    const m = new Map<DefId, number>();
    for (const id of ids) {
      const d = reader.card(id)!.def;
      m.set(d, (m.get(d) ?? 0) + 1);
    }
    return m;
  };
  const same = (a: ReadonlyMap<DefId, number>, b: ReadonlyMap<DefId, number>) => a.size === b.size && [...a].every(([k, v]) => b.get(k) === v);
  const unknownHidden = (cards: readonly (CardView | HiddenCardView)[]) => cards.filter((c) => c.hidden && !c.known).map((c) => c.id);
  const faceDown = (p: PlayerId) => reader.cards(p, "evolveDeck").filter((id) => !reader.card(id)!.faceUp);
  const theirs = view.players[opp];
  const ok =
    same(dom.deckMe, real(reader.cards(me, "deck"))) &&
    same(dom.unseen, real([...reader.cards(opp, "deck"), ...unknownHidden(theirs.hand), ...unknownHidden(theirs.banished), ...unknownHidden(theirs.field)])) &&
    same(dom.evoLeftOpp, real(faceDown(opp))) &&
    same(dom.evoDownMe, real(faceDown(me)));
  checks.poolsChecked += 1;
  if (!ok) checks.poolsBad += 1;
  for (const s of view.players) {
    for (const c of [...s.hand, ...s.field, ...s.banished]) {
      if (!c.hidden || !c.known) continue;
      checks.knownChecked += 1;
      if (reader.card(c.id)!.def !== c.known.def) checks.knownBad += 1;
    }
  }
}

/** C16: samples of what the viewer can't see give the same features (20 at each sample of a game). */
export function leakAtView(game: GameSession, view: PlayerView, me: PlayerId, prep: PreparedV2, enc: EncodedV2, checks: V2Checks): void {
  const x = gatheredV2(enc, prep);
  for (let s = 0; s < 20; s++) {
    const copy = game.determinized(me, `leak:${s}`);
    const cv = copy.view(me);
    if (cv.turn !== view.turn || cv.decision?.type !== view.decision?.type) {
      checks.leakDrift += 1;
      continue;
    }
    checks.leakChecked += 1;
    if (gatheredV2(encodeV2(cv, me, prep), prep) !== x) checks.leakBad += 1;
  }
}

/** A sample's hash, choosing the fixed pooled-check and golden samples. */
export function sampleHash(game: number, input: number, viewer: number): number {
  return parseInt(createHash("sha256").update(`pooled:${game}:${input}:${viewer}`).digest("hex").slice(0, 8), 16);
}

export { REL_COLUMNS_V2 };
