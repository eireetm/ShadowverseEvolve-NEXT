// CP05-074 闇の理・フェディエル — Abysscraft follower, 3, 3/3. グラブル・六竜・闇属性.
// 進化コスト1：これは進化する。
// 自分が手札の闇属性・カード1枚を捨てたとき、相手のリーダーすべてと相手の場のフォロワーすべてに1ダメージ。
// ({[evolve]} {[cost01]}: Evolve this follower. Whenever you discard a dark (or 全属性, CR JP 14.6.2.2) card from your hand — once per
// card (ruling Q2915), in either player's turn (Q2914), as a cost or to the hand limit too (CR 7.4.7) — deal 1 damage to each enemy
// leader and each enemy follower on the field, at the same time; a pending instance resolves after this has left the field
// (Q2916, CR 10.6.2.8.2.1).)
import { defineCard, evolveAbility } from "../helpers";
import { fedielDiscardBurst } from "./abyss-shared";

export default defineCard({
  abilities: [evolveAbility(1), fedielDiscardBurst],
});
