// CP05-064 護国真龍・スカーサハ — Dragoncraft follower, 4, 3/3. グラブル・風属性.
// これをプレイする際、コストを-Xする。Xは「このターン中に自分の場のフォロワーが上限解放や最終上限解放をした回数」である。
// ファンファーレ『風晶のエレメント』1枚をEXエリアに置く。1枚引く。
// (This costs X less to play, X being the times followers on your field uncapped and final-uncapped this turn (CR JP 14.6.4.1,
// JP 14.6.4.2) as its cost is determined (CR 10.6.2.5): ヒヒイロカネ doing both counts 2 (ruling Q2910), and a follower that left
// since still counts. Not below 0 (CR 1.3.2.2.1). Fanfare - Put a 風晶のエレメント (CP05-T12) into your EX area. Draw a card.)
import { defineCard, fanfare } from "../helpers";
import { WIND_ELEMENT } from "./shared";

export default defineCard({
  playCost: (g, _self, controller) => -g.uncapsThisTurn(controller),
  abilities: [
    fanfare({
      *resolve(fx) {
        yield* fx.tokensToEx([WIND_ELEMENT]);
        yield* fx.draw(1);
      },
    }),
  ],
});
