// CP05-098 魔杖の外科医・ティコ (evolved) — Havencraft, 2/2. グラブル・光属性.
// 【進化時】『光晶のエレメント』1枚をEXエリアに置く。自分の場に元のコスト5のグラブル・フォロワーがいるなら、自分のリーダーは体力+2する。
// (On Evolve - Put a 光晶のエレメント into your EX area. If there is a Granblue follower of original cost 5 on your field, give your
// leader +2 defense — not this one: an evolved follower has its base card's cost, 1 (CR 5.16.1.2). Super-evolving triggers it
// too (CP05-092's ruling Q2872).)
import { defineCard, onEvolve } from "../helpers";
import { tikoEffect } from "./haven-shared";

export default defineCard({
  abilities: [onEvolve({ resolve: tikoEffect })],
});
