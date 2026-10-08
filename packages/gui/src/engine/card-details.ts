import type { CardId, GameReader, PlayerView } from "@sve/core";
import type { CardRuntimeDetails } from "./protocol";
import { forEachCard } from "./view-utils";

/** Presentation only: never visit hidden instances or copy scripts, effects or their sources into an update. */
export function cardRuntimeDetails(reader: GameReader, view: PlayerView): Record<CardId, CardRuntimeDetails> {
  const details: Record<CardId, CardRuntimeDetails> = {};
  forEachCard(view, (card) => {
    details[card.id] = {
      enteredFieldThisTurn: reader.enteredFieldThisTurn(card.id),
      boxed: reader.isBoxed(card.id),
      abilitiesLost: reader.info(card.id).abilitiesLostAt !== null,
      cannotAttack: reader.cannotAttackByEffect(card.id),
      cannotAttackLeader: reader.cannotAttackLeaderByEffect(card.id),
      cannotDealDamage: reader.cannotDealDamage(card.id),
      // The engine creates maneuver with endOfTurn and removes it when it expires. No type/stat calculation here.
      maneuveredThisTurn: reader.state.effects.some(
        (e) => e.target === card.id && e.change.kind === "maneuver" && e.until === "endOfTurn" && e.createdTurn === reader.state.turn,
      ),
    };
  });
  return details;
}
