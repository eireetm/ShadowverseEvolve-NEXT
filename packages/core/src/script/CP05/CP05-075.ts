// CP05-075 闇の理・フェディエル (evolved) — Abysscraft, 4/4. グラブル・六竜・闇属性.
// 自分が手札の闇属性・カード1枚を捨てたとき、相手のリーダーすべてと相手の場のフォロワーすべてに1ダメージ。
// 【進化時】手札2枚を捨てる：2枚引く。
// 【超進化時】自分の墓場の「これと同名を除くカード」をカード名が異なるように2枚まで選ぶ。それを手札に加える。自分の手札1枚を捨てる。
// (Whenever you discard a dark (or 全属性) card from your hand, 1 damage to each enemy leader and follower — as CP05-074. On Evolve -
// Discard 2 cards: draw 2 (exactly 2, together, CR 10.4.2.2, 5.12; it may be left unpaid, CR 10.4.7.4). On Super Evolve - Select up to
// 2 cards with different names in your cemetery, not named 闇の理・フェディエル (CR 2.1.2, 10.6.2.3.2): put them into your hand; then
// discard a card, whatever was selected (its own sentence). Super-evolving triggers both, resolved in any order (rulings Q2871, Q2872);
// the selection is made when On Super Evolve is played (CR 10.6.2.3), so it can take back cards On Evolve discarded.)
import { discardCardsCost } from "../costs";
import { defineCard, onEvolve, onSuperEvolve } from "../helpers";
import { inYourZone } from "../targets";
import { fedielDiscardBurst, notNamedAs } from "./abyss-shared";

export default defineCard({
  abilities: [
    fedielDiscardBurst,
    onEvolve({
      cost: discardCardsCost(2),
      *resolve(fx) {
        yield* fx.draw(2);
      },
    }),
    onSuperEvolve({
      targets: [inYourZone("cemetery", { count: 2, upTo: true, distinctNames: true, filter: notNamedAs("CP05-075") })],
      *resolve(fx) {
        yield* fx.returnToHand((fx.targets[0] ?? []).filter((id) => fx.game.card(id)?.zone === "cemetery"));
        yield* fx.discard(fx.controller, 1, 1);
      },
    }),
  ],
});
