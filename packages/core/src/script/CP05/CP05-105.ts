// CP05-105 天司長の後継・サンダルフォン — Neutral follower, 5, 4/4. グラブル・光属性.
// 進化コスト1：これは進化する。
// 【守護】
// ファンファーレ相手の場のフォロワー2体まで選ぶ。それに2ダメージ。相手のリーダーすべてに2ダメージ。自分のSEPが0なら、これは進化する。自分のリーダーは体力+2する。
// (Evolve (1). Ward. Fanfare - Select up to 2 enemy followers on the field (none too: ruling Q2924, CR 10.6.2.3.2) and deal them
// 2 damage; deal 2 damage to each enemy leader. If you have no super-evolution point (each player starts with 1, CR 6.2.1.11),
// evolve this and give your leader +2 defense. The +2 is under the condition too (「…なら、X。Y。」, as BP19-112's official
// English has it), and it is given even when the evolving is declined or can't be done (CR 1.3.2). An effect's evolution: no
// cost, the player may decline it, and it doesn't use the turn's evolve (ruling Q2923, CR 8.3.2.1).)
import { defineCard, evolveAbility, fanfare } from "../helpers";
import { enemyFollower } from "../targets";

export default defineCard({
  keywords: ["ward"],
  abilities: [
    evolveAbility(1),
    fanfare({
      targets: [enemyFollower({ count: 2, upTo: true })],
      *resolve(fx) {
        const g = fx.game;
        yield* fx.dealDamageEach(fx.targets[0] ?? [], 2);
        yield* fx.dealDamage(g.leader(g.opponent(fx.controller)), 2);
        if (g.state.players[fx.controller].superEvolutionPoints !== 0) return;
        yield* fx.evolve(fx.self);
        yield* fx.giveLeaderDefense(fx.controller, 2);
      },
    }),
  ],
});
