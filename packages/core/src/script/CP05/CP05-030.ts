// CP05-030 氷心の覇王・アグロヴァル — Swordcraft follower, 6, 5/5. グラブル・水属性.
// ファンファーレ相手の場のフォロワーすべてに「自分の墓場のQ起動能力を持つフォロワーの枚数」と同じダメージ。
// Q起動コスト3手札のこれを捨てる：相手の場のフォロワー1体を選ぶ。それを破壊する。
// (Fanfare - Deal X damage to each enemy follower on the field, together (CR 5.14), X = the followers with a quick activated ability
// in your cemetery when it resolves: printed on the card, wherever that ability works (one valid in the hand counts), Quick
// alone doesn't; none deals no damage (CR 1.3.2.2); not a selection, so Aura doesn't stop it. {[q]} Act {[cost03]}, discard this
// from your hand: select an enemy follower on the field and destroy it — valid in the hand (ruling Q2887, CR 10.3.5), also at
// Quick timing (CR 12.3.3); the target is selected before the cost is paid (CR 10.6.2.3, 10.6.2.5).)
import { discardThis } from "../costs";
import { activated, defineCard, fanfare } from "../helpers";
import { enemyFollower } from "../targets";
import { quickFollowersInCemetery } from "./shared";

export default defineCard({
  abilities: [
    fanfare({
      *resolve(fx) {
        const x = quickFollowersInCemetery(fx.game, fx.controller);
        if (x > 0) yield* fx.dealDamageEach(fx.game.followers(fx.game.opponent(fx.controller)), x);
      },
    }),
    activated(
      { playPoints: 3, custom: discardThis },
      {
        validIn: ["hand"],
        quick: true,
        targets: [enemyFollower()],
        *resolve(fx) {
          yield* fx.destroy(fx.targets[0]!);
        },
      },
    ),
  ],
});
