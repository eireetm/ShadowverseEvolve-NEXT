// The decks and the order of the games bot:arena and bench:throughput play: the sample decks and the deck sets of
// decksets.json, every ordered matchup of the decks walked in a spread-out order, and which seat bot A takes in each game.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { DeckList } from "../../packages/core/src";

export const ROOT = join(import.meta.dirname, "..", "..");
const SAMPLES = join(ROOT, "packages", "gui", "decks", "samples");

export interface NamedDeck {
  name: string;
  deck: DeckList;
}

/** decksets.json: the format and restriction list the sets are legal in, and the sets. */
export interface DeckSets {
  format: "standard";
  restrictionList: string;
  train: string[];
  holdout: string[];
}

export const DECK_SETS = JSON.parse(readFileSync(join(ROOT, "tools", "rl", "decksets.json"), "utf8")) as DeckSets;

/** The deck names of a set ("train", "holdout", "legal": both), or null for another name. */
export function deckSet(name: string): string[] | null {
  if (name === "train") return DECK_SETS.train;
  if (name === "holdout") return DECK_SETS.holdout;
  if (name === "legal") return [...DECK_SETS.train, ...DECK_SETS.holdout];
  return null;
}

/** Every sample deck but the Cross Craft one. */
export const allSampleDecks = (): string[] =>
  readdirSync(SAMPLES)
    .filter((f) => f.endsWith(".json") && !f.startsWith("cross"))
    .map((f) => f.replace(/\.json$/, ""));

const expand = (counts: Record<string, number> | undefined) => Object.entries(counts ?? {}).flatMap(([id, n]) => Array<string>(n).fill(id));

/** A sample deck by name, or null. */
export function sampleDeck(name: string): NamedDeck | null {
  const file = join(SAMPLES, `${name}.json`);
  if (!existsSync(file)) return null;
  const json = JSON.parse(readFileSync(file, "utf8")) as { leader: string; main: Record<string, number>; evolve?: Record<string, number> };
  return { name, deck: { leader: json.leader, main: expand(json.main), evolve: expand(json.evolve) } };
}

/** The ordered pairs of decks played (seat 0's deck, seat 1's deck): each deck against itself, or every two different decks. */
export function orderedMatchups(decks: number, mirror: boolean): [number, number][] {
  const all: [number, number][] = [];
  for (let i = 0; i < decks; i++) for (let j = 0; j < decks; j++) if (mirror ? i === j : i !== j) all.push([i, j]);
  return all;
}

/** A stride with no common factor with `n`: walking by it visits every matchup once per lap, spread out. */
export function spreadStride(n: number): number {
  const gcd = (x: number, y: number): number => (y === 0 ? x : gcd(y, x % y));
  let s = Math.max(1, Math.floor(n * 0.382) + 1);
  while (n > 1 && gcd(s, n) !== 1) s += 1;
  return s;
}

export interface SeriesGame {
  /** The game's seed: one per pair of games (paired), or per game (independent). */
  seed: string;
  pair: number | null;
  /** Indices of seat 0's and seat 1's decks. */
  decks: [number, number];
  /** The seat of bot A. */
  seatOfA: number;
}

/**
 * Game `index` of a series. Paired: two games per seed and matchup, A in each seat once. Independent: a seed per game; A's
 * seat alternates, and changes from lap to lap of the matchups too, so that A plays both sides of every pair of decks (with
 * an even number of matchups, the stride is odd and every visit of a matchup would otherwise fall on the same parity).
 */
export function seriesGame(index: number, series: string, matchups: readonly [number, number][], independent: boolean): SeriesGame {
  const n = matchups.length;
  const unit = independent ? index : Math.floor(index / 2);
  const decks = matchups[(unit * spreadStride(n)) % n]!;
  const seatOfA = independent ? (n % 2 === 0 ? (unit + Math.floor(unit / n)) % 2 : unit % 2) : index % 2;
  return { seed: `${series}-${unit}`, pair: independent ? null : unit, decks, seatOfA };
}
