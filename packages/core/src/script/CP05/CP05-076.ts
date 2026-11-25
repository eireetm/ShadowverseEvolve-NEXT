// CP05-076 幽想の少女・フェリ — Abysscraft follower, 1, 1/1. グラブル・闇属性.
// 自分のターン中、自分の闇属性・カードの能力によってこれを自分の手札から捨てたとき、これを場に出す。
// 進化コスト1：これは進化する。
// 【最終上限解放可能】
// これが最終上限解放したとき、コスト3：自分の場の他の闇属性・フォロワー2体まで選ぶ。それをスタンドする。
// (During your turn (a trigger condition, CR 10.1.1.2.1.1), when the ability of a dark (or 全属性, CR JP 14.6.2.2) card you control
// discards this from your hand — its effect, its cost, or a spell's additional cost (CR 10.1.1.4) — summon this card from the cemetery
// (CR 4.1.4.1): no cost, so it must be done (CR 10.7.3.1). {[evolve]} {[cost01]}: Evolve this follower. Final Uncap (CR JP 14.6.3).
// When this final-uncaps (CR JP 14.6.4.2), {[cost03]}: refresh up to 2 other dark followers on your field (CR 5.4.1). ヒヒイロカネ
// final-uncaps it in one go; only that ability triggers, it has no "when this uncaps".)
import { defineCard, evolveAbility } from "../helpers";
import { feriRefreshes, summonThisFromCemetery, whenDiscardedByYourDarkCard } from "./abyss-shared";

export default defineCard({
  keywords: ["finalUncap"],
  abilities: [whenDiscardedByYourDarkCard({ resolve: summonThisFromCemetery }, { yourTurn: true }), evolveAbility(1), feriRefreshes],
});
