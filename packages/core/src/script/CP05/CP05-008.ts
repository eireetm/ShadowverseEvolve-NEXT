// CP05-008 虹色の弓使い・クピタン — Forestcraft follower, 2, 0/4. グラブル・水属性.
// ファンファーレ『水晶のエレメント』1枚をEXエリアに置く。
// Q起動これをアクト：相手の場のフォロワー1体を選ぶ。それに1ダメージ。自分の墓場のQ起動能力を持つフォロワーが7枚以上なら、代わりに
// 7ダメージ。それのリーダーに2ダメージ。
// (Fanfare - Put a 水晶のエレメント into your EX area. Quick activate, engage this: select an enemy follower on the field and
// deal it 1 damage; if there are at least 7 followers with a quick activated ability in your cemetery, deal it 7 damage instead
// and 2 damage to its leader — the sentence after 「…なら、X。」 is under the condition too unless it opens one of its own
// (the project's reading, confirmed by its owner; the set's ruling Q2912 on CP05-070 and BP21-042's official English say the
// same of the same shape); counted as it resolves. Without an enemy follower to select it can't be played, so no leader
// damage either — ruling Q2875, CR 10.6.2.3.3. Engaging it is possible on the turn it entered, CR 10.4.6.1.)
import { activated, defineCard, fanfare } from "../helpers";
import { enemyFollower } from "../targets";
import { WATER_ELEMENT, quickFollowersInCemetery } from "./shared";

export default defineCard({
  abilities: [
    fanfare({
      *resolve(fx) {
        yield* fx.tokensToEx([WATER_ELEMENT]);
      },
    }),
    activated(
      { engageSelf: true },
      {
        quick: true,
        targets: [enemyFollower()],
        *resolve(fx) {
          const target = fx.targets[0]![0]!;
          if (quickFollowersInCemetery(fx.game, fx.controller) < 7) {
            yield* fx.dealDamage(target, 1);
            return;
          }
          const leader = fx.game.leader(fx.game.controller(target));
          yield* fx.dealDamage(target, 7);
          yield* fx.dealDamage(leader, 2);
        },
      },
    ),
  ],
});
