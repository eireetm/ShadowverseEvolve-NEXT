// CP05-014 緋焔の踊り子・アンスリア (evolved) — Forestcraft, 4/4. グラブル・火属性.
// 【進化時】相手の場のフォロワー1体を選ぶ。それに3ダメージ。『火晶のエレメント』1枚をEXエリアに置く。
// (On Evolve - Select an enemy follower on the field, deal it 3 damage, and put a 火晶のエレメント into your EX area. Without an
// enemy follower to select it can't be played, so no element either — ruling Q2878, CR 10.6.2.3.3.)
import { defineCard, onEvolve } from "../helpers";
import { enemyFollower } from "../targets";
import { FIRE_ELEMENT } from "./shared";

export default defineCard({
  abilities: [
    onEvolve({
      targets: [enemyFollower()],
      *resolve(fx) {
        yield* fx.dealDamage(fx.targets[0]![0]!, 3);
        yield* fx.tokensToEx([FIRE_ELEMENT]);
      },
    }),
  ],
});
