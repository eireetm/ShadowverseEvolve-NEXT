// CP05-039 水の理・ワムデュス — Runecraft follower, 3, 1/3. グラブル・六竜・水属性.
// 進化コスト1：これは進化する。
// ファンファーレ自分のデッキの上3枚を見る。その中から、クイックを持つスペルやQ起動能力を持つフォロワー2枚まで公開して手札に加えてよい。残りを
// 墓場に置く。
// Q起動コスト1手札のこれを捨てる：相手の場のフォロワー1体を選ぶ。それに2ダメージ。
// (Evolve {[cost01]}. Fanfare - Look at the top 3 cards of your deck; you may reveal up to 2 spells with Quick and followers with a
// quick activated ability among them, in all, and add them to your hand; put the rest into your cemetery (CR 5.11, 5.21, 5.34). In
// the deck a spell with Quick is one with Quick printed alone: "has Quick while ..." works only where the card can be played (CR
// 12.3.6); a follower with a quick activated ability has one printed (CR 12.3.3), one valid only in the hand too. {[q]} {[act]}
// {[cost01]}, discard this card: select an enemy follower on the field and deal it 2 damage — valid in the hand (ruling Q2897).)
import { discardThis } from "../costs";
import { activated, defineCard, evolveAbility, fanfare, lookAtTopCards } from "../helpers";
import { enemyFollower } from "../targets";
import { quickCardInDeck } from "./rune-shared";

export default defineCard({
  abilities: [
    evolveAbility(1),
    fanfare({
      *resolve(fx) {
        yield* lookAtTopCards(fx, 3, { filter: quickCardInDeck, to: "hand", max: 2, rest: "cemetery" });
      },
    }),
    activated(
      { playPoints: 1, custom: discardThis },
      {
        validIn: ["hand"],
        quick: true,
        targets: [enemyFollower()],
        *resolve(fx) {
          yield* fx.dealDamage(fx.targets[0]![0]!, 2);
        },
      },
    ),
  ],
});
