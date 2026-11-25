// CP05-038 閃耀の双剣・カトル — Runecraft follower, 3, 4/2. グラブル・十天衆・水属性.
// 【最終上限解放可能】
// これが上限解放したとき、相手の場のフォロワー1体を選ぶ。それに4ダメージ。
// これが最終上限解放したとき、相手のリーダーすべてに4ダメージ。
// Q起動コスト3手札のこれを捨てる：相手の場のフォロワー1体を選ぶ。それに4ダメージ。1枚引く。
// (Final Uncap (CR JP 14.6.3). When this uncaps (CR JP 14.6.4.1), select an enemy follower on the field and deal it 4 damage. When
// this final-uncaps (CR JP 14.6.4.2), deal 4 damage to each enemy leader. ヒヒイロカネ on it before it is uncapped does both, in
// the order its controller chooses (rulings Q2867, Q2868). {[q]} {[act]} {[cost03]}, discard this card: select an enemy follower
// on the field, deal it 4 damage and draw a card — valid in the hand (ruling Q2895, CR 10.3.5), quick (CR 12.3.3), and not
// playable without an enemy follower to select, so no draw either (Q2896, CR 10.6.2.3.3).)
import { discardThis } from "../costs";
import { activated, defineCard, whenThisIsFinalUncapped, whenThisIsUncapped } from "../helpers";
import { enemyFollower } from "../targets";

export default defineCard({
  keywords: ["finalUncap"],
  abilities: [
    whenThisIsUncapped({
      targets: [enemyFollower()],
      *resolve(fx) {
        yield* fx.dealDamage(fx.targets[0]![0]!, 4);
      },
    }),
    whenThisIsFinalUncapped({
      *resolve(fx) {
        yield* fx.dealDamage(fx.game.leader(fx.game.opponent(fx.controller)), 4);
      },
    }),
    activated(
      { playPoints: 3, custom: discardThis },
      {
        validIn: ["hand"],
        quick: true,
        targets: [enemyFollower()],
        *resolve(fx) {
          yield* fx.dealDamage(fx.targets[0]![0]!, 4);
          yield* fx.draw(1);
        },
      },
    ),
  ],
});
