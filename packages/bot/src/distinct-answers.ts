import type { Answer, CardId, Decision, PlayerView } from "./core";
import { cardSignatures } from "./keys";

// Selections and choices told apart by what is chosen, not by which ids (PlannerBotOptions.choiceDedupe). A search of a deck
// with 15 candidates of 6 cards has 6 different answers of one card (and none), not 15; "up to 2" of four followers that are
// two pairs of identical ones has 6, not 11. The candidates' answers (candidates.ts) then enumerate the different ones and
// sample only when there are too many, and a sampled answer that is one already listed (another copy, the same cards in
// another order) is not listed again. Main phase actions on identical cards (an attack on either of two identical enemy
// followers) are tried once (branches.ts). The answers are still the decision's own ids: only the duplicates are left out.

/** What a candidate of a decision is for telling answers apart (two candidates with the same signature are interchangeable). */
export type SameCard = (id: CardId) => string;

/**
 * The signatures of a decision's cards as its player sees them (`view` is that player's, with the decision): a card the view
 * shows by everything it shows of it and where it is (keys.ts cardSignatures); a card the decision lets its player look at
 * (CR 5.11, `peek`) or only names (a deck's cards in a search, CR 5.8: `candidateDefs`) by its definition; a card the view
 * hides by where it is ("?": its player can't tell those apart). Only the view and the decision are read — in the real game
 * (the Ward choices) as in a sample — so nothing hidden from the player tells two cards apart. A forced candidate (CR 1.3.2.3,
 * `mandatory`) never shares a signature with one that isn't.
 */
export function answerSigner(view: PlayerView, d: Decision): SameCard {
  const shown = cardSignatures(view);
  const peek = new Map<CardId, string>();
  const named = new Map<CardId, string>();
  let mandatory: ReadonlySet<CardId> = new Set();
  if (d.type === "selectCards") {
    for (const c of d.peek ?? []) peek.set(c.id, c.def);
    d.candidates.forEach((id, i) => {
      const def = d.candidateDefs[i];
      if (def) named.set(id, def);
    });
    mandatory = new Set(d.mandatory ?? []);
  }
  return (id) => {
    const seen = shown(id);
    const s =
      seen !== undefined && !seen.hidden
        ? seen.signature
        : peek.has(id)
          ? `peek|${peek.get(id)!}`
          : seen !== undefined
            ? seen.signature
            : named.has(id)
              ? `shown|${named.get(id)!}`
              : `id|${id}`;
    return mandatory.has(id) ? `!${s}` : s;
  };
}

/** The key of a selection by what it selects: the multiset of its cards' signatures (the order left out). */
export function selectionKey(cards: readonly CardId[], same: SameCard): string {
  return JSON.stringify(cards.map(same).sort());
}

/** The key of a choice: its options as a set (the engine returns them in the options' order, decide.ts chooseOptions). */
export function choiceKey(ids: readonly string[]): string {
  return JSON.stringify([...ids].sort());
}

/**
 * Every different selection of a selectCards decision by what it selects, up to `limit`, the smallest first (as the engine's
 * enumerateAnswers lists them): the candidates grouped by signature, and for each size from `min` to `max` every multiset
 * of the groups that fits (each group at most as often as it has cards), the forced cards first while they last (CR
 * 1.3.2.3: a selection includes as many of them as its size allows). A multiset is given by the first cards of each group,
 * forced ones first and then in the candidates' order. `complete`: these are all of them.
 */
export function distinctSelections(d: Extract<Decision, { type: "selectCards" }>, same: SameCard, limit: number): { answers: Answer[]; complete: boolean } {
  const index = new Map(d.candidates.map((id, i) => [id, i]));
  const groupsOf = (ids: readonly CardId[]) => {
    const groups = new Map<string, CardId[]>();
    for (const id of ids) {
      const s = same(id);
      const g = groups.get(s);
      if (g) g.push(id);
      else groups.set(s, [id]);
    }
    return [...groups.values()];
  };
  const must = new Set(d.mandatory ?? []);
  const forced = groupsOf(d.candidates.filter((id) => must.has(id)));
  const free = groupsOf(d.candidates.filter((id) => !must.has(id)));
  const forcedCount = forced.reduce((n, g) => n + g.length, 0);
  const out: Answer[] = [];
  const order = (ids: CardId[]) => ids.sort((a, b) => Number(must.has(b)) - Number(must.has(a)) || index.get(a)! - index.get(b)!);
  /** Every multiset of `k` cards of `groups` (counts per group, lexicographic), visited until `visit` returns false. */
  const multisets = (groups: CardId[][], k: number, visit: (ids: CardId[]) => boolean): boolean => {
    const counts = new Array<number>(groups.length).fill(0);
    const left = (from: number) => groups.slice(from).reduce((n, g) => n + g.length, 0);
    const go = (g: number, rest: number): boolean => {
      if (rest === 0) {
        const ids: CardId[] = [];
        counts.forEach((c, i) => ids.push(...groups[i]!.slice(0, c)));
        return visit(ids);
      }
      if (g >= groups.length || left(g) < rest) return true;
      for (let c = Math.min(groups[g]!.length, rest); c >= 0; c--) {
        counts[g] = c;
        if (!go(g + 1, rest - c)) return false;
      }
      counts[g] = 0;
      return true;
    };
    return go(0, k);
  };
  const visit = (ids: CardId[]): boolean => {
    if (out.length >= limit) return false;
    out.push({ type: "selectCards", cards: order(ids) });
    return true;
  };
  for (let size = d.min; size <= Math.min(d.max, d.candidates.length); size++) {
    const ok = size <= forcedCount ? multisets(forced, size, visit) : multisets(free, size - forcedCount, (others) => visit([...forced.flat(), ...others]));
    if (!ok) return { answers: out, complete: false };
  }
  return { answers: out, complete: true };
}
