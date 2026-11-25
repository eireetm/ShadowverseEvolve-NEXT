// CP05-054 怪力乱神・サラーサ — Dragoncraft follower, 4, 3/3. グラブル・十天衆・土属性.
// 【最終上限解放可能】
// これが上限解放したとき、自分のエボルヴデッキの裏向きの土属性・エボルヴフォロワー2枚まで表向きにしてよい。
// これが最終上限解放したとき、相手のリーダーすべてと相手の場のフォロワーすべてに「自分のエボルヴデッキの表向きの土属性・エボルヴフォロワー」
// 2枚につき1ダメージ。
// (Final Uncap (CR JP 14.6.3). When this uncaps (CR JP 14.6.4.1), you may turn up to 2 facedown earth evolved followers in your
// evolve deck faceup (CR 4.6.3; 全属性 ones are earth too, CR JP 14.6.2.2). When this final-uncaps (CR JP 14.6.4.2), deal 1 damage
// for every 2 faceup earth evolved followers in your evolve deck to each enemy leader and each enemy follower on the field: one
// damage of the total, the rest not counted (CR 5.29.1), to all of them at once, counted as it resolves (CR 10.6.2.8.2).
// ヒヒイロカネ doing both makes both trigger, resolved in the order you choose (rulings Q2867, Q2868; CR 10.5.2.2): the cards the
// uncap one turns faceup count for the other if it resolves first.)
import { defineCard, whenThisIsFinalUncapped, whenThisIsUncapped } from "../helpers";
import { faceUpEarthEvolved } from "./shared";
import { turnEarthEvolvedFaceup } from "./dragon-shared";

export default defineCard({
  keywords: ["finalUncap"],
  abilities: [
    whenThisIsUncapped({
      *resolve(fx) {
        yield* turnEarthEvolvedFaceup(fx, 2);
      },
    }),
    whenThisIsFinalUncapped({
      *resolve(fx) {
        const x = Math.floor(faceUpEarthEvolved(fx.game, fx.controller) / 2);
        const opponent = fx.game.opponent(fx.controller);
        yield* fx.dealDamageEach([fx.game.leader(opponent), ...fx.game.followers(opponent)], x);
      },
    }),
  ],
});
