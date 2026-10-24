import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { DeckList } from "../src/core";

// The sample decks (packages/gui/decks/samples) and the deck sets the bots are measured on, for the tests.
const ROOT = join(__dirname, "..", "..", "..");

/** A sample deck by name (sd01, dsd01b, ...): counts expanded to a list. */
export function sampleDeck(name: string): DeckList {
  const json = JSON.parse(readFileSync(join(ROOT, "packages", "gui", "decks", "samples", `${name}.json`), "utf8")) as { leader: string; main: Record<string, number>; evolve?: Record<string, number> };
  const expand = (counts: Record<string, number> = {}) => Object.entries(counts).flatMap(([p, n]) => Array<string>(n).fill(p));
  return { leader: json.leader, main: expand(json.main), evolve: expand(json.evolve) };
}

/** The training and the holdout deck sets (tools/rl/decksets.json). */
export const DECK_SETS = JSON.parse(readFileSync(join(ROOT, "tools", "rl", "decksets.json"), "utf8")) as { train: string[]; holdout: string[] };

/** The arena's configuration (every main phase and quick window asked; the deck rules on). */
export const ARENA_CONFIG = { autoResolve: ["selectPending", "selectCards", "choose", "orderCards"] as ("selectPending" | "selectCards" | "choose" | "orderCards")[], deckRestrictions: true };
