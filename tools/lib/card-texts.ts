// The card texts of this machine: the data build writes them to packages/core/data/<SET>_<lang>.json, and they aren't in the
// repository (the core has none: the rules never read them). Tools and tests that read card texts take them from here;
// without the files a card has no text, and the tests about texts are skipped.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readCardTextFile, withCardTexts, type CardTextFile, type CardTextLang } from "../../packages/core/src/data/set-file";
import type { LocalizedText } from "../../packages/core/src/model/card";

const DATA = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "packages", "core", "data");
const TEXT_FILE = /^([A-Za-z0-9]+)_(en|cn|ja)\.json$/;

let read: CardTextFile[] | null = null;

/** The text files of packages/core/data, each checked (read once). */
export function dataTextFiles(): readonly CardTextFile[] {
  if (read) return read;
  read = [];
  if (!existsSync(DATA)) return read;
  for (const name of readdirSync(DATA).sort()) {
    const match = TEXT_FILE.exec(name);
    if (match) read.push(readCardTextFile(JSON.parse(readFileSync(join(DATA, name), "utf8")), { set: match[1]!, lang: match[2] as CardTextLang }));
  }
  return read;
}

/** Whether this machine has the card texts (the data build has run here). */
export const hasDataTexts = (): boolean => dataTextFiles().length > 0;

/** The cards with this machine's texts. */
export function withDataTexts<T extends { id: string; text: LocalizedText }>(cards: readonly T[]): T[] {
  return withCardTexts(cards, dataTextFiles());
}
