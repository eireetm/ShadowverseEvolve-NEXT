// CP05-051 炎獄の葬送者・エルモート — Runecraft follower, 2, 2/2. グラブル・火属性.
// これが上限解放したとき、相手のリーダーすべてに1ダメージ。
// ファンファーレ手札の火属性・カード3枚を公開：相手の場のフォロワー1体を選ぶ。それに3ダメージ。
// (When this uncaps (CR JP 14.6.4.1), deal 1 damage to each enemy leader. It has no Final Uncap. Fanfare - Reveal 3 fire cards from
// your hand (全属性 ones too, CR JP 14.6.2.2): select an enemy follower on the field and deal it 3 damage — a process its
// controller may perform when it resolves (CR 10.4.7.4), asked only when there is a follower to select (CR 10.6.2.3.3; CP05-057's
// ruling Q2907). A revealed card's "when this is revealed from your hand" triggers (CP05-037, 048).)
import { revealFromHand } from "../costs";
import { defineCard, fanfare, whenThisIsUncapped } from "../helpers";
import { enemyFollower, hasTrait } from "../targets";

export default defineCard({
  abilities: [
    whenThisIsUncapped({
      *resolve(fx) {
        yield* fx.dealDamage(fx.game.leader(fx.game.opponent(fx.controller)), 1);
      },
    }),
    fanfare({
      cost: revealFromHand(hasTrait("火属性"), 3),
      targets: [enemyFollower()],
      *resolve(fx) {
        yield* fx.dealDamage(fx.targets[0]![0]!, 3);
      },
    }),
  ],
});
