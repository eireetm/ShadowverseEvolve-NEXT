// CP05-007 奮励の儁秀・シルヴァ — Forestcraft follower, 7, 5/5. グラブル・水属性.
// 【疾走】
// これが上限解放したとき、自分の墓場のQ起動能力を持つフォロワーを元のコストの合計が6以下になるように2枚まで選ぶ。それを場に出す。
// Q起動コスト2手札のこれを捨てる：相手の場のフォロワー1体を選ぶ。それに4ダメージ。
// (Storm. When this is uncapped, select up to 2 followers with a quick activated ability in your cemetery whose original costs
// total 6 or less and put them onto your field — one printed on the card counts wherever it works (one valid only in the hand
// too), CR 12.3.3; selected one at a time, each time only among those that still fit (CR 5.24.1); with room for fewer, its
// controller chooses which, CR 4.4.4.2; their Fanfares trigger, CR 12.4.3. Quick activate (2), discard this card from your
// hand: select an enemy follower on the field and deal it 4 damage — valid in the hand, ruling Q2874, CR 10.3.5.)
import { discardThis } from "../costs";
import { activated, defineCard, selectWithinTotalCost, whenThisIsUncapped } from "../helpers";
import { enemyFollower, isQuickActivatedFollower } from "../targets";

export default defineCard({
  keywords: ["storm"],
  abilities: [
    whenThisIsUncapped({
      *resolve(fx) {
        const candidates = fx.game.cards(fx.controller, "cemetery").filter((id) => isQuickActivatedFollower(fx.game, id));
        yield* fx.putOntoField(yield* selectWithinTotalCost(fx, candidates, 6, 2));
      },
    }),
    activated(
      { playPoints: 2, custom: discardThis },
      {
        quick: true,
        validIn: ["hand"],
        targets: [enemyFollower()],
        *resolve(fx) {
          yield* fx.dealDamage(fx.targets[0]![0]!, 4);
        },
      },
    ),
  ],
});
