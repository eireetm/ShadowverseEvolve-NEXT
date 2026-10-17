// Cards that went into a hand where every player saw them: searched or taken from the deck after being revealed (CR 5.8.1.2,
// 5.21.1), or taken from a cemetery, a public zone (CR 4.9.2). The table shows them a moment (the other player's face up),
// and the game waits for that. Worked out from the core's own events, which the engine worker has whole: a card revealed in
// the deck keeps its id until it moves, and its move into the hand names that id. For the other player the move is hidden
// (no card leaves a deck by name, redactEvent), so only the worker can tie the two; what it passes on is public anyway.
import type { CardId, GameEvent, PlayerId } from "@sve/core";
import type { ToHandCard } from "./protocol";

/**
 * The cards revealed in the resolution going on, and whether their deck was shuffled since (then a draw is a random card,
 * CR 5.21.1.1). A reveal ends with its effect (5.21.1.1): a new card or ability played clears it, as a new turn does.
 */
export type Revealing = Map<CardId, { shuffled: boolean }>;

/** The cards these events put into a hand in public, in order; `revealing` is kept up from one answer's events to the next. */
export function revealedToHand(events: readonly GameEvent[], revealing: Revealing): ToHandCard[] {
  const out: ToHandCard[] = [];
  for (const event of events) {
    switch (event.type) {
      case "cardPlayed":
      case "abilityPlayed":
      case "turnStarted":
        revealing.clear();
        break;
      case "cardsRevealed":
        for (const card of event.cards) revealing.set(card.id, { shuffled: false });
        break;
      case "deckShuffled":
        for (const entry of revealing.values()) entry.shuffled = true;
        break;
      case "cardsMoved":
        for (const move of event.moves) {
          if (move.to.zone !== "hand" || !move.newCard || !move.card) continue;
          const revealed = move.from?.zone === "deck" ? revealing.get(move.card) : undefined;
          const shown = move.from?.zone === "cemetery" || (revealed !== undefined && !(revealed.shuffled && move.reason === "draw"));
          if (shown) out.push({ player: move.to.player as PlayerId, id: move.newCard, card: { def: move.def, printing: move.printing || null } });
          revealing.delete(move.card);
        }
        break;
      default:
        break;
    }
  }
  return out;
}
