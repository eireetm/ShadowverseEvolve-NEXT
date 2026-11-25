// CP05-002 調和の舞手・ユエル＆ソシエ — Forestcraft follower, 3, 3/3. グラブル・火属性・水属性.
// ファンファーレ手札の火属性・カード3枚を公開：相手の場のフォロワー1体を選ぶ。それに3ダメージ。それのリーダーに3ダメージ。
// Q起動コスト1手札のこれを捨てる：相手の場のフォロワー1体を選ぶ。それに4ダメージ。この能力はこのターン、自分が他のQ起動能力をプレイして
// いたなら使える。
// (Fanfare, reveal 3 fire cards from your hand: select an enemy follower on the field, deal it 3 damage and 3 damage to its
// leader — a 全属性 card is a fire card, CR JP 14.6.2.2; the controller may decline the reveal, CR 10.4.7.4, and without an
// enemy follower to select it can't be played, so its leader takes nothing either — ruling Q2870, CR 10.6.2.3.3.
// Quick activate (1), discard this card from your hand: select an enemy follower on the field and deal it 4 damage; only if you
// played another quick activated ability this turn — valid in the hand, ruling Q2869, CR 10.3.5, 12.3.3. Any one of yours
// counts, from any zone and in either player's turn: this one discards itself, so it can never be its own first.)
import { discardThis, revealFromHand } from "../costs";
import { activated, defineCard, fanfare } from "../helpers";
import { enemyFollower, hasTrait } from "../targets";

export default defineCard({
  abilities: [
    fanfare({
      cost: revealFromHand(hasTrait("火属性"), 3),
      targets: [enemyFollower()],
      *resolve(fx) {
        const target = fx.targets[0]![0]!;
        const leader = fx.game.leader(fx.game.controller(target));
        yield* fx.dealDamage(target, 3);
        yield* fx.dealDamage(leader, 3);
      },
    }),
    activated(
      { playPoints: 1, custom: discardThis },
      {
        quick: true,
        validIn: ["hand"],
        condition: (g, p) => g.quickActivationsThisTurn(p) >= 1,
        targets: [enemyFollower()],
        *resolve(fx) {
          yield* fx.dealDamage(fx.targets[0]![0]!, 4);
        },
      },
    ),
  ],
});
