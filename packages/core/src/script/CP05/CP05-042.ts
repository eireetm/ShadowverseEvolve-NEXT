// CP05-042 開闢の錬金術師・カリオストロ (evolved) — Runecraft, 3/3. グラブル・土属性・光属性・闇属性.
// 【進化時】相手の場のフォロワー1体を選ぶ。それに2ダメージ。
// 起動これをアクト手札のグラブル・カード1枚を捨てる：相手の場のフォロワー1体を選ぶ。それに2ダメージ。
// (On Evolve - Select an enemy follower on the field and deal it 2 damage. {[act]} {[engage]}, discard a Granblue card from your
// hand: select an enemy follower on the field and deal it 2 damage — CP05-041's, printed on the evolved card too: an evolved
// follower has the abilities of its evolved card (CR 5.16.2.2). It needs the follower reserved (CR 10.4.6).)
import { defineCard, onEvolve } from "../helpers";
import { enemyFollower } from "../targets";
import { alchemistAct } from "./rune-shared";

export default defineCard({
  abilities: [
    onEvolve({
      targets: [enemyFollower()],
      *resolve(fx) {
        yield* fx.dealDamage(fx.targets[0]![0]!, 2);
      },
    }),
    alchemistAct,
  ],
});
