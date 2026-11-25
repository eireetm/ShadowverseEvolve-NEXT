// CP05-036 信念の蹴撃・ランドル — Swordcraft follower, 4, 2/1. グラブル・風属性.
// これをプレイする際、コストを-Xする。Xは「このターン中に自分の場のフォロワーが上限解放や最終上限解放をした回数」である。
// 【疾走】
// 自分のエンドフェイズが来たとき、これを手札に戻す。
// (This costs X less to play, X = how many times your followers uncapped and final-uncapped this turn, counted when its cost is
// determined (CR 10.6.2.5): ヒヒイロカネ doing both counts 2 (ruling Q2892); not below 0 (CR 1.3.2.2.1). Storm. At the start of
// your end phase (CR 7.4.1), return this to your hand.)
import { atStartOfYourEndPhase, defineCard } from "../helpers";

export default defineCard({
  keywords: ["storm"],
  playCost: (g, _self, player) => -g.uncapsThisTurn(player),
  abilities: [
    atStartOfYourEndPhase({
      *resolve(fx) {
        if (fx.game.card(fx.self)?.zone === "field") yield* fx.returnToHand([fx.self]);
      },
    }),
  ],
});
