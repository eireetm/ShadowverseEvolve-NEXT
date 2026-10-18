// Which paragraph of a card's text an ability is, so that a choice between pending abilities, and a decision asked while a
// card or ability is being played, can show what it says (two Fanfares of one card read the same by their timing alone).
// Pure: test/ability-text.test.ts checks it against every card, in every card language.
//  - A paragraph is a line of the text, with the numbered options of a choice that the Chinese text puts on lines of their
//    own. A divider followed by a token's definition ends the card's own text (what follows is the token's).
//  - A timing with a mark (Fanfare, Last Words, On Evolve ...) and the activated abilities (Act, Evolve, Advanced and its
//    equivalents Feed and Ride): the n-th paragraph that starts with the mark is the card's n-th ability of that kind, in the
//    order its script lists them. The card languages put the paragraphs in different orders (the English one often differs
//    from the Japanese and Chinese), but the abilities of one kind keep their order among themselves. A card with one such
//    ability and more such paragraphs (a translation that splits it in two, BP03-090) shows them all; a card that gives the
//    ability to itself in quotes ("this follower has '...'", BP09-049) shows the quote.
//  - Other triggers have no mark: a card's only one is the paragraph that reads as a trigger ("When ...", "当…时", "…とき、").
//    OTHER_LINES says it for the cards with more than one, and for those whose text alone doesn't tell.
//  - A spell is its whole text; a card played another way, the paragraph that says how (PLAY).
// The text is only located: which ability it is comes from the engine (the script's ability, its kind and rank).
import type { CardLang } from "../../app/settings";
import { dataLang, toHant, type DataLang } from "../../i18n/hant";
import { giftQuotes } from "./gifts";

/**
 * What may come before a timing's mark at the start of a line: other icons and keywords (UB, 【...】, 《...》), and another
 * timing's mark ("{[fanfare]}/{[lastwords]}", "ファンファーレラストワード").
 */
const HEAD: Record<DataLang, string> = {
  en: String.raw`(?:(?:\{\[[a-z0-9]+\]\}|On Evolve|On+ Super[- ]?Evolve|(?:Follower )?Strike|On Race|On Drive)[\s/,]*)*`,
  cn: String.raw`(?:[《【][^》】]*[》】][/／]?)*`,
  ja: String.raw`(?:UB|\{\[[a-z0-9]+\]\}|[《【][^》】]*[》】]|ファンファーレ|ラストワード|[/／])*`,
};

/** Each timing's mark in each card language: the spellings the card data has (older sets bracket some of them). */
const MARKS: Readonly<Record<string, Record<DataLang, string>>> = {
  fanfare: { en: String.raw`\{\[fanfare\]\}`, cn: "[《【]入场曲[》】]", ja: String.raw`(?:《?ファンファーレ》?|\{\[fanfare\]\})` },
  lastWords: { en: String.raw`\{\[lastwords\]\}`, cn: "[《【]谢幕曲[》】]", ja: String.raw`(?:《?ラストワード》?|\{\[lastwords\]\})` },
  onEvolve: { en: String.raw`On Evolve\b`, cn: "【进化时】", ja: "【進化時】" },
  onSuperEvolve: { en: String.raw`On+ Super[- ]?Evolve\b`, cn: "【超进化时】", ja: "【超進化時】" },
  strike: { en: String.raw`(?:Follower )?Strike\b`, cn: "【攻击时】", ja: "【攻撃時】" },
  onRace: { en: String.raw`On Race\b`, cn: "【起跑时】", ja: "【出走時】" },
  onDrive: { en: String.raw`On Drive\b`, cn: "【驱动获得时】", ja: "【ドライブ獲得時】" },
};

/** What may come before an activated ability's mark: the Union Burst and Quick icons. */
const ACTIVATION_HEAD: Record<DataLang, string> = {
  en: String.raw`(?:\{\[(?:ub|quick|q)\]\}\s*)*`,
  cn: String.raw`(?:[《【](?:UB|快速)[》】]\s*)*`,
  ja: String.raw`(?:UB|クイック|《?Q》?|[《【]クイック[》】])*`,
};

/**
 * The activated abilities' marks: advanced ones (CR 12.16) with Feed and Ride, which the scripts make advanced too (they are
 * equivalent to evolve abilities); evolve ones (CR 12.2); and the others.
 */
const ACTIVATIONS: Readonly<Record<string, Record<DataLang, string>>> = {
  advanced: { en: String.raw`\{\[(?:adv|feed|ride)\]\}`, cn: "[《【](?:高等起动|进阶起动|吃饭|凭依|憑依)[》】]", ja: "《?(?:アドバンス起動|食事|憑依)》?" },
  evolve: { en: String.raw`(?:\{\[evolve\]\}|Evolve\b)`, cn: "[《【]进化[》】]", ja: "《?進化(?!時)》?" },
  activated: { en: String.raw`(?:\{\[act\]\}|Activate\b)`, cn: "[《【](?:起动|启动)[》】]", ja: "《?起動》?" },
};

/** The groups a card's abilities are counted in: each marked timing, "other", "activated", "evolve", "advanced", "spell". */
export const MARKED_TIMINGS: readonly string[] = Object.keys(MARKS);

const patterns = new Map<string, RegExp | null>();
function pattern(group: string, lang: DataLang): RegExp | null {
  const key = `${group}:${lang}`;
  if (patterns.has(key)) return patterns.get(key)!;
  const timing = MARKS[group]?.[lang];
  const activation = ACTIVATIONS[group]?.[lang];
  const re = timing ? new RegExp(`^${HEAD[lang]}${timing}`) : activation ? new RegExp(`^${ACTIVATION_HEAD[lang]}${activation}`) : null;
  patterns.set(key, re);
  return re;
}

/** Starts with any timing's or activated ability's mark. */
function marked(text: string, lang: DataLang): boolean {
  return [...MARKED_TIMINGS, ...Object.keys(ACTIVATIONS)].some((group) => pattern(group, lang)!.test(text));
}

/**
 * The cards with more than one automatic ability without a mark ("other"), and those whose only one the text doesn't tell:
 * for each language, the line of the card text each one is (by its index in that language's text), in the order the card's
 * script lists them. Two abilities on one line are one sentence the script splits (BP09-002: a Beast or another follower).
 * The Japanese and Chinese texts list some in another order than the English one (BP10-004, BP14-059). A delayed trigger is
 * said by the line of the ability that sets it up (BP22-037's Fanfare). The test lists the cards that need a line here.
 */
export const OTHER_LINES: Readonly<Record<string, Partial<Record<DataLang, readonly number[]>>>> = {
  "BP03-075": { en: [0, 1], cn: [0, 1], ja: [0, 1] },
  "BP07-088": { en: [1, 2], cn: [1, 2], ja: [1, 2] },
  "BP09-002": { en: [1, 1], cn: [1, 1], ja: [1, 1] },
  "BP09-095": { en: [0, 1], cn: [0, 1], ja: [0, 1] },
  "BP10-004": { en: [1, 2], cn: [1, 0], ja: [1, 0] },
  "BP10-066": { en: [0, 2], cn: [0, 1], ja: [0, 1] },
  "BP11-070": { en: [1, 2], cn: [0, 1], ja: [0, 1] },
  "BP12-010": { en: [0, 0], cn: [0, 0], ja: [0, 0] },
  "BP12-063": { en: [0, 3], cn: [0, 2], ja: [0, 2] },
  "BP14-059": { en: [1, 2], cn: [1, 0], ja: [1, 0] },
  "BP14-102": { en: [1, 2], cn: [1, 2], ja: [1, 2] },
  "BP18-027": { en: [2, 2], cn: [1, 1], ja: [1, 1] },
  "BP20-T02": { en: [0, 0], cn: [0, 0], ja: [0, 0] },
  "BP21-037": { en: [0, 1], cn: [0, 1], ja: [0, 1] },
  "BP21-075": { en: [0, 1], cn: [0, 1], ja: [0, 1] },
  "CP03-064": { en: [0, 1], cn: [0, 1], ja: [0, 1] },
  "BP22-037": { en: [1, 2], cn: [1, 2], ja: [1, 2] },
  // Delayed triggers alone: the ability or spell that sets each one up.
  "BP01-056": { en: [1], cn: [2], ja: [2] },
  "BP03-089": { en: [0], cn: [0], ja: [0] },
  "BP15-001": { en: [1], cn: [1], ja: [1] },
  "BP15-008": { en: [3], cn: [2], ja: [2] },
  "BP15-012": { en: [0], cn: [0], ja: [0] },
  "SP01-026": { en: [1], cn: [1], ja: [1] },
};

/** A line of a card's text that ends its own text when a token's definition follows it, or separates two parts of it. */
const DIVIDER = /^[-―—─]{3,}$/;
/** A choice's numbered option on a line of its own (the Chinese texts). */
const OPTION = /^(?:【\d+】|\(\d+\)|（\d+）)/;

export interface Paragraph {
  /** Its first line's index in the text (OTHER_LINES counts lines). */
  line: number;
  text: string;
}

/** The card's own paragraphs: its lines, a choice's numbered options joined to their line, up to a token's definition. */
export function paragraphs(text: string): Paragraph[] {
  const out: Paragraph[] = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const value = lines[i]!.trim();
    if (!value) continue;
    if (DIVIDER.test(value)) {
      const next = lines.slice(i + 1).find((l) => l.trim() !== "")?.trim() ?? "";
      if (/^『[^』]+』/.test(next)) break;
      continue;
    }
    const last = out.at(-1);
    if (last && OPTION.test(value)) last.text += `\n${value}`;
    else out.push({ line: i, text: value });
  }
  return out;
}

/** The paragraphs of a card's text that start with a timing's or activated ability's mark, in order. */
export function markedLines(text: string, lang: DataLang, group: string): string[] {
  const re = pattern(group, lang);
  return re ? paragraphs(text).filter((p) => re.test(p.text)).map((p) => p.text) : [];
}

/** The text without what its quotes say ("...", 「...」): a trigger it gives isn't one of its own. Lengths stay. */
function outsideQuotes(text: string, lang: DataLang): string {
  let depth = 0;
  let out = "";
  for (const ch of text) {
    if (lang === "en" && ch === '"') {
      depth = depth === 0 ? 1 : 0;
      out += " ";
    } else if (lang !== "en" && (ch === "「" || (ch === "」" && depth > 0))) {
      depth += ch === "「" ? 1 : -1;
      out += " ";
    } else out += depth > 0 ? " " : ch;
  }
  return out;
}

/**
 * A paragraph without a mark that reads as a trigger: its first sentence is (or starts with a limit and then) a "when" clause
 * — not a replacement ("When this would be destroyed ... instead"), nor how to play the card ("When playing this card").
 */
function readsAsTrigger(paragraph: string, lang: DataLang): boolean {
  const first = outsideQuotes(paragraph, lang).split(lang === "en" ? /(?<=[.!])\s/ : /。/)[0]!.trim();
  if (lang === "en") {
    if (/\bwould\b/i.test(first.split(",")[0]!) || /^When (?:playing|you would play)\b/i.test(first)) return false;
    return /^(?:(?:Once|Twice|Three times|Four times|\d+ times) (?:per turn|on each of your turns|during (?:each of )?your turns?)|During (?:your|each opponent's|your opponent's) turn|For the rest of this turn)?[, ]*(?:when(?:ever)?\b|at the (?:start|end|beginning)\b|the (?:first|next) time\b)/i.test(
      first,
    );
  }
  if (lang === "cn") {
    if (/^(?:只要|将?这张卡.{0,15}使用之际|使用这张卡之际)/.test(first) || /代替/.test(first)) return false;
    return /^(?:当|每当)|当.+时|到来时|使用时[，,]|使用之际[，,]/.test(first);
  }
  if (/限り|代わりに/.test(first) || /^これをプレイする際/.test(first)) return false;
  return /とき、|たび、/.test(first);
}

/**
 * How to play the card another way (CR 10.4.7.3): "When playing this card, [process]: ...", "As an additional cost to play this
 * card, ...", "You may play this for N more play points". Not a passive changing its cost ("This costs 1 less to play if ...").
 */
const PLAY: Record<DataLang, RegExp> = {
  en: /^(?:When playing this(?: card)?\b|As an additional cost to play this\b|You (?:can|may) play this(?: card)? for\b)|\bto play this card instead of paying its cost\b/i,
  cn: /^(?:将这张卡使用之际|使用这张卡之际|这张卡使用之际)[^。]*(?:：|额外消费|追加费用|可以将消费[+＋]|可以不支付)/,
  ja: /^これをプレイする際[^。]*(?:：|追加コスト|てよい)/,
};

/** The paragraphs that say how to play the card another way (PLAY), joined. */
function playText(text: string, lang: DataLang): string | null {
  const found = paragraphs(text).filter((p) => PLAY[lang].test(p.text));
  return found.length > 0 ? found.map((p) => p.text).join("\n") : null;
}

/** The card's text in quotes that its group marks or (for "other") reads as triggers: the abilities it gives itself. */
function quoted(text: string, lang: DataLang, group: string): string[] {
  const quotes = giftQuotes(text, lang);
  if (group === "other") return quotes.filter((q) => !marked(q, lang) && readsAsTrigger(q, lang));
  const re = pattern(group, lang);
  return re ? quotes.filter((q) => re.test(q)) : [];
}

/**
 * The text of one of a card's abilities in one card language: the `rank`-th (0: first) of its `count` abilities of `group`
 * (an automatic ability's timing, "activated", "evolve", "advanced", "spell"), or "play": how it is being played another way.
 * Null when the text doesn't tell (a translation that differs, a trigger without a mark OTHER_LINES doesn't list).
 */
export function abilityLine(def: string, text: string, lang: DataLang, group: string, rank: number, count: number): string | null {
  if (!text.trim() || text === "unavailable") return null;
  if (group === "spell") {
    const all = paragraphs(text);
    return all.length > 0 ? all.map((p) => p.text).join("\n") : null;
  }
  if (group === "play") return playText(text, lang);
  if (!Number.isInteger(rank) || !Number.isInteger(count) || rank < 0 || rank >= count) return null;
  const all = paragraphs(text);
  if (group === "other") {
    const lines = OTHER_LINES[def]?.[lang];
    if (lines) {
      const line = lines.length === count ? lines[rank] : undefined;
      return line === undefined ? null : (all.find((p) => p.line === line)?.text ?? null);
    }
    if (count !== 1) return null;
    const found = all.filter((p) => !marked(p.text, lang) && readsAsTrigger(p.text, lang));
    if (found.length === 1) return found[0]!.text;
    const quotes = found.length === 0 ? quoted(text, lang, group) : [];
    return quotes.length === 1 ? quotes[0]! : null;
  }
  const re = pattern(group, lang);
  if (!re) return null;
  const found = all.filter((p) => re.test(p.text)).map((p) => p.text);
  if (found.length === count) return found[rank]!;
  if (count === 1 && found.length > 1) return found.join("\n");
  const quotes = found.length === 0 ? quoted(text, lang, group) : [];
  return quotes.length === count ? quotes[rank]! : null;
}

/** A located ability text and the card language it is in (icons are drawn in that language's style). */
export interface AbilityText {
  text: string;
  lang: CardLang;
}

/** A card's text as the card panel shows it (catalog.ts cardText): the card language, or the next one the data has it in. */
function textIn(card: { text: Partial<Record<DataLang, string | null>>; preview?: boolean }, lang: DataLang): { text: string; lang: DataLang } | null {
  const order: DataLang[] = card.preview && lang !== "en" ? [lang, "ja", "cn"] : [lang, "en", "ja", "cn"];
  for (const l of order) {
    const text = card.text[l];
    if (text && text !== "unavailable") return { text, lang: l };
  }
  return null;
}

/**
 * The text of a card's ability in the card language (abilityLine), from the text the card panel shows: no other language's
 * paragraph where this one doesn't tell. Traditional Chinese: the Chinese one, converted.
 */
export function locateAbilityText(
  card: { id: string; text: Partial<Record<DataLang, string | null>>; preview?: boolean },
  lang: CardLang,
  group: string,
  rank: number,
  count: number,
): AbilityText | null {
  const shown = textIn(card, dataLang(lang));
  if (!shown) return null;
  const line = abilityLine(card.id, shown.text, shown.lang, group, rank, count);
  if (line === null) return null;
  return lang === "zh-Hant" && shown.lang === "cn" ? { text: toHant(line), lang } : { text: line, lang: shown.lang };
}

/**
 * An ability a card's text gives in quotes (an equipment token's "The equipped follower has '...'", a card giving another
 * one an ability): the `rank`-th of the `count` quotes of `group` (an automatic ability's timing, "activated" ...), or its
 * only quote. Null when the quotes don't tell.
 */
export function locateQuotedText(
  card: { id: string; text: Partial<Record<DataLang, string | null>>; preview?: boolean },
  lang: CardLang,
  group: string,
  rank: number,
  count: number,
): AbilityText | null {
  const shown = textIn(card, dataLang(lang));
  if (!shown) return null;
  const quotes = giftQuotes(shown.text, shown.lang);
  const ofGroup = quoted(shown.text, shown.lang, group);
  const line = ofGroup.length === count ? ofGroup[rank] : quotes.length === 1 ? quotes[0] : undefined;
  if (line === undefined) return null;
  return lang === "zh-Hant" && shown.lang === "cn" ? { text: toHant(line), lang } : { text: line, lang: shown.lang };
}
