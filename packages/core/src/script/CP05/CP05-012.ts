// CP05-012 美粧の乙女・クロエ — Forestcraft follower, 1, 1/1. グラブル・闇属性.
// ファンファーレ手札の闇属性・カード1枚を捨てる：1枚引く。
// 起動これをアクト：自分の墓場の闇属性・カード1枚を選ぶ。それをデッキの下に置く。
// (Fanfare, discard a dark card from your hand: draw a card — a 全属性 card is a dark card, CR JP 14.6.2.2; the controller may
// decline, CR 10.4.7.4. Activate, engage this: select a dark card in your cemetery and put it on the bottom of your deck — not
// quick (no Q on the card), so only in your main phase, CR 12.3.3; not without one to select, CR 10.6.2.3.3.)
import { discardA } from "../costs";
import { activated, defineCard, fanfare } from "../helpers";
import { hasTrait, inYourZone } from "../targets";

const dark = hasTrait("闇属性");

export default defineCard({
  abilities: [
    fanfare({
      cost: discardA(dark),
      *resolve(fx) {
        yield* fx.draw(1);
      },
    }),
    activated(
      { engageSelf: true },
      {
        targets: [inYourZone("cemetery", { filter: dark })],
        *resolve(fx) {
          yield* fx.putOnDeck(fx.targets[0]!, "bottom");
        },
      },
    ),
  ],
});
