// CP05-058 どこにでもいるフツーの女の子・メグ — Dragoncraft follower, 2, 1/1. グラブル・闇属性.
// 進化コスト1：これは進化する。
// ファンファーレ手札の闇属性・カード1枚を捨てる：1枚引く。
// (Evolve (1). Fanfare - Discard a dark card (全属性 too, CR JP 14.6.2.2) from your hand: draw a card. The discard is optional
// (CR 10.4.7.4); it is a discard by this dark card's ability (its cause, as the CP05-065 trigger reads it).)
import { discardA } from "../costs";
import { defineCard, evolveAbility, fanfare } from "../helpers";
import { hasTrait } from "../targets";

export default defineCard({
  abilities: [
    evolveAbility(1),
    fanfare({
      cost: discardA(hasTrait("闇属性")),
      *resolve(fx) {
        yield* fx.draw(1);
      },
    }),
  ],
});
