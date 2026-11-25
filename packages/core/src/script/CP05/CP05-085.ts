// CP05-085 心眼の双葬女・レディ・グレイ (evolved) — Abysscraft, 1/3. グラブル・闇属性.
// 【ドレイン】
// 自分が手札の闇属性・カード1枚を捨てたとき、これは攻撃力+1する。
// 【進化時】手札の闇属性・カード1枚を捨てる：1枚引く。
// (Drain (CR 12.13). Whenever you discard a dark (or 全属性) card from your hand, this gets +1 attack — as CP05-084. On Evolve - Discard
// a dark card: draw a card (it may be left unpaid, CR 10.4.7.4). That discard is a dark card's ability's: it triggers the first ability
// (the follower is on the field) and CP05-072 / 076 / 082 discarded by it.)
import { discardA } from "../costs";
import { defineCard, onEvolve } from "../helpers";
import { darkCard, ladyGreyGrows } from "./abyss-shared";

export default defineCard({
  keywords: ["drain"],
  abilities: [
    ladyGreyGrows,
    onEvolve({
      cost: discardA(darkCard),
      *resolve(fx) {
        yield* fx.draw(1);
      },
    }),
  ],
});
