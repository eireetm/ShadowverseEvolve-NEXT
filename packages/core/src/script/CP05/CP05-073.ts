// CP05-073 繊細の魔奏者・ニオ — Abysscraft follower, 1, 1/1. グラブル・十天衆・風属性.
// 【最終上限解放可能】
// これが上限解放したとき、相手の場のフォロワー1体を選ぶ。それは攻撃力-1/体力-1する。
// これが最終上限解放したとき、相手の場のフォロワー1体を選ぶ。それは攻撃力-2/体力-2する。
// (Final Uncap (CR JP 14.6.3). When this uncaps (CR JP 14.6.4.1), select an enemy follower on the field: it gets -1/-1; when this
// final-uncaps (CR JP 14.6.4.2), one gets -2/-2 (CR 5.27.1) — with no duration, for as long as it stays on the field
// (CR 10.2.1.2, 10.9.2). Without an enemy follower nothing is played (CR 10.6.2.3.3, 10.7.3.2). ヒヒイロカネ does both: both trigger, in any order, each selecting when it is played (rulings Q2867, Q2868;
// CR 10.6.2.3).
// It is a wind (風属性) follower: the dark element can't select it.)
import { defineCard, whenThisIsFinalUncapped, whenThisIsUncapped } from "../helpers";
import { enemyFollower } from "../targets";

export default defineCard({
  keywords: ["finalUncap"],
  abilities: [
    whenThisIsUncapped({
      targets: [enemyFollower()],
      *resolve(fx) {
        yield* fx.giveStats(fx.targets[0]![0]!, -1, -1);
      },
    }),
    whenThisIsFinalUncapped({
      targets: [enemyFollower()],
      *resolve(fx) {
        yield* fx.giveStats(fx.targets[0]![0]!, -2, -2);
      },
    }),
  ],
});
