// CP05-041 開闢の錬金術師・カリオストロ — Runecraft follower, 2, 2/2. グラブル・土属性・光属性・闇属性.
// 進化コスト1：これは進化する。
// ファンファーレ自分のPP最大値が7以上なら、『アルス・マグナ』1枚と『ヒヒイロカネ』1枚をEXエリアに置く。
// 起動これをアクト手札のグラブル・カード1枚を捨てる：相手の場のフォロワー1体を選ぶ。それに2ダメージ。
// (Evolve {[cost01]}. Fanfare - If your maximum play points are at least 7 (when it resolves), put an アルス・マグナ (CP05-T08) and
// a ヒヒイロカネ (CP05-T15) into your EX area; with room for one of them only, you choose which (ruling Q2899, CR 4.8.3.2).
// {[act]} {[engage]}, discard a Granblue card from your hand: select an enemy follower on the field and deal it 2 damage (not
// quick; the engage cost may be paid in the turn it came, CR 10.4.6.1).)
import { defineCard, evolveAbility, fanfare } from "../helpers";
import { alchemistAct } from "./rune-shared";
import { ARS_MAGNA, HIHIIROKANE } from "./shared";

export default defineCard({
  abilities: [
    evolveAbility(1),
    fanfare({
      condition: (g, c) => g.state.players[c].maxPlayPoints >= 7,
      *resolve(fx) {
        yield* fx.tokensToEx([ARS_MAGNA, HIHIIROKANE]);
      },
    }),
    alchemistAct,
  ],
});
