// CP05-018 箒星 — Forestcraft spell, 3. グラブル・風属性.
// これをプレイする際、コストを-Xする。Xは「このターン中に自分の場のフォロワーが上限解放や最終上限解放をした回数」である。
// 相手の場のフォロワー1体を選ぶ。それに4ダメージ。『風晶のエレメント』1枚をEXエリアに置く。
// (This costs X less to play, X = the uncaps and final uncaps of followers on your field this turn — each event counts:
// ヒヒイロカネ final-uncapping a follower makes it 2 less, ruling Q2880; set when the cost is determined, CR 10.6.2.5. Select an
// enemy follower on the field, deal it 4 damage, and put a 風晶のエレメント into your EX area. Not playable without one, so
// no element either — ruling Q2881, CR 10.6.2.3.3.)
import { defineCard, spell } from "../helpers";
import { enemyFollower } from "../targets";
import { WIND_ELEMENT } from "./shared";

export default defineCard({
  playCost: (g, _self, controller) => -g.uncapsThisTurn(controller),
  abilities: [
    spell({
      targets: [enemyFollower()],
      *resolve(fx) {
        yield* fx.dealDamage(fx.targets[0]![0]!, 4);
        yield* fx.tokensToEx([WIND_ELEMENT]);
      },
    }),
  ],
});
