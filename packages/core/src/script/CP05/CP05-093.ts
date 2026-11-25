// CP05-093 狂恋の華鎧・ヴィーラ — Havencraft follower, 3, 3/3. グラブル・光属性.
// 進化コスト1：これは進化する。
// 【守護】
// 自分のPP最大値が7以上である限り、これが受けるダメージを-1する。
// ファンファーレ『光晶のエレメント』1枚をEXエリアに置く。
// (Evolve (1). Ward. While your maximum play points are 7 or more, this takes 1 less damage — any damage (BP01-134's ruling on
// the same sentence), a replacement effect (CR 5.14.2, 10.2.1.3.2); "your" is its controller's. Fanfare - Put a 光晶のエレメント
// into your EX area.)
import { defineCard, evolveAbility, fanfare } from "../helpers";
import { viraDamageTaken } from "./haven-shared";
import { LIGHT_ELEMENT } from "./shared";

export default defineCard({
  keywords: ["ward"],
  field: { damageTaken: viraDamageTaken },
  abilities: [
    evolveAbility(1),
    fanfare({
      *resolve(fx) {
        yield* fx.tokensToEx([LIGHT_ELEMENT]);
      },
    }),
  ],
});
