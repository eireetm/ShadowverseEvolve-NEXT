// CP05-T08 アルス・マグナ — Runecraft spell token, 1. グラブル・土属性・光属性・闇属性.
// 相手の場のフォロワー1体を選ぶ。それとそれのリーダーに2ダメージ。自分のリーダーは体力+2する。
// (Select an enemy follower on the field; deal 2 damage to it and to its leader at once, then give your leader {[defense]}+2. It
// can't be played without an enemy follower to select, so none of it happens (ruling Q2929, CR 10.6.2.3.3). CP05-041 puts it
// into the EX area, where it is played from (CR 8.2.1); afterwards it goes to the cemetery and is removed (CR 9.1.4.4).)
import { defineCard, spell } from "../helpers";
import { enemyFollower } from "../targets";

export default defineCard({
  abilities: [
    spell({
      targets: [enemyFollower()],
      *resolve(fx) {
        const follower = fx.targets[0]![0]!;
        yield* fx.dealDamageEach([follower, fx.game.leader(fx.game.controller(follower))], 2);
        yield* fx.giveLeaderDefense(fx.controller, 2);
      },
    }),
  ],
});
