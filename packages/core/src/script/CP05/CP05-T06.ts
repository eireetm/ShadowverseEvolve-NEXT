// CP05-T06 炎帝・パーシヴァル — Swordcraft follower token, 3, 4/3. グラブル・火属性.
// ファンファーレ相手の場のフォロワー1体を選ぶ。それに4ダメージ。『火晶のエレメント』1枚をEXエリアに置く。
// (Fanfare - Select an enemy follower on the field and deal it 4 damage, then put a 火晶のエレメント (CP05-T09) into your EX area.
// Without a follower to select it can't be played: no element (ruling Q2928, CR 10.6.2.3.3).)
import { defineCard, fanfare } from "../helpers";
import { enemyFollower } from "../targets";
import { FIRE_ELEMENT } from "./shared";

export default defineCard({
  abilities: [
    fanfare({
      targets: [enemyFollower()],
      *resolve(fx) {
        yield* fx.dealDamage(fx.targets[0]![0]!, 4);
        yield* fx.tokensToEx([FIRE_ELEMENT]);
      },
    }),
  ],
});
