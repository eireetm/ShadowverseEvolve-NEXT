// CP05-067 灼脚の麗姫・アリーザ (evolved) — Dragoncraft, 3/3. グラブル・火属性.
// 【攻撃時】『火晶のエレメント』1枚をEXエリアに置く。
// 【進化時】相手の場のフォロワー1体を選ぶ。それをアクトする。
// (Strike - Put a 火晶のエレメント (CP05-T09) into your EX area, each time it attacks. On Evolve - Select an enemy follower on the
// field and engage it (CR 5.4.1). An engaged one may be selected, and stays as it is (CR 1.3.2.1; BP01-029, 038, 041 rulings);
// without one it can't be played.)
import { defineCard, onEvolve, strike } from "../helpers";
import { enemyFollower } from "../targets";
import { FIRE_ELEMENT } from "./shared";

export default defineCard({
  abilities: [
    strike({
      *resolve(fx) {
        yield* fx.tokensToEx([FIRE_ELEMENT]);
      },
    }),
    onEvolve({
      targets: [enemyFollower()],
      *resolve(fx) {
        yield* fx.engage(fx.targets[0] ?? []);
      },
    }),
  ],
});
