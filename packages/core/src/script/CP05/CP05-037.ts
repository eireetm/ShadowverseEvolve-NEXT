// CP05-037 魔弾の射手・エッセル — Runecraft follower, 3, 2/4. グラブル・十天衆・火属性.
// これを自分の手札から公開したとき、相手の場のフォロワー1体を選ぶ。それに1ダメージ。
// 【最終上限解放可能】
// これが上限解放したとき、相手の場のフォロワー1体を選ぶ。それに4ダメージ。
// これが最終上限解放したとき、自分の場の元のコスト3以下のフォロワー1体を選ぶ。それは【疾走】を持つ。
// (When this is revealed from your hand — by any card's ability, the opponent's too, in either player's turn; being played is no
// such reveal (rulings Q2893, Q2894; CR 5.21.1) — select an enemy follower on the field and deal it 1 damage.
// Final Uncap (CR JP 14.6.3). When this uncaps (CR JP 14.6.4.1), select an enemy follower on the field and deal it 4 damage. When
// this final-uncaps (CR JP 14.6.4.2), select a follower on your field whose original cost is 3 or less (CR 5.24.1; this one too)
// and give it Storm, with no end (CR 10.2.1.2). ヒヒイロカネ on it before it is uncapped does both: both trigger, in the order its
// controller chooses (Q2867, Q2868). An ability without a target to select isn't played (CR 10.6.2.3.3).)
import { defineCard, whenRevealedFromYourHand, whenThisIsFinalUncapped, whenThisIsUncapped } from "../helpers";
import { costAtMost, enemyFollower, yourFollower } from "../targets";

export default defineCard({
  keywords: ["finalUncap"],
  abilities: [
    whenRevealedFromYourHand({
      targets: [enemyFollower()],
      *resolve(fx) {
        yield* fx.dealDamage(fx.targets[0]![0]!, 1);
      },
    }),
    whenThisIsUncapped({
      targets: [enemyFollower()],
      *resolve(fx) {
        yield* fx.dealDamage(fx.targets[0]![0]!, 4);
      },
    }),
    whenThisIsFinalUncapped({
      targets: [yourFollower({ filter: costAtMost(3) })],
      *resolve(fx) {
        yield* fx.giveKeyword(fx.targets[0]![0]!, "storm");
      },
    }),
  ],
});
