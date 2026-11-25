// CP05-052 報恩の技師・アイザック — Runecraft follower, 1, 1/1. グラブル・水属性.
// ファンファーレ『水晶のエレメント』1枚をEXエリアに置く。
// Q起動これをアクト：自分のデッキの上1枚を見る。それを墓場に置いてよい。
// (Fanfare - Put a 水晶のエレメント (CP05-T10) into your EX area. {[q]} {[act]} {[engage]}: look at the top card of your deck; you
// may put it into your cemetery (CR 5.11, 5.34) — not revealed, it stays on top otherwise. Quick (CR 12.3.3): in your main phase
// and at quick timing, also in the turn it came (CR 10.4.6.1).)
import { activated, defineCard, fanfare } from "../helpers";
import { lookAtTopMayBury } from "../BP09/shared";
import { WATER_ELEMENT } from "./shared";

export default defineCard({
  abilities: [
    fanfare({
      *resolve(fx) {
        yield* fx.tokensToEx([WATER_ELEMENT]);
      },
    }),
    activated(
      { engageSelf: true },
      {
        quick: true,
        *resolve(fx) {
          yield* lookAtTopMayBury(fx);
        },
      },
    ),
  ],
});
