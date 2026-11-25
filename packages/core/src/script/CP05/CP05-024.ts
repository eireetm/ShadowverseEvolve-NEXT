// CP05-024 揺らぎの斬姫・ナルメア (evolved) — Swordcraft, 4/4. グラブル・風属性・闇属性.
// 【必殺】
// 【進化時】相手の場のフォロワー1体を選ぶ。それに4ダメージ。『ヒヒイロカネ』1枚をEXエリアに置く。
// (Bane. On Evolve - Select an enemy follower on the field and deal it 4 damage, then put a ヒヒイロカネ (CP05-T15) into your EX
// area (none when it is full, CR 4.8.3.2). Without a follower to select it can't be played: no ヒヒイロカネ (ruling Q2883,
// CR 10.6.2.3.3).)
import { defineCard, onEvolve } from "../helpers";
import { enemyFollower } from "../targets";
import { HIHIIROKANE } from "./shared";

export default defineCard({
  keywords: ["bane"],
  abilities: [
    onEvolve({
      targets: [enemyFollower()],
      *resolve(fx) {
        yield* fx.dealDamage(fx.targets[0]![0]!, 4);
        yield* fx.tokensToEx([HIHIIROKANE]);
      },
    }),
  ],
});
