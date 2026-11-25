// Shared pieces of the CP05 Swordcraft scripts (not a card: the file name has no set prefix).
import type { CardId, PlayerId } from "../../model/ids";
import type { Keyword } from "../../model/keyword";
import type { GameReader } from "../../engine/query";
import { atStartOfYourEndPhase, fanfare } from "../helpers";
import { named } from "../targets";
import type { AutomaticAbility } from "../types";

/**
 * "このターン、自分の場のフォロワーが上限解放や最終上限解放を合わせて3回以上していたなら" (CP05-027, 028, 033, 034): this turn the
 * player's followers uncapped and final-uncapped at least 3 times in all (CR JP 14.6.4.1, JP 14.6.4.2). Each one counts once,
 * so ヒヒイロカネ doing both counts 2 (rulings Q2886, Q2888, Q2890); one where nothing was done doesn't count; one whose follower
 * has left the field since still does — it happened (CP03-007 Q3, the same "this turn ... did N times"). It reads no card's
 * information, so the keyword passives may use it (CP05-033, 034: `selfKeywords` must not ask `info`).
 */
export function threeUncapsThisTurn(g: GameReader, player: PlayerId): boolean {
  return g.uncapsThisTurn(player) >= 3;
}

/**
 * CP05-027 / 028 "自分のエンドフェイズが来たとき、このターン、…3回以上していたなら、相手のリーダーすべてに2ダメージ。": at the start of
 * your end phase (CR 7.4.1); the "if" is checked when it resolves, deal 2 damage to each enemy leader (the opponent's).
 */
export const endPhaseTwoDamage: AutomaticAbility = atStartOfYourEndPhase({
  condition: (g, c) => threeUncapsThisTurn(g, c),
  *resolve(fx) {
    yield* fx.dealDamage(fx.game.leader(fx.game.opponent(fx.controller)), 2);
  },
});

/**
 * CP05-033 / 034 "このターン、…3回以上していたなら、これは【…】を持つ": a passive, so on the field only (CR 10.3.5): the keywords come as
 * soon as the third uncap happens (an attack can use them at once, BP17-111's ruling on the same kind of passive) and go when
 * the turn ends.
 */
export function keywordsAfterThreeUncaps(keywords: readonly Keyword[]): (g: GameReader, self: CardId) => readonly Keyword[] {
  return (g, self) => (g.card(self)?.zone === "field" && threeUncapsThisTurn(g, g.controller(self)) ? keywords : []);
}

/**
 * CP05-033 / 034 "ファンファーレ自分の場に『X』がいないなら、自分のデッキから『X』1枚を探し、場に出す。": the "if" is checked when the
 * Fanfare resolves (rulings Q2889, Q2891: of two entering together, the second finds one on the field); a search with a
 * condition need not find it (CR 4.1.2.2) and reveals what it finds (CR 5.8.1.2).
 */
export function fetchPartner(name: string): AutomaticAbility {
  return fanfare({
    condition: (g, c) => !g.cards(c, "field").some((id) => named(name)(g, id)),
    *resolve(fx) {
      yield* fx.search((id) => named(name)(fx.game, id), { to: "field" });
    },
  });
}
