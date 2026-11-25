// CP05-T05 竜殺しの騎士・ジークフリート — Swordcraft follower token, 3, 3/4. グラブル・土属性.
// 【守護】（これが場に出たときか、自分のエンドフェイズにこれをアクトできる。相手は、アクト状態の【守護】を持つフォロワー以外を攻撃できない）
// ファンファーレ相手の場のアクト状態のフォロワー1体を選ぶ。それを破壊する。『土晶のエレメント』1枚をEXエリアに置く。
// (Ward. Fanfare - Select an engaged enemy follower on the field and destroy it, then put a 土晶のエレメント (CP05-T11) into your
// EX area. Without such a follower to select it can't be played: no element (ruling Q2927, CR 10.6.2.3.3). The parenthesis is
// reminder text, CR 2.6.2.)
import { defineCard, fanfare } from "../helpers";
import { enemyFollower } from "../targets";
import { EARTH_ELEMENT } from "./shared";

export default defineCard({
  keywords: ["ward"],
  abilities: [
    fanfare({
      targets: [enemyFollower({ filter: (g, id) => g.card(id)?.engaged === true })],
      *resolve(fx) {
        yield* fx.destroy(fx.targets[0]!);
        yield* fx.tokensToEx([EARTH_ELEMENT]);
      },
    }),
  ],
});
