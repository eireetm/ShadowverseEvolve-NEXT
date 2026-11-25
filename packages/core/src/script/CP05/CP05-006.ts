// CP05-006 絢爛の紡ぎ手・コルワ (evolved) — Forestcraft, 3/3. グラブル・風属性.
// 自分のエンドフェイズが来たとき、このターン、自分の場のフォロワーが上限解放や最終上限解放を合わせて3回以上していたなら、『フィル』1枚を
// EXエリアに置く。
// 【進化時】自分のデッキから元のコスト1の風属性・カード1枚を探し、手札に加える。
// (At the start of your end phase, with 3 or more uncaps and final uncaps of your followers this turn, a フィル into your EX
// area, as CP05-005 — ruling Q2873. On Evolve - Search your deck for a wind card with an original cost of exactly 1 (a 全属性
// one too, CR JP 14.6.2.2; CR 5.24.1), reveal it and add it to your hand, then shuffle — it may not be found, CR 4.1.2.2,
// 5.8.1.2, 5.8.2.)
import { defineCard, onEvolve } from "../helpers";
import { hasTrait } from "../targets";
import { korwaEndPhase } from "./forest-shared";

export default defineCard({
  abilities: [
    korwaEndPhase,
    onEvolve({
      *resolve(fx) {
        const g = fx.game;
        yield* fx.search((id) => g.info(id).cost === 1 && hasTrait("風属性")(g, id));
      },
    }),
  ],
});
