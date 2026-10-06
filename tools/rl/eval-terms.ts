// The hand-written evaluation (packages/bot/src/evaluate.ts) as a weighted sum of terms, one per weight: what W1 refits (a
// logistic regression over the terms of both sides). The terms are taken with the default danger line (8) and hand cap (7),
// and signed so that a side's value is exactly Σ weight · term; the evaluation is my side's value minus the opponent's.
import { DEFAULT_WEIGHTS, type EvalWeights } from "../../packages/bot/src";
import { opponentOf, type CardView, type PlayerId, type PlayerSideView, type PlayerView } from "../../packages/core/src";

const KEYWORDS = ["ward", "bane", "drain", "aura", "intimidate", "assail", "rush", "storm"] as const;

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
  for (const card of s.ex) {
    if (card.type === "crest") {
      add("crest", 1);
      add("counter", counterSum(card));
    } else add("ex", 1);
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
