// The abilities given to a card (the player view's `gifts`), each as the text of the card that gave it quotes it: BP12-071
// "Give it '{[lastwords]} Banish this card.'", 「《谢幕曲》使这张卡消失」, 「ラストワードこれは消滅する」. Pure: test/gifts.test.ts checks it
// against every card that gives an ability.
import type { Gift } from "@sve/core";
import type { CardLang } from "../../app/settings";
import type { Catalog } from "../../app/catalog";
import type { CatalogCard } from "../../engine/protocol";

/** What follows the last quote of a Chinese or Japanese gift ("获得「…」能力", "「…」を持つ" / "を得る"). */
const AFTER: Record<"cn" | "ja", RegExp> = { cn: /^的?能力/, ja: /^を(?:持|得)/ };
/** What joins two quotes given together ("「…」与「…」能力", "「…」と「…」を持つ"). */
const JOIN: Record<"cn" | "ja", RegExp> = { cn: /^(?:与|和|、|及|以及)$/, ja: /^(?:と|、)$/ };

/** The outermost 「…」 of a text: where each one opens and closes. */
function bracketed(text: string): { open: number; close: number }[] {
  const out: { open: number; close: number }[] = [];
  let depth = 0;
  let open = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "「") {
      if (depth === 0) open = i;
      depth++;
    } else if (text[i] === "」" && depth > 0 && --depth === 0) out.push({ open, close: i });
  }
  return out;
}

/**
 * The abilities a card text gives in quotes, in order. Chinese and Japanese: the 「…」 followed by 能力 / を持つ, and those
 * joined to it; a token's text after "―――" (the card describes a token it makes) is the token's. English: the quotes
 * other than a name's ('a follower with "Octrice" in its name', BP20-026).
 */
export function giftQuotes(text: string, lang: CardLang): string[] {
  if (lang === "en") {
    // Between the 1st and 2nd quote mark, the 3rd and 4th ...: what follows a name is " in its name".
    const parts = text.split('"');
    return parts.flatMap((part, i) => (i % 2 === 1 && i + 1 < parts.length && !parts[i + 1]!.startsWith(" in ") ? [part.trim()] : []));
  }
  const own = text.split(/\n―{3,}/)[0]!;
  const quotes = bracketed(own);
  const gift = quotes.map(() => false);
  for (let i = quotes.length - 1; i >= 0; i--) {
    const after = own.slice(quotes[i]!.close + 1);
    gift[i] = AFTER[lang].test(after) || (gift[i + 1] === true && JOIN[lang].test(own.slice(quotes[i]!.close + 1, quotes[i + 1]!.open)));
  }
  return quotes.filter((_, i) => gift[i]).map((q) => own.slice(q.open + 1, q.close));
}

/** A card's quoted abilities in a card language, or in the next one its text has them in (as cardText falls back). */
export function quotesOf(card: CatalogCard, lang: CardLang): { lang: CardLang; quotes: string[] } | null {
  for (const l of [...new Set<CardLang>([lang, "en", "ja", "cn"])]) {
    const quotes = giftQuotes(card.text[l] ?? "", l);
    if (quotes.length > 0) return { lang: l, quotes };
  }
  return null;
}

/** A line of the card panel's given abilities: the quote, its language, and the card whose text it is. */
export interface GiftLine {
  text: string;
  lang: CardLang;
  by: string;
}

/**
 * The lines a card's gifts show, grouped by the card that gave them: the n-th different ability one card gave is the
 * n-th quote of its text (ECP02-061 gives two), one line per gift (two of one ability are two abilities, BP13-119). When
 * the numbers differ (a gift its text doesn't quote, as an equipment token's keywords alone), its quotes once each.
 */
export function giftLines(gifts: readonly Gift[], catalog: Catalog, lang: CardLang): GiftLine[] {
  const out: GiftLine[] = [];
  for (const by of new Set(gifts.map((g) => g.by))) {
    const card = catalog.def(by);
    const found = card ? quotesOf(card, lang) : null;
    if (!found) continue;
    const mine = gifts.filter((g) => g.by === by);
    const abilities = [...new Set(mine.map((g) => g.ability))];
    const lines = abilities.length === found.quotes.length ? mine.map((g) => found.quotes[abilities.indexOf(g.ability)]!) : found.quotes;
    for (const text of lines) out.push({ text, lang: found.lang, by });
  }
  return out;
}
