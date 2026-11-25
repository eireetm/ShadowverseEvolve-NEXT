// CP05-089 開眼者・ウーノ — Havencraft follower, 1, 1/1. グラブル・十天衆・水属性.
// 【守護】【最終上限解放可能】
// これが上限解放したとき、1枚引く。自分の手札1枚を捨てる。
// これが最終上限解放したとき、相手の場のフォロワー1体を選ぶ。それに4ダメージ。
// Q起動コスト1これをアクト：自分のリーダーは体力+1する。
// (Ward. Final Uncap (CR JP 14.6.3). When this uncaps (CR JP 14.6.4.1): draw a card, then discard a card (not optional,
// CR 5.12.1). When this final-uncaps (CR JP 14.6.4.2): select an enemy follower on the field and deal it 4 damage — without
// one the ability can't be played (CR 10.6.2.3.3, 10.7.3.2; the set's rulings Q2882, Q2905 on the same kind of ability). A
// water element uncaps it, a second one final-uncaps it instead; ヒヒイロカネ does both at once, and both trigger, resolved in
// the order its controller chooses (rulings Q2867, Q2868). Each happens once per card: an uncapped one isn't uncapped again
// (CR JP 14.6.4.1), and a card that left the field and came back is a new one (CR 4.1.4). {[q]} {[act]} {[cost01]},
// {[engage]}: give your leader +1 defense — also at Quick timing (CR 12.3.3); it may engage the turn it came in (CR 10.4.6.1).)
import { activated, defineCard, whenThisIsFinalUncapped, whenThisIsUncapped } from "../helpers";
import { enemyFollower } from "../targets";

export default defineCard({
  keywords: ["ward", "finalUncap"],
  abilities: [
    whenThisIsUncapped({
      *resolve(fx) {
        yield* fx.draw(1);
        yield* fx.discard(fx.controller, 1, 1);
      },
    }),
    whenThisIsFinalUncapped({
      targets: [enemyFollower()],
      *resolve(fx) {
        yield* fx.dealDamage(fx.targets[0]![0]!, 4);
      },
    }),
    activated(
      { playPoints: 1, engageSelf: true },
      {
        quick: true,
        *resolve(fx) {
          yield* fx.giveLeaderDefense(fx.controller, 1);
        },
      },
    ),
  ],
});
