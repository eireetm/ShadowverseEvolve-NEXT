// CP05-103 英雄幻視・トルー — Havencraft follower, 2, 1/3. グラブル・水属性.
// 【守護】
// ファンファーレ『水晶のエレメント』1枚をEXエリアに置く。1枚引く。
// Q起動これをアクト：『水晶のエレメント』1枚をEXエリアに置く。
// (Ward. Fanfare - Put a 水晶のエレメント into your EX area and draw a card. {[q]} {[act]} {[engage]}: put a 水晶のエレメント into
// your EX area — also at Quick timing (CR 12.3.3); it can engage the turn it came in (CR 10.4.6.1), not when already engaged
// (CR 10.4.6).)
import { activated, defineCard, fanfare } from "../helpers";
import { WATER_ELEMENT } from "./shared";

export default defineCard({
  keywords: ["ward"],
  abilities: [
    fanfare({
      *resolve(fx) {
        yield* fx.tokensToEx([WATER_ELEMENT]);
        yield* fx.draw(1);
      },
    }),
    activated(
      { engageSelf: true },
      {
        quick: true,
        *resolve(fx) {
          yield* fx.tokensToEx([WATER_ELEMENT]);
        },
      },
    ),
  ],
});
