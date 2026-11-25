// CP05-033 眠れる輝竜・アーサー — Swordcraft follower, 2, 1/2. グラブル・風属性.
// このターン、自分の場のフォロワーが上限解放や最終上限解放を合わせて3回以上していたなら、これは【突進】【指定攻撃】【必殺】を持つ。
// ファンファーレ自分の場に『眠れる獅子・モルドレッド』がいないなら、自分のデッキから『眠れる獅子・モルドレッド』1枚を探し、場に出す。
// (While your followers have uncapped and final-uncapped at least 3 times in all this turn, this has Rush, Assail and Bane — a
// passive on the field (CR 10.3.5), at once when the third happens; ヒヒイロカネ doing both counts 2 (ruling Q2888). Fanfare - If
// there is no 眠れる獅子・モルドレッド (CP05-034) on your field, search your deck for one and put it onto your field — checked when
// it resolves: of two entering together, the first finds one and the second doesn't (ruling Q2889).)
import { defineCard } from "../helpers";
import { MORDRED } from "./shared";
import { fetchPartner, keywordsAfterThreeUncaps } from "./sword-shared";

export default defineCard({
  selfKeywords: keywordsAfterThreeUncaps(["rush", "assail", "bane"]),
  abilities: [fetchPartner(MORDRED)],
});
