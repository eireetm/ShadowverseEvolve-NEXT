// CP05-044 コロッサス・マグナ — Runecraft amulet, 1. グラブル・火属性.
// ファンファーレ手札の火属性・カード3枚を公開：相手の場のフォロワー1体を選ぶ。それに2ダメージ。
// 起動コスト1これをアクト手札の火属性・カード1枚を公開：相手の場のフォロワー1体を選ぶ。それに1ダメージ。
// (Fanfare - Reveal 3 fire cards from your hand (全属性 ones too, CR JP 14.6.2.2): select an enemy follower on the field and deal
// it 2 damage — a process its controller may perform when it resolves (CR 10.4.7.4), asked only when there is a follower to
// select: without one it isn't played and nothing is revealed (CR 10.6.2.3.3; CP05-057's ruling Q2907). {[act]} {[cost01]}
// {[engage]}, reveal a fire card from your hand: select an enemy follower on the field and deal it 1 damage (the engage cost may
// be paid in the turn it came, CR 10.4.6.1). A revealed card's "when this is revealed from your hand" triggers, each time
// (CP05-037, 048; CR 10.7.2.1).)
import { revealFromHand } from "../costs";
import { activated, defineCard, fanfare } from "../helpers";
import { enemyFollower, hasTrait } from "../targets";

export default defineCard({
  abilities: [
    fanfare({
      cost: revealFromHand(hasTrait("火属性"), 3),
      targets: [enemyFollower()],
      *resolve(fx) {
        yield* fx.dealDamage(fx.targets[0]![0]!, 2);
      },
    }),
    activated(
      { playPoints: 1, engageSelf: true, custom: revealFromHand(hasTrait("火属性"), 1) },
      {
        targets: [enemyFollower()],
        *resolve(fx) {
          yield* fx.dealDamage(fx.targets[0]![0]!, 1);
        },
      },
    ),
  ],
});
