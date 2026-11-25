// CP05-040 水の理・ワムデュス (evolved) — Runecraft, 2/4. グラブル・六竜・水属性.
// 自分のエンドフェイズが来たとき、自分のPPを3回復する。
// 【超進化時】これは「これが場にいる限り、自分がクイックを持つスペルやQ起動能力を持つフォロワーやQ起動能力をプレイする際、コストを-1する」
// を持つ。
// (At the start of your end phase, recover 3 play points (CR 7.4.1, 5.15.1). On Super-Evolve - This gains "While this is on the
// field, when you play a spell with Quick, a follower with a quick activated ability or a quick activated ability, it costs 1
// less" — a gained text (as BP18-081, CR 10.9.1.2), lost with its abilities. It changes the play points to pay when the cost is
// determined (CR 10.6.2.5, 10.4.4.1), never below 0 (CR 1.3.2.2.1): only while it is on the field then (ruling Q2898). A spell
// has Quick with what it has where it is played, "has Quick while ..." too (BP12-058 under Overflow; decided by the project
// owner, 2026-11-24); a follower's quick activated ability is printed (CR 12.3.3), wherever it works; any quick activated
// ability of yours, in any zone, costs 1 less; a treasure's activated ability is not quick.)
import { atStartOfYourEndPhase, defineCard, onSuperEvolve } from "../helpers";
import { isQuickActivatedFollower, isSpell } from "../targets";

const CHEAPER_QUICK =
  "While this is on the field, when you play a spell with Quick, a follower with a quick activated ability or a quick activated ability, it costs 1 less.";

export default defineCard({
  field: {
    // Asked of the cards on both fields: only the cards and abilities its controller plays.
    playCostOf: (g, self, card, player) =>
      player === g.controller(self) &&
      g.hasGainedText(self, CHEAPER_QUICK) &&
      ((isSpell(g, card) && g.info(card).keywords.includes("quick")) || isQuickActivatedFollower(g, card))
        ? -1
        : 0,
    activationCostOf: (g, self, _card, ability, player) =>
      ability.quick === true && player === g.controller(self) && g.hasGainedText(self, CHEAPER_QUICK) ? -1 : 0,
  },
  abilities: [
    atStartOfYourEndPhase({
      *resolve(fx) {
        yield* fx.recoverPlayPoints(3);
      },
    }),
    onSuperEvolve({
      *resolve(fx) {
        if (fx.game.card(fx.self)?.zone === "field") yield* fx.gainText(fx.self, CHEAPER_QUICK);
      },
    }),
  ],
});
