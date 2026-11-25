// CP05-046 神託の妖童・アルルメイヤ (evolved) — Runecraft, 4/4. グラブル・土属性.
// 【進化時】相手の場のフォロワー1体を選ぶ。それに「自分のエボルヴデッキの表向きの土属性・エボルヴフォロワーの枚数」と同じダメージ。
// 『土晶のエレメント』1枚をEXエリアに置く。
// (On Evolve - Select an enemy follower on the field and deal it damage equal to the number of faceup earth evolved followers in
// your evolve deck (CR 4.6.3; 全属性 ones too, CR JP 14.6.2.2), counted when it resolves — not this card's own, which is in the
// evolve zone; 0 deals none (CR 1.3.2.2) — then put a 土晶のエレメント (CP05-T11) into your EX area. Without an enemy follower to
// select it isn't played: no element either (ruling Q2901, CR 10.6.2.3.3).)
import { defineCard, onEvolve } from "../helpers";
import { enemyFollower } from "../targets";
import { EARTH_ELEMENT, faceUpEarthEvolved } from "./shared";

export default defineCard({
  abilities: [
    onEvolve({
      targets: [enemyFollower()],
      *resolve(fx) {
        yield* fx.dealDamage(fx.targets[0]![0]!, faceUpEarthEvolved(fx.game, fx.controller));
        yield* fx.tokensToEx([EARTH_ELEMENT]);
      },
    }),
  ],
});
