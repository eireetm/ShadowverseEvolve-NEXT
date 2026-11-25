// CP05-063 純朴の鋼体・ムゲン (evolved) — Dragoncraft, 6/6. グラブル・光属性.
// 【進化時】相手の場のフォロワー2体まで選ぶ。それを破壊する。『光晶のエレメント』1枚をEXエリアに置く。
// (On Evolve - Select up to 2 enemy followers on the field and destroy them, at once. Put a 光晶のエレメント (CP05-T13) into your
// EX area. It may select none (CR 10.6.2.3.2) and is still played: then it only puts the element (ruling Q2906).)
import { defineCard, onEvolve } from "../helpers";
import { enemyFollower } from "../targets";
import { LIGHT_ELEMENT } from "./shared";

export default defineCard({
  abilities: [
    onEvolve({
      targets: [enemyFollower({ count: 2, upTo: true })],
      *resolve(fx) {
        yield* fx.destroy(fx.targets[0] ?? []);
        yield* fx.tokensToEx([LIGHT_ELEMENT]);
      },
    }),
  ],
});
