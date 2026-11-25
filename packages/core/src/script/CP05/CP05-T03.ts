// CP05-T03 俊英の双剣士・ランスロット — Swordcraft follower token, 3, 3/3. グラブル・水属性.
// 【疾走】（【疾走】を持つフォロワーは、場に出たターンから攻撃できる）
// ファンファーレ『水晶のエレメント』1枚をEXエリアに置く。1枚引く。自分の手札1枚を捨てる。
// (Storm. Fanfare - Put a 水晶のエレメント (CP05-T10) into your EX area (none when it is full, CR 4.8.3.2), draw a card, then
// discard a card from your hand (CR 5.12) — each done on its own (CR 1.3.2). The parenthesis is reminder text, CR 2.6.2.)
import { defineCard, fanfare } from "../helpers";
import { WATER_ELEMENT } from "./shared";

export default defineCard({
  keywords: ["storm"],
  abilities: [
    fanfare({
      *resolve(fx) {
        yield* fx.tokensToEx([WATER_ELEMENT]);
        yield* fx.draw(1);
        yield* fx.discard(fx.controller, 1, 1);
      },
    }),
  ],
});
