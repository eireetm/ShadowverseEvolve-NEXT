// Shared pieces of the CP05 Dragoncraft scripts (not a card: the file name has no set prefix).
import type { CardId, PlayerId } from "../../model/ids";
import type { GameReader } from "../../engine/query";
import type { EffectContext } from "../../engine/effects/context";
import type { Proc } from "../../engine/runtime/proc";
import type { CustomCost } from "../types";
import { hasTrait, isEvolvedFollower } from "../targets";

type Filter = (game: GameReader, card: CardId) => boolean;

/**
 * "自分のエボルヴデッキの裏向きの土属性・エボルヴフォロワーN枚（まで）を表向きにしてよい" (CP05-054, 060, 069): the player turns up to
 * `max` facedown earth (or 全属性, CR JP 14.6.2.2) evolved followers of their evolve deck faceup (CR 4.6.3), none if they like
 * (てよい). Not a selection (選ぶ): they pick among their own cards there (CR 4.6.2).
 */
export function* turnEarthEvolvedFaceup(fx: EffectContext, max: number): Proc<void> {
  const g = fx.game;
  const down = g.faceDownEvolveDeck(fx.controller).filter((id) => isEvolvedFollower(g, id) && hasTrait("土属性")(g, id));
  if (down.length === 0) return;
  yield* fx.turnFaceup(yield* fx.chooseCards(down, 0, Math.min(max, down.length)));
}

/**
 * "自分のデッキの上1枚を見る。その中から、<属性>・カード1枚を公開して手札に加えてよい。" (CP05-056, 061, 066): look at the top card of the
 * deck (CR 5.11.1); one matching `filter` may be revealed and put into the hand. Nothing moves a card that isn't taken: it stays
 * on top, unrevealed (the rulings of the same text on BP15-072 and BP17-099).
 */
export function* lookAtTopMayTake(fx: EffectContext, filter: Filter): Proc<void> {
  const top = fx.topCards(1);
  const chosen = yield* fx.selectCards(top.filter((id) => filter(fx.game, id)), 0, 1, fx.controller, top);
  if (chosen.length === 0) return;
  yield* fx.reveal(chosen);
  yield* fx.returnToHand(chosen);
}

/** The fire (or 全属性, CR JP 14.6.2.2) cards in a player's hand. */
export const fireCardsInHand = (g: GameReader, player: PlayerId): CardId[] =>
  g.cards(player, "hand").filter((id) => hasTrait("火属性")(g, id));

/**
 * "手札の火属性・カードX枚を公開" (CP05-057): reveal X fire cards from the hand (CR 5.21), X chosen by the player (CR 10.6.2.2.4) — at
 * least 1 (none would do nothing) and at least the number of followers selected to divide X among, each getting at least 1
 * (CR 10.6.2.4.2). The engine selects the targets before it pays (CR 10.6.2.3, 10.6.2.5), so choosing X then offers the same
 * choices as choosing it first. `fx.memory.x` is X for the effect.
 */
export const revealFireX: CustomCost = {
  canPay: (g, c) => fireCardsInHand(g, c).length >= 1,
  *pay(fx) {
    const cards = fireCardsInHand(fx.game, fx.controller);
    const shown = yield* fx.chooseCards(cards, Math.max(1, fx.targets[0]?.length ?? 0), cards.length);
    yield* fx.reveal(shown);
    fx.memory.x = shown.length;
  },
};

/** X of an ability whose cost recorded it (revealFireX). */
export const paidX = (fx: EffectContext): number => Number(fx.memory.x ?? 0);

/**
 * "それのリーダー" (CP05-057, 060, 068): the leader of the selected follower's controller — of the player it last was on the field
 * of, if it has left it since (CR 10.11.1): it was an enemy follower when it was selected.
 */
export function leaderOf(fx: EffectContext, follower: CardId): CardId {
  const c = fx.game.card(follower);
  return fx.game.leader(c?.zone === "field" ? c.controller : fx.game.opponent(fx.controller));
}
