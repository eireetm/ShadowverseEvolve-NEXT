// CP05-071 アルバコア — Dragoncraft amulet, 4. グラブル・闇属性.
// ファンファーレ相手の場のカード1枚を選ぶ。それを破壊する。
// 起動これをアクト墓場に置く：『闇晶のエレメント』1枚をEXエリアに置く。1枚引く。この能力はこのターン、自分の手札の闇属性・カードを
// 捨てていたなら使える。
// (Fanfare - Select an enemy card on the field (a follower or an amulet) and destroy it; without one it can't be played. {[act]}
// {[engage]}, bury this card (in that order, CR 10.4.2.1; also the turn it came, CR 10.4.6.1): put a 闇晶のエレメント (CP05-T14)
// into your EX area; draw a card. Activate only if you discarded a dark card (全属性 too, CR JP 14.6.2.2) from your hand this
// turn — any discard from it is yours (CR 5.12.1), by any card's ability or as a cost (the set's ruling Q2916), as the card was in
// the hand.)
import { traitMatches } from "../../model/traits";
import { activated, defineCard, fanfare } from "../helpers";
import { enemyCardOnField } from "../targets";
import { DARK_ELEMENT } from "./shared";

export default defineCard({
  abilities: [
    fanfare({
      targets: [enemyCardOnField()],
      *resolve(fx) {
        yield* fx.destroy(fx.targets[0] ?? []);
      },
    }),
    activated(
      { engageSelf: true, burySelf: true },
      {
        condition: (g, c) => g.discardedCardsThisTurn(c).some((card) => traitMatches(card.traits, "闇属性")),
        *resolve(fx) {
          yield* fx.tokensToEx([DARK_ELEMENT]);
          yield* fx.draw(1);
        },
      },
    ),
  ],
});
