import { createEngine } from "@sve/core";
import { ALL_CARDS, ALL_SCRIPTS } from "@sve/core/sets";
import { describe, expect, it } from "vitest";
import { Catalog, cardText } from "../src/app/catalog";
import type { CardLang } from "../src/app/settings";
import { tokenLinks } from "../src/game/card/token-links";
import { loadHant } from "../src/i18n/hant";

// The card panel's links to the tokens a card's text names (src/game/card/token-links.ts), checked on cards that show each
// part of the rules, and on every card: the languages of a card link the same tokens (so a new card whose text names a token
// otherwise is listed here: a VARIANTS entry, or a rule, for it).

const engine = createEngine({ cards: ALL_CARDS, scripts: ALL_SCRIPTS });
const catalog = new Catalog(engine.db.all().map((def) => ({ ...def, status: engine.implementationStatus(def.id) })));

/** The links of a card's text in a card language: what they say, and the token each opens ("text → id"). */
function links(id: string, lang: CardLang): string[] {
  const card = catalog.def(id)!;
  const text = cardText(card, lang);
  const find = tokenLinks(card, text, lang, catalog);
  return text.split("\n").flatMap((line, i) => find(i).map((l) => `${line.slice(l.start, l.end)} → ${l.def}`));
}

/** The tokens a card's text links in a data language (none without that text), its body and its reference block apart. */
function linked(id: string, lang: "en" | "ja" | "cn"): { body: Set<string>; all: Set<string> } | null {
  const card = catalog.def(id)!;
  const text = card.text[lang];
  if (!text || card.preview) return null;
  const find = tokenLinks(card, text, lang, catalog);
  const body = new Set<string>();
  const all = new Set<string>();
  let reference = false;
  for (const [i, line] of text.split("\n").entries()) {
    if (/^―{3,}\s*$/.test(line)) reference = true;
    for (const l of find(i)) {
      all.add(l.def);
      if (!reference) body.add(l.def);
    }
  }
  return { body, all };
}

describe("links to the tokens a card's text names", () => {
  it("English: whole names, longest first, lists before 'token', and bare names where nothing else is meant", () => {
    // "Fairy Wisp" is one token, not "Fairy".
    expect(links("BP01-010", "en")).toEqual(["Fairy Wisp → BP01-T02"]);
    expect(links("BP01-020", "en")).toEqual(["Fairy → BP01-T03", "Fairy → BP01-T03"]);
    expect(links("BP01-001", "en")).toEqual(["Thorn Burst → BP01-T01", "Thorn Burst → BP01-T01"]);
    // A list before one "token": every name in it. "Mimi" is also a card's name: only as a token.
    expect(links("BP01-101", "en")).toEqual(["Mimi → BP01-T12", "Coco → BP01-T13"]);
    // A token name inside a longer card name is that card's ("Lævateinn Dragon"), and so is the end of a name the data
    // doesn't know ("Iron Tail Dragon").
    expect(links("BP03-058", "en")).toEqual([]);
    expect(links("CP03-066", "en")).toEqual([]);
    // 'with "Ghost" in its name' is a part of a name; the same card's Ghost token is a token.
    expect(links("BP10-091", "en")).toEqual([]);
    expect(links("BP10-088", "en")).toEqual(["Ghost → BP01-T14"]);
    // A bare name: "If there's no Magitrain on your field, summon one."
    expect(links("BP11-069", "en")).toEqual(["Magitrain → BP11-T02"]);
    // A misspelled name (VARIANTS).
    expect(links("BP17-029", "en")).toContain("Shield Gaurdian → BP02-T02");
  });

  it("Japanese and Chinese: whole names in 『』, the reference block included; never a part of a name or unquoted", () => {
    expect(links("BP01-020", "ja")).toEqual(["フェアリー → BP01-T03", "フェアリー → BP01-T03", "フェアリー → BP01-T03"]);
    expect(links("BP01-001", "cn")).toEqual(["蔷薇的猛击 → BP01-T01", "蔷薇的猛击 → BP01-T01", "蔷薇的猛击 → BP01-T01"]);
    // 『フェアリープリンセス・アリア』 is a card, not a Fairy; 妖精类型 is a trait.
    expect(links("BP11-007", "ja")).toEqual([]);
    expect(links("BP11-007", "cn")).toEqual([]);
    // 「カード名に『ゴースト』を含む」 / 「卡片名包含『怨灵』」: a part of a name.
    expect(links("BP10-091", "ja")).toEqual([]);
    expect(links("BP10-091", "cn")).toEqual([]);
    // Names written otherwise than the token's card (VARIANTS).
    expect(links("BP01-102", "ja")).toEqual(["ミミ → BP01-T12", "ココ → BP01-T13"]);
    expect(links("CP04-058", "cn")).toContain("情谊的证明 → CP04-T09");
    expect(links("BP08-101", "cn")).toContain("神祕的创造物 → BP05-T05");
  });

  it("Traditional Chinese: the Chinese text's links, in the converted text", async () => {
    await loadHant();
    const cn = links("BP01-020", "cn");
    const hant = links("BP01-020", "zh-Hant");
    expect(hant.map((l) => l.split(" → ")[1])).toEqual(cn.map((l) => l.split(" → ")[1]));
    expect(hant[0]).toBe("妖精 → BP01-T03");
    expect(links("BP08-101", "zh-Hant")).toContain("神秘的創造物 → BP05-T05");
  });

  it("follows the text shown (another language's when the card has none in this one); a token doesn't link to itself", () => {
    // DSD01a-014 has no English text: English shows the Japanese one, linked as Japanese.
    expect(catalog.def("DSD01a-014")!.text.en).toBe("");
    expect(links("DSD01a-014", "en")).toEqual(links("DSD01a-014", "ja"));
    expect(links("DSD01a-014", "en")[0]).toBe("マナリアの魔弾 → DSD01a-T01");
    expect(links("BP14-T02", "ja")).toEqual([]);
  });

  it("every card's languages link the same tokens (the reference blocks aside: only Japanese and Chinese have them)", () => {
    const problems: string[] = [];
    for (const card of catalog.cards) {
      const [en, ja, cn] = (["en", "ja", "cn"] as const).map((lang) => linked(card.id, lang));
      const list = (s: Set<string>) => [...s].sort().join(" ") || "-";
      const same = (a: Set<string>, b: Set<string>) => list(a) === list(b);
      if (en && ja && !same(en.all, ja.body) && ![...en.all].every((t) => ja.all.has(t))) problems.push(`${card.id} en ${list(en.all)} / ja ${list(ja.body)}`);
      if (en && ja && ![...ja.body].every((t) => en.all.has(t))) problems.push(`${card.id} ja body ${list(ja.body)} / en ${list(en.all)}`);
      if (ja && cn && !same(ja.body, cn.body)) problems.push(`${card.id} ja body ${list(ja.body)} / cn body ${list(cn.body)}`);
    }
    expect(problems).toEqual([]);
  });

  it("links every token from some card's text, in each language that names it", () => {
    const tokens = catalog.cards.filter((c) => c.token);
    const reached = { en: new Set<string>(), ja: new Set<string>(), cn: new Set<string>() };
    for (const card of catalog.cards) {
      for (const lang of ["en", "ja", "cn"] as const) for (const t of linked(card.id, lang)?.all ?? []) reached[lang].add(t);
    }
    const missing = (lang: "en" | "ja" | "cn") => tokens.filter((t) => !reached[lang].has(t.id)).map((t) => t.id);
    // English: the pre-release placeholders and two tokens only named in texts without English.
    expect(missing("en")).toEqual(["BP22-T01", "BP22-T02", "BP22-T03", "DSD01a-T01", "DSD01b-T01"].filter((id) => tokens.some((t) => t.id === id)));
    // Pre-release cards (BP22) are left out of this check: their tokens' Japanese and Chinese names come from their texts.
    expect(missing("ja").filter((id) => !catalog.def(id)!.preview)).toEqual([]);
    expect(missing("cn").filter((id) => !catalog.def(id)!.preview)).toEqual([]);
  });
});
