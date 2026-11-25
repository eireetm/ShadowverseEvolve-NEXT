// CP05-095 七宝石の姫・レ・フィーエ — Havencraft follower, 5, 3/5. グラブル・光属性.
// 【守護】
// 自分のエンドフェイズが来たとき、自分のリーダーは体力+1する。自分の場の元のコスト5のグラブル・フォロワーが3体以上なら、代わりに体力+3する。
// ファンファーレ相手の場のフォロワー1体を選ぶ。それを消滅させる。『光晶のエレメント』1枚をEXエリアに置く。
// (Ward. At the start of your end phase (CR 7.4.1), give your leader +1 defense — +3 instead with at least 3 Granblue followers
// of original cost 5 on your field, this one counted (CR 5.24.1; an evolved one by its base card's cost, CR 5.16.1.2): one or
// the other, decided as it resolves. Fanfare - Select an enemy follower on the field and banish it (CR 5.7.1); put a
// 光晶のエレメント into your EX area. Without an enemy follower to select it isn't played: no element (ruling Q2918).)
import { atStartOfYourEndPhase, defineCard, fanfare } from "../helpers";
import { enemyFollower } from "../targets";
import { granblueCost5OnField } from "./haven-shared";
import { LIGHT_ELEMENT } from "./shared";

export default defineCard({
  keywords: ["ward"],
  abilities: [
    atStartOfYourEndPhase({
      *resolve(fx) {
        yield* fx.giveLeaderDefense(fx.controller, granblueCost5OnField(fx.game, fx.controller) >= 3 ? 3 : 1);
      },
    }),
    fanfare({
      targets: [enemyFollower()],
      *resolve(fx) {
        yield* fx.banish(fx.targets[0]!);
        yield* fx.tokensToEx([LIGHT_ELEMENT]);
      },
    }),
  ],
});
