/**
 * The gates the conditional charge's "gates" scope judges (conditional.ts): a Fanfare's references in the card feature
 * table (card-features.ts) that gate its effect in its code ("if fewer than 3, stop": a part of an effect valid only under
 * a condition does nothing while it isn't met, CR 10.3.3), and whether one is met in a position as the bot sees it
 * (encoder-v2-refs.ts's own filters and tests). conditional.ts takes them as a reader (CondGates), so it needs nothing of
 * the table itself.
 */
import { opponentOf, type CardId, type CardView, type DefId, type HiddenCardView, type PlayerId, type PlayerSideView, type PlayerView } from "./core";
import { refPartial, type CardFeatureTable, type CardRef } from "./card-features";
import type { CondGates } from "./conditional";
import { compileFilter, factsOfCard, meets, refClass } from "./encoder-v2-refs";

/** The references of a Fanfare that gate its effect in its code (where "resolve", a gate, under no choice, fully read). */
export function resolveGatesOf(table: CardFeatureTable, def: DefId, index: number): CardRef[] {
  return table.refsOf(def).filter((r) => r.ability === index && r.timing === "fanfare" && r.where === "resolve" && refClass(r) === "gate" && r.test !== null && !(r.alt && r.alt.length > 0) && !refPartial(r.filter));
}

/** The cards of a counted zone of a side (null: a zone the bot can't count, the deck: CR 4.5.2, nobody sees it). */
function zoneCards(side: PlayerSideView, zone: string): readonly (CardView | HiddenCardView)[] | null {
  switch (zone) {
    case "field":
      return side.field;
    case "cemetery":
      return side.cemetery;
    case "ex":
      return side.ex;
    case "banished":
      return side.banished;
    case "evolveZone":
      return side.evolveZone;
    case "hand":
      return side.hand;
    default:
      return null;
  }
}

/**
 * Is a gate reference met in a position (the bot's view): its zones' cards of its side matching its filter, counted, against
 * its test (encoder-v2-refs.ts meets). Null: not countable (a zone the view doesn't list, a hidden card in it, an unknown side).
 */
export function gateMet(table: CardFeatureTable, view: PlayerView, me: PlayerId, self: CardId, ref: CardRef): boolean | null {
  const sides = ref.side === "own" ? [me] : ref.side === "opp" ? [opponentOf(me)] : ref.side === "both" ? [me, opponentOf(me)] : null;
  if (sides === null || ref.test === null) return null;
  const racing = new Set<string>();
  for (const side of view.players) for (const c of side.raceZone) if (c.linkedTo !== null) racing.add(c.linkedTo);
  const dom = { view, table, racing };
  const pred = compileFilter(table, ref.filter);
  let count = 0;
  for (const side of sides) {
    for (const zone of ref.zones) {
      const cards = zoneCards(view.players[side], zone);
      if (cards === null) return null;
      for (const c of cards) {
        if (c.hidden) return null;
        if (pred(factsOfCard(dom, c), self)) count += 1;
      }
    }
  }
  return meets(ref.test, count);
}

/** The reader conditional.ts takes (its CondGates): the table's hash, a Fanfare's gates, whether one is met, its text. */
export interface TableGates extends CondGates<CardRef> {
  /** The table's hash (its references decide what is judged): written into the change's identity. */
  hash: string;
  gatesOf(def: DefId, index: number): readonly CardRef[];
  met(view: PlayerView, me: PlayerId, self: CardId, gate: CardRef): boolean | null;
  /** How the coverage lists print a gate: "<side> <zones> <filter> <test> <n>". */
  describe(gate: CardRef): string;
}

/** The gates of a card feature table, read as conditional.ts reads them (resolveGatesOf, gateMet). */
export function tableGates(table: CardFeatureTable): TableGates {
  return {
    hash: table.file.hash,
    gatesOf: (def, index) => resolveGatesOf(table, def, index),
    met: (view, me, self, gate) => gateMet(table, view, me, self, gate),
    describe: (g) => `${g.side} ${g.zones.join("/")} ${JSON.stringify(g.filter)} ${g.test!.kind} ${g.test!.n}`,
  };
}
