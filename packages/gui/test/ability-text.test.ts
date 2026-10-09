import type { AbilityDef } from "@sve/core";
import { ALL_CARDS, ALL_SCRIPTS } from "@sve/core/sets";
import { describe, expect, it } from "vitest";
import type { DataLang } from "../src/i18n/hant";
import { rankOf } from "../src/engine/game-host";
import { abilityLine, locateAbilityText, locateAutomaticAbilityText, locateKeywordAbilityText, markedLines, OTHER_LINES } from "../src/game/card/ability-text";

// Pending choices show complete paragraphs. Audit every script in every card language, including
// shared paragraphs, reviewed multilingual mappings and explicit exceptions in the source data.

const LANGS: readonly DataLang[] = ["en", "cn", "ja"];
const MARKED = ["fanfare", "lastWords", "onEvolve", "onSuperEvolve", "strike", "onRace", "onDrive"];
type Automatic = Extract<AbilityDef, { kind: "automatic" }>;

/** The card's text in a language, or null where the data has none (a pre-release card's English text is a placeholder). */
const textOf = (card: (typeof ALL_CARDS)[number], lang: DataLang): string | null => {
  const text = card.text[lang];
  return text && text !== "unavailable" ? text : null;
};

/** Each card's automatic abilities by timing, with their indexes in its script. */
function byTiming(abilities: readonly AbilityDef[]): Map<string, number[]> {
  const out = new Map<string, number[]>();
  abilities.forEach((a, i) => {
    if (a.kind === "automatic") out.set(a.timing, [...(out.get(a.timing) ?? []), i]);
  });
  return out;
}

describe("an ability's line of its card text", () => {
  it("tells CP04-037 Karyl's two Fanfares apart, in every card language", () => {
    const abilities = ALL_SCRIPTS["CP04-037"]!.abilities ?? [];
    expect([rankOf(abilities, 0), rankOf(abilities, 1), rankOf(abilities, 2)]).toEqual([{ rank: 0, count: 2 }, {}, { rank: 1, count: 2 }]);
    const karyl = ALL_CARDS.find((c) => c.id === "CP04-037")!;
    const line = (lang: DataLang, rank: number) => abilityLine("CP04-037", karyl.text[lang] ?? "", lang, "fanfare", rank, 2);
    expect(line("cn", 0)).toBe("《UB》《入场曲》将手牌中的1张法术卡舍弃：选择敌方场上的1个从者。给予其3点伤害。抽取1张卡。");
    expect(line("cn", 1)).toBe("《入场曲》《消费2》：将1张『混沌魔法书』卡装备到这张卡。");
    expect(line("ja", 0)).toMatch(/^UBファンファーレ手札のスペル1枚を捨てる：/);
    expect(line("ja", 1)).toBe("ファンファーレコスト2：これは『ケイオスグリモワール』1枚を装備する。");
    expect(line("en", 1)).toBe("{[fanfare]} {[cost02]} Equip this with a Chaos Grimoire token.");
  });

  it("gives each of a card's abilities with one marked timing its own line, in every language its text is in", () => {
    const problems: string[] = [];
    for (const card of ALL_CARDS) {
      const abilities = ALL_SCRIPTS[card.id]?.abilities ?? [];
      for (const [timing, indexes] of byTiming(abilities)) {
        if (!MARKED.includes(timing) || indexes.length < 2) continue;
        for (const lang of LANGS) {
          const text = textOf(card, lang);
          if (!text) continue;
          const lines = indexes.map((_, rank) => abilityLine(card.id, text, lang, timing, rank, indexes.length));
          if (lines.some((l) => l === null) || new Set(lines).size !== lines.length) problems.push(`${card.id} ${timing} ${lang}`);
          // A Union Burst ability is the line with the UB icon (the order the script lists them in is the text's).
          indexes.forEach((index, rank) => {
            const ub = (abilities[index] as Automatic).unionBurst === true;
            if (ub !== /^(?:\{\[ub\]\}|《UB》|UB)/.test(lines[rank] ?? "")) problems.push(`${card.id} ${timing} ${lang}: UB of ${rank}`);
          });
        }
      }
    }
    expect(problems).toEqual([]);
  });

  it("lists every card with more than one trigger without a mark in OTHER_LINES, one line of its text for each", () => {
    const problems: string[] = [];
    const cards = new Set<string>();
    for (const card of ALL_CARDS) {
      const abilities = ALL_SCRIPTS[card.id]?.abilities ?? [];
      const others = byTiming(abilities).get("other") ?? [];
      const count = others.length;
      if (count < 2) continue;
      cards.add(card.id);
      for (const lang of LANGS) {
        const text = textOf(card, lang);
        const lines = OTHER_LINES[card.id]?.[lang];
        if (!text) {
          if (lines) problems.push(`${card.id} ${lang}: lines for a text the data doesn't have`);
          continue;
        }
        if (lines?.length !== count) {
          problems.push(`${card.id} ${lang}: ${count} triggers without a mark, ${lines?.length ?? "no"} lines in OTHER_LINES`);
          continue;
        }
        const all = text.split("\n");
        const marked = new Set(MARKED.flatMap((timing) => markedLines(text, lang, timing)));
        lines.forEach((index, rank) => {
          const line = all[index];
          // A delayed trigger is said by the line of the ability that sets it up (BP22-037's Fanfare).
          const delayed = (abilities[others[rank]!] as Automatic).delayed === true;
          if (!line || (marked.has(line) && !delayed) || /^[-―]+$/.test(line.trim())) problems.push(`${card.id} ${lang}: line ${index} isn't a trigger's`);
        });
      }
    }
    expect(Object.keys(OTHER_LINES).filter((id) => !cards.has(id))).toEqual([]);
    expect(problems).toEqual([]);
  });

  it("follows the Japanese and Chinese order where it differs from the English one, and gives no line where the text doesn't tell", () => {
    const text = (id: string, lang: DataLang) => ALL_CARDS.find((c) => c.id === id)!.text[lang] ?? "";
    // BP10-004: the first trigger is "Whenever an enemy follower is put onto the field", the second the end phase one.
    expect(abilityLine("BP10-004", text("BP10-004", "en"), "en", "other", 1, 2)).toBe("At the start of your end phase, refresh this card.");
    expect(abilityLine("BP10-004", text("BP10-004", "cn"), "cn", "other", 1, 2)).toBe("当自己的结束阶段到来时，将这张卡竖置。");
    expect(abilityLine("BP10-004", text("BP10-004", "ja"), "ja", "other", 0, 2)).toMatch(/^相手の場にフォロワーが出たとき/);
    // Both printed conditional branches belong to its one scripted Fanfare.
    expect(abilityLine("BP03-090", text("BP03-090", "cn"), "cn", "fanfare", 0, 1)).toBe(text("BP03-090", "cn").split("\n").slice(1, 3).join("\n"));
    expect(abilityLine("BP03-090", text("BP03-090", "en"), "en", "fanfare", 0, 1)).toMatch(/^\{\[fanfare\]\} If this card was put onto the field from your hand/);
    expect(abilityLine("BP01-126", text("BP01-126", "cn"), "cn", "other", 0, 1)).toBe(text("BP01-126", "cn").split("\n")[2]);
    // Older sets bracket the marks, and one line may have two ("Fanfare/Last Words").
    expect(markedLines(text("BP01-031", "ja"), "ja", "lastWords")).toHaveLength(1);
    expect(markedLines(text("BP18-049", "cn"), "cn", "lastWords")).toEqual(markedLines(text("BP18-049", "cn"), "cn", "fanfare"));
  });
});

const cardOf = (id: string) => ALL_CARDS.find((c) => c.id === id)!;

describe("complete automatic ability text", () => {
  it("keeps every choice and excludes unrelated passive and activated abilities", () => {
    const card = cardOf("BP19-092");
    for (const lang of ["cn", "ja"] as const) {
      const found = locateAutomaticAbilityText(card, ALL_SCRIPTS[card.id]!.abilities!, 0, lang)!;
      expect(found.text).toBe(card.text[lang]!.split("\n").slice(1).join("\n"));
      expect(found.text).toContain("【3】");
      expect(found.text).not.toContain(lang === "ja" ? "追加で1回" : "额外触发1次");
    }
    const other = cardOf("CP04-075");
    const index = ALL_SCRIPTS[other.id]!.abilities!.findIndex((a) => a.kind === "automatic" && a.timing === "other");
    const found = locateAutomaticAbilityText(other, ALL_SCRIPTS[other.id]!.abilities!, index, "cn")!;
    expect(found.text).toContain("【1】");
    expect(found.text).toContain("【2】");
    expect(found.text).not.toContain("《入场曲》");
  });

  it("does not confuse token definitions, cost replacements, or quoted text with ordinary triggers", () => {
    for (const id of ["BP03-074", "BP07-084", "BP12-014"]) {
      for (const lang of ["cn", "ja"] as const) {
        const card = cardOf(id);
        const found = locateAbilityText(card, lang, "other", 0, 1)!;
        expect(found.text).not.toContain("―――");
        expect(found.text).toBe(card.text[lang]!.split("\n")[id === "BP03-074" ? 1 : 0]);
      }
    }
    const card = cardOf("BP19-098");
    expect(locateAbilityText(card, "en", "other", 0, 1)?.text).toBe("At the start of your end phase, select an enemy follower on the field and deal it 2 damage.");
    expect(abilityLine("synthetic", "While this is on your field, whenever an enemy plays a card, its abilities trigger twice.", "en", "other", 0, 1)).toBeNull();
    expect(abilityLine("synthetic", "これは「自分のエンドフェイズが来たとき、1枚引く」を失う。", "ja", "other", 0, 1)).toBeNull();
    expect(abilityLine("synthetic", "自分のエンドフェイズが来たとき、1枚引く。\n自分のメインフェイズが来たとき、1枚引く。", "ja", "other", 0, 1)).toBeNull();
    expect(abilityLine("synthetic", "ファンファーレ1枚引く。\nファンファーレ1枚引く。", "ja", "fanfare", 0, 1)).toBeNull();
    expect(abilityLine("synthetic", "ファンファーレ1枚引く。", "ja", "fanfare", 0.5, 1)).toBeNull();
  });

  it("extracts quoted attacks and keeps outer abilities separate from the abilities they give", () => {
    for (const lang of LANGS) {
      const card = cardOf("CP03-009");
      const found = locateAbilityText(card, lang, "strike", 0, 1)!;
      expect(found.text).toMatch(/^(?:Strike|【攻击时】|【攻撃時】)/);
      expect(found.text).not.toContain(lang === "ja" ? "【ドライブ獲得時】" : lang === "cn" ? "【驱动获得时】" : "On Drive");
      const outer = locateAbilityText(card, lang, "onDrive", 0, 1)!;
      expect(outer.text).toContain(found.text);
    }
    const card = cardOf("BP22-022");
    expect(locateAbilityText(card, "ja", "other", 0, 1)?.text).toBe("自分のEXエリアに『輝く金貨』が置かれたとき、相手のリーダーすべてと相手の場のフォロワーすべてに1ダメージ");
  });

  it("isolates delayed triggers from their setup damage and the other choice options", () => {
    for (const id of ["BP01-056", "BP03-089", "BP15-001", "BP15-008", "BP15-012"]) {
      const card = cardOf(id);
      for (const lang of LANGS) {
        const found = locateAbilityText(card, lang, "other", 0, 1)!;
        expect(found).not.toBeNull();
        expect(found.match).toBe("exact");
        expect(card.text[lang]).toContain(found.text);
        expect(found.text).not.toMatch(/^(?:Activate|《起动》|起動|ファンファーレ|《入场曲》|\{\[fanfare\]\})/);
      }
    }
    const card = cardOf("SP01-026");
    for (const lang of LANGS) {
      const found = locateAbilityText(card, lang, "other", 0, 1)!;
      expect(found.text).not.toMatch(/【[134]】|\([134]\)/);
      expect(found.text).not.toContain("Recover 5");
      expect(card.text[lang]).toContain(found.text);
    }
    expect(locateAbilityText(cardOf("BP22-037"), "ja", "other", 1, 2)?.text).toBe("このターン、次に自分の場にウィッチフォロワーが1体以上出たとき、その中の1体は進化する。");
    expect(locateAbilityText(cardOf("CP04-045"), "en", "other", 0, 1)?.text).toBe("At the start of your end phase, if this is in your EX area, bury it.");
  });

  it("identifies shared paragraphs and locates an ability by its actual script index", () => {
    const card = cardOf("BP09-002");
    const abilities = ALL_SCRIPTS[card.id]!.abilities!;
    const first = locateAutomaticAbilityText(card, abilities, 1, "ja")!;
    const second = locateAutomaticAbilityText(card, abilities, 2, "ja")!;
    expect(first.match).toBe("shared");
    expect(second).toEqual(first);
    expect(first.text).toContain("獣・フォロワーなら");
    expect(locateAutomaticAbilityText(card, abilities, 0, "ja")).toBeNull();
    expect(locateAutomaticAbilityText(card, abilities, -1, "ja")).toBeNull();
    expect(locateAutomaticAbilityText(card, abilities, 100, "ja")).toBeNull();
    const quotes = cardOf("CP04-T09");
    const equipment = ALL_SCRIPTS[quotes.id]!.equipment!.abilities!;
    expect(locateAutomaticAbilityText(quotes, equipment, 0, "ja", "quoted")?.text).toBe("【攻撃時】相手の場のフォロワー2体まで選ぶ。それに3ダメージ");
    const giver = { id: "X", text: { en: '{[fanfare]} Give a follower "{[fanfare]} Draw 2 cards."', cn: null, ja: null } };
    const automatic = ALL_SCRIPTS["CP04-037"]!.abilities!.filter((a) => a.kind === "automatic").slice(0, 1);
    expect(locateAutomaticAbilityText(giver, automatic, 0, "en", "quoted")?.text).toBe("{[fanfare]} Draw 2 cards.");
  });

  it("carries the actual language when missing or inaccurate translations fall back", () => {
    expect(locateAbilityText(cardOf("BP08-U07"), "cn", "fanfare", 0, 1)?.lang).toBe("en");
    for (const id of ["BP03-071", "BP18-029", "BP18-052"]) {
      const timing = id === "BP03-071" ? "fanfare" : "strike";
      const found = locateAbilityText(cardOf(id), "en", timing, 0, 1)!;
      expect(found.lang).toBe("ja");
      expect(found.text).toMatch(/^(?:ファンファーレ|【攻撃時】)/);
    }
    const preview = locateAbilityText(cardOf("BP22-037"), "en", "other", 0, 2)!;
    expect(preview.lang).toBe("ja");
    expect(locateAbilityText(cardOf("BP01-126"), "zh-Hant", "other", 0, 1)?.lang).toBe("zh-Hant");
    expect(locateAbilityText({ id: "X", text: { cn: "【进化时】抽取1张卡。", en: "", ja: null } }, "en", "onEvolve", 0, 1)?.lang).toBe("cn");
    expect(locateAbilityText({ id: "X", text: { en: "unavailable", cn: null, ja: null } }, "en", "fanfare", 0, 1)).toBeNull();
  });

  it("expands only the automatic keywords, including two sequential Twin Drive checks", () => {
    for (const lang of ["ja", "cn", "en", "zh-Hant"] as const) {
      for (const keyword of ["drain", "singleDrive", "twinDrive"]) {
        expect(locateKeywordAbilityText(keyword, lang)).toMatchObject({ lang, match: "exact" });
      }
      expect(locateKeywordAbilityText("storm", lang)).toBeNull();
    }
    expect(locateKeywordAbilityText("twinDrive", "ja")?.text).toContain("その後");
    expect(locateKeywordAbilityText("drain", "ja")?.text).toContain("攻撃によるダメージ");
  });

  it("covers every scripted automatic ability in all requested languages and lists raw-data exceptions explicitly", () => {
    const missing: Record<DataLang, string[]> = { ja: [], cn: [], en: [] };
    const noFallback: string[] = [];
    for (const card of ALL_CARDS) {
      const abilities = ALL_SCRIPTS[card.id]?.abilities ?? [];
      for (const [timing, indexes] of byTiming(abilities)) {
        for (const [rank, index] of indexes.entries()) {
          for (const lang of LANGS) {
            if (textOf(card, lang) && !abilityLine(card.id, card.text[lang]!, lang, timing, rank, indexes.length)) missing[lang].push(card.id + ":" + timing);
            const found = locateAutomaticAbilityText(card, abilities, index, lang);
            if (!found) noFallback.push(card.id + ":" + index + ":" + lang);
            else {
              const data = found.lang === "zh-Hant" ? "cn" : found.lang;
              expect(card.text[data], card.id + ":" + index + ":" + lang).toContain(found.text);
            }
          }
        }
      }
      const equipment = ALL_SCRIPTS[card.id]?.equipment?.abilities ?? [];
      equipment.forEach((ability, index) => {
        if (ability.kind !== "automatic") return;
        for (const lang of LANGS) {
          const found = locateAutomaticAbilityText(card, equipment, index, lang, "quoted");
          if (!found) noFallback.push(card.id + ":equipment:" + index + ":" + lang);
          else expect(card.text[found.lang === "zh-Hant" ? "cn" : found.lang]).toContain(found.text);
        }
      });
    }
    expect(missing).toEqual({ ja: [], cn: ["BP08-U07:fanfare"], en: ["BP03-071:fanfare", "BP18-029:strike", "BP18-052:strike"] });
    expect(noFallback).toEqual([]);
  });
});
