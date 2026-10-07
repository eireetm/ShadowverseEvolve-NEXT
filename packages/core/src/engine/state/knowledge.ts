import type { PlayerId } from "../../model/ids";
import type { CardInstance, GameState, PlayerZone } from "../../model/state";
import { cardVisibleTo } from "../../view/visibility";

/**
 * What each player has been shown of the cards now hidden from them (CardInstance.knownBy): bookkeeping, not a rule. The
 * rules only say who may look at a card when (CR 4.1.2: hand 4.7.2, deck 4.5.2, evolve deck 4.6.2; reveal 5.21.1, look
 * 5.11.1, search 5.8.1.2); a player who was shown a card remembers it after it is hidden again (a card searched and revealed
 * into a hand, a follower returned to its owner's hand, a card looked at and put back on the deck). Nothing in the game reads
 * it: the view shows it to that player, and determinize() keeps such cards instead of dealing them again.
 *
 * It must never hold more than the player could know, so it is forgotten whenever that is unclear:
 *  - a shuffle (CR 5.9.1) forgets every card of the deck (not with 0–1 cards, 5.9.1.1);
 *  - two or more cards put into a deck together are in an order only the deck's owner decides and sees (CR 4.1.5, 4.1.5.1);
 *  - a card leaving a zone hidden from a player, unseen by them and still hidden from them afterwards, makes that player forget
 *    every card of the zone it left (they can't tell which one it was: CR 4.7.2 a hand has no public order); one that becomes
 *    visible makes them forget only the cards of that zone with the same definition (which of them left is unclear).
 */

/** Can `player` see this card now: its zone (CR 4.1.2) or a reveal in progress (CR 5.21.1). */
export function seenBy(state: GameState, card: CardInstance, player: PlayerId): boolean {
  return cardVisibleTo(card, player) || state.revealed.includes(card.id);
}

/** `player` has been shown this card: they know it while it is hidden from them (nothing to note while they can see it). */
export function noteKnown(state: GameState, card: CardInstance, player: PlayerId): void {
  if (seenBy(state, card, player) || card.knownBy?.includes(player)) return;
  card.knownBy = [...(card.knownBy ?? []), player].sort();
}

/** `player` (or everyone) no longer knows this card. */
export function forgetKnown(card: CardInstance, player?: PlayerId): void {
  if (!card.knownBy) return;
  const left = player === undefined ? [] : card.knownBy.filter((p) => p !== player);
  if (left.length > 0) card.knownBy = left;
  else delete card.knownBy;
}

/** Every card of a player's zone: `player` (or everyone) forgets them. */
export function forgetZone(state: GameState, owner: PlayerId, zone: PlayerZone, player?: PlayerId, sameDef?: string): void {
  for (const id of state.players[owner].zones[zone]) {
    const card = state.cards[id]!;
    if (sameDef === undefined || card.def === sameDef) forgetKnown(card, player);
  }
}
