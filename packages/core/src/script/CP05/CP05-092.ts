// CP05-092 土の理・ガレヲン (evolved) — Havencraft, 3/3. グラブル・六竜・土属性.
// 【進化時】自分のデッキの上4枚を見る。その中から、グラブル・カード1枚を公開して手札に加えてよい。残りを好きな順にデッキの下に置く。
// 【超進化時】『土晶のエレメント』X枚をEXエリアに置く。自分のリーダーは体力+Xする。Xは「自分のエボルヴデッキの表向きの土属性・エボルヴフォ
// ロワーの枚数の半分（端数切り上げ）」である。
// (On Evolve - Look at the top 4 cards of your deck; you may reveal a Granblue card among them and add it to your hand; the rest
// on the bottom in any order. On Super-Evolve - Put X 土晶のエレメント into your EX area and give your leader +X defense, X =
// half the faceup earth (or 全属性, CR JP 14.6.2.2) evolved followers in your evolve deck, rounded up, counted as it resolves
// (CR 5.2.1.1) — not this card, now in the evolve zone (CR 4.12.1). Super-evolving triggers both, in either order (rulings
// Q2871, Q2872). When the EX area has room for fewer than X, only those are made (CR 4.8.3.2), and the leader still gets +X:
// X is fixed by the evolve deck alone (CR 1.3.2).)
import { defineCard, lookAtTopCards, onEvolve, onSuperEvolve } from "../helpers";
import { hasTrait } from "../targets";
import { EARTH_ELEMENT, faceUpEarthEvolved } from "./shared";

export default defineCard({
  abilities: [
    onEvolve({
      *resolve(fx) {
        yield* lookAtTopCards(fx, 4, { filter: hasTrait("グラブル"), to: "hand" });
      },
    }),
    onSuperEvolve({
      *resolve(fx) {
        const x = Math.ceil(faceUpEarthEvolved(fx.game, fx.controller) / 2);
        yield* fx.tokensToEx(Array.from({ length: x }, () => EARTH_ELEMENT));
        yield* fx.giveLeaderDefense(fx.controller, x);
      },
    }),
  ],
});
