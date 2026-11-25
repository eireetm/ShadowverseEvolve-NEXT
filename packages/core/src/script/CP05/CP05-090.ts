// CP05-090 魔導の申し子・フュンフ — Havencraft follower, 5, 2/3. グラブル・十天衆・光属性.
// 【最終上限解放可能】
// これが上限解放したとき、自分の手札の元のコスト5のグラブル・フォロワー1枚を場に出してよい。
// これが最終上限解放したとき、コスト2：自分のデッキの上5枚を見る。その中から、「これと同名を除く元のコスト5のグラブル・フォロワー」1枚を場
// に出してよい。残りを好きな順にデッキの下に置く。
// (Final Uncap (CR JP 14.6.3). When this uncaps (CR JP 14.6.4.1): you may put a Granblue follower whose original cost is 5
// (CR 5.24.1) from your hand onto your field — put, not played (CR 5.5.1; its Fanfare triggers, CR 12.4.3), and another one
// of this name may be it: only the second sentence leaves this name out. When this final-uncaps (CR JP 14.6.4.2),
// {[cost02]} (asked as it resolves; unpaid, nothing happens: CR 10.4.7.4): look at the top 5 cards of your deck, you may put
// such a follower without this card's name among them onto your field, the rest on the bottom in any order. ヒヒイロカネ
// does both at once: both trigger, in the order its controller chooses (rulings Q2867, Q2868).)
import type { CardId } from "../../model/ids";
import type { EffectContext } from "../../engine/effects/context";
import { playPointsCost } from "../costs";
import { defineCard, lookAtTopCards, whenThisIsFinalUncapped, whenThisIsUncapped } from "../helpers";
import { granblueCost5 } from "./shared";

/** This card's names: those it has now, or its printed one if it has left the field before this resolves (CR 2.1). */
function namesOfThis(fx: EffectContext): readonly string[] {
  return fx.game.card(fx.self) ? fx.game.info(fx.self).names : [fx.game.db.get(fx.sourceDef).name];
}

export default defineCard({
  keywords: ["finalUncap"],
  abilities: [
    whenThisIsUncapped({
      *resolve(fx) {
        const g = fx.game;
        const chosen = yield* fx.chooseCards(g.cards(fx.controller, "hand").filter((id) => granblueCost5(g, id)), 0, 1);
        if (chosen.length > 0) yield* fx.putOntoField(chosen);
      },
    }),
    whenThisIsFinalUncapped({
      cost: playPointsCost(2),
      *resolve(fx) {
        const mine = namesOfThis(fx);
        const other = (id: CardId) => !fx.game.info(id).names.some((n) => mine.includes(n));
        yield* lookAtTopCards(fx, 5, { filter: (g, id) => granblueCost5(g, id) && other(id), to: "field" });
      },
    }),
  ],
});
