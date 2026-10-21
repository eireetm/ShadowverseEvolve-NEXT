import type { DefId } from "../../model/card";
import type { CardId, PlayerId } from "../../model/ids";
import type { G } from "../runtime/context";
import type { Env } from "../state/access";
import { thisTurn } from "../state/turn-counts";

/**
 * CR 14.5.1.2 — Union Burst abilities are invalid at all times and in all zones in a deck based on a class or on another
 * universe than Princess Connect! Re: Dive. The deck that counts is the one of the player who controls the card and plays the
 * ability (CR 3.1.2), not its owner's: a follower given by a player whose deck is based on the universe has no Union Burst for
 * a player whose deck is based on a class, and one given to a player whose deck is based on it has (BP13-043 rulings Q1, Q2);
 * likewise a card played from an opponent's cemetery (BP05-018).
 */
export function unionBurstValid(env: Env, player: PlayerId): boolean {
  return env.state.players[player].universe === "princessConnect";
}

/**
 * CR 14.5.1.3 — a Union Burst ability has "executed" once it is played (10.6.2.7) and resolved (10.6.2.8). The engine resolves
 * every ability it plays, so the execution is recorded when it is played: an ability executed by another one's effect sees the
 * outer one as executed (CP04-114 ruling Q14: Ameth's own Union Burst counts for Eris's condition, which is checked inside it).
 */
export function recordUnionBurst(g: G, player: PlayerId, source: CardId, sourceDef: DefId, ability: number): void {
  thisTurn(g.state, player).unionBursts += 1;
  g.emit({ type: "unionBurstExecuted", player, source, sourceDef, ability });
}
