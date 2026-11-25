// CP05-109 小さき赤き竜・ビィ (evolved) — Neutral, 2/2. グラブル・全属性.
// 【進化時】『ヒヒイロカネ』1枚をEXエリアに置く。
// (On Evolve - Put a ヒヒイロカネ (CP05-T15) into your EX area; none when the EX area is full, CR 4.8.3.2. CP05-108's Fanfare
// evolving it triggers it too, CR 12.6.1.)
import { defineCard, onEvolve } from "../helpers";
import { HIHIIROKANE } from "./shared";

export default defineCard({
  abilities: [
    onEvolve({
      *resolve(fx) {
        yield* fx.tokensToEx([HIHIIROKANE]);
      },
    }),
  ],
});
