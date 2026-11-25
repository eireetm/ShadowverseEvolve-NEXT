// CP05-108 小さき赤き竜・ビィ — Neutral follower, 1, 1/1. グラブル・全属性.
// 進化コスト1：これは進化する。
// ファンファーレ自分の場に『グラン＆ジータ』がいるなら、これは進化する。
// (Evolve (1). Fanfare - If there is a グラン＆ジータ (CP05-107, its alternate printing CP05-U11 too: CR 2.13) on your field when
// it resolves, evolve this — an effect's evolution: no cost, the player may decline it, and it doesn't use the turn's evolve
// (ruling Q2923, CR 8.3.2.1).)
import { defineCard, evolveAbility, fanfare } from "../helpers";
import { named } from "../targets";
import { GRAN_AND_DJEETA } from "./shared";

export default defineCard({
  abilities: [
    evolveAbility(1),
    fanfare({
      *resolve(fx) {
        if (fx.game.cards(fx.controller, "field").some((id) => named(GRAN_AND_DJEETA)(fx.game, id))) yield* fx.evolve(fx.self);
      },
    }),
  ],
});
