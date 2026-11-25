// CP05-088 ストーン・ブレイク — Abysscraft spell, 1. グラブル・闇属性.
// クイック
// 下記から1つチョイスする。【1】相手の場のフォロワー1体を選ぶ。それに2ダメージ。【2】手札の闇属性・カード1枚を捨てる：相手の場のフォロワー
// 1体を選ぶ。それに3ダメージ。それのリーダーに1ダメージ。
// (Quick (CR 12.3.2). Choose one (CR 5.18): (1) select an enemy follower on the field and deal it 2 damage; (2) discard a dark
// (or 全属性, CR JP 14.6.2.2) card from your hand: select an enemy follower on the field, deal it 3 damage and 1 damage to its leader
// (its controller's, CR 10.11.1). The option's target is selected while playing (CR 10.6.2.3), its process asked when it resolves
// (CR 10.4.7.5): it may be chosen and the process not executed, then it does nothing (BP03-117, BP10-049 rulings). Both options need
// an enemy follower: without one the spell can't be played, so no leader damage either (ruling Q2917; CR 5.18.3.1.2, 10.6.2.3.3).)
import { discardA } from "../costs";
import { defineCard, spell } from "../helpers";
import { enemyFollower } from "../targets";
import { darkCard } from "./abyss-shared";

export default defineCard({
  keywords: ["quick"],
  abilities: [
    spell({
      modes: [
        {
          id: "1",
          label: "Deal 2 damage to an enemy follower",
          targets: [enemyFollower()],
          *resolve(fx) {
            yield* fx.dealDamage(fx.targets[0]![0]!, 2);
          },
        },
        {
          id: "2",
          label: "Discard a Dark card: 3 damage to an enemy follower and 1 to its leader",
          cost: discardA(darkCard),
          targets: [enemyFollower()],
          *resolve(fx) {
            const target = fx.targets[0]![0]!;
            const side = fx.game.card(target)?.controller ?? fx.game.opponent(fx.controller);
            yield* fx.dealDamage(target, 3);
            yield* fx.dealDamage(fx.game.leader(side), 1);
          },
        },
      ],
    }),
  ],
});
