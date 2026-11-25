// Shared pieces of CP05 Abysscraft card scripts (not a card: the file name has no set prefix).
//
// The class's cards are built around discarding dark cards (闇属性・カード): a reference to the 闇属性 trait also references
// 全属性 (CR JP 14.6.2.2), as hasTrait / traitMatches do.
import type { DefId } from "../../model/card";
import type { CardId } from "../../model/ids";
import type { EffectContext } from "../../engine/effects/context";
import type { GameReader } from "../../engine/query";
import type { Proc } from "../../engine/runtime/proc";
import { traitMatches } from "../../model/traits";
import { playPointsCost } from "../costs";
import { whenDiscardedByYourCard, whenThisIsFinalUncapped, whenYouDiscard, type TimingSpec } from "../helpers";
import { anotherYourFollower, hasTrait, named } from "../targets";
import type { AutomaticAbility } from "../types";

/** "闇属性・カード" — a card of the 闇属性 type, or of 全属性 (CR JP 14.6.2.2). */
export const darkCard = hasTrait("闇属性");

/**
 * "（自分のターン中、）自分の闇属性・カードの能力によってこれを自分の手札から捨てたとき" (CP05-072, 076, 082): valid in the hand (CR 10.3.4),
 * it triggers when an ability of a dark (or 全属性, CR JP 14.6.2.2) card you control — as that card was then — discards this card from
 * your hand: the ability's effect or its cost (an automatic ability's or an option's process, CR 10.4.7.4 / 10.4.7.5, an activated
 * ability's cost), and a spell's additional cost, which is part of the spell's text (CR 10.1.1.4; decided by the project owner,
 * 2026-11-24). A discard to the hand limit is no ability's (CR 7.4.7), nor is one by an opponent's card. `yourTurn`: "自分のターン中"
 * is part of the trigger condition (CR 10.1.1.2.1.1). `fx.self` is this card in the cemetery (CR 4.1.4.1).
 */
export function whenDiscardedByYourDarkCard(spec: TimingSpec, opts: { yourTurn?: boolean } = {}): AutomaticAbility {
  return whenDiscardedByYourCard(opts.yourTurn ? { triggerIf: (g, c) => g.activePlayer === c, ...spec } : spec, (cause) =>
    traitMatches(cause.traits, "闇属性"),
  );
}

/**
 * "これを場に出す" said of this card discarded from the hand: the card in the cemetery (CR 4.1.4.1) onto its owner's field (CR 4.1.6);
 * nothing once it has left the cemetery (CR 4.1.4: a new card), nor with a full field (CR 4.4.4.2).
 */
export function* summonThisFromCemetery(fx: EffectContext): Proc<void> {
  const card = fx.game.card(fx.self);
  if (card?.zone === "cemetery") yield* fx.putOntoField([fx.self], card.owner);
}

/**
 * "自分が手札の闇属性・カード1枚を捨てたとき、相手のリーダーすべてと相手の場のフォロワーすべてに1ダメージ。" (CP05-074 / 075): once per dark
 * card discarded (2 at once: twice, ruling Q2915), in either player's turn (Q2914), a discard as a cost and to the hand limit
 * (CR 7.4.7) too; the card is judged as it is in the cemetery (CR 10.7.4.1.1). The damage is dealt at the same time. A pending
 * instance still resolves after this follower has left the field (Q2916, CR 10.6.2.8.2.1).
 */
export const fedielDiscardBurst: AutomaticAbility = whenYouDiscard(
  {
    *resolve(fx) {
      const opponent = fx.game.opponent(fx.controller);
      yield* fx.dealDamageEach([fx.game.leader(opponent), ...fx.game.followers(opponent)], 1);
    },
  },
  darkCard,
);

/**
 * "自分が手札の闇属性・カード1枚を捨てたとき、これは攻撃力+1する。" (CP05-084 / 085): once per dark card (Q2915), in either player's turn
 * (Q2914). The +1 has no duration: it stays while the follower is on the field, also once it has evolved (CR 5.16.2.1, 10.9.2); a
 * follower that left the field first is a new card (CR 4.1.4) and gets nothing.
 */
export const ladyGreyGrows: AutomaticAbility = whenYouDiscard(
  {
    *resolve(fx) {
      if (fx.game.card(fx.self)?.zone === "field") yield* fx.giveStats(fx.self, 1, 0);
    },
  },
  darkCard,
);

/**
 * "これが最終上限解放したとき、コスト3：自分の場の他の闇属性・フォロワー2体まで選ぶ。それをスタンドする。" (CP05-076 / 077): {[cost03]} may be
 * left unpaid (CR 10.4.7.4); up to 2 (CR 10.6.2.3.2) other dark (or 全属性, CR JP 14.6.2.2) followers on your field are refreshed
 * (CR 5.4.1). The text doesn't ask for engaged ones: a reserved one may be selected, and nothing happens to it (CR 1.3.2.1).
 */
export const feriRefreshes: AutomaticAbility = whenThisIsFinalUncapped({
  cost: playPointsCost(3),
  targets: [anotherYourFollower({ count: 2, upTo: true, filter: darkCard })],
  *resolve(fx) {
    yield* fx.refresh((fx.targets[0] ?? []).filter((id) => fx.game.card(id)?.zone === "field"));
  },
});

/**
 * "「これと同名を除く…」" (CP05-075, 078): a card that doesn't have this card's name (CR 2.1.2). The name is read from `def`, this card's
 * definition, so it is still known once the card has left its zone (CR 10.11.1), and no card name is written in the script.
 */
export const notNamedAs =
  (def: DefId) =>
  (g: GameReader, id: CardId): boolean =>
    !named(g.db.get(def).name)(g, id);
