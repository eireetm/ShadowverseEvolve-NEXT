// CP05-056 炎の理・ウィルナス — Dragoncraft follower, 4, 4/4. グラブル・六竜・火属性.
// 進化コスト1：これは進化する。
// ファンファーレ自分のデッキの上1枚を見る。その中から、火属性・カード1枚を公開して手札に加えてよい。
// (Evolve (1). Fanfare - Look at the top card of your deck (CR 5.11.1). You may reveal a fire card of any type from among it (全属性
// too, CR JP 14.6.2.2) and put it into your hand. A card not taken stays on top, unrevealed (the rulings of the same text on
// BP15-072, BP17-099).)
import { defineCard, evolveAbility, fanfare } from "../helpers";
import { hasTrait } from "../targets";
import { lookAtTopMayTake } from "./dragon-shared";

export default defineCard({
  abilities: [
    evolveAbility(1),
    fanfare({
      *resolve(fx) {
        yield* lookAtTopMayTake(fx, hasTrait("火属性"));
      },
    }),
  ],
});
