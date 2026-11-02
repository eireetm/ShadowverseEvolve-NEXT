// A cemetery's cards counted (CemeteryStats.tsx): the printed cost, class, card type and traits of each, as the card has them.
// A cemetery is public (CR 4.9.2): this tells nothing its window doesn't show.
import { CARD_CLASSES, type CardClass, type CardType, type CardView } from "@sve/core";
import type { Catalog } from "../../app/catalog";
import { displayOf } from "../card/display";

export interface Tally<K> {
  key: K;
  n: number;
}

export interface TraitTally extends Tally<string> {
  /** How many of them are of each card type, in the order of `CemeteryStatsData.types`. */
  types: Tally<CardType>[];
}

export interface CemeteryStatsData {
  total: number;
  /** By cost, lowest first; cards without a cost last (key null). */
  costs: Tally<number | null>[];
  /** The most first. */
  classes: Tally<CardClass>[];
  /** Followers, spells, amulets, then the rest. */
  types: Tally<CardType>[];
  /** The most first. A card of two traits counts in both (CR 2.4). */
  traits: TraitTally[];
}

const TYPE_ORDER: readonly CardType[] = ["follower", "spell", "amulet", "crest", "equipment", "leader"];

const add = <K>(to: Map<K, number>, key: K): void => {
  to.set(key, (to.get(key) ?? 0) + 1);
};

const inTypeOrder = (types: ReadonlyMap<CardType, number>): Tally<CardType>[] => TYPE_ORDER.flatMap((key) => (types.has(key) ? [{ key, n: types.get(key)! }] : []));

export function cemeteryStats(cards: readonly CardView[], catalog: Catalog): CemeteryStatsData {
  const costs = new Map<number | null, number>();
  const classes = new Map<CardClass, number>();
  const types = new Map<CardType, number>();
  const traits = new Map<string, Map<CardType, number>>();
  for (const card of cards) {
    const def = catalog.def(displayOf(card, undefined, catalog).def);
    if (!def) continue;
    add(costs, def.cost);
    add(classes, def.class);
    add(types, def.type);
    for (const trait of new Set(def.traits)) {
      const byType = traits.get(trait) ?? new Map<CardType, number>();
      traits.set(trait, byType);
      add(byType, def.type);
    }
  }
  const rank = (cost: number | null): number => cost ?? Infinity;
  return {
    total: cards.length,
    costs: [...costs].map(([key, n]) => ({ key, n })).sort((a, b) => rank(a.key) - rank(b.key)),
    classes: [...classes].map(([key, n]) => ({ key, n })).sort((a, b) => b.n - a.n || CARD_CLASSES.indexOf(a.key) - CARD_CLASSES.indexOf(b.key)),
    types: inTypeOrder(types),
    traits: [...traits]
      .map(([key, byType]) => ({ key, n: [...byType.values()].reduce((sum, n) => sum + n, 0), types: inTypeOrder(byType) }))
      .sort((a, b) => b.n - a.n || a.key.localeCompare(b.key)),
  };
}
