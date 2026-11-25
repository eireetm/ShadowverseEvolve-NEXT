// CP05-079 セレスト・マグナ — Abysscraft amulet, 1. グラブル・闇属性.
// ターンごとに1回、自分が手札の闇属性・カードを捨てたとき、相手の場のフォロワー1体を選ぶ。それに1ダメージ。
// 起動これをアクト手札の闇属性・カード1枚を捨てる：自分のデッキの上1枚を見る。それをデッキの下に置いてよい。
// (Once per turn — in either player's turn: not "on each of your turns" (ruling Q2914) — when you discard a dark
// (or 全属性, CR JP 14.6.2.2) card from your hand, select an enemy follower on the field and deal it 1 damage. It becomes pending at
// most once a turn (CR 10.7.2.2): 2 cards discarded together trigger it once, and an instance that can't be played for want of a
// target uses that once up (CR 10.6.2.3.3, 10.7.3.2). Activate - Engage this, discard a dark card (in that order, CR 10.4.2.1): look
// at the top card of your deck; you may put it on the bottom — kept, it stays on top unrevealed (CR 5.11). Its own discard triggers
// the first ability.)
import { discardA } from "../costs";
import { activated, defineCard, whenYouDiscard } from "../helpers";
import { enemyFollower } from "../targets";
import { darkCard } from "./abyss-shared";

export default defineCard({
  abilities: [
    whenYouDiscard(
      {
        oncePerTurn: true,
        targets: [enemyFollower()],
        *resolve(fx) {
          yield* fx.dealDamage(fx.targets[0]![0]!, 1);
        },
      },
      darkCard,
    ),
    activated(
      { engageSelf: true, custom: discardA(darkCard) },
      {
        *resolve(fx) {
          const [top] = fx.topCards(1);
          if (top !== undefined) {
            yield* fx.lookAt([top]);
            if (yield* fx.confirm()) yield* fx.putOnDeck([top], "bottom");
          }
        },
      },
    ),
  ],
});
