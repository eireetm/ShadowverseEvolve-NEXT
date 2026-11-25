// CP05-013 緋焔の踊り子・アンスリア — Forestcraft follower, 3, 3/3. グラブル・火属性.
// 進化コスト1：これは進化する。
// ファンファーレ手札の火属性・カード3枚を公開：『火晶のエレメント』1枚をEXエリアに置く。自分のリーダーは体力+2する。
// (Evolve (1). Fanfare, reveal 3 fire cards from your hand (a 全属性 card is one, CR JP 14.6.2.2): put a 火晶のエレメント into
// your EX area and give your leader +2 defense — both only if it is paid, CR 10.4.7.2; the controller may decline,
// CR 10.4.7.4; with a full EX area only the defense, CR 4.8.3.2.)
import { revealFromHand } from "../costs";
import { defineCard, evolveAbility, fanfare } from "../helpers";
import { hasTrait } from "../targets";
import { FIRE_ELEMENT } from "./shared";

export default defineCard({
  abilities: [
    evolveAbility(1),
    fanfare({
      cost: revealFromHand(hasTrait("火属性"), 3),
      *resolve(fx) {
        yield* fx.tokensToEx([FIRE_ELEMENT]);
        yield* fx.giveLeaderDefense(fx.controller, 2);
      },
    }),
  ],
});
