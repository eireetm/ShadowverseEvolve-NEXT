// CP05-043 空慕う帰還者・カシウス — Runecraft follower, 4, 3/3. グラブル・水属性.
// ファンファーレ1枚引く。自分の墓場のQ起動能力を持つフォロワーが7枚以上なら、自分のPPを3回復する。
// Q起動コスト1手札のこれを捨てる：自分のデッキの上3枚を見る。その中から、Q起動能力を持つフォロワー1枚を公開して手札に加えてよい。残りを好きな
// 順にデッキの下に置く。
// (Fanfare - Draw a card. Then, if there are at least 7 followers with a quick activated ability in your cemetery — printed
// (CR 12.3.3), those valid only in the hand too — recover 3 play points: the condition is the second sentence's only, checked
// after the draw. {[q]} {[act]} {[cost01]}, discard this card: look at the top 3 cards of your deck; you may reveal a follower
// with a quick activated ability among them and add it to your hand; put the rest on the bottom of your deck in any order
// (CR 5.11, 5.21) — valid in the hand (ruling Q2900).)
import { discardThis } from "../costs";
import { activated, defineCard, fanfare, lookAtTopCards } from "../helpers";
import { isQuickActivatedFollower } from "../targets";
import { quickFollowersInCemetery } from "./shared";

export default defineCard({
  abilities: [
    fanfare({
      *resolve(fx) {
        yield* fx.draw(1);
        if (quickFollowersInCemetery(fx.game, fx.controller) >= 7) yield* fx.recoverPlayPoints(3);
      },
    }),
    activated(
      { playPoints: 1, custom: discardThis },
      {
        validIn: ["hand"],
        quick: true,
        *resolve(fx) {
          yield* lookAtTopCards(fx, 3, { filter: isQuickActivatedFollower, to: "hand" });
        },
      },
    ),
  ],
});
