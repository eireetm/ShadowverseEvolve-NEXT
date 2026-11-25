// CP05-021 光の理・ル・オー — Swordcraft follower, 5, 3/3. グラブル・六竜・光属性.
// 進化コスト1：これは進化する。
// ファンファーレ『光晶のエレメント』1枚をEXエリアに置く。
// (Evolve (1). Fanfare - Put a 光晶のエレメント (CP05-T13) into your EX area: a token created there (CR 5.5.2, 9.1.2), not
// when the EX area is full (CR 4.8.3.2).)
import { defineCard, evolveAbility, fanfare } from "../helpers";
import { LIGHT_ELEMENT } from "./shared";

export default defineCard({
  abilities: [
    evolveAbility(1),
    fanfare({
      *resolve(fx) {
        yield* fx.tokensToEx([LIGHT_ELEMENT]);
      },
    }),
  ],
});
