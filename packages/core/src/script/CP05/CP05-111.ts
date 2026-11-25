// CP05-111 蒼天の守護騎士・カタリナ — Neutral follower, 3, 2/3. グラブル・水属性.
// 【守護】
// ファンファーレ自分のデッキから元のコスト1のQ起動能力を持つフォロワー1枚を探し、場に出す。『水晶のエレメント』1枚をEXエリアに置く。
// Q起動コスト1手札のこれを捨てる：『水晶のエレメント』1枚をEXエリアに置く。1枚引く。
// (Ward. Fanfare - Search your deck for a follower with an original cost of exactly 1 (its printed cost, CR 5.24.1) that has a
// quick activated ability (CR 12.3.3; one printed on it, wherever it works, as for every "Q起動能力を持つフォロワー" of CP05),
// reveal it (CR 5.8.1.2) and put it onto your field. It need not be found (CR 4.1.2.2) and doesn't go onto a full field
// (CR 4.4.4.2); a 水晶のエレメント goes into your EX area either way. {[q]} {[act]} {[cost01]}, discard this card from your hand:
// put a 水晶のエレメント into your EX area and draw a card — valid in the hand (ruling Q2926, CR 10.3.5), in the opponent's turn
// too (CR 12.3.3); the draw happens with a full EX area as well (CR 1.3.2).)
import { discardThis } from "../costs";
import { activated, defineCard, fanfare } from "../helpers";
import { isQuickActivatedFollower } from "../targets";
import { WATER_ELEMENT } from "./shared";

export default defineCard({
  keywords: ["ward"],
  abilities: [
    fanfare({
      *resolve(fx) {
        yield* fx.search((id) => isQuickActivatedFollower(fx.game, id) && fx.game.info(id).cost === 1, { to: "field" });
        yield* fx.tokensToEx([WATER_ELEMENT]);
      },
    }),
    activated(
      { playPoints: 1, custom: discardThis },
      {
        quick: true,
        validIn: ["hand"],
        *resolve(fx) {
          yield* fx.tokensToEx([WATER_ELEMENT]);
          yield* fx.draw(1);
        },
      },
    ),
  ],
});
