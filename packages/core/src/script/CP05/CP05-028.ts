// CP05-028 サムライドリーマー・ミリン (evolved) — Swordcraft, 3/3. グラブル・風属性.
// 自分のエンドフェイズが来たとき、このターン、自分の場のフォロワーが上限解放や最終上限解放を合わせて3回以上していたなら、相手のリーダーすべてに
// 2ダメージ。
// 【進化時】相手の場のフォロワー1体を選ぶ。それに2ダメージ。これが上限解放していたなら、代わりに4ダメージ。
// (At the start of your end phase, if your followers uncapped and final-uncapped at least 3 times in all this turn, deal 2
// damage to each enemy leader (as CP05-027; ruling Q2886). On Evolve - Select an enemy follower on the field and deal it 2
// damage, or 4 if this is uncapped (CR JP 14.6.4.1.1) when it resolves — uncapped before it evolved counts, the same card stays
// uncapped (CR 5.16.2). Gone from the field by then: whether it was when it evolved (CR 10.11.1; decided by the project owner,
// 2026-11-24 — it can't be uncapped while this waits, so the two are the same).)
import { defineCard } from "../helpers";
import { enemyFollower } from "../targets";
import type { AutomaticAbility } from "../types";
import { endPhaseTwoDamage } from "./sword-shared";

/** On Evolve (CR 12.6), recording whether this was uncapped when it evolved (`count` 1) for when it has left the field. */
const evolveDamage: AutomaticAbility = {
  kind: "automatic",
  timing: "onEvolve",
  trigger: (e, me, game) => (!me.lookBack && e.type === "evolved" && e.card === me.card ? [{ count: game.isUncapped(me.card) ? 1 : 0 }] : false),
  targets: [enemyFollower()],
  *resolve(fx) {
    const uncapped = fx.game.card(fx.self)?.zone === "field" ? fx.game.isUncapped(fx.self) : fx.data?.count === 1;
    yield* fx.dealDamage(fx.targets[0]![0]!, uncapped ? 4 : 2);
  },
};

export default defineCard({
  abilities: [endPhaseTwoDamage, evolveDamage],
});
