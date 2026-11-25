// CP05-057 炎の理・ウィルナス (evolved) — Dragoncraft, 5/5. グラブル・六竜・火属性.
// 【進化時】手札の火属性・カードX枚を公開：相手の場のフォロワー2体まで選ぶ。それにXダメージを割りふる。
// 【超進化時】手札の火属性・カードX枚を公開：相手の場のフォロワー1体を選ぶ。それとそれのリーダーにXダメージ。
// (On Evolve - Reveal X fire cards (全属性 too, CR JP 14.6.2.2) from your hand: select up to 2 enemy followers on the field and
// deal X damage divided between them, at least 1 each (CR 10.6.2.4.2). On Super-Evolve - Reveal X fire cards from your hand:
// select an enemy follower on the field and deal X damage to it and to its leader, at once. Revealing is optional (CR 10.4.7.4);
// X is chosen while playing (CR 10.6.2.2.4) — here as the reveal is paid, after the targets: at least 1 and at least the number
// of followers selected, which gives the same choices. On Evolve may select no follower and still be played (ruling Q2906), so
// cards may be revealed (a card's "when revealed from your hand" triggers) and no damage is dealt (CR 10.6.2.4.1); On
// Super-Evolve can't be played without an enemy follower, so nothing is revealed and its leader takes nothing (ruling Q2907).
// Super-evolving triggers both, in the order you choose (rulings Q2871, Q2872; CR 12.2.4.2), and both may reveal the same
// cards: a reveal ends once its ability has resolved (CR 5.21.1.1).)
import { defineCard, onEvolve, onSuperEvolve } from "../helpers";
import { enemyFollower } from "../targets";
import { fireCardsInHand, leaderOf, paidX, revealFireX } from "./dragon-shared";

export default defineCard({
  abilities: [
    onEvolve({
      cost: revealFireX,
      targets: [enemyFollower({ count: 2, upTo: true, max: (g, c) => fireCardsInHand(g, c).length })],
      *resolve(fx) {
        yield* fx.dealDividedDamage(fx.targets[0] ?? [], paidX(fx));
      },
    }),
    onSuperEvolve({
      cost: revealFireX,
      targets: [enemyFollower()],
      *resolve(fx) {
        const target = fx.targets[0]![0]!;
        yield* fx.dealDamageEach([target, leaderOf(fx, target)], paidX(fx));
      },
    }),
  ],
});
