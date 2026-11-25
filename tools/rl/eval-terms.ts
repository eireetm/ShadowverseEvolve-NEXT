// The hand-written evaluation (packages/bot/src/evaluate.ts) as a weighted sum of terms, one per weight: what W1 refits (a
// logistic regression over the terms of both sides). The terms are taken with the default danger line (8) and hand cap (7),
// and signed so that a side's value is exactly Σ weight · term; the evaluation is my side's value minus the opponent's.
import { DEFAULT_WEIGHTS, type EvalWeights } from "../../packages/bot/src";
import { opponentOf, type CardView, type PlayerId, type PlayerSideView, type PlayerView } from "../../packages/core/src";

const KEYWORDS = ["ward", "bane", "drain", "aura", "intimidate", "assail", "rush", "storm"] as const;

/**
 * The terms, in the order rl:encode stores them (its w1 arrays, named by its meta.json's columns.w1). A term is only ever
 * appended, so samples written before one existed hold the terms before it: the first 24 for those written before
 * "treasure" (2026-11-24), which counted a treasure in the EX area as an EX card. rl:w1 reads the terms a file names.
 */
export const W1_TERMS = [
  "leader",
  "leaderDanger",
  "attack",
  "defense",
  ...KEYWORDS.map((k) => `kw.${k}`),
  "evolved",
  "amulet",
  "counter",
  "hand",
  "ex",
  "crest",
  "equipment",
  "evolutionPoint",
  "superEvolutionPoint",
  "maxPlayPoint",
  "playPoint",
  "deckDanger",
  "treasure",
] as const;

const DANGER_LINE = DEFAULT_WEIGHTS.dangerLine;
const HAND_CAP = DEFAULT_WEIGHTS.handCap;
const counterSum = (c: CardView) => Object.values(c.counters).reduce((a, b) => a + b, 0);

/** A side's terms (W1_TERMS order), as evaluate's sideValue counts them. All are whole numbers. */
export function sideTerms(s: PlayerSideView): number[] {
  const t = new Map<string, number>(W1_TERMS.map((k) => [k, 0]));
  const add = (k: string, n: number) => t.set(k, t.get(k)! + n);
  add("leader", s.leaderDefense);
  add("leaderDanger", -Math.max(0, DANGER_LINE - s.leaderDefense));
  for (const card of s.field) {
    if (card.hidden) {
      add("amulet", 1);
      continue;
    }
    add("counter", counterSum(card));
    if (card.type !== "follower" || card.attack === null || card.defense === null) {
      add("amulet", 1);
      continue;
    }
    add("attack", Math.max(0, card.attack));
    add("defense", Math.max(0, card.defense));
    for (const k of card.keywords) if ((KEYWORDS as readonly string[]).includes(k)) add(`kw.${k}`, 1);
    if (card.evolvedWith !== null) add("evolved", 1);
  }
  add("hand", Math.min(s.hand.length, HAND_CAP));
  // A treasure (CP05: an uncap waiting to be used, CR JP 14.6.4) has a weight of its own, as a crest does; not an EX card's.
  for (const card of s.ex) {
    if (card.type === "crest") {
      add("crest", 1);
      add("counter", counterSum(card));
    } else add(card.type === "treasure" ? "treasure" : "ex", 1);
  }
  add("equipment", s.equipmentZone.length);
  add("evolutionPoint", s.evolutionPoints);
  add("superEvolutionPoint", s.superEvolutionPoints);
  add("maxPlayPoint", Math.min(s.maxPlayPoints, 10));
  add("playPoint", s.playPoints);
  add("deckDanger", -Math.max(0, 3 - s.deckCount));
  return W1_TERMS.map((k) => t.get(k)!);
}

/** Both sides' terms from `me`'s view. */
export function evalTerms(view: PlayerView, me: PlayerId): { me: number[]; opp: number[] } {
  return { me: sideTerms(view.players[me]), opp: sideTerms(view.players[opponentOf(me)]) };
}

/** The weights in W1_TERMS order. */
export function termWeights(w: EvalWeights = DEFAULT_WEIGHTS): number[] {
  return W1_TERMS.map((k) => (k.startsWith("kw.") ? (w.keywords[k.slice(3) as (typeof KEYWORDS)[number]] ?? 0) : (w[k as keyof EvalWeights] as number)));
}

/** Σ weight · (my term − the opponent's): evaluate(view, me, w) for a game still being played. */
export function dotTerms(weights: readonly number[], me: readonly number[], opp: readonly number[]): number {
  let v = 0;
  for (let k = 0; k < weights.length; k++) v += weights[k]! * (me[k]! - opp[k]!);
  return v;
}

/** The terms of the first layout, written until 2026-11-24: every term before "treasure". */
const FIRST_LAYOUT = W1_TERMS.indexOf("treasure");

/** The w1 columns of a layout of these terms a side, as rl:encode names them: "w1.me.<term>" for each, then "w1.opp.<term>". */
export function w1Columns(terms: readonly string[] = W1_TERMS): string[] {
  return [...terms.map((t) => `w1.me.${t}`), ...terms.map((t) => `w1.opp.${t}`)];
}

/**
 * The terms a samples file holds, from its meta.json's columns.w1 ("w1.me.<term>" for each term, then "w1.opp.<term>"): the
 * first n of W1_TERMS (terms are only appended), from the first layout's 24 to all of them. Throws for any other columns.
 */
export function storedTerms(columns: readonly string[]): (typeof W1_TERMS)[number][] {
  const terms = W1_TERMS.slice(0, columns.length / 2);
  const expected = w1Columns(terms);
  if (terms.length < FIRST_LAYOUT || expected.length !== columns.length || expected.some((c, i) => c !== columns[i])) {
    throw new Error(`the w1 columns aren't W1's terms (the first ${FIRST_LAYOUT} to ${W1_TERMS.length} of them a side, in order): ${columns.join(", ")}`);
  }
  return terms;
}

/**
 * Weights from a file (an sve-eval-weights file of npm run rl:w1) over the defaults, as the planner and the greedy bot merge
 * the weights they are given: a file written before a weight existed has no value for it (treasure: none of those written
 * before 2026-11-24), and evaluate, which weightsEvaluator calls with the weights as they are, would read undefined there
 * and score NaN wherever it counts (a treasure in an EX area). Every tool that loads such a file passes it through this.
 */
export function withDefaultWeights(w: Partial<EvalWeights>): EvalWeights {
  return { ...DEFAULT_WEIGHTS, ...w, keywords: { ...DEFAULT_WEIGHTS.keywords, ...w.keywords } };
}

/** termWeights' inverse: EvalWeights with these terms' weights (by name), the defaults for every other weight. */
export function weightsOfTerms(byTerm: Readonly<Record<string, number>>): EvalWeights {
  const w = withDefaultWeights({});
  for (const [t, v] of Object.entries(byTerm)) {
    if (!(W1_TERMS as readonly string[]).includes(t)) throw new Error(`not a W1 term: ${t}`);
    if (t.startsWith("kw.")) w.keywords[t.slice(3) as (typeof KEYWORDS)[number]] = v;
    else (w as unknown as Record<string, number>)[t] = v;
  }
  return w;
}

/**
 * Two w1 arrays of the same samples compared by column name (C10 of enc-v2-finish: a run against an older encoding): every
 * column both name must hold the same values row by row; a column only the newer layout has (a term appended since) is
 * only counted where it isn't 0, since the older samples predate its term. Row-major arrays of `rows` rows.
 */
export function compareW1ByName(
  older: { columns: readonly string[]; data: ArrayLike<number> },
  newer: { columns: readonly string[]; data: ArrayLike<number> },
  rows: number,
): { shared: number; differ: number; missing: string[]; added: string[]; addedNonZero: number } {
  const at = new Map(newer.columns.map((c, i) => [c, i]));
  const missing = older.columns.filter((c) => !at.has(c));
  const known = new Set(older.columns);
  const added = newer.columns.filter((c) => !known.has(c));
  const ow = older.columns.length;
  const nw = newer.columns.length;
  let differ = 0;
  let shared = 0;
  older.columns.forEach((c, i) => {
    const j = at.get(c);
    if (j === undefined) return;
    shared += 1;
    for (let r = 0; r < rows; r++) if (older.data[r * ow + i] !== newer.data[r * nw + j]) differ += 1;
  });
  let addedNonZero = 0;
  for (const c of added) {
    const j = at.get(c)!;
    for (let r = 0; r < rows; r++) if (newer.data[r * nw + j] !== 0) addedNonZero += 1;
  }
  return { shared, differ, missing, added, addedNonZero };
}
