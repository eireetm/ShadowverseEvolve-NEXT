// CP05-T15 ヒヒイロカネ — Neutral treasure token (CR JP 14.6.1). グラブル.
// 起動コスト0：自分の場のグラブル・フォロワー1体を選ぶ。それは上限解放する。それが【最終上限解放可能】を持つなら、さらにそれは
// 最終上限解放する。
// ({[act]} {[cost00]}: select a Granblue follower on your field; it uncaps; if it has Final Uncap, it also final-uncaps — the
// same card does both, both "when this uncaps / final-uncaps" trigger, in any order: rulings Q2867, Q2868. An uncapped one only
// final-uncaps: the second sentence has only its own condition (decided by the project owner, 2026-11-24).)
import { defineCard, uncapAbility } from "../helpers";

export default defineCard({
  abilities: [uncapAbility("グラブル", "also")],
});
