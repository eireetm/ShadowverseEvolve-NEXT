// CP05-025 真紅の穿光・ゼタ — Swordcraft follower, 5, 4/4. グラブル・火属性.
// 【疾走】【最終上限解放可能】
// これが上限解放したとき、これは「【攻撃時】相手の場のフォロワー1体を選ぶ。それに5ダメージ」を持つ。
// これが最終上限解放したとき、これは「【攻撃時】相手の場のフォロワーすべてに2ダメージ」を持つ。
// (Storm. Final Uncap (CR JP 14.6.3). When this uncaps (CR JP 14.6.4.1), it gains "Strike - Select an enemy follower on the
// field and deal it 5 damage"; when it final-uncaps (CR JP 14.6.4.2), "Strike - Deal 2 damage to each enemy follower on the
// field" — gained texts (as BP22-022), for as long as it stays on the field (CR 10.2.1.2, 10.9.2), lost with its abilities
// (CR 10.9.1.2). A fire element uncaps it, or final-uncaps it instead once uncapped (CR JP 14.6.4.2, so it gains only the
// second); ヒヒイロカネ gives both, the two triggers in any order (rulings Q2867, Q2868). Both Strikes resolve in any order; the
// first can't be played without a follower to select (CR 10.6.2.3.3), the second still resolves (ruling Q2884).)
import { defineCard, strike, whenThisIsFinalUncapped, whenThisIsUncapped } from "../helpers";
import { enemyFollower } from "../targets";

const STRIKE_FIVE = "Strike - Select an enemy follower on the field and deal it 5 damage.";
const STRIKE_ALL_TWO = "Strike - Deal 2 damage to each enemy follower on the field.";

export default defineCard({
  keywords: ["storm", "finalUncap"],
  abilities: [
    whenThisIsUncapped({
      *resolve(fx) {
        if (fx.game.card(fx.self)?.zone === "field") yield* fx.gainText(fx.self, STRIKE_FIVE);
      },
    }),
    whenThisIsFinalUncapped({
      *resolve(fx) {
        if (fx.game.card(fx.self)?.zone === "field") yield* fx.gainText(fx.self, STRIKE_ALL_TWO);
      },
    }),
    // The gained texts (CR 10.9.1.2): abilities of this card only once it has gained them.
    strike({
      triggerIf: (g, _c, self) => g.hasGainedText(self, STRIKE_FIVE),
      targets: [enemyFollower()],
      *resolve(fx) {
        yield* fx.dealDamage(fx.targets[0]![0]!, 5);
      },
    }),
    strike({
      triggerIf: (g, _c, self) => g.hasGainedText(self, STRIKE_ALL_TWO),
      *resolve(fx) {
        yield* fx.dealDamageEach(fx.game.followers(fx.game.opponent(fx.controller)), 2);
      },
    }),
  ],
});
