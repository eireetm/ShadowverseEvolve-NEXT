// Cards named in a card's text, as links of the card panel (CardText's links): a click shows that card (a token, or one card a
// text names by its whole name). Which rule applies follows the text shown, not the card language (cardText falls back to
// another language's text):
// - Japanese and Chinese: a card's whole name in 『』 (never a part of a longer name, never unquoted: 妖精 is also a trait),
//   the reference block after ――― included; not in 「カード名に『X』を含む」 / 「卡片名包含『X』」 (a part of a name). A token
//   first, then another card: a name several cards have is the only one of them that isn't evolved (an evolved card has its
//   card's name), else none.
// - English: a token's whole name (longest first). A token name inside a longer card name ("Noble Fairy", "Lævateinn
//   Dragon") belongs to that card, and a name right after a capitalized word in the middle of a sentence ends a longer name
//   the data doesn't have ("Iron Tail Dragon"). A name without "token" after it counts too ("If there's no Magitrain on
//   your field"), except a name another card also has ("Mimi": only "a Mimi or Coco token") and a quoted part of a name
//   ('with "Ghost" in its name'). Other cards: those the Japanese text (else the Chinese one) names, by their English whole
//   names (English texts quote no names: only the cards meant are looked for).
// - Traditional Chinese: the Chinese text's links at the same places of its conversion (OpenCC keeps the text's length).
// No two tokens share a name in a language (the core's card database refuses it, CR 9.1.2.3), so a name is one token. A few
// texts write a card's name otherwise than its card: VARIANTS, per card.
import { cardTextLang, type Catalog } from "../../app/catalog";
import type { CardLang } from "../../app/settings";
import type { CatalogCard } from "../../engine/protocol";
import { dataLang, toHant, type DataLang } from "../../i18n/hant";

/** A part of a line of text that opens another card in the panel (a card the text names): where, and which card. */
export interface TextLink {
  start: number;
  end: number;
  def: string;
}

/** Links in card text (CardText): where they are in its `index`th line (not overlapping, in order), and what a click does. */
export interface TextLinks {
  find(index: number): readonly TextLink[];
  open(def: string): void;
}

/** A card named in a text: where (the name only, without 『』 or "token"), and which card. */
interface Mention {
  start: number;
  end: number;
  def: string;
}

/**
 * Texts that write a card's name otherwise than its card does, by card: what they write, and the card meant (checked against
 * the card's other languages). Never for every card: 『ミミ』 is also a non-token card's Japanese name (CP04-103), 情谊的证明 a
 * non-token card's Chinese name (BP21-116).
 */
const VARIANTS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  // 『ミミ』『ココ』 for 冥焔の右腕・ミミ / 冥焔の左腕・ココ.
  "BP01-101": { ミミ: "BP01-T12", ココ: "BP01-T13" },
  "BP01-102": { ミミ: "BP01-T12", ココ: "BP01-T13" },
  // 神祕 for 神秘的创造物 (Mystic Artifact).
  "BP08-101": { 神祕的创造物: "BP05-T05" },
  // Diurnal Slumber: the token's card says 待夜的憩息.
  "BP18-078": { 待宵的憩息: "BP18-T07" },
  // 纹章 呜咽的圣骑士·维尔伯特.
  "BP21-095": { "纹章 哀泣的圣骑士·维尔伯特": "BP21-T10" },
  // Precious Memento: the token's card says 情谊之证.
  "CP04-058": { 情谊的证明: "CP04-T09" },
  // A misspelled Shield Guardian.
  "BP17-029": { "Shield Gaurdian": "BP02-T02" },
  // Elana's Prayer: its card says 耶菈的祈祷.
  "BP18-100": { 耶拉的祈祷: "BP02-095" },
  // A-Class Pyromancy: its card says 炎术检定A级.
  "BP18-118": { 炎术鉴定A级: "BP18-123" },
  // Saito, Mao Ward Officer: its card says 魔污区政府职员·灾藤.
  "BP18-123": { "魔污区役所职员·灾藤": "BP18-117" },
  // Tokai Teio: its card says 东海帝皇.
  "CP01-024": { 东海帝王: "CP01-014" },
  // Irontail Dragon, and a misspelled Gatling Claw Dragon.
  "CP03-066": { "Iron Tail Dragon": "CP03-080", "Gattling Claw Dragon": "CP03-077" },
  // Anne's Sorcery: its card says 安的宏大魔法.
  "DSD01a-001": { 安的大魔法: "DSD01a-008" },
  // Grea's Ember: its card's English name is its first printing's, a Japanese one (BP21-PR10 グレアの炎熱).
  "DSD01a-003": { "Grea's Ember": "BP21-PR10" },
};

/** Japanese or Chinese names: tokens, then the other cards (null: several cards have it, and not just one of them isn't evolved). */
interface QuotedNames {
  tokens: Map<string, string>;
  cards: Map<string, string | null>;
}

/** What the rules need of the card pool, made once per catalog. */
interface LinkIndex {
  /** English: tokens by name; names also some other card's; every token name and every other card name holding one, longest first. */
  en: { tokens: Map<string, string>; shared: Set<string>; names: RegExp };
  ja: QuotedNames;
  cn: QuotedNames;
}

const indexes = new WeakMap<Catalog, LinkIndex>();

const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Whole words: no letter or digit just before or after (\b doesn't know "Lævateinn" or "Smart!"). `pattern`: a name's. */
const wordsOf = (names: Iterable<string>, pattern: (name: string) => string = escape): RegExp =>
  new RegExp(
    `(?<![\\p{L}\\p{N}])(?:${[...names]
      .sort((a, b) => b.length - a.length)
      .map(pattern)
      .join("|")})(?![\\p{L}\\p{N}])`,
    "gu",
  );

/** An English name with its apostrophes and hyphens either way, as the texts write them ("Shadow’s Corrosion", "All-Discerning"). */
const looseName = (name: string): string => name.replace(/’/g, "'").replace(/-/g, " ");
const loosePattern = (name: string): string => escape(looseName(name)).replace(/'/g, "['’]").replace(/ /g, "[ -]");
/** An English name has letters, and no kanji or kana (an English name of a Japan-only printing is the Japanese one). */
const ENGLISH = /[A-Za-z]/;
const JAPANESE_OR_CHINESE = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;

/** A card's names in a language: its own and its printings' other ones (CR 2.13). */
const namesOf = (card: CatalogCard, lang: DataLang): string[] =>
  [card.names[lang], ...Object.values(card.alternateNames ?? {}).map((alt) => alt?.[lang])].filter((name): name is string => !!name);

/** The other cards by name: the one card of a name, or the one that isn't evolved (its evolved cards share its name). */
function cardsByName(catalog: Catalog, lang: "ja" | "cn"): Map<string, string | null> {
  const having = new Map<string, CatalogCard[]>();
  for (const card of catalog.cards) {
    if (card.token) continue;
    for (const name of new Set(namesOf(card, lang))) having.set(name, [...(having.get(name) ?? []), card]);
  }
  const out = new Map<string, string | null>();
  for (const [name, cards] of having) {
    const unevolved = cards.filter((card) => !card.evolved);
    out.set(name, unevolved.length === 1 ? unevolved[0]!.id : cards.length === 1 ? cards[0]!.id : null);
  }
  return out;
}

function indexOf(catalog: Catalog): LinkIndex {
  let index = indexes.get(catalog);
  if (index) return index;
  const tokens = new Map<string, string>();
  const others = new Set<string>();
  const ja = new Map<string, string>();
  const cn = new Map<string, string>();
  for (const card of catalog.cards) {
    const en = card.names.en;
    if (!card.token) {
      for (const name of namesOf(card, "en")) others.add(name);
      continue;
    }
    // Not a pre-release placeholder ("unavailable") nor a name in Japanese (DSD01a-T01): the English texts never write them.
    if (en && !card.preview && /[A-Za-z]/.test(en) && !tokens.has(en)) tokens.set(en, card.id);
    for (const name of namesOf(card, "ja")) if (!ja.has(name)) ja.set(name, card.id);
    if (card.names.cn && !cn.has(card.names.cn)) cn.set(card.names.cn, card.id);
  }
  const anyToken = wordsOf(tokens.keys());
  // Only a card name holding a token name can hide one.
  const holders = [...others].filter((name) => !tokens.has(name) && ((anyToken.lastIndex = 0), anyToken.test(name)));
  index = {
    en: { tokens, shared: new Set([...tokens.keys()].filter((name) => others.has(name))), names: wordsOf(tokens.size > 0 ? [...tokens.keys(), ...holders] : ["\u0000"]) },
    ja: { tokens: ja, cards: cardsByName(catalog, "ja") },
    cn: { tokens: cn, cards: cardsByName(catalog, "cn") },
  };
  indexes.set(catalog, index);
  return index;
}

/** Between two names of a list ("a Steelclad Knight, Shield Guardian, or Knight token", "a Mimi or Coco token"). */
const LIST_SEPARATOR = /^(?:,\s*(?:and\s+|or\s+)?|,?\s+(?:and|or)\s+)(?:(?:an?|the|\d+|X)\s+)?$/;

/** Whether the word just before `start` is a capitalized word (2+ letters) that doesn't begin a sentence. */
function afterCapitalizedWord(text: string, start: number): boolean {
  const word = /(\S+) +$/.exec(text.slice(Math.max(0, start - 80), start));
  if (!word || /[,.;:!?)"”\]}]$/.test(word[1]!) || !/^\p{Lu}[\p{L}\p{M}]/u.test(word[1]!)) return false;
  // A sentence begins at the start of the text or a line, after its punctuation, an icon, a bracket or a dash.
  return !/(?:^|[.!?:;)\]}"“(\-—])\s*$/.test(text.slice(0, start - word[0].length));
}

/** Whether a name is a quoted part of a name: 'with "Ghost" in its name' (or '"A" or "B" in its name'). */
function quotedNamePart(text: string, start: number, end: number): boolean {
  if (!/["“]$/.test(text.slice(0, start))) return false;
  return /^["”](?:\s*(?:,|or|and)\s*["“][^"”]*["”])*\s+in (?:its|their) names?\b/.test(text.slice(end));
}

/** English token mentions (the rule above). */
function englishMentions(text: string, card: CatalogCard, index: LinkIndex, catalog: Catalog): Mention[] {
  const { tokens, shared, names } = index.en;
  const hits: { start: number; end: number; def: string | null; name: string }[] = [];
  names.lastIndex = 0;
  for (let m: RegExpExecArray | null; (m = names.exec(text)); ) hits.push({ start: m.index, end: m.index + m[0].length, def: tokens.get(m[0]) ?? null, name: m[0] });
  for (const [written, def] of Object.entries(VARIANTS[card.id] ?? {})) {
    if (!catalog.def(def)?.token) continue;
    for (let at = text.indexOf(written); at >= 0; at = text.indexOf(written, at + written.length)) {
      if (!hits.some((h) => h.start < at + written.length && at < h.end)) hits.push({ start: at, end: at + written.length, def, name: written });
    }
  }
  hits.sort((a, b) => a.start - b.start);
  // Right to left: a name is called a token when "token(s)" follows it, or a list separator and another such name.
  const called = hits.map(() => false);
  for (let i = hits.length - 1; i >= 0; i--) {
    const hit = hits[i]!;
    if (!hit.def) continue;
    const next = hits[i + 1];
    called[i] =
      /^\s+tokens?(?![\p{L}\p{N}])/u.test(text.slice(hit.end)) || (!!next?.def && called[i + 1]! && LIST_SEPARATOR.test(text.slice(hit.end, next.start)));
  }
  return hits.flatMap((hit, i) => {
    // A holder (a card name holding a token name) is no mention, nor a name ending a longer name; a bare name only where the
    // rule lets it be one.
    if (!hit.def || afterCapitalizedWord(text, hit.start)) return [];
    if (!called[i] && (shared.has(hit.name) || quotedNamePart(text, hit.start, hit.end))) return [];
    return [{ start: hit.start, end: hit.end, def: hit.def }];
  });
}

/**
 * English mentions of the other cards (not tokens) the card's Japanese text names, else its Chinese one (and its VARIANTS):
 * their English whole names, longest first, apart from the tokens found (`taken`) and from a quoted part of a name.
 */
function englishCardMentions(text: string, card: CatalogCard, index: LinkIndex, catalog: Catalog, taken: readonly Mention[]): Mention[] {
  const from = card.text.ja ? "ja" : card.text.cn ? "cn" : null;
  const byName = new Map<string, string>();
  const add = (name: string, def: string): void => {
    if (ENGLISH.test(name) && !JAPANESE_OR_CHINESE.test(name) && !catalog.def(def)?.token && !byName.has(looseName(name))) byName.set(looseName(name), def);
  };
  for (const [written, def] of Object.entries(VARIANTS[card.id] ?? {})) add(written, def);
  for (const { def } of from ? quotedMentions(card.text[from] ?? "", from, card, index) : []) {
    const named = catalog.def(def);
    for (const name of named ? namesOf(named, "en") : []) add(name, def);
  }
  if (byName.size === 0) return [];
  const out: Mention[] = [];
  for (const m of text.matchAll(wordsOf(byName.keys(), loosePattern))) {
    const start = m.index;
    const end = start + m[0].length;
    if (quotedNamePart(text, start, end) || taken.some((t) => t.start < end && start < t.end)) continue;
    out.push({ start, end, def: byName.get(looseName(m[0]))! });
  }
  return out;
}

/**
 * 「カード名に『X』（か『Y』…）を含む」 / 「卡片名包含『X』（或『Y』…）」: what comes just before a quote (and the quotes ahead of it),
 * and, in Japanese, what must come after it (and the quotes after it).
 */
const NAME_PART_BEFORE: Record<"ja" | "cn", RegExp> = {
  ja: /カード名に(?:『[^『』\n]*』(?:か|と|、|や))*$/,
  cn: /卡片?名(?:称)?中?不?(?:包含|含有)(?:『[^『』\n]*』(?:或|、|与|和|及))*$/,
};
const NAME_PART_AFTER: Record<"ja" | "cn", RegExp> = {
  ja: /^(?:(?:か|と|、|や)『[^『』\n]*』)*を含/,
  cn: /^/,
};

/** Japanese and Chinese mentions: a card's whole name in 『』, not as a part of a name. */
function quotedMentions(text: string, lang: "ja" | "cn", card: CatalogCard, index: LinkIndex): Mention[] {
  const { tokens, cards } = index[lang];
  const variants = VARIANTS[card.id] ?? {};
  const out: Mention[] = [];
  for (const m of text.matchAll(/『([^『』\n]+)』/g)) {
    const name = m[1]!;
    const def = variants[name] ?? tokens.get(name) ?? cards.get(name);
    if (!def) continue;
    const after = m.index + m[0].length;
    if (NAME_PART_BEFORE[lang].test(text.slice(Math.max(0, m.index - 80), m.index)) && NAME_PART_AFTER[lang].test(text.slice(after, after + 80))) continue;
    out.push({ start: m.index + 1, end: m.index + 1 + name.length, def });
  }
  return out;
}

/** Mentions of the Chinese text at their places in its Traditional conversion: the same, while the lengths agree; else found again. */
function convertedMentions(mentions: Mention[], source: string, shown: string): Mention[] {
  if (shown.length === source.length) return mentions;
  const out: Mention[] = [];
  let from = 0;
  for (const mention of mentions) {
    const name = toHant(source.slice(mention.start, mention.end));
    const at = shown.indexOf(`『${name}』`, from);
    if (at < 0) continue;
    out.push({ start: at + 1, end: at + 1 + name.length, def: mention.def });
    from = at + name.length + 2;
  }
  return out;
}

const NONE: readonly TextLink[] = [];

/**
 * The links of a card's text as the panel shows it (`text`: cardText(card, lang)), line by line: the cards it names. A card
 * naming itself is no link (it is shown already).
 */
export function cardLinks(card: CatalogCard, text: string, lang: CardLang, catalog: Catalog): (index: number) => readonly TextLink[] {
  const from: DataLang | null = cardTextLang(card, dataLang(lang));
  const source = from ? card.text[from] : null;
  if (!from || !source) return () => NONE;
  const index = indexOf(catalog);
  let mentions: Mention[];
  if (from === "en") {
    const tokens = englishMentions(source, card, index, catalog);
    mentions = [...tokens, ...englishCardMentions(source, card, index, catalog, tokens)].sort((a, b) => a.start - b.start);
  } else mentions = quotedMentions(source, from, card, index);
  if (text !== source) mentions = convertedMentions(mentions, source, text);
  mentions = mentions.filter((m) => m.def !== card.id);
  if (mentions.length === 0) return () => NONE;
  // Each line's own: the offsets within it (a name never crosses a line).
  const lines: TextLink[][] = [];
  let line = 0;
  let lineStart = 0;
  let next = text.indexOf("\n");
  for (const mention of mentions) {
    while (next >= 0 && mention.start > next) {
      line += 1;
      lineStart = next + 1;
      next = text.indexOf("\n", lineStart);
    }
    (lines[line] ??= []).push({ start: mention.start - lineStart, end: mention.end - lineStart, def: mention.def });
  }
  return (i) => lines[i] ?? NONE;
}
