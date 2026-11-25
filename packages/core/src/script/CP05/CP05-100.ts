// CP05-100 天象の風・ペトラ — Havencraft follower, 1, 1/2. グラブル・風属性.
// ファンファーレ相手の場のフォロワー1体を選ぶ。それは次のそれのプレイヤーのスタートフェイズにスタンドしない。『風晶のエレメント』1枚をEXエリアに
// 置く。
// (Fanfare - Select an enemy follower on the field: it doesn't refresh in its controller's next start phase (an exception to
// CR 7.2.3; the same Japanese as BP14-062 — a reserved one isn't engaged by it). Put a 風晶のエレメント into your EX area.
// Without an enemy follower to select it isn't played: no element (ruling Q2919).)
import { defineCard, fanfare } from "../helpers";
import { enemyFollower } from "../targets";
import { WIND_ELEMENT } from "./shared";

export default defineCard({
  abilities: [
    fanfare({
      targets: [enemyFollower()],
      *resolve(fx) {
        yield* fx.skipNextRefresh(fx.targets[0]![0]!);
        yield* fx.tokensToEx([WIND_ELEMENT]);
      },
    }),
  ],
});
