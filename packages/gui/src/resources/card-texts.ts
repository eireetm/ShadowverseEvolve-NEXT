// The card texts the page shows (README "Custom resources"). The engine has none (the rules never read them, and they aren't
// in the repository): they come in two layers, and the first that has a set's texts in a language gives them, as a whole file
// (decided by the project owner, 2026-10-18):
//  1. the player's own: public/text/<SET>_<lang>.json;
//  2. this machine's: the data build's files packages/core/data/<SET>_<lang>.json, which the dev server gives
//     (host/plugin.ts /api/card-texts); a release has none of its own (the private release's are in its public/text/).
// Both are the format of core/data/set-file.ts: a card a file doesn't list has no text in its language, and the card shows the
// next language's (catalog.ts cardTextLang), or none. Only the page shows them: games, replays and online play don't change.
import { readCardTextFile, withCardTexts, type CardTextFile, type CardTextLang, type LocalizedText } from "@sve/core";
import { hostApi } from "../host/api";

/** A text file in public/: "text/BP22_cn.json" (set BP22, Chinese). */
const OWN_TEXT_FILE = /^text\/([A-Za-z0-9]+)_(en|cn|ja)\.json$/;

/** The files whose texts are shown: this machine's that the player's don't replace, then the player's. */
let shown: readonly CardTextFile[] = [];
let problems: readonly string[] = [];
const listeners = new Set<() => void>();

/**
 * Read the texts: the player's files among those of public/ (resources.ts lists them), each checked as the data's are (one
 * that isn't a text file of its name's set and language is left out, cardTextProblems names it), and this machine's.
 */
export async function loadCardTexts(publicFiles: Iterable<string>): Promise<void> {
  const own: CardTextFile[] = [];
  const bad: string[] = [];
  for (const path of publicFiles) {
    const match = OWN_TEXT_FILE.exec(path);
    if (!match) continue;
    try {
      const response = await fetch(hostApi.resourceUrl(path));
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      own.push(readCardTextFile(await response.json(), { set: match[1]!, lang: match[2] as CardTextLang }));
    } catch (err) {
      console.warn(`public/${path}:`, err);
      bad.push(`public/${path}`);
    }
  }
  const builtIn: CardTextFile[] = [];
  try {
    for (const json of await hostApi.builtInCardTexts()) {
      try {
        builtIn.push(readCardTextFile(json));
      } catch (err) {
        console.warn("card texts of this machine:", err);
      }
    }
  } catch (err) {
    console.warn("card texts of this machine:", err);
  }
  const replaced = new Set(own.map((f) => `${f.set}_${f.lang}`));
  shown = [...builtIn.filter((f) => !replaced.has(`${f.set}_${f.lang}`)), ...own];
  problems = bad;
  for (const listener of listeners) listener();
}

/** The player's text files that couldn't be used ("public/text/BP22_cn.json"), from the last reading. */
export const cardTextProblems = (): readonly string[] => problems;

/** Be told when the texts have been read (again: the settings' "read the folder again"). */
export function onCardTexts(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The cards with the texts read (core/data/set-file.ts withCardTexts). */
export function withShownTexts<T extends { id: string; text: LocalizedText }>(cards: readonly T[], files: readonly CardTextFile[] = shown): T[] {
  return withCardTexts(cards, files);
}
