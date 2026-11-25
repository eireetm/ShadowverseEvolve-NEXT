// CP05-003 風の理・イーウィヤ — Forestcraft follower, 1, 1/1. グラブル・六竜・風属性.
// 進化コスト1：これは進化する。
// ファンファーレ『風晶のエレメント』1枚をEXエリアに置く。
// (Evolve (1). Fanfare - Put a 風晶のエレメント treasure token into your EX area — none with a full EX area, CR 4.8.3.2.)
import { defineCard, evolveAbility, fanfare } from "../helpers";
import { WIND_ELEMENT } from "./shared";

export default defineCard({
  abilities: [
    evolveAbility(1),
    fanfare({
      *resolve(fx) {
        yield* fx.tokensToEx([WIND_ELEMENT]);
      },
    }),
  ],
});
