// CP05-055 大いなる調停者・ゾーイ — Dragoncraft follower, 5, 5/5. グラブル・光属性.
// 【最終上限解放可能】
// これが上限解放したとき、相手の場のフォロワー1体を選ぶ。それに5ダメージ。自分のPP最大値を+1する。
// これが最終上限解放したとき、コスト1：自分の場の他の元のコスト5のグラブル・フォロワーすべては攻撃力+2/体力+2する。
// (Final Uncap (CR JP 14.6.3). When this uncaps (CR JP 14.6.4.1), select an enemy follower on the field and deal it 5 damage, and
// you get +1 max play points (at most 10, CR 3.2.4.1). Without an enemy follower to select it can't be played at all, so no max
// play point either (ruling Q2905; CR 10.6.2.3.3). When this final-uncaps (CR JP 14.6.4.2), {[cost01]}: each other Granblue
// follower on your field whose original cost is 5 gets +2/+2 — the printed cost (CR 5.24.1), an evolved follower's being its
// base card's (CR 5.16.1.2) — for as long as it stays there (no duration, CR 10.2.1.2). The cost is optional (CR 10.4.7.4); the
// followers are those on the field as it resolves. ヒヒイロカネ doing both makes both trigger, in the order you choose (rulings
// Q2867, Q2868). The U07 printing (世界の味方・ゾーイ) is this card.)
import { playPointsCost } from "../costs";
import { defineCard, whenThisIsFinalUncapped, whenThisIsUncapped } from "../helpers";
import { enemyFollower } from "../targets";
import { granblueCost5 } from "./shared";

export default defineCard({
  keywords: ["finalUncap"],
  abilities: [
    whenThisIsUncapped({
      targets: [enemyFollower()],
      *resolve(fx) {
        yield* fx.dealDamage(fx.targets[0]![0]!, 5);
        yield* fx.increaseMaxPlayPoints(1);
      },
    }),
    whenThisIsFinalUncapped({
      cost: playPointsCost(1),
      *resolve(fx) {
        for (const id of fx.game.followers(fx.controller)) {
          if (id !== fx.self && granblueCost5(fx.game, id)) yield* fx.giveStats(id, 2, 2);
        }
      },
    }),
  ],
});
