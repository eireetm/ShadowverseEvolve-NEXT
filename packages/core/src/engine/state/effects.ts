import type { CardId } from "../../model/ids";
import type { GameState, PersistentEffect } from "../../model/state";

/**
 * Is a persistent effect in force now?
 *  - Its duration: an "endOfOpponentsNextTurn" effect ("for the rest of this turn and during each opponent's next turn",
 *    BP02-090) applies in its creation turn and in turns of the controller's opponent, not in the controller's own later
 *    turns (e.g. an extra turn, CR 5.28). Other effects apply until they are removed.
 *  - An ability given to the card ("Give it '...'", CR 10.9.1.2; `givenBy`), also one its script makes an effect (BP08-024
 *    "this takes at most 3 damage"), is lost with the card's abilities: not while it has lost all abilities since it was
 *    given (BP05-061 ruling: the abilities it has then, printed or given; one given later works, cf. CR 5.31.2.1).
 */
export function effectInForce(state: Readonly<GameState>, e: PersistentEffect): boolean {
  if (!durationRunning(state, e)) return false;
  if (e.givenBy === undefined) return true;
  const at = abilitiesLostAt(state, e.target);
  return at === null || e.seq > at;
}

function durationRunning(state: Readonly<GameState>, e: PersistentEffect): boolean {
  if (e.until !== "endOfOpponentsNextTurn") return true;
  return state.turn === e.createdTurn || state.activePlayer !== e.controller;
}

/**
 * Timestamp of the latest "loses all abilities" effect in force on the card (BP05-061), or null.
 * Being Boxed is one too (CR 5.31.2, 5.31.2.1).
 */
export function abilitiesLostAt(state: Readonly<GameState>, id: CardId): number | null {
  let at: number | null = null;
  for (const e of state.effects) {
    if (e.target === id && (e.change.kind === "loseAbilities" || e.change.kind === "boxed") && durationRunning(state, e)) at = e.seq;
  }
  return at;
}

/**
 * BP03-039/040 — an effect is stopping this card's activated abilities. Evolve abilities stay
 * playable when the effect says "except Evolve".
 */
export function activationBlocked(state: Readonly<GameState>, card: string, evolve: boolean): boolean {
  return state.effects.some(
    (e) =>
      e.target === card &&
      effectInForce(state, e) &&
      e.change.kind === "cantActivate" &&
      !(evolve && e.change.exceptEvolve),
  );
}

/** CR 8.4.3 — an effect says this follower can't attack enemy leaders (a Stand Trigger, CR 14.4.5.1.3.3). */
export function effectPreventsLeaderAttack(state: Readonly<GameState>, card: string): boolean {
  return state.effects.some((e) => e.target === card && effectInForce(state, e) && e.change.kind === "cannotAttackLeader");
}

/** CR 8.4.3.2.1 — an effect says this follower can't attack enemies. */
export function effectPreventsAttack(state: Readonly<GameState>, card: string): boolean {
  return state.effects.some((e) => e.target === card && effectInForce(state, e) && e.change.kind === "cannotAttack");
}
