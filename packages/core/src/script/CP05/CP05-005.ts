// CP05-005 絢爛の紡ぎ手・コルワ — Forestcraft follower, 2, 2/2. グラブル・風属性.
// 進化コスト1：これは進化する。
// 自分のエンドフェイズが来たとき、このターン、自分の場のフォロワーが上限解放や最終上限解放を合わせて3回以上していたなら、『フィル』1枚を
// EXエリアに置く。
// ファンファーレ『風晶のエレメント』1枚をEXエリアに置く。
// (Evolve (1). At the start of your end phase, if followers on your field were uncapped or final-uncapped 3 or more times in
// total this turn, put a フィル spell token into your EX area — each event counts, ヒヒイロカネ doing both counts 2: ruling
// Q2873; checked as it resolves. Fanfare - Put a 風晶のエレメント into your EX area. The text after the line describes the
// token, CR 2.9.2.)
import { defineCard, evolveAbility, fanfare } from "../helpers";
import { korwaEndPhase } from "./forest-shared";
import { WIND_ELEMENT } from "./shared";

export default defineCard({
  abilities: [
    evolveAbility(1),
    korwaEndPhase,
    fanfare({
      *resolve(fx) {
        yield* fx.tokensToEx([WIND_ELEMENT]);
      },
    }),
  ],
});
