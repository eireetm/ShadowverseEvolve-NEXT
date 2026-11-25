// CP05-T07 ハクタク — Runecraft follower token, 4, 4/6. グラブル・水属性.
// 【突進】【指定攻撃】【守護】（【指定攻撃】を持つフォロワーは、スタンド状態のフォロワーを攻撃できる）
// Q起動コスト1：自分のリーダーは体力+2する。この能力は1ターンに1回使える。
// (Rush, Assail, Ward (CR 12.10, 12.11, 12.8; the parenthesis only reminds what Assail does). {[q]} {[act]} {[cost01]}: give your
// leader {[defense]}+2 — quick (CR 12.3.3), once per turn. CP05-047 summons it.)
import { activated, defineCard } from "../helpers";

export default defineCard({
  keywords: ["rush", "assail", "ward"],
  abilities: [
    activated(
      { playPoints: 1 },
      {
        quick: true,
        oncePerTurn: true,
        *resolve(fx) {
          yield* fx.giveLeaderDefense(fx.controller, 2);
        },
      },
    ),
  ],
});
