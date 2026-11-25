// CP05-020 刀神・オクトー — Swordcraft follower, 8, 5/5. グラブル・十天衆・土属性.
// これをプレイする際、自分のエボルヴデッキの表向きの土属性・エボルヴフォロワー2枚につき、コストを-2する。
// 【最終上限解放可能】
// これが上限解放したとき、これは【突進】【指定攻撃】を持つ。
// これが最終上限解放したとき、コスト1：相手の場のフォロワー1体を選ぶ。それを破壊する。それのリーダーに3ダメージ。
// (This costs 2 less to play for every 2 faceup earth evolved followers in your evolve deck: 2 × ⌊n/2⌋, once (CR 5.29.1); earth
// includes 全属性 (CR JP 14.6.2.2); evolved amulets and advanced cards aren't evolved followers (BP22-026 rulings). Final Uncap
// (CR JP 14.6.3). When this uncaps (CR JP 14.6.4.1): it gains Rush and Assail, for as long as it stays on the field (no duration,
// CR 10.2.1.2, 10.9.2). When this final-uncaps (CR JP 14.6.4.2), you may pay {[cost01]} (CR 10.4.7.4): select an enemy follower on
// the field, destroy it, and deal 3 damage to its leader — the leader of its controller, read before it is destroyed (CR 10.11.1),
// dealt even if it wasn't destroyed (two sentences). Without a follower to select it can't be played: no damage (ruling Q2882,
// CR 10.6.2.3.3). ヒヒイロカネ doing both triggers both, in any order (rulings Q2867, Q2868).)
import { playPointsCost } from "../costs";
import { defineCard, whenThisIsFinalUncapped, whenThisIsUncapped } from "../helpers";
import { enemyFollower } from "../targets";
import { faceUpEarthEvolved } from "./shared";

export default defineCard({
  keywords: ["finalUncap"],
  playCost: (g, _self, player) => -2 * Math.floor(faceUpEarthEvolved(g, player) / 2),
  abilities: [
    whenThisIsUncapped({
      *resolve(fx) {
        if (fx.game.card(fx.self)?.zone !== "field") return;
        yield* fx.giveKeyword(fx.self, "rush");
        yield* fx.giveKeyword(fx.self, "assail");
      },
    }),
    whenThisIsFinalUncapped({
      cost: playPointsCost(1),
      targets: [enemyFollower()],
      *resolve(fx) {
        const target = fx.targets[0]![0]!;
        const leader = fx.game.leader(fx.game.controller(target));
        yield* fx.destroy([target]);
        yield* fx.dealDamage(leader, 3);
      },
    }),
  ],
});
