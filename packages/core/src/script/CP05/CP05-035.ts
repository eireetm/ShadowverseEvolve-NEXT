// CP05-035 燃え滾る闘志・フェザー — Swordcraft follower, 3, 4/4. グラブル・光属性.
// 【突進】【守護】（【突進】を持つフォロワーは、場に出たターンから相手のフォロワーを攻撃できる）
// ファンファーレ『光晶のエレメント』1枚をEXエリアに置く。
// (Rush. Ward. Fanfare - Put a 光晶のエレメント (CP05-T13) into your EX area (none when it is full, CR 4.8.3.2). The parenthesis
// is reminder text, CR 2.6.2.)
import { defineCard, fanfare } from "../helpers";
import { LIGHT_ELEMENT } from "./shared";

export default defineCard({
  keywords: ["rush", "ward"],
  abilities: [
    fanfare({
      *resolve(fx) {
        yield* fx.tokensToEx([LIGHT_ELEMENT]);
      },
    }),
  ],
});
