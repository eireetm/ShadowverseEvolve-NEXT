// CP05-011 天禀の射手・メーテラ — Forestcraft follower, 4, 3/3. グラブル・風属性.
// これが上限解放したとき、相手の場のフォロワー1体を選ぶ。それに5ダメージ。
// 自分のエンドフェイズが来たとき、このターン、自分の場のフォロワーが上限解放や最終上限解放を合わせて3回以上していたなら、相手のリーダー
// すべてに5ダメージ。
// (When this is uncapped, select an enemy follower on the field and deal it 5 damage — not played without one, CR 10.6.2.3.3.
// At the start of your end phase, if followers on your field were uncapped or final-uncapped 3 or more times in total this
// turn, deal 5 damage to each enemy leader — ヒヒイロカネ final-uncapping a follower counts 2: ruling Q2877; checked as it
// resolves. No Final Uncap: ヒヒイロカネ only uncaps this, CR JP 14.6.4.2.)
import { atStartOfYourEndPhase, defineCard, whenThisIsUncapped } from "../helpers";
import { enemyFollower } from "../targets";
import { threeUncapsThisTurn } from "./forest-shared";

export default defineCard({
  abilities: [
    whenThisIsUncapped({
      targets: [enemyFollower()],
      *resolve(fx) {
        yield* fx.dealDamage(fx.targets[0]![0]!, 5);
      },
    }),
    atStartOfYourEndPhase({
      condition: threeUncapsThisTurn,
      *resolve(fx) {
        yield* fx.dealDamage(fx.game.leader(fx.game.opponent(fx.controller)), 5);
      },
    }),
  ],
});
