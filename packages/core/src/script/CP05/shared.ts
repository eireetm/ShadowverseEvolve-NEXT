// Shared pieces of CP05 card scripts (not a card: the file name has no set prefix).
//
// CP05 (Granblue Fantasy) is a pre-release set (data/preview.ts, 2026-11-24): its cards are implemented from the Japanese
// text (the Chinese text checked against it), and its card names are the Japanese ones until the English data is out, when
// these constants become the English names. Every script names CP05 cards through them. Its rules (uncapping, treasures,
// 全属性) are in the Japanese rules v1.29.0 only: they are cited "CR JP <number>".
import type { CardId, PlayerId } from "../../model/ids";
import type { GameReader } from "../../engine/query";
import { hasTrait, isEvolvedFollower, isFollower, isQuickActivatedFollower } from "../targets";

// Treasures (CR JP 14.6.1) and the other tokens.
export const FIRE_ELEMENT = "火晶のエレメント"; // CP05-T09
export const WATER_ELEMENT = "水晶のエレメント"; // CP05-T10
export const EARTH_ELEMENT = "土晶のエレメント"; // CP05-T11
export const WIND_ELEMENT = "風晶のエレメント"; // CP05-T12
export const LIGHT_ELEMENT = "光晶のエレメント"; // CP05-T13
export const DARK_ELEMENT = "闇晶のエレメント"; // CP05-T14
export const HIHIIROKANE = "ヒヒイロカネ"; // CP05-T15
export const KUMUYU = "ガンパウダーミキサー・クムユ"; // CP05-T01
export const FIL = "フィル"; // CP05-T02 (a spell token)
export const LANCELOT = "俊英の双剣士・ランスロット"; // CP05-T03
export const VANE = "不撓不屈の騎士・ヴェイン"; // CP05-T04
export const SIEGFRIED = "竜殺しの騎士・ジークフリート"; // CP05-T05
export const PERCIVAL = "炎帝・パーシヴァル"; // CP05-T06
export const HAKUTAKU = "ハクタク"; // CP05-T07
export const ARS_MAGNA = "アルス・マグナ"; // CP05-T08 (a spell token)

// Cards other cards name.
export const ZETA = "真紅の穿光・ゼタ"; // CP05-025
export const ARTHUR = "眠れる輝竜・アーサー"; // CP05-033
export const MORDRED = "眠れる獅子・モルドレッド"; // CP05-034
export const ZOOEY = "大いなる調停者・ゾーイ"; // CP05-055
export const MEG = "どこにでもいるフツーの女の子・メグ"; // CP05-059
export const SEOX = "神狼・シス"; // CP05-072
export const VIRA = "狂恋の華鎧・ヴィーラ"; // CP05-094
export const GRAN_AND_DJEETA = "グラン＆ジータ"; // CP05-107

/** The element of each attribute (CP05-T09 … T14), by the trait its ability selects. */
export const ELEMENT_OF: Readonly<Record<string, string>> = {
  火属性: FIRE_ELEMENT,
  水属性: WATER_ELEMENT,
  土属性: EARTH_ELEMENT,
  風属性: WIND_ELEMENT,
  光属性: LIGHT_ELEMENT,
  闇属性: DARK_ELEMENT,
};

/**
 * "自分のエボルヴデッキの表向きの土属性・エボルヴフォロワー" (CP05-015, 020, 031 …): the faceup earth (or 全属性,
 * CR JP 14.6.2.2) evolved followers in the player's evolve deck area (CR 4.6.3: faceup cards there are public).
 */
export function faceUpEarthEvolved(g: GameReader, player: PlayerId): number {
  return g.faceUpEvolveDeck(player).filter((id) => isEvolvedFollower(g, id) && hasTrait("土属性")(g, id)).length;
}

/** "自分の墓場のQ起動能力を持つフォロワー" (CP05-008, 009, 030, 043, 047): printed quick activated abilities (CR 12.3.3). */
export function quickFollowersInCemetery(g: GameReader, player: PlayerId): number {
  return g.cards(player, "cemetery").filter((id) => isQuickActivatedFollower(g, id)).length;
}

/**
 * "元のコスト5のグラブル・フォロワー" (CP05-001, 095, 106 …): a Granblue follower whose original cost is 5 — an evolved
 * follower's is its base card's (CR 5.24.1, 5.16.1.2; BP07-091 rulings), which `info().cost` gives on the field.
 */
export function granblueCost5(g: GameReader, id: CardId): boolean {
  return isFollower(g, id) && hasTrait("グラブル")(g, id) && g.info(id).cost === 5;
}
