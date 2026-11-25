// CP05-070 オンリー･ワン･ウィッシュ — Dragoncraft spell, 2. グラブル・光属性.
// 自分のデッキの上1枚を公開する。光属性・カードを公開したなら、『光晶のエレメント』1枚をEXエリアに置く。自分のPP最大値を+1する。自分の
// PP最大値が10なら、自分のデッキから『大いなる調停者・ゾーイ』1枚を探し、手札に加える。
// (Reveal the top card of your deck; it stays there (CR 5.21.1). If you revealed a light card (全属性 too, CR JP 14.6.2.2), put a
// 光晶のエレメント (CP05-T13) into your EX area and get +1 max play points — the condition covers both (ruling Q2912). Then, if
// your max play points are 10 (the most, CR 3.2.4.1), search your deck for a 大いなる調停者・ゾーイ (CP05-055; its U07 printing is
// that card) and put it into your hand, revealed (CR 5.8.1.2), the deck then shuffled (CR 5.8.2): a condition of its own,
// whatever was revealed (ruling Q2913). A search with a condition may find nothing (CR 4.1.2.2); an empty deck reveals no light
// card.)
import { defineCard, spell } from "../helpers";
import { hasTrait, named } from "../targets";
import { LIGHT_ELEMENT, ZOOEY } from "./shared";

export default defineCard({
  abilities: [
    spell({
      *resolve(fx) {
        const top = fx.topCards(1);
        if (top.length > 0) yield* fx.reveal(top);
        if (top.some((id) => hasTrait("光属性")(fx.game, id))) {
          yield* fx.tokensToEx([LIGHT_ELEMENT]);
          yield* fx.increaseMaxPlayPoints(1);
        }
        if (fx.game.state.players[fx.controller].maxPlayPoints === 10) yield* fx.search((id) => named(ZOOEY)(fx.game, id), { max: 1 });
      },
    }),
  ],
});
