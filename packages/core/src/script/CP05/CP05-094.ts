// CP05-094 狂恋の華鎧・ヴィーラ (evolved) — Havencraft, 4/4. グラブル・光属性.
// 【守護】
// 自分のPP最大値が7以上である限り、これが受けるダメージを-1する。
// 【進化時】相手の場のフォロワー1体を選ぶ。自分のデッキの上3枚を公開する。それに「これによって公開した光属性・カードの枚数」と同じダメージ。公
// 開したカードの中から、1枚を手札に加える。残りを好きな順にデッキの下に置く。
// (Ward. While your maximum play points are 7 or more, this takes 1 less damage (as CP05-093). On Evolve - Select an enemy
// follower on the field; reveal the top 3 cards of your deck; deal it damage equal to the light (or 全属性, CR JP 14.6.2.2) cards
// among them (none: no damage, CR 1.3.2.2); add one of the revealed cards to your hand — any one, and not optional (no
// "may"); the rest on the bottom in any order. Without an enemy follower to select it isn't played, and nothing is revealed
// (ruling Q2921; CR 10.6.2.3.3). Super-evolving triggers it too (CP05-092's rulings Q2871, Q2872). The printings CP05-SP01,
// SSP01a and SSP01b, with another name in large type, are this card.)
import { defineCard, onEvolve } from "../helpers";
import { enemyFollower, hasTrait } from "../targets";
import { viraDamageTaken } from "./haven-shared";

export default defineCard({
  keywords: ["ward"],
  field: { damageTaken: viraDamageTaken },
  abilities: [
    onEvolve({
      targets: [enemyFollower()],
      *resolve(fx) {
        const top = fx.topCards(3);
        yield* fx.reveal(top);
        yield* fx.dealDamage(fx.targets[0]![0]!, top.filter((id) => hasTrait("光属性")(fx.game, id)).length);
        yield* fx.returnToHand(yield* fx.selectCards(top, 1, 1, fx.controller, top));
        yield* fx.bottomInAnyOrder(top.filter((id) => fx.game.card(id)?.zone === "deck"));
      },
    }),
  ],
});
