// What the engine worker needs from the core that its public API doesn't offer: the core's own functions, called as they
// are, never copied (the GUI doesn't implement rules). The core itself stays untouched — its code is what the rules
// fingerprint of the bots' training data records. Display only: nothing here decides anything in a game.
import type { AbilityDef, CardId, DefId, Engine, GameSession, PlayerId } from "@sve/core";
import { EQUIP_PREFIX } from "../../../core/src/engine/abilities/equipment";
import { GRANT_PREFIX } from "../../../core/src/engine/abilities/grants";
import { KEYWORD_DEF_PREFIX } from "../../../core/src/engine/abilities/keyword-abilities";
import { getAbility } from "../../../core/src/engine/abilities/play-ability";
import { playCost } from "../../../core/src/engine/costs";
import type { G } from "../../../core/src/engine/runtime/context";

/**
 * CR 10.4.4.1 — the play points `player` would pay to play `card` normally now: its cost with the increases and decreases in
 * force, not a play option's (the core's engine/costs.ts). The card's cost itself doesn't change.
 */
export function normalPlayCost(engine: Engine, game: GameSession, card: CardId, player: PlayerId): number {
  return playCost({ state: game.state, db: engine.db, scripts: engine.scripts }, card, player);
}

/**
 * The ability a pending ability (or one being played) names: `index` of the definition `def`'s abilities, also for the pseudo
 * definitions of keyword ("kw:"), given ("grant:") and equipment ("equip:") abilities — the core's own lookup, which reads
 * only the scripts. Undefined when there is none.
 */
export function abilityOf(engine: Engine, def: DefId, index: number): AbilityDef | undefined {
  try {
    return getAbility({ scripts: engine.scripts } as unknown as G, def, index);
  } catch {
    return undefined;
  }
}

/** The pseudo definitions' prefixes (a pending ability's `sourceDef`): a keyword's ability, a given one, an equipment token's. */
export const PSEUDO_DEF = { keyword: KEYWORD_DEF_PREFIX, grant: GRANT_PREFIX, equipment: EQUIP_PREFIX } as const;
