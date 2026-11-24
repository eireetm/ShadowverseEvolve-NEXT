import { describe, expect, it } from "vitest";
import { CardDataError } from "../../src";
import { previewRawCards, previewSetFile, type CardListCard } from "../../src/data/preview";

/** A card of CP05's official list (D:\SVE\CP05\CP05.json): a plain list with the Chinese name, types and text. */
function listCard(over: Partial<CardListCard>): CardListCard {
  return {
    カード番号: "CP05-T15",
    カード名: "ヒヒイロカネ",
    中文卡名: "绯绯色金",
    クラス: "ニュートラル",
    タイトル: "グランブルーファンタジー",
    カード種類: "トレジャー・トークン",
    タイプ: "グラブル",
    中文类型: "碧蓝幻想",
    コスト: "-",
    攻撃力: "-",
    体力: "-",
    効果: "起動コスト0：テスト。",
    中文效果: "《起动》《消费0》：测试。",
    "Q&A": [{ id: "Q2932（2026-11-24）", Q: "質問", A: "回答" }],
    ...over,
  };
}

describe("pre-release card lists (data/preview.ts)", () => {
  it("reads CP05's list: the Chinese name, the title's universe, the Q&A numbers, a treasure, the picture", () => {
    const [raw] = previewRawCards(previewSetFile("CP05", [listCard({})]));
    expect(raw).toMatchObject({
      card_no: "CP05-T15",
      name_en: "",
      name_ja: "ヒヒイロカネ",
      name_cn: "绯绯色金",
      class: "Neutral",
      card_type: ["Treasure", "Token"],
      traits_ja: "グラブル",
      cost: null,
      effect_ja: "起動コスト0：テスト。",
      effect_cn: "《起动》《消费0》：测试。",
      rulings: [{ q: "Q2932 質問", a: "回答" }],
      image: "CP05-T15.png",
      preview: true,
      universe: "granblueFantasy",
    });
  });

  it("refuses what it can't read instead of guessing", () => {
    // CR 2.12.2.1: an unknown title, or one that isn't the set's universe (data/universes.ts).
    expect(() => previewRawCards(previewSetFile("CP05", [listCard({ タイトル: "知らない" })]))).toThrow(/unknown title/);
    expect(() => previewRawCards(previewSetFile("CP04", [listCard({ カード番号: "CP04-T99" })]))).toThrow(/universe/);
    expect(() => previewSetFile("CP05", [listCard({ "Q&A": [{ id: "Q2932", Q: "", A: "" }] })])).toThrow(CardDataError);
    expect(() => previewRawCards(previewSetFile("CP05", [listCard({ カード種類: "宝物" })]))).toThrow(/unknown card type/);
  });

  it("passes the other shape (BP22's) through", () => {
    const file = { 収録コード: "XX01", カード: [] };
    expect(previewSetFile("XX01", file)).toBe(file);
  });
});
