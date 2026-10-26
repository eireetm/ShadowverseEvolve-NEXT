import type { Answer, Decision, MainAction, RngState } from "./core";
import { candidateAnswers } from "./candidates";
import type { SameCard } from "./distinct-answers";
import type { CardLookup } from "./policy";

/**
 * The answers a planner tries at a decision of its turn, at most `max`: main phase actions by kind in turns (attacks, plays,
 * evolutions, abilities), attacks on the leader first and then on the most valuable followers, the same action of identical
 * cards once; ending the main phase is not among them (a plan can end at any decision that allows it). Other decisions as
 * the greedy bot compares them. With `same` (distinct-answers.ts: the cards as the deciding player sees them), selections and
 * choices are told apart by what they choose, and an attack's target, the follower evolved and the card whose ability is
 * activated by what they are: the same action on either of two identical cards is tried once.
 */
export function planBranches(d: Decision, lookup: CardLookup, rng: RngState, max: number, same?: SameCard): Answer[] {
  if (d.type !== "mainPhase") return candidateAnswers(d, lookup, rng, max, false, same);
  const groups: Record<string, { key: string; answer: Answer }[]> = { attack: [], play: [], evolve: [], activate: [] };
  const seen = new Set<string>();
  for (const action of d.actions) {
    if (action.type === "endMainPhase" || action.type === "manual") continue;
    const key = actionKey(action, lookup, same);
    if (seen.has(key)) continue;
    seen.add(key);
    groups[action.type]!.push({ key, answer: { type: "mainPhase", action } });
  }
  // Attacks on the leader first, then on the most valuable followers.
  groups.attack!.sort((a, b) => targetRank(b.answer, lookup) - targetRank(a.answer, lookup));
  const out: Answer[] = [];
  const lists = Object.values(groups);
  for (let i = 0; out.length < max && lists.some((l) => i < l.length); i++) {
    for (const list of lists) if (i < list.length && out.length < max) out.push(list[i]!.answer);
  }
  return out;
}

/**
 * Actions that give the same position: the same card played from the same place, attacks by identical followers; with
 * `same`, also attacks on identical targets, evolving either of two identical followers, the same ability of identical cards.
 */
function actionKey(action: MainAction, lookup: CardLookup, same?: SameCard): string {
  switch (action.type) {
    case "play": {
      const f = lookup(action.card);
      return f ? `play|${f.def}|${f.zone}|${String(f.cost)}` : JSON.stringify(action);
    }
    case "evolve": {
      const f = lookup(action.evolveCard);
      return JSON.stringify({ ...action, evolveCard: f?.def ?? action.evolveCard, ...(same ? { card: same(action.card) } : {}) });
    }
    case "attack": {
      const a = lookup(action.attacker);
      return a ? `attack|${a.def}|${a.value}|${a.zone}|${same ? same(action.target) : action.target}` : JSON.stringify(action);
    }
    case "activate":
      return same ? JSON.stringify({ ...action, card: same(action.card) }) : JSON.stringify(action);
    default:
      return JSON.stringify(action);
  }
}

function targetRank(answer: Answer, lookup: CardLookup): number {
  if (answer.type !== "mainPhase" || answer.action.type !== "attack") return 0;
  const target = lookup(answer.action.target);
  return target?.zone === "leader" ? 1_000 : (target?.value ?? 0);
}
