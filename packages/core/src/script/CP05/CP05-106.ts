// CP05-106 天司長の後継・サンダルフォン (evolved) — Neutral, 5/5. グラブル・光属性.
// 【守護】
// 【進化時】相手の場のフォロワー2体まで選ぶ。それに2ダメージ。相手のリーダーすべてに2ダメージ。自分の場の元のコスト5のグラブル・フォロワーが
// 3体以上なら、選んだフォロワーに2ダメージ。相手のリーダーすべてに2ダメージ。
// (Ward. On Evolve - Select up to 2 enemy followers on the field (none too: ruling Q2906, CR 10.6.2.3.2) and deal them 2 damage;
// deal 2 damage to each enemy leader. Then, if there are at least 3 Granblue followers with an original cost of 5 on your field —
// this one counts: an evolved follower's original cost is its base card's (CR 5.24.1, 5.16.1.2) — deal 2 more damage to the
// selected followers still on the field (one brought to 0 defense is only destroyed at the next confirmation timing, CR 11.1.2)
// and 2 more to each enemy leader, under the condition too (「…なら、X。Y。」). Counted when it resolves. Also printed as
// CP05-SP02 / SSP02a / SSP02b 「幻想の一時・サンダルフォン＆ルシフェル」, an alternate name (CR 2.13).)
import { defineCard, onEvolve } from "../helpers";
import { enemyFollower } from "../targets";
import { granblueCost5 } from "./shared";

export default defineCard({
  keywords: ["ward"],
  abilities: [
    onEvolve({
      targets: [enemyFollower({ count: 2, upTo: true })],
      *resolve(fx) {
        const g = fx.game;
        const opponent = g.opponent(fx.controller);
        const chosen = fx.targets[0] ?? [];
        yield* fx.dealDamageEach(chosen, 2);
        yield* fx.dealDamage(g.leader(opponent), 2);
        if (g.followers(fx.controller).filter((id) => granblueCost5(g, id)).length < 3) return;
        yield* fx.dealDamageEach(chosen.filter((id) => g.card(id)?.zone === "field"), 2);
        yield* fx.dealDamage(g.leader(opponent), 2);
      },
    }),
  ],
});
