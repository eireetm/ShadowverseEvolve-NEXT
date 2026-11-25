// CP05-061 ティアマト・マグナ — Dragoncraft amulet, 1. グラブル・風属性.
// ファンファーレ『風晶のエレメント』2枚をEXエリアに置く。
// 起動これをアクト墓場に置く：自分のデッキの上1枚を見る。その中から、風属性・カード1枚を公開して手札に加えてよい。この能力はこのターン、
// 自分の場のフォロワーが上限解放や最終上限解放を合わせて3回以上していたなら使える。
// (Fanfare - Put 2 風晶のエレメント (CP05-T12) into your EX area (as many as fit, CR 4.8.3.2). {[act]} {[engage]}, bury this card
// (in that order, CR 10.4.2.1; also the turn it came, CR 10.4.6.1): look at the top card of your deck (CR 5.11.1); you may reveal
// a wind card (全属性 too, CR JP 14.6.2.2) from among it and put it into your hand — one not taken stays on top, unrevealed.
// Activate only if followers on your field uncapped and final-uncapped at least 3 times in all this turn (CR JP 14.6.4.1,
// JP 14.6.4.2): ヒヒイロカネ doing both counts 2 (ruling Q2909), and a follower that left since still counts (it did uncap).)
import { activated, defineCard, fanfare } from "../helpers";
import { hasTrait } from "../targets";
import { WIND_ELEMENT } from "./shared";
import { lookAtTopMayTake } from "./dragon-shared";

export default defineCard({
  abilities: [
    fanfare({
      *resolve(fx) {
        yield* fx.tokensToEx([WIND_ELEMENT, WIND_ELEMENT]);
      },
    }),
    activated(
      { engageSelf: true, burySelf: true },
      {
        condition: (g, c) => g.uncapsThisTurn(c) >= 3,
        *resolve(fx) {
          yield* lookAtTopMayTake(fx, hasTrait("風属性"));
        },
      },
    ),
  ],
});
