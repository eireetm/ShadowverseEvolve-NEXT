// CP05-004 風の理・イーウィヤ (evolved) — Forestcraft, 2/2. グラブル・六竜・風属性.
// 【進化時】『風晶のエレメント』1枚をEXエリアに置く。1枚引く。
// 【超進化時】『ヒヒイロカネ』1枚をEXエリアに置く。1枚引く。
// (On Evolve - Put a 風晶のエレメント into your EX area and draw a card. On Super-Evolve - Put a ヒヒイロカネ into your EX area
// and draw a card. Super-evolving triggers both, resolved in either order — rulings Q2871, Q2872, CR 12.2.4.2; with one free
// slot in the EX area the first to resolve takes it, CR 4.8.3.2, and the draws happen anyway.)
import { defineCard, onEvolve, onSuperEvolve } from "../helpers";
import { HIHIIROKANE, WIND_ELEMENT } from "./shared";

export default defineCard({
  abilities: [
    onEvolve({
      *resolve(fx) {
        yield* fx.tokensToEx([WIND_ELEMENT]);
        yield* fx.draw(1);
      },
    }),
    onSuperEvolve({
      *resolve(fx) {
        yield* fx.tokensToEx([HIHIIROKANE]);
        yield* fx.draw(1);
      },
    }),
  ],
});
