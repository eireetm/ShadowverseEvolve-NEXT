// CP05-001 魔眼の狩人・ソーン — Forestcraft follower, 5, 3/3. グラブル・十天衆・光属性.
// これをプレイする際、場の元のコスト5のグラブル・フォロワー2体をアクト：コストを-5する。
// 【最終上限解放可能】
// これが上限解放したとき、2枚引く。自分の手札1枚を捨てる。
// これが最終上限解放したとき、これは【疾走】を持つ。
// (When playing this, engage 2 Granblue followers with an original cost of 5 on your field: this costs 5 less — a way to play
// it, CR 10.4.7.3; reserved ones on your own field, CR 10.4.3, 10.4.6; this card is in the resolution zone then, not among
// them, CR 10.6.2.1; an evolved one has its base card's cost, CR 5.24.1, 5.16.1.2. Final Uncap, CR JP 14.6.3.1. When this is
// uncapped, draw 2 cards, then discard a card (not "may"). When this is final-uncapped, it gains Storm — for as long as it
// stays on the field, CR 10.2.1.2, 4.1.4. ヒヒイロカネ on it before it was uncapped does both: both trigger, in either order —
// rulings Q2867, Q2868; an element on it once uncapped final-uncaps it instead, so only the second triggers, CR 10.2.1.3.1.)
import { engageYourCards } from "../costs";
import { defineCard, whenThisIsFinalUncapped, whenThisIsUncapped } from "../helpers";
import { granblueCost5 } from "./shared";

export default defineCard({
  keywords: ["finalUncap"],
  playOptions: [
    {
      id: "engage",
      label: "Engage 2 Granblue followers with an original cost of 5 on your field: costs 5 less",
      ...engageYourCards(granblueCost5, 2),
      costDelta: -5,
    },
  ],
  abilities: [
    whenThisIsUncapped({
      *resolve(fx) {
        yield* fx.draw(2);
        yield* fx.discard(fx.controller, 1, 1);
      },
    }),
    whenThisIsFinalUncapped({
      *resolve(fx) {
        if (fx.game.card(fx.self)?.zone === "field") yield* fx.giveKeyword(fx.self, "storm");
      },
    }),
  ],
});
