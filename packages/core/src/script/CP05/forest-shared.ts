// Shared pieces of CP05 Forestcraft card scripts (not a card: the file name has no set prefix).
import type { PlayerId } from "../../model/ids";
import type { GameReader } from "../../engine/query";
import { atStartOfYourEndPhase } from "../helpers";
import { FIL } from "./shared";

/**
 * "このターン、自分の場のフォロワーが上限解放や最終上限解放を合わせて3回以上していたなら" (CP05-005, 006, 011): the uncaps and
 * final uncaps of followers on your field this turn, counted as events (CR JP 14.6.4.1 / JP 14.6.4.2): ヒヒイロカネ doing both
 * counts 2 (rulings Q2873, Q2877), and a follower that left the field since still counts (CP03-007 Q3's reading of the same
 * shape). Checked as the ability resolves, not when it triggers (BP08-071, BP10-109 rulings); not met then, it does nothing.
 */
export const threeUncapsThisTurn = (g: GameReader, p: PlayerId): boolean => g.uncapsThisTurn(p) >= 3;

/**
 * CP05-005 / 006 "自分のエンドフェイズが来たとき、このターン、自分の場のフォロワーが上限解放や最終上限解放を合わせて3回以上していたなら、
 * 『フィル』1枚をEXエリアに置く。" (At the start of your end phase, CR 7.4.1, with 3 uncaps this turn: a フィル spell token into
 * your EX area, CR 5.5.2 — none with a full EX area, CR 4.8.3.2.)
 */
export const korwaEndPhase = atStartOfYourEndPhase({
  condition: threeUncapsThisTurn,
  *resolve(fx) {
    yield* fx.tokensToEx([FIL]);
  },
});
