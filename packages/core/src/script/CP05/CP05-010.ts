// CP05-010 清新なる銃設計士・ククル (evolved) — Forestcraft, 3/3. グラブル・水属性.
// 【進化時】相手の場のフォロワー1体を選ぶ。それに2ダメージ。
// (On Evolve - Select an enemy follower on the field and deal it 2 damage. Not played without one, CR 10.6.2.3.3. The base
// card's quick activated ability is not on this card, CR 5.16.1.2.)
import { defineCard, onEvolve } from "../helpers";
import { enemyFollower } from "../targets";

export default defineCard({
  abilities: [
    onEvolve({
      targets: [enemyFollower()],
      *resolve(fx) {
        yield* fx.dealDamage(fx.targets[0]![0]!, 2);
      },
    }),
  ],
});
