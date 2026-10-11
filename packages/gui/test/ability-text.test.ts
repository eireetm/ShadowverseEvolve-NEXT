import type { AbilityDef } from "@sve/core";
import { ALL_CARDS, ALL_SCRIPTS } from "@sve/core/sets";
import { describe, expect, it } from "vitest";
import { loadHant, type DataLang } from "../src/i18n/hant";
import { rankOf, textGroupOf } from "../src/engine/game-host";
import { abilityLine, locateAbilityText, locateQuotedText, markedLines, MARKED_TIMINGS, OTHER_LINES, paragraphs } from "../src/game/card/ability-text";

// A choice between pending abilities, and a decision asked while an ability is being played, show what the ability says: its
// paragraph of the card text (two Fanfares of one card read the same by their timing alone). Checked against every card, in
// every card language its text is in.

const LANGS: readonly DataLang[] = ["en", "cn", "ja"];
type Card = (typeof ALL_CARDS)[number];

/** The card's text in a language, or null where the data has none (a pre-release card's English text is a placeholder). */
const textOf = (card: Card, lang: DataLang): string | null => {
  const text = card.text[lang];
  return text && text !== "unavailable" ? text : null;
};
const cardOf = (id: string): Card => ALL_CARDS.find((c) => c.id === id)!;

/** Each ability of a card with its group (an automatic ability's timing, or its kind of activated ability) and rank. */
function located(card: Card): { index: number; group: string; rank: number; count: number }[] {
  const abilities = ALL_SCRIPTS[card.id]?.abilities ?? [];
  return abilities.flatMap((a, index) => {
    if (a.kind === "spell") return [];
    const { rank, count } = rankOf(abilities, index);
    return [{ index, group: textGroupOf(a), rank: rank!, count: count! }];
  });
}

/**
 * Card texts that don't say an ability the way the others do: the ability shows no text in that language (no other language's
 * paragraph instead). A missing mark (BP03-071's English Fanfare, BP21-096's Chinese Evolve), a misspelt one (CP02-069
 * "Activat"), another timing than the other languages and the script (the English texts of BP18-029 and BP18-052 say On Evolve
 * where the Japanese and Chinese ones say Strike), a text that isn't the card's (BP08-U07's Chinese one).
 */
const DATA_PROBLEMS: readonly string[] = [
  "BP03-071 en fanfare 1/1",
  "BP08-U07 cn fanfare 1/1",
  "BP18-029 en strike 1/1",
  "BP18-052 en strike 1/1",
  "BP21-096 cn evolve 1/1",
  "CP02-069 en activated 1/1",
];

describe("an ability's paragraph of its card text", () => {
  it("tells CP04-037 Karyl's two Fanfares apart, in every card language", () => {
    const abilities = ALL_SCRIPTS["CP04-037"]!.abilities ?? [];
    expect(rankOf(abilities, 0)).toEqual({ rank: 0, count: 2 });
    expect(rankOf(abilities, 2)).toEqual({ rank: 1, count: 2 });
    const karyl = cardOf("CP04-037");
    const line = (lang: DataLang, rank: number) => abilityLine("CP04-037", karyl.text[lang] ?? "", lang, "fanfare", rank, 2);
    expect(line("cn", 0)).toBe("《UB》《入场曲》将手牌中的1张法术卡舍弃：选择敌方场上的1个从者。给予其3点伤害。抽取1张卡。");
    expect(line("cn", 1)).toBe("《入场曲》《消费2》：将1张『混沌魔法书』卡装备到这张卡。");
    expect(line("ja", 0)).toMatch(/^UBファンファーレ手札のスペル1枚を捨てる：/);
    expect(line("ja", 1)).toBe("ファンファーレコスト2：これは『ケイオスグリモワール』1枚を装備する。");
    expect(line("en", 1)).toBe("{[fanfare]} {[cost02]} Equip this with a Chaos Grimoire token.");
  });

  it("finds every ability of every card, each of one kind its own paragraph, in every language its text is in", () => {
    const problems: string[] = [];
    for (const card of ALL_CARDS) {
      const abilities = ALL_SCRIPTS[card.id]?.abilities ?? [];
      for (const lang of LANGS) {
        const text = textOf(card, lang);
        if (!text) continue;
        const found = located(card).map((a) => ({ ...a, line: abilityLine(card.id, text, lang, a.group, a.rank, a.count) }));
        for (const a of found) {
          if (a.line === null) problems.push(`${card.id} ${lang} ${a.group} ${a.rank + 1}/${a.count}`);
          // A Union Burst ability is the paragraph with the UB icon.
          else if (MARKED_TIMINGS.includes(a.group) && a.count > 1) {
            const ub = (abilities[a.index] as Extract<AbilityDef, { kind: "automatic" }>).unionBurst === true;
            if (ub !== /^(?:\{\[ub\]\}|《UB》|UB)/.test(a.line)) problems.push(`${card.id} ${lang} ${a.group}: UB of ${a.rank + 1}`);
          }
        }
        // Two abilities of one kind never show the same paragraph (but two triggers the script splits out of one sentence).
        for (const a of found) {
          const twins = found.filter((b) => b.group === a.group && b.line !== null && b.line === a.line);
          if (twins.length > 1 && a.group !== "other" && a.count > 1) problems.push(`${card.id} ${lang} ${a.group}: one paragraph for two`);
        }
      }
    }
    expect([...new Set(problems)]).toEqual(DATA_PROBLEMS);
  });

  it("keeps OTHER_LINES to the cards whose triggers without a mark the text alone doesn't tell, one paragraph each", () => {
    const problems: string[] = [];
    for (const [id, langs] of Object.entries(OTHER_LINES)) {
      const card = cardOf(id);
      const others = located(card).filter((a) => a.group === "other");
      for (const lang of LANGS) {
        const lines = langs[lang];
        const text = textOf(card, lang);
        if (!text) {
          if (lines) problems.push(`${id} ${lang}: lines for a text the data doesn't have`);
          continue;
        }
        if (lines?.length !== others.length) problems.push(`${id} ${lang}: ${others.length} triggers without a mark, ${lines?.length ?? "no"} lines`);
        const starts = new Set(paragraphs(text).map((p) => p.line));
        for (const line of lines ?? []) if (!starts.has(line)) problems.push(`${id} ${lang}: line ${line} isn't a paragraph`);
      }
    }
    expect(problems).toEqual([]);
  });

  it("follows the Japanese and Chinese order where it differs from the English one", () => {
    const text = (id: string, lang: DataLang) => cardOf(id).text[lang] ?? "";
    // BP10-004: the first trigger is "Whenever an enemy follower is put onto the field", the second the end phase one.
    expect(abilityLine("BP10-004", text("BP10-004", "en"), "en", "other", 1, 2)).toBe("At the start of your end phase, refresh this card.");
    expect(abilityLine("BP10-004", text("BP10-004", "cn"), "cn", "other", 1, 2)).toBe("当自己的结束阶段到来时，将这张卡竖置。");
    expect(abilityLine("BP10-004", text("BP10-004", "ja"), "ja", "other", 0, 2)).toMatch(/^相手の場にフォロワーが出たとき/);
  });

  it("shows a split ability whole, a trigger without a mark by how it reads, an ability a card gives itself by its quote", () => {
    const text = (id: string, lang: DataLang) => cardOf(id).text[lang] ?? "";
    // The Chinese and Japanese texts split BP03-090's one Fanfare in two: both.
    expect(abilityLine("BP03-090", text("BP03-090", "cn"), "cn", "fanfare", 0, 1)?.split("\n")).toHaveLength(2);
    expect(abilityLine("BP03-090", text("BP03-090", "en"), "en", "fanfare", 0, 1)).toMatch(/^\{\[fanfare\]\} If this card was put onto the field from your hand/);
    // BP01-126's only trigger without a mark: the end phase one, not its Strike.
    expect(abilityLine("BP01-126", text("BP01-126", "cn"), "cn", "other", 0, 1)).toMatch(/^当自己的结束阶段到来时/);
    expect(abilityLine("BP01-126", text("BP01-126", "en"), "en", "other", 0, 1)).toMatch(/^At the start of your end phase/);
    // BP09-049 has its Strike only in quotes ("this follower has Storm and '...'").
    for (const lang of LANGS) expect(abilityLine("BP09-049", text("BP09-049", lang), lang, "strike", 0, 1), lang).toMatch(/1/);
    // Older sets bracket the marks, and one line may have two ("Fanfare/Last Words").
    expect(markedLines(text("BP01-031", "ja"), "ja", "lastWords")).toHaveLength(1);
    expect(markedLines(text("BP18-049", "cn"), "cn", "lastWords")).toEqual(markedLines(text("BP18-049", "cn"), "cn", "fanfare"));
  });

  it("joins a choice's numbered options to their paragraph and leaves out the definitions of the tokens a card makes", () => {
    const sp01 = abilityLine("SP01-026", cardOf("SP01-026").text.cn ?? "", "cn", "activated", 0, 1)!;
    expect(sp01.split("\n")).toHaveLength(5);
    expect(sp01).toMatch(/^《起动》/);
    // BP01-023: the spell's text, not its Fairy token's.
    for (const lang of LANGS) {
      const spell = locateAbilityText(cardOf("BP01-023"), lang, "spell", 0, 1)!.text;
      expect(spell, lang).not.toMatch(/『[^』]+』《|―{3,}|-{3,}/);
    }
    // BP17-030: the parts a divider separates are both the card's.
    expect(locateAbilityText(cardOf("BP17-030"), "en", "spell", 0, 1)!.text.split("\n")).toHaveLength(2);
  });

  it("says how a follower or amulet with another way to play it is played, in every language its text is in", () => {
    // A spell being played shows its whole text, which says it too.
    const problems: string[] = [];
    for (const card of ALL_CARDS) {
      if (!ALL_SCRIPTS[card.id]?.playOptions?.length || card.type === "spell") continue;
      for (const lang of LANGS) {
        const text = textOf(card, lang);
        if (text && abilityLine(card.id, text, lang, "play", 0, 1) === null) problems.push(`${card.id} ${lang}`);
      }
    }
    expect(problems).toEqual([]);
  });

  it("finds an equipment token's abilities in its quotes, and keeps Traditional Chinese the Chinese one converted", async () => {
    const problems: string[] = [];
    for (const card of ALL_CARDS) {
      const abilities = ALL_SCRIPTS[card.id]?.equipment?.abilities ?? [];
      abilities.forEach((a, index) => {
        const { rank, count } = rankOf(abilities, index);
        for (const lang of LANGS) {
          if (textOf(card, lang) && !locateQuotedText(card, lang, textGroupOf(a), rank ?? 0, count ?? 1)) problems.push(`${card.id} ${lang} ${index}`);
        }
      });
    }
    expect(problems).toEqual([]);
    await loadHant();
    const hant = locateAbilityText(cardOf("BP10-004"), "zh-Hant", "other", 1, 2)!;
    expect(hant.lang).toBe("zh-Hant");
    expect(hant.text).toMatch(/結束階段/);
  });
});
