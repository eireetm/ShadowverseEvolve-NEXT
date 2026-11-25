// CP05-023 揺らぎの斬姫・ナルメア — Swordcraft follower, 3, 3/3. グラブル・風属性・闇属性.
// 進化コスト1：これは進化する。
// 【必殺】
// ファンファーレ手札のグラブル・カード1枚を捨てる：『風晶のエレメント』1枚か『闇晶のエレメント』1枚をEXエリアに置く。1枚引く。
// (Evolve (1). Bane. Fanfare - You may discard a Granblue card from your hand (CR 10.4.7.4; not asked without one): put a
// 風晶のエレメント (CP05-T12) or a 闇晶のエレメント (CP05-T14) into your EX area, its controller's choice, and draw a card — both
// only if it was paid (CR 10.4.7.2). A full EX area takes no element (CR 4.8.3.2); the draw still happens (CR 1.3.2).)
import { discardA } from "../costs";
import { defineCard, evolveAbility, fanfare } from "../helpers";
import { hasTrait } from "../targets";
import { DARK_ELEMENT, WIND_ELEMENT } from "./shared";

export default defineCard({
  keywords: ["bane"],
  abilities: [
    evolveAbility(1),
    fanfare({
      cost: discardA(hasTrait("グラブル")),
      *resolve(fx) {
        const [element] = yield* fx.choose([
          { id: "wind", label: WIND_ELEMENT },
          { id: "dark", label: DARK_ELEMENT },
        ]);
        yield* fx.tokensToEx([element === "dark" ? DARK_ELEMENT : WIND_ELEMENT]);
        yield* fx.draw(1);
      },
    }),
  ],
});
