// CP05-104 アフェクション・オース — Havencraft spell, 1. グラブル・光属性.
// クイック
// 相手の場のフォロワー1体を選ぶ。それに2ダメージ。『光晶のエレメント』1枚をEXエリアに置く。自分の手札の元のコスト5のグラブル・フォロワー1枚を
// 捨ててよい。そうしたなら、自分のデッキから『狂恋の華鎧・ヴィーラ』1枚を探し、手札に加える。
// (Quick. Select an enemy follower on the field and deal it 2 damage. Put a 光晶のエレメント into your EX area. You may discard a
// Granblue follower of original cost 5 (CR 5.24.1) from your hand — the player picks it, it isn't selected; if you do, search
// your deck for a 狂恋の華鎧・ヴィーラ (CP05-093; its evolved card is in the evolve deck), reveal it, add it to your hand — a
// search with a name may go unfound (CR 4.1.2.2, 5.8.1.2). Without an enemy follower to select it can't be played (ruling
// Q2922; CR 10.6.2.3.3).)
import { discardA } from "../costs";
import { defineCard, spell } from "../helpers";
import { enemyFollower, named } from "../targets";
import { granblueCost5, LIGHT_ELEMENT, VIRA } from "./shared";

export default defineCard({
  keywords: ["quick"],
  abilities: [
    spell({
      targets: [enemyFollower()],
      *resolve(fx) {
        yield* fx.dealDamage(fx.targets[0]![0]!, 2);
        yield* fx.tokensToEx([LIGHT_ELEMENT]);
        if (yield* fx.optionalCost(discardA(granblueCost5))) yield* fx.search((id) => named(VIRA)(fx.game, id));
      },
    }),
  ],
});
