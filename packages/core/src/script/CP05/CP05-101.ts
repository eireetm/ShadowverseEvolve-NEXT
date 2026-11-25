// CP05-101 星跡の巡礼者・ソフィア — Havencraft follower, 4, 3/3. グラブル・水属性.
// 進化コスト1：これは進化する。
// 【守護】
// ファンファーレ『水晶のエレメント』1枚をEXエリアに置く。
// Q起動コスト3手札のこれを捨てる：2枚引く。
// (Evolve (1). Ward. Fanfare - Put a 水晶のエレメント into your EX area. {[q]} {[act]} {[cost03]}, discard this from your hand: draw
// 2 cards — valid in the hand (ruling Q2920, CR 10.3.5), also at Quick timing (CR 12.3.3); discarding it as the cost is
// discarding (CR 5.12.1).)
import { discardThis } from "../costs";
import { activated, defineCard, evolveAbility, fanfare } from "../helpers";
import { WATER_ELEMENT } from "./shared";

export default defineCard({
  keywords: ["ward"],
  abilities: [
    evolveAbility(1),
    fanfare({
      *resolve(fx) {
        yield* fx.tokensToEx([WATER_ELEMENT]);
      },
    }),
    activated(
      { playPoints: 3, custom: discardThis },
      {
        quick: true,
        validIn: ["hand"],
        *resolve(fx) {
          yield* fx.draw(2);
        },
      },
    ),
  ],
});
