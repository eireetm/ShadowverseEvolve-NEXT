// CP05-068 古今独歩の大拳豪・ガンダゴウザ — Dragoncraft follower, 7, 6/5. グラブル・火属性.
// これを自分の手札から公開したとき、自分の場の火属性・フォロワー1体を選ぶ。それは【突進】【指定攻撃】を持つ。
// 【突進】【指定攻撃】
// 【攻撃時】手札の火属性・カード3枚を公開：相手の場のフォロワー1体を選ぶ。それとそれのリーダーに6ダメージ。
// (When an ability reveals this from your hand — any card's ability, the opponent's too, in either player's turn, each time it
// does (rulings Q2893, Q2894; CR 10.7.2.1); not as it is played (CR 10.6.2.1 is no ability's reveal) — select a fire follower on
// your field (全属性 too, CR JP 14.6.2.2): it has Rush and Assail for as long as it stays there (no duration, CR 10.2.1.2). Valid
// in the hand (CR 10.3.4); resolved even if this has left it since (CR 10.6.2.8.2.1). Rush. Assail. Strike - Reveal 3 fire cards
// from your hand: select an enemy follower on the field and deal 6 damage to it and to its leader, at once. Revealing is optional
// (CR 10.4.7.4); without an enemy follower it can't be played, so its leader takes nothing (ruling Q2911). Another of this card
// revealed by it triggers (ruling Q2893).)
import { revealFromHand } from "../costs";
import { defineCard, strike, whenRevealedFromYourHand } from "../helpers";
import { enemyFollower, hasTrait, yourFollower } from "../targets";
import { leaderOf } from "./dragon-shared";

export default defineCard({
  keywords: ["rush", "assail"],
  abilities: [
    whenRevealedFromYourHand({
      targets: [yourFollower({ filter: hasTrait("火属性") })],
      *resolve(fx) {
        const follower = fx.targets[0]![0]!;
        yield* fx.giveKeyword(follower, "rush");
        yield* fx.giveKeyword(follower, "assail");
      },
    }),
    strike({
      cost: revealFromHand(hasTrait("火属性"), 3),
      targets: [enemyFollower()],
      *resolve(fx) {
        const target = fx.targets[0]![0]!;
        yield* fx.dealDamageEach([target, leaderOf(fx, target)], 6);
      },
    }),
  ],
});
