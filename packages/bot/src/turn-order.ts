import type { GameSession, PlayerId } from "./core";

// The turn order by the bot's own deck (PlannerBotOptions.turnOrder). CR 6.2.1.6: the player the setup picks at random
// chooses who goes first. Going first and going second differ: the first player doesn't draw in their first turn (CR
// 7.2.4.1) and the second player begins with evolution points (CR 6.2.1.10), so which is better depends on the deck (a deck
// that needs its evolution points early, or one that wants the initiative). Without a table the bots always go first.
//
// A table lists decks, each with the answer an offline rule found for it from the data (the table's builder records the
// rule and the evidence), and a default for every other deck. The bot's own deck — its main deck and evolve deck by card
// definition, the leader not counted — is compared with each entry by the overlap the tools reading human decks use (the
// copies the two share over the larger deck's size, so a reprint counts as its card); the entry with the highest overlap
// at or above the table's threshold answers, else the default.
// Fair: a player knows their own deck list (CR 4.5.2: nobody knows the order of a deck; its composition is the player's
// own). The bot reads the definitions of its own cards in its hand, deck and evolve deck as a multiset: never their order,
// never the opponent's cards, so a sample of what it knows gives the same answer as the real game.

/** A deck of the table: its name (reports only), the answer, and its main and evolve deck as copies by card definition. */
export interface TurnOrderEntry {
  name: string;
  goFirst: boolean;
  cards: Record<string, number>;
}

/** A table of answers by deck (the header). */
export interface TurnOrderTable {
  /** The table's name ("v1"; "first" / "second" for a fixed answer) and a hash of its content, both written in its identity. */
  id: string;
  hash: string;
  /** The least overlap (0..1) an entry needs to answer. */
  threshold: number;
  /** The answer for a deck no entry matches. */
  goFirst: boolean;
  entries: TurnOrderEntry[];
}

/** What a table answered: the answer, the entry that gave it (null: the default) and that entry's overlap. */
export interface TurnOrderChoice {
  goFirst: boolean;
  entry: string | null;
  overlap: number;
}

/** A table without entries: always this answer ("first", "second"; a probe of how much the turn order is worth). */
export function fixedTurnOrder(goFirst: boolean): TurnOrderTable {
  return { id: goFirst ? "first" : "second", hash: "", threshold: 1, goFirst, entries: [] };
}

/** The table's identity: "order=<id>", with ":table=<hash>" for a table with entries. */
export function turnOrderIdentity(table: TurnOrderTable): string {
  return table.entries.length === 0 ? `order=${table.id}` : `order=${table.id}:table=${table.hash}`;
}

/** What is wrong with a table (empty: nothing). */
export function turnOrderProblems(table: TurnOrderTable): string[] {
  const problems: string[] = [];
  if (typeof table.id !== "string" || !/^[a-z0-9-]+$/.test(table.id)) problems.push(`id ${String(table.id)}: lowercase letters, digits and -`);
  if (typeof table.goFirst !== "boolean") problems.push("goFirst: true or false");
  if (typeof table.threshold !== "number" || !(table.threshold > 0) || table.threshold > 1) problems.push(`threshold ${String(table.threshold)}: above 0, at most 1`);
  if (!Array.isArray(table.entries)) return [...problems, "entries: a list"];
  if (table.entries.length > 0 && (typeof table.hash !== "string" || !/^[0-9a-f]{16}$/.test(table.hash))) problems.push("hash: 16 hex digits (the table's content)");
  for (const [i, e] of table.entries.entries()) {
    if (typeof e.name !== "string" || typeof e.goFirst !== "boolean" || typeof e.cards !== "object" || e.cards === null) {
      problems.push(`entry ${i}: name, goFirst and cards`);
      continue;
    }
    const counts = Object.values(e.cards);
    if (counts.length === 0 || counts.some((n) => !Number.isInteger(n) || n < 1)) problems.push(`entry ${i} (${e.name}): cards are copies (whole numbers from 1) by definition`);
  }
  return problems;
}

/** Copies the two decks share over the larger deck's size (1: the same definitions, the same counts). */
export function deckOverlap(a: ReadonlyMap<string, number>, b: ReadonlyMap<string, number>): number {
  let shared = 0;
  let sa = 0;
  let sb = 0;
  for (const n of a.values()) sa += n;
  for (const n of b.values()) sb += n;
  for (const [def, n] of a) shared += Math.min(n, b.get(def) ?? 0);
  const size = Math.max(sa, sb);
  return size === 0 ? 0 : shared / size;
}

/** `me`'s own deck list as the player knows it: the definitions of its cards in hand, deck and evolve deck, with their copies. */
export function ownDeckList(session: GameSession, me: PlayerId): Map<string, number> {
  const reader = session.reader();
  const out = new Map<string, number>();
  for (const zone of ["hand", "deck", "evolveDeck"] as const) {
    for (const id of reader.cards(me, zone)) {
      const def = reader.card(id)?.def;
      if (def !== undefined) out.set(def, (out.get(def) ?? 0) + 1);
    }
  }
  return out;
}

/** The table's answer for a deck (the header): the best entry at or above the threshold, else the default. */
export function turnOrderFor(table: TurnOrderTable, deck: ReadonlyMap<string, number>): TurnOrderChoice {
  let best: TurnOrderEntry | null = null;
  let overlap = 0;
  for (const e of table.entries) {
    const o = deckOverlap(deck, new Map(Object.entries(e.cards)));
    // The first of equals: the table's order decides a tie.
    if (o >= table.threshold && o > overlap) {
      best = e;
      overlap = o;
    }
  }
  return best ? { goFirst: best.goFirst, entry: best.name, overlap } : { goFirst: table.goFirst, entry: null, overlap: 0 };
}
