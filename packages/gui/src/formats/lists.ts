/// <reference types="vite/client" />
// The restriction lists (restrictions/*.json, see the README there): the cards a format bans or limits to 1 copy, per region.
// Every file of the folder is read (a new list is a new file); its name is the list's id.
import type { FormatId } from "../engine/protocol";

export interface ListedCard {
  /** A card number (any printing of the card). */
  card: string;
  /** The name the official page gives (checked against the card data by the tests). */
  name: string;
  since: string;
  note?: string;
}

export interface RestrictionList {
  /** The file's name ("01_26_JPN"). */
  id: string;
  format: Exclude<FormatId, "unlimited">;
  /** asia: the Japanese site's lists; en: the English site's; china: mainland China's. */
  region: "asia" | "en" | "china";
  /** The official list's last update (YYYY-MM-DD). */
  updated: string;
  /** The official page, if there is one. */
  source?: string;
  /** Cross Craft: cards of each leader's class the main deck needs at least (the region's rule; CR Appendix B-2: 1). */
  minimumPerLeaderClass?: number;
  /** Not one copy in a deck. */
  banned: readonly ListedCard[];
  /** One copy at most (殿堂入り, "Restricted to 1"). */
  limited: readonly ListedCard[];
}

const files = import.meta.glob<Omit<RestrictionList, "id">>("../../restrictions/*.json", { eager: true, import: "default" });

/** Every list, the newest first. */
export const RESTRICTION_LISTS: readonly RestrictionList[] = Object.entries(files)
  .map(([path, list]) => ({ ...list, id: path.replace(/^.*\//, "").replace(/\.json$/, "") }))
  .sort((a, b) => b.updated.localeCompare(a.updated) || a.id.localeCompare(b.id));

/** The lists of a format. */
export const listsFor = (format: FormatId): RestrictionList[] => RESTRICTION_LISTS.filter((list) => list.format === format);

/** A list by its id; none for none or a list that isn't there any more. */
export const restrictionList = (id: string | null | undefined): RestrictionList | null => (id ? (RESTRICTION_LISTS.find((list) => list.id === id) ?? null) : null);

/**
 * A short fingerprint of a list's contents (FNV-1a of its JSON): online, the host's rules carry the one of the list the room
 * uses, and the other player's program checks its own list of that name is the same (net/online.ts listProblem).
 */
export function listFingerprint(list: RestrictionList): string {
  const text = JSON.stringify(list);
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `${h.toString(16).padStart(8, "0")}${text.length.toString(16)}`;
}

/**
 * Online: the host's restriction list (its rules' `list` and `listHash`) as this program has it: none (no list of that name)
 * or another version of it (its contents differ). Its decks would be checked another way: it can't be ready. Null: no list,
 * or the same one.
 */
export function listProblem(rules: { list: string | null; listHash: string | null }): "missing" | "different" | null {
  if (rules.list === null) return null;
  const mine = restrictionList(rules.list);
  if (!mine) return "missing";
  return rules.listHash !== null && listFingerprint(mine) !== rules.listHash ? "different" : null;
}
