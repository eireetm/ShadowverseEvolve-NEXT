// CP05-084 心眼の双葬女・レディ・グレイ — Abysscraft follower, 2, 0/2. グラブル・闇属性.
// 進化コスト1：これは進化する。
// 【ドレイン】(【ドレイン】を持つフォロワーが攻撃して与えたダメージと同じだけ、自分のリーダーは体力を+する)
// 自分が手札の闇属性・カード1枚を捨てたとき、これは攻撃力+1する。
// ファンファーレ『闇晶のエレメント』1枚をEXエリアに置く。
// ({[evolve]} {[cost01]}: Evolve this follower. Drain (CR 12.13). Whenever you discard a dark (or 全属性, CR JP 14.6.2.2) card from your
// hand, this gets +1 attack — once per card (ruling Q2915), in either player's turn (Q2914), with no duration (CR 10.9.2), kept when it
// evolves (CR 5.16.2.1). Fanfare - Put a 闇晶のエレメント into your EX area (a treasure token, CR JP 14.6.1, CR 5.5.2; not with a full EX
// area, CR 4.8.3.2).)
import { defineCard, evolveAbility, fanfare } from "../helpers";
import { ladyGreyGrows } from "./abyss-shared";
import { DARK_ELEMENT } from "./shared";

export default defineCard({
  keywords: ["drain"],
  abilities: [
    evolveAbility(1),
    ladyGreyGrows,
    fanfare({
      *resolve(fx) {
        yield* fx.tokensToEx([DARK_ELEMENT]);
      },
    }),
  ],
});
