// CP05-065 メグの親友・まりっぺ — Dragoncraft follower, 2, 2/2. グラブル・闇属性.
// 自分の闇属性・カードの能力によってこれを自分の手札から捨てたとき、『闇晶のエレメント』1枚をEXエリアに置く。1枚引く。
// ファンファーレ『闇晶のエレメント』1枚をEXエリアに置く。自分の場に『どこにでもいるフツーの女の子・メグ』がいるなら、自分のリーダーは体力+2
// する。
// (When an ability of a dark card you control (全属性 too, CR JP 14.6.2.2; the card as it was then) discards this from your hand
// — by its effect or as its cost, e.g. CP05-058's Fanfare (CR 10.4.7.4), also as the additional cost of a dark spell (CP05-083;
// decided by the project owner) — put a 闇晶のエレメント (CP05-T14) into your EX area and draw a card. Valid in the hand
// (CR 10.3.4), in either player's turn. Not a discard by the rules (the hand limit, CR 7.4.7), nor by another card's ability (an
// opponent's included). Fanfare - Put a 闇晶のエレメント into your EX area. If どこにでもいるフツーの女の子・メグ (CP05-058, evolved or
// not) is on your field, your leader gets +2 defense: the condition only covers that sentence (it comes after the first).)
import { traitMatches } from "../../model/traits";
import { defineCard, fanfare, whenDiscardedByYourCard } from "../helpers";
import { named } from "../targets";
import { DARK_ELEMENT, MEG } from "./shared";

export default defineCard({
  abilities: [
    whenDiscardedByYourCard(
      {
        *resolve(fx) {
          yield* fx.tokensToEx([DARK_ELEMENT]);
          yield* fx.draw(1);
        },
      },
      (cause) => traitMatches(cause.traits, "闇属性"),
    ),
    fanfare({
      *resolve(fx) {
        yield* fx.tokensToEx([DARK_ELEMENT]);
        if (fx.game.cards(fx.controller, "field").some((id) => named(MEG)(fx.game, id))) yield* fx.giveLeaderDefense(fx.controller, 2);
      },
    }),
  ],
});
