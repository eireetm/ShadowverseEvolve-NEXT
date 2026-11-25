// CP05-027 サムライドリーマー・ミリン — Swordcraft follower, 2, 2/2. グラブル・風属性.
// 進化コスト1：これは進化する。
// 自分のエンドフェイズが来たとき、このターン、自分の場のフォロワーが上限解放や最終上限解放を合わせて3回以上していたなら、相手のリーダーすべてに
// 2ダメージ。
// (Evolve (1). At the start of your end phase (CR 7.4.1), if your followers uncapped and final-uncapped at least 3 times in all
// this turn, deal 2 damage to each enemy leader — checked when it resolves; ヒヒイロカネ doing both counts 2 (ruling Q2886).)
import { defineCard, evolveAbility } from "../helpers";
import { endPhaseTwoDamage } from "./sword-shared";

export default defineCard({
  abilities: [evolveAbility(1), endPhaseTwoDamage],
});
