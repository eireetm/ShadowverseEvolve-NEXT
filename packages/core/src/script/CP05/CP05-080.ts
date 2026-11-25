// CP05-080 降魔の操者・ダヌア — Abysscraft follower, 1, 1/1. グラブル・光属性.
// 進化コスト1：これは進化する。
// ({[evolve]} {[cost01]}: Evolve this follower.)
import { defineCard, evolveAbility } from "../helpers";

export default defineCard({
  abilities: [evolveAbility(1)],
});
