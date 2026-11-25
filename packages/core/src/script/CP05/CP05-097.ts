// CP05-097 魔杖の外科医・ティコ — Havencraft follower, 1, 1/1. グラブル・光属性.
// 進化コスト1：これは進化する。
// ファンファーレ『光晶のエレメント』1枚をEXエリアに置く。自分の場に元のコスト5のグラブル・フォロワーがいるなら、自分のリーダーは体力+2する。
// (Evolve (1). Fanfare - Put a 光晶のエレメント into your EX area. If there is a Granblue follower of original cost 5 (CR 5.24.1)
// on your field, give your leader +2 defense — the condition is only the second sentence's.)
import { defineCard, evolveAbility, fanfare } from "../helpers";
import { tikoEffect } from "./haven-shared";

export default defineCard({
  abilities: [evolveAbility(1), fanfare({ resolve: tikoEffect })],
});
