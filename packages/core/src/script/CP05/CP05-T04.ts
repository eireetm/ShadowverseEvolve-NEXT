// CP05-T04 不撓不屈の騎士・ヴェイン — Swordcraft follower token, 3, 2/5. グラブル・風属性.
// ファンファーレ『風晶のエレメント』1枚をEXエリアに置く。自分のリーダーは体力+3する。
// (Fanfare - Put a 風晶のエレメント (CP05-T12) into your EX area (none when it is full, CR 4.8.3.2), and give your leader +3
// defense (CR 5.27) either way.)
import { defineCard, fanfare } from "../helpers";
import { WIND_ELEMENT } from "./shared";

export default defineCard({
  abilities: [
    fanfare({
      *resolve(fx) {
        yield* fx.tokensToEx([WIND_ELEMENT]);
        yield* fx.giveLeaderDefense(fx.controller, 3);
      },
    }),
  ],
});
