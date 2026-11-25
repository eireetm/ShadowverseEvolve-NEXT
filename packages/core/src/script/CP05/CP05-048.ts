// CP05-048 アルケミック・フレア — Runecraft spell, 2. グラブル・火属性.
// これを自分の手札から公開したとき、『火晶のエレメント』1枚をEXエリアに置く。
// 相手の場のフォロワー1体を選ぶ。それに4ダメージ。『火晶のエレメント』1枚をEXエリアに置く。
// (When this is revealed from your hand — by any card's ability, the opponent's too, in either player's turn; being played is no
// such reveal (rulings Q2893, Q2894; CR 5.21.1) — put a 火晶のエレメント (CP05-T09) into your EX area. Valid in the hand
// (CR 10.3.4), it resolves even if this has left the hand since (CR 10.7.7). The spell: select an enemy follower on the field and
// deal it 4 damage, then put a 火晶のエレメント into your EX area; it can't be played without an enemy follower to select, so
// no element either (ruling Q2902, CR 10.6.2.3.3).)
import { defineCard, spell, whenRevealedFromYourHand } from "../helpers";
import { enemyFollower } from "../targets";
import { FIRE_ELEMENT } from "./shared";

export default defineCard({
  abilities: [
    whenRevealedFromYourHand({
      *resolve(fx) {
        yield* fx.tokensToEx([FIRE_ELEMENT]);
      },
    }),
    spell({
      targets: [enemyFollower()],
      *resolve(fx) {
        yield* fx.dealDamage(fx.targets[0]![0]!, 4);
        yield* fx.tokensToEx([FIRE_ELEMENT]);
      },
    }),
  ],
});
