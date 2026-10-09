// Locate an automatic ability's complete text without changing the rules or the worker protocol.
import type { AbilityDef, CardDefinition } from "@sve/core";
import type { CardLang } from "../../app/settings";
import { dataLang, toHant, type DataLang } from "../../i18n/hant";
import { giftQuotes } from "./gifts";

/**
 * What may come before a timing's mark at the start of a line: other icons and keywords (UB, 【...】, 《...》), and another
 * timing's mark ("{[fanfare]}/{[lastwords]}", "ファンファーレラストワード").
 */
const HEAD: Record<DataLang, string> = {
  en: String.raw`(?:(?:\{\[[a-z0-9]+\]\}|On Evolve|On+ Super[- ]?Evolve|(?:Follower )?Strike|On Race|On Drive)[\s/,-]*)*`,
  cn: String.raw`(?:[《【][^》】]*[》】][\s/／]*)*`,
  ja: String.raw`(?:(?:UB|\{\[[a-z0-9]+\]\}|[《【][^》】]*[》】]|ファンファーレ|ラストワード)[\s/／]*)*`,
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

const patterns = new Map<string, RegExp>();
function pattern(timing: string, lang: DataLang): RegExp | null {
  const mark = MARKS[timing]?.[lang];
  if (!mark) return null;
  const key = `${timing}:${lang}`;
  let re = patterns.get(key);
  if (!re) patterns.set(key, (re = new RegExp(`^${HEAD[lang]}${mark}`)));
  return re;
}

/**
 * The cards with more than one automatic ability without a mark ("other"): for each language, the line of the card text
 * each one is (by its index in that language's text), in the order the card's script lists them. Two abilities on one line
 * are one sentence the script splits (BP09-002: a Beast or another follower). The Japanese and Chinese texts list some in
 * another order than the English one (BP10-004, BP14-059). A new card with more than one is listed by the test.
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
  // The second is the delayed trigger embedded in its Fanfare (delayedText extracts that clause).
  "BP22-037": { cn: [1, 2], ja: [1, 2] },
};


export interface AbilityText {
  text: string;
  /** The language actually used, including a fallback; icon labels must use this language too. */
  lang: CardLang;
  /** A shared paragraph covers more than one script ability and retains all the printed conditions. */
  match: "exact" | "shared";
}

interface Paragraph {
  line: number;
  text: string;
}

const SEPARATOR = /^[-―—─]{3,}$/;
const OPTION = /^(?:【\d+】|\(\d+\))/;
const TIMINGS = Object.keys(MARKS);

/** Mask quotes without removing offsets or sentences outside them. Names in 『...』 are not ability quotes. */
function outsideQuotes(text: string, lang: DataLang): string {
  let depth = 0;
  let out = "";
  for (const ch of text) {
    if (lang === "en" && ch === '"') {
      depth = depth === 0 ? 1 : 0;
      out += " ";
    } else if (lang !== "en" && ch === "「") {
      depth++;
      out += " ";
    } else if (lang !== "en" && ch === "」" && depth > 0) {
      depth--;
      out += " ";
    } else out += depth > 0 ? " " : ch;
  }
  return out;
}

/** Ordinary triggers must be in the opening sentence, not inside a passive or a cost replacement. */
function isTrigger(text: string, lang: DataLang): boolean {
  const head = outsideQuotes(text, lang).split(lang === "en" ? /[.!](?:\s|$)/ : /。/)[0]!.trim();
  if (lang === "ja") {
    const condition = head.split("とき、")[0]!;
    return !/(?:ある限り|プレイする際)/.test(condition) && /とき、/.test(head);
  }
  if (lang === "cn") {
    if (/^(?:只要|将这张卡使用|这张卡.{0,15}使用之际)/.test(head)) return false;
    return /^(?:当|每当)/.test(head) ||
      /^(?:每|自己的|自己|对方|敌方|这个回合|在).*(?:当.+时|时[，,]|使用之际[，,])/.test(head);
  }
  if (/^When (?:playing|you would play)\b/i.test(head)) return false;
  return /^(?:(?:Once|Twice|Four|\d+) (?:times )?(?:per turn|(?:on|during) each of your turns)|During (?:your|each opponent's) turn|For the rest of this turn)[, ]+(?:when(?:ever)?\b)/i.test(head) ||
    /^(?:When(?:ever)?\b|At (?:the|each|your|an? opponent)|The (?:first|next) time\b)/i.test(head);
}

/**
 * Preserve physical line indexes for the reviewed mappings. Numbered choices belong to the preceding
 * paragraph. A divider can separate real abilities (PriConne); only a following token definition ends
 * the card's own text. Unknown line boundaries stay separate instead of swallowing another ability.
 */
function paragraphs(text: string, lang: DataLang): Paragraph[] {
  const out: Paragraph[] = [];
  let afterDivider = false;
  for (const [line, raw] of text.split(/\r?\n/).entries()) {
    const value = raw.trim();
    if (!value) continue;
    if (SEPARATOR.test(value)) {
      afterDivider = true;
      continue;
    }
    if (afterDivider && lang !== "en" && /^『[^』]+』/.test(value)) break;
    afterDivider = false;
    const previous = out.at(-1);
    if (OPTION.test(value) && previous && /(?:チョイス|抉择|选择|Choose\b)/i.test(previous.text)) {
      previous.text += "\n" + value;
    } else out.push({ line, text: value });
  }
  return out;
}

/** The complete paragraphs beginning with a timing mark, including their numbered choice lines. */
export function markedLines(text: string, lang: DataLang, timing: string): string[] {
  const re = pattern(timing, lang);
  return re ? paragraphs(text, lang).filter((p) => re.test(p.text)).map((p) => p.text) : [];
}

/** Reviewed delayed triggers embedded in another ability, selected by sentence or option rather than guessed. */
const DELAYED = new Set(["BP01-056", "BP03-089", "BP15-001", "BP15-008", "BP15-012", "BP22-037", "SP01-026"]);
function delayedText(def: string, text: string, lang: DataLang): string | null {
  if (!DELAYED.has(def)) return null;
  if (def === "SP01-026") {
    const option = /(?:【2】|\(2\))([\s\S]*?)(?=【3】|\(3\)|$)/.exec(text)?.[1]?.trim();
    return option && isTrigger(option, lang) ? option : null;
  }
  if (def === "BP22-037") {
    const prefix = lang === "ja" ? /このターン、次に/ : lang === "cn" ? /这个回合，当下次/ : /The next time/i;
    const line = paragraphs(text, lang).find((p) => pattern("fanfare", lang)?.test(p.text))?.text;
    const start = line?.search(prefix) ?? -1;
    return line && start >= 0 ? line.slice(start) : null;
  }
  // Sentence boundaries here are reviewed for these definitions; no arbitrary cut at "とき、".
  const sentences = paragraphs(text, lang).flatMap((p) => p.text.split(lang === "en" ? /(?<=[.!])\s+/ : /(?<=。)/));
  const found = sentences.filter((s) => isTrigger(s.trim(), lang));
  return found.length === 1 ? found[0]!.trim() : null;
}

function segment(def: string, text: string, lang: DataLang, timing: string, rank: number, count: number): Omit<AbilityText, "lang"> | null {
  if (!text.trim() || text === "unavailable" || !Number.isInteger(count) || !Number.isInteger(rank) || count < 1 || rank < 0 || rank >= count) return null;
  const all = paragraphs(text, lang);
  if (timing === "other") {
    if ((count === 1 || (def === "BP22-037" && rank === 1)) && DELAYED.has(def)) {
      const delayed = delayedText(def, text, lang);
      return delayed ? { text: delayed, match: "exact" } : null;
    }
    const indexes = OTHER_LINES[def]?.[lang];
    if (indexes && indexes.length !== count) return null;
    const index = indexes?.[rank];
    if (index !== undefined) {
      const paragraph = all.find((p) => p.line === index);
      return paragraph ? { text: paragraph.text, match: indexes!.filter((i) => i === index).length > 1 ? "shared" : "exact" } : null;
    }
    const ordinary = all.filter((p) => !TIMINGS.some((t) => pattern(t, lang)?.test(p.text)) && isTrigger(p.text, lang));
    if (count === 1 && ordinary.length === 1) return { text: ordinary[0]!.text, match: "exact" };
    // A card can gain its own other trigger inside an On Super Evolve paragraph (BP22-022).
    const quotes = giftQuotes(all.map((p) => p.text).join("\n"), lang).filter((q) => isTrigger(q, lang));
    return count === 1 && ordinary.length === 0 && quotes.length === 1 ? { text: quotes[0]!, match: "exact" } : null;
  }
  const lines = markedLines(text, lang, timing);
  if (def === "BP03-090" && timing === "fanfare" && count === 1 && lines.length === 2) {
    return { text: lines.join("\n"), match: "exact" };
  }
  if (lines.length === count) return { text: lines[rank]!, match: "exact" };
  // Only inspect quoted abilities when no top-level ability matches; never take another card's token text.
  if (lines.length === 0) {
    const quotes = giftQuotes(all.map((p) => p.text).join("\n"), lang).flatMap((q) => markedLines(q, lang, timing));
    if (quotes.length === count) return { text: quotes[rank]!, match: "exact" };
  }
  return null;
}

/** Compatibility entry point: one language, now a full ability paragraph rather than a physical line. */
export function abilityLine(def: string, text: string, lang: DataLang, timing: string, rank: number, count: number): string | null {
  return segment(def, text, lang, timing, rank, count)?.text ?? null;
}

/** Resolve each language independently; never apply requested-language markers to fallback card text. */
export function locateAbilityText(
  card: Pick<CardDefinition, "id" | "text">,
  lang: CardLang,
  timing: string,
  rank: number,
  count: number,
): AbilityText | null {
  for (const data of [...new Set<DataLang>([dataLang(lang), "en", "ja", "cn"])]) {
    const found = segment(card.id, card.text[data] ?? "", data, timing, rank, count);
    if (!found) continue;
    return lang === "zh-Hant" && data === "cn"
      ? { ...found, text: toHant(found.text), lang }
      : { ...found, lang: data };
  }
  return null;
}

/** Use the providing script's index, not an index into a receiving card's current list of abilities. */
export function locateAutomaticAbilityText(
  card: Pick<CardDefinition, "id" | "text">,
  abilities: readonly AbilityDef[],
  index: number,
  lang: CardLang,
  origin: "printed" | "quoted" = "printed",
): AbilityText | null {
  const ability = abilities[index];
  if (ability?.kind !== "automatic") return null;
  const same = (a: AbilityDef) => a.kind === "automatic" && a.timing === ability.timing;
  const rank = abilities.slice(0, index).filter(same).length;
  const count = abilities.filter(same).length;
  if (origin === "printed") return locateAbilityText(card, lang, ability.timing, rank, count);
  // Equipment and grants refer to the inner quote, even if the giver has its own ability of that timing.
  const quoted = (data: DataLang) => giftQuotes(card.text[data] ?? "", data).join("\n");
  const text = { en: quoted("en"), cn: quoted("cn"), ja: quoted("ja") };
  return locateAbilityText({ id: `${card.id}:quoted`, text }, lang, ability.timing, rank, count);
}

/** Automatic abilities represented only by a keyword have no printed effect paragraph (CR 12.13 / 14.4.6). */
const KEYWORD_TEXT: Readonly<Record<string, Record<DataLang, string>>> = {
  drain: {
    ja: "【ドレイン】このフォロワーが攻撃によるダメージを与えたとき、自分のリーダーの体力をそのダメージ数に等しい値増加する。",
    cn: "【虹吸】当这个从者给予攻击伤害时，使自己的主战者的生命值增加与该伤害值等量的数值。",
    en: "Drain — Whenever this follower deals attack damage, increase your leader's defense by the amount of damage it dealt.",
  },
  singleDrive: {
    ja: "【シングルドライブ】【攻撃時】ドライブチェックを1回行う。",
    cn: "【单次驱动】【攻击时】进行1次驱动检查。",
    en: "Single Drive — Strike: Perform a drive check.",
  },
  twinDrive: {
    ja: "【ツインドライブ】【攻撃時】ドライブチェックを1回行い、その後ドライブチェックを1回行う。",
    cn: "【双重驱动】【攻击时】进行1次驱动检查，然后再进行1次驱动检查。",
    en: "Twin Drive — Strike: Perform a drive check, then perform another drive check.",
  },
};

export function locateKeywordAbilityText(keyword: string, lang: CardLang): AbilityText | null {
  const text = KEYWORD_TEXT[keyword]?.[dataLang(lang)];
  return text ? { text: lang === "zh-Hant" ? toHant(text) : text, lang, match: "exact" } : null;
}
