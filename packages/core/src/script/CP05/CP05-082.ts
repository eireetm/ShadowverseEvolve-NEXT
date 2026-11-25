// CP05-082 冥闇の剛刃・バザラガ — Abysscraft follower, 7, 4/7. グラブル・闇属性.
// 自分の闇属性・カードの能力によってこれを自分の手札から捨てたとき、コスト1：相手の場のフォロワー1体を選ぶ。それに3ダメージ。
// これが上限解放したとき、これは「ラストワードこれを場に出す」を持つ。
// ファンファーレ相手の場のフォロワー1体を選ぶ。それを破壊する。
// (When the ability of a dark (or 全属性, CR JP 14.6.2.2) card you control discards this from your hand — its effect, its cost, or a
// spell's additional cost (CR 10.1.1.4), in either player's turn: there's no "during your turn" — {[cost01]}: select an enemy follower
// on the field and deal it 3 damage (the cost may be left unpaid, CR 10.4.7.4; without a target nothing is asked, CR 10.6.2.3.3). When
// this uncaps (CR JP 14.6.4.1), it gains "{[lastwords]} Summon this" for as long as it stays on the field (CR 10.9.2): put into the
// cemetery from the field (CR 12.5.3), the card there goes onto its owner's field (CR 4.1.4.1, 4.1.6) — a new card, not uncapped and
// without it (CR 4.1.4), whose Fanfare triggers again (CR 12.4.3); it is lost with the follower's abilities (CR 10.9.1.2). No Final
// Uncap: ヒヒイロカネ only uncaps it (CR JP 14.6.4.2). Fanfare - Select an enemy follower on the field and destroy it.)
import { playPointsCost } from "../costs";
import { defineCard, fanfare, whenThisIsUncapped } from "../helpers";
import { enemyFollower } from "../targets";
import { whenDiscardedByYourDarkCard } from "./abyss-shared";

export default defineCard({
  abilities: [
    whenDiscardedByYourDarkCard({
      cost: playPointsCost(1),
      targets: [enemyFollower()],
      *resolve(fx) {
        yield* fx.dealDamage(fx.targets[0]![0]!, 3);
      },
    }),
    whenThisIsUncapped({
      *resolve(fx) {
        if (fx.game.card(fx.self)?.zone === "field") yield* fx.grant(fx.self, "lastWordsSummonSelf");
      },
    }),
    fanfare({
      targets: [enemyFollower()],
      *resolve(fx) {
        yield* fx.destroy(fx.targets[0]!);
      },
    }),
  ],
});
