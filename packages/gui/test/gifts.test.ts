import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createEngine, type CardDefinition } from "@sve/core";
import { ALL_CARDS, ALL_SCRIPTS } from "@sve/core/sets";
import { describe, expect, it } from "vitest";
import type { CardLang } from "../src/app/settings";
import type { DataLang } from "../src/i18n/hant";
import { Catalog } from "../src/app/catalog";
import { giftLines, giftQuotes } from "../src/game/card/gifts";

// The card panel shows the abilities given to a card (the player view's gifts) as the giving card's text quotes them
// (src/game/card/gifts.ts). Checked against every card: each card that gives an ability has its quotes in every card
// language, as many as the abilities it gives, and each card whose text gives one in quotes gives it in a way the player
// view reports (so a new card that doesn't is listed here).

const engine = createEngine({ cards: ALL_CARDS, scripts: ALL_SCRIPTS });
const catalog = new Catalog(engine.db.all().map((def) => ({ ...def, status: engine.implementationStatus(def.id) })));
const LANGS: readonly DataLang[] = ["en", "cn", "ja"];
const card = (id: string) => ALL_CARDS.find((c) => c.id === id)!;

/** The card's text in a language, or null where the data has none (a pre-release card's English text is a placeholder). */
const textOf = (def: CardDefinition, lang: DataLang): string | null => {
  const text = def.text[lang];
  return text && text !== "unavailable" ? text : null;
};

const SCRIPTS = join(__dirname, "..", "..", "core", "src", "script");
/** A definition's script source ("" for one without a file of its own). */
const source = (def: string): string => {
  const file = join(SCRIPTS, def.split("-")[0]!, `${def}.ts`);
  return existsSync(file) ? readFileSync(file, "utf8") : "";
};
const given = new Map<string, number>();

/**
 * The different abilities a card's script gives in ways the player view reports, or 0: fx.grant (by id), fx.gainText,
 * the effect kinds it `gives`, the ability its own text quotes (`quotedWhile`), a delayed trigger that `gives`, a passive
 * that gives (`grantsFor`), and an equipment token's (the view lists each token a follower equips).
 */
function giftsGiven(def: string): number {
  const script = ALL_SCRIPTS[def];
  if (!script) return 0;
  const known = given.get(def);
  if (known !== undefined) return known;
  const text = source(def);
  const grants = new Set([...text.matchAll(/\.grant\([^,]+,\s*"(\w+)"/g)].map((m) => m[1]));
  const texts = new Set([...text.matchAll(/\.gainText\([^,]+,\s*(\w+)/g)].map((m) => m[1]));
  const delayed = (script.abilities ?? []).filter((a) => a.kind === "automatic" && a.gives).length;
  const n =
    grants.size +
    texts.size +
    (script.gives?.length ?? 0) +
    (script.quotedWhile ? 1 : 0) +
    delayed +
    (script.field?.grantsFor ? 1 : 0) +
    (card(def).type === "equipment" && giftQuotes(card(def).text.cn ?? "", "cn").length > 0 ? 1 : 0);
  given.set(def, n);
  return n;
}

describe("the abilities given to a card, in the card panel", () => {
  it("are the quotes of the giving card's text, in each card language", () => {
    const gremory = card("BP12-071");
    expect(LANGS.map((l) => giftQuotes(gremory.text[l]!, l))).toEqual([["{[lastwords]} Banish this card."], ["《谢幕曲》使这张卡消失"], ["ラストワードこれは消滅する"]]);
    // Two given together; a name in quotes is not one; a quote inside a quote; a token's text after "―――" is the token's.
    const nana = card("ECP02-061");
    expect(LANGS.map((l) => giftQuotes(nana.text[l]!, l).length)).toEqual([2, 2, 2]);
    expect(giftQuotes(card("BP20-026").text.en!, "en")).toEqual(["This costs 1 less to play."]);
    expect(giftQuotes(card("BP15-PR14").text.cn!, "cn")).toEqual([
      "【攻击时】给予敌方场上的全体从者各与「这个回合中自己的主战者的生命值减少的次数」等量的伤害",
    ]);
    expect(giftQuotes(card("BP09-036").text.cn!, "cn")).toEqual([]);
  });

  it("show one line per gift: a card's n-th ability is its text's n-th quote; a card's text in the next language that has it", () => {
    const lines = (gifts: { by: string; ability: string }[], lang: CardLang) => giftLines(gifts, catalog, lang).map((l) => `${l.lang} ${l.text}`);
    expect(lines([{ by: "BP12-071", ability: "lastWordsBanishSelf" }], "cn")).toEqual(["cn 《谢幕曲》使这张卡消失"]);
    const nana = [
      { by: "ECP02-061", ability: "activateDiscard2Bury" },
      { by: "ECP02-061", ability: "mainPhaseDamageYourLeader2" },
    ];
    expect(lines(nana, "en")).toEqual(['en At the start of your main phase, deal 2 damage to your leader', "en Activate {[cost01]}, discard 2 cards: Bury this."]);
    // BP13-119 given twice: two abilities.
    expect(lines([{ by: "BP13-119", ability: "lastWordsLeaderDraw" }, { by: "BP13-119", ability: "lastWordsLeaderDraw" }], "ja")).toHaveLength(2);
    // A pre-release card's English text is a placeholder: its Japanese one.
    expect(lines([{ by: "BP22-024", ability: "preventDamage" }], "en")).toEqual(["ja これは交戦ダメージを受けない"]);
    // A gift its card's text doesn't quote shows nothing (an equipment token that gives a keyword alone).
    expect(lines([{ by: "V1", ability: "x" }], "cn")).toEqual([]);
  });

  it("every card that gives abilities quotes as many in each of its languages", () => {
    const wrong: string[] = [];
    for (const def of ALL_CARDS) {
      const given = giftsGiven(def.id);
      if (given === 0) continue;
      for (const lang of LANGS) {
        const text = textOf(def, lang);
        if (text === null) continue;
        const quotes = giftQuotes(text, lang).length;
        if (quotes !== given) wrong.push(`${def.id} ${lang}: gives ${given}, quotes ${quotes}`);
      }
    }
    expect(wrong).toEqual([]);
  }, 60_000);

  it("every card whose text gives an ability in quotes gives it in a way the player view reports", () => {
    const missing = ALL_CARDS.filter((def) => giftQuotes(def.text.cn ?? "", "cn").length > 0 && giftsGiven(def.id) === 0).map((def) => def.id);
    expect(missing).toEqual([]);
  }, 60_000);
});
