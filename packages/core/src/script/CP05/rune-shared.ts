// Shared pieces of the CP05 Runecraft (ウィッチ) scripts (not a card: the file name has no set prefix).
import type { CardId } from "../../model/ids";
import type { GameReader } from "../../engine/query";
import { discardA } from "../costs";
import { activated, whenThisIsUncapped } from "../helpers";
import { and, enemyFollower, hasTrait, inYourZone, isFollower, isQuickActivatedFollower, isSpell } from "../targets";
import type { ActivatedAbility, AutomaticAbility } from "../types";

/**
 * CP05-041 / 042 「起動これをアクト手札のグラブル・カード1枚を捨てる：相手の場のフォロワー1体を選ぶ。それに2ダメージ。」 — {[act]}
 * {[engage]}, discard a Granblue card from your hand (another card than this one): select an enemy follower on the field and deal
 * it 2 damage. Not quick (CR 12.3.3); the engage cost may be paid in the turn the card came (CR 10.4.6.1).
 */
export const alchemistAct: ActivatedAbility = activated(
  { engageSelf: true, custom: discardA(hasTrait("グラブル")) },
  {
    targets: [enemyFollower()],
    *resolve(fx) {
      yield* fx.dealDamage(fx.targets[0]![0]!, 2);
    },
  },
);

/**
 * CP05-049 / 050 「これが上限解放したとき、自分の墓場のグラブル・フォロワー1枚を選ぶ。それを手札に加える。」 (CR JP 14.6.4.1): the
 * cemetery is a public zone, so the card is a target that must be there: not played without one (CR 10.6.2.3.3).
 */
export const uncappedReturnsGranblue: AutomaticAbility = whenThisIsUncapped({
  targets: [inYourZone("cemetery", { filter: and(isFollower, hasTrait("グラブル")) })],
  *resolve(fx) {
    yield* fx.returnToHand(fx.targets[0]!);
  },
});

/**
 * CP05-039 「クイックを持つスペルやQ起動能力を持つフォロワー」 among the cards of a deck: a spell with Quick printed alone (CR
 * 12.3.2) — a "has Quick while ..." doesn't work in a deck, where the card can't be played (CR 12.3.6) — or a follower with a
 * quick activated ability printed on it (CR 12.3.3), wherever that ability works.
 */
export function quickCardInDeck(g: GameReader, id: CardId): boolean {
  const card = g.card(id);
  return card !== undefined && ((isSpell(g, id) && g.printedKeywords(card.def).includes("quick")) || isQuickActivatedFollower(g, id));
}
