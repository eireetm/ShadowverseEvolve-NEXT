// CP05-034 眠れる獅子・モルドレッド — Swordcraft follower, 2, 2/1. グラブル・風属性.
// このターン、自分の場のフォロワーが上限解放や最終上限解放を合わせて3回以上していたなら、これは【疾走】を持つ。
// ファンファーレ自分の場に『眠れる輝竜・アーサー』がいないなら、自分のデッキから『眠れる輝竜・アーサー』1枚を探し、場に出す。
// (While your followers have uncapped and final-uncapped at least 3 times in all this turn, this has Storm — a passive on the
// field (CR 10.3.5), at once when the third happens, so this turn it may attack a leader (CR 12.9); ヒヒイロカネ doing both
// counts 2 (ruling Q2890). Fanfare - If there is no 眠れる輝竜・アーサー (CP05-033) on your field, search your deck for one and put
// it onto your field — checked when it resolves: of two entering together, the second doesn't (ruling Q2891).)
import { defineCard } from "../helpers";
import { ARTHUR } from "./shared";
import { fetchPartner, keywordsAfterThreeUncaps } from "./sword-shared";

export default defineCard({
  selfKeywords: keywordsAfterThreeUncaps(["storm"]),
  abilities: [fetchPartner(ARTHUR)],
});
