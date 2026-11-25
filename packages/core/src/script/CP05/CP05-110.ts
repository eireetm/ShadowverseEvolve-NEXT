// CP05-110 蒼の少女・ルリア — Neutral follower, 1, 1/1. グラブル・全属性.
// 【最終上限解放可能】
// ファンファーレ自分のデッキの上3枚を見る。その中から、グラブル・カード1枚を公開して手札に加えてよい。残りを好きな順にデッキの下に置く。
// (Final Uncap (CR JP 14.6.3): no effect of its own (CR JP 14.6.3.2); a treasure may final-uncap her (CR JP 14.6.4.2). Being
// 全属性, every element can uncap her and then final-uncap her (CR JP 14.6.2.2); ヒヒイロカネ does both at once, which counts as
// 2 uncaps this turn (rulings Q2873, Q2880 on other cards). Fanfare - Look at the top 3 cards of your deck (CR 5.11); you may
// reveal a Granblue card among them (CR 5.21) and add it to your hand; put the rest on the bottom of your deck in any order.)
import { defineCard, fanfare, lookAtTopCards } from "../helpers";
import { hasTrait } from "../targets";

export default defineCard({
  keywords: ["finalUncap"],
  abilities: [
    fanfare({
      *resolve(fx) {
        yield* lookAtTopCards(fx, 3, { filter: hasTrait("グラブル"), to: "hand" });
      },
    }),
  ],
});
