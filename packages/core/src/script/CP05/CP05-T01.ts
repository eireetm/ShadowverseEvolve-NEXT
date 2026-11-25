// CP05-T01 ガンパウダーミキサー・クムユ — Forestcraft follower token, 3, 3/2. グラブル・土属性.
// 【突進】【指定攻撃】（【指定攻撃】を持つフォロワーは、スタンド状態のフォロワーを攻撃できる）
// ラストワード相手のリーダーすべてに2ダメージ。
// (Rush. Assail — the reminder in brackets has no effect, CR 2.6.2. Last Words - Deal 2 damage to each enemy leader — the
// enemies of its controller when it left the field, CR 10.7.4.1.2.)
import { defineCard, lastWords } from "../helpers";

export default defineCard({
  keywords: ["rush", "assail"],
  abilities: [
    lastWords({
      *resolve(fx) {
        yield* fx.dealDamage(fx.game.leader(fx.game.opponent(fx.controller)), 2);
      },
    }),
  ],
});
