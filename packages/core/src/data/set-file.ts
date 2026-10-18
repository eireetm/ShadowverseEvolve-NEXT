import type { CardDefinition, DefId, LocalizedText } from "../model/card";
import { CardDataError } from "./errors";

/**
 * Format version of the generated `packages/core/data/<SET>.json` files. 2 (2026-10-18): the card texts are in files of
 * their own, one per language (CardTextFile), which aren't in the repository: a set is the same game without them.
 */
export const CARD_SET_FORMAT = 2;

/** Format version of the card text files `packages/core/data/<SET>_<lang>.json`. */
export const CARD_TEXT_FORMAT = 1;

/** The languages of the card texts, each in a file of its own. */
export const CARD_TEXT_LANGS = ["en", "cn", "ja"] as const;
export type CardTextLang = (typeof CARD_TEXT_LANGS)[number];

/** A set file as stored: its definitions without their texts. */
export interface CardSetFile {
  format: number;
  set: string;
  /** Number of physical printings merged into `cards`. */
  printings: number;
  cards: Omit<CardDefinition, "text">[];
}

/**
 * A card text file `<SET>_<lang>.json`: the texts of a set's definitions in one language, by definition id. A definition the
 * file doesn't list has no text in that language (an empty English text, a null Chinese or Japanese one); "" is listed for a
 * card whose text is empty. Written by the data build (tools/build-card-data.ts) and kept out of the repository; the GUI
 * takes the player's own files of this format (public/text/) before them.
 */
export interface CardTextFile {
  format: number;
  set: string;
  lang: CardTextLang;
  cards: Record<DefId, string>;
}

/** A set's definitions. */
export interface CardSet {
  set: string;
  printings: number;
  cards: CardDefinition[];
}

/** A definition's texts before a text file gives them. */
const NO_TEXT: LocalizedText = { en: "", cn: null, ja: null };

/**
 * Light structural check of a generated set file, and its definitions — without texts, unless the set's text files are given
 * (a tool or a test that has them; the core itself never needs them).
 */
export function readCardSetFile(json: unknown, texts?: Partial<Readonly<Record<CardTextLang, unknown>>>): CardSet {
  const f = json as Partial<CardSetFile>;
  if (!f || f.format !== CARD_SET_FORMAT || typeof f.set !== "string" || !Array.isArray(f.cards)) {
    throw new CardDataError(`unsupported card set file (format ${String(f?.format)}); re-run npm run build:cards`);
  }
  const set = f.set;
  const files = CARD_TEXT_LANGS.flatMap((lang) => (texts?.[lang] === undefined ? [] : [readCardTextFile(texts[lang], { set, lang })]));
  const ids = new Set(f.cards.map((c) => c.id));
  for (const file of files) {
    const stray = Object.keys(file.cards).find((id) => !ids.has(id));
    if (stray) throw new CardDataError(`${set}_${file.lang}.json: ${stray} is not a definition of ${set}; re-run npm run build:cards`);
  }
  const cards = withCardTexts(
    f.cards.map((c): CardDefinition => ({ ...c, text: NO_TEXT })),
    files,
  );
  return { set, printings: f.printings ?? 0, cards };
}

/**
 * Definitions with the texts of text files: a file gives its set's definitions (their ids start with the set's code, as the
 * data files hold them; a back face's too, "BP09-005_back") their texts in its language, as a whole — a definition it doesn't
 * list has none in that language. A later file of the same set and language replaces an earlier one's (the GUI lays the
 * player's own, public/text/, over the data's).
 */
export function withCardTexts<T extends { id: string; text: LocalizedText }>(cards: readonly T[], files: readonly CardTextFile[]): T[] {
  if (files.length === 0) return [...cards];
  return cards.map((card) => {
    let text = card.text;
    for (const file of files) {
      if (!card.id.startsWith(`${file.set}-`)) continue;
      // Not Object.hasOwn: older Android WebViews (the GUI's) lack it.
      const own = Object.prototype.hasOwnProperty.call(file.cards, card.id) ? file.cards[card.id]! : null;
      text = { ...text, [file.lang]: file.lang === "en" ? (own ?? "") : own };
    }
    return text === card.text ? card : { ...card, text };
  });
}

/**
 * Light structural check of a card text file: a generated one, or the player's own that replaces it in the GUI (public/text/,
 * the same format). `expected` names the set and the language it must be (its file name's).
 */
export function readCardTextFile(json: unknown, expected?: { set: string; lang: CardTextLang }): CardTextFile {
  const f = json as Partial<CardTextFile>;
  const where = expected ? `${expected.set}_${expected.lang}.json` : "card text file";
  const cards = f?.cards;
  if (!f || f.format !== CARD_TEXT_FORMAT || typeof f.set !== "string" || !CARD_TEXT_LANGS.includes(f.lang as CardTextLang) || !cards || typeof cards !== "object" || Array.isArray(cards)) {
    throw new CardDataError(`${where}: not a card text file of format ${CARD_TEXT_FORMAT} (format ${String(f?.format)})`);
  }
  if (expected && (f.set !== expected.set || f.lang !== expected.lang)) throw new CardDataError(`${where}: it says set ${f.set}, language ${f.lang}`);
  const notText = Object.entries(cards).find(([, text]) => typeof text !== "string");
  if (notText) throw new CardDataError(`${where}: the text of ${notText[0]} is not a string`);
  return f as CardTextFile;
}
