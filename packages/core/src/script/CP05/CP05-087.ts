// CP05-087 エーヴィヒ・カメラート — Abysscraft spell, 1. グラブル・闇属性.
// クイック
// 手札の闇属性・カード1枚を捨てる：『闇晶のエレメント』2枚をEXエリアに置く。1枚引く。
// (Quick (CR 12.3.2). Discard a dark (or 全属性, CR JP 14.6.2.2) card from your hand: put 2 闇晶のエレメント into your EX area (only as many
// as it has room for, CR 4.8.3.2) and draw a card — both only if the process was executed, everything up to the end of the paragraph
// (CR 10.4.7.2). The process is asked when the spell resolves (CR 10.4.7.5), so the spell can be played without a dark card in hand,
// and then does nothing (as BP06-017's ruling). The discard is this dark card's ability's.)
import { discardA } from "../costs";
import { defineCard, spell } from "../helpers";
import { darkCard } from "./abyss-shared";
import { DARK_ELEMENT } from "./shared";

export default defineCard({
  keywords: ["quick"],
  abilities: [
    spell({
      *resolve(fx) {
        if (!(yield* fx.optionalCost(discardA(darkCard)))) return;
        yield* fx.tokensToEx([DARK_ELEMENT, DARK_ELEMENT]);
        yield* fx.draw(1);
      },
    }),
  ],
});
