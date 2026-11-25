// CP05-072 神狼・シス — Abysscraft follower, 6, 3/2. グラブル・十天衆・闇属性.
// 自分のターン中、自分の闇属性・カードの能力によってこれを自分の手札から捨てたとき、コスト3：これを場に出す。
// 【最終上限解放可能】
// これが上限解放したとき、これは【疾走】を持つ。
// これが最終上限解放したとき、コスト2：自分のデッキから『神狼・シス』1枚を探し、場に出す。
// (During your turn, when the ability of a dark (or 全属性, CR JP 14.6.2.2) card you control discards this from your hand — its effect,
// its cost, or a spell's additional cost (CR 10.1.1.4) — {[cost03]}: summon this card from the cemetery (CR 4.1.4.1); "during your
// turn" is part of the trigger condition (CR 10.1.1.2.1.1), the cost may be left unpaid (CR 10.4.7.4). Final Uncap (CR JP 14.6.3).
// When this uncaps (CR JP 14.6.4.1), it gains Storm for as long as it stays on the field (CR 10.9.2).
// When this final-uncaps (CR JP 14.6.4.2), {[cost02]}: search your deck for a 神狼・シス and summon it — it may be left unfound
// (CR 4.1.2.2) and is revealed (CR 5.8.1.2); it is a new card, neither uncapped nor with Storm (CR 4.1.4). ヒヒイロカネ does both: both
// trigger, in any order (rulings Q2867, Q2868).)
import { playPointsCost } from "../costs";
import { defineCard, whenThisIsFinalUncapped, whenThisIsUncapped } from "../helpers";
import { named } from "../targets";
import { summonThisFromCemetery, whenDiscardedByYourDarkCard } from "./abyss-shared";
import { SEOX } from "./shared";

export default defineCard({
  keywords: ["finalUncap"],
  abilities: [
    whenDiscardedByYourDarkCard({ cost: playPointsCost(3), resolve: summonThisFromCemetery }, { yourTurn: true }),
    whenThisIsUncapped({
      *resolve(fx) {
        if (fx.game.card(fx.self)?.zone === "field") yield* fx.giveKeyword(fx.self, "storm");
      },
    }),
    whenThisIsFinalUncapped({
      cost: playPointsCost(2),
      *resolve(fx) {
        yield* fx.search((id) => named(SEOX)(fx.game, id), { to: "field" });
      },
    }),
  ],
});
