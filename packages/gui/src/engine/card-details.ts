import type { CardId, CardScript, Characteristics, GameReader, PersistentEffect, PlayerView, ScriptRegistry } from "@sve/core";
import type { CardRuntimeDetails } from "./protocol";
import { forEachCard } from "./view-utils";

/**
 * GUI-only queries, aligned with main 0.4.1 (2aebbba): flow/attack.ts, state/characteristics.ts,
 * state/effects.ts and actions/damage.ts. These restrictions have no public GameReader query yet.
 * Evaluate registered scripts in the worker; publish only booleans for cards in the final visible view.
 */
export function cardRuntimeDetails(reader: GameReader, scripts: ScriptRegistry, view: PlayerView): Record<CardId, CardRuntimeDetails> {
  const { state } = reader;
  const infos = new Map<CardId, Characteristics>();
  const info = (id: CardId): Characteristics => {
    let result = infos.get(id);
    if (!result) infos.set(id, (result = reader.info(id)));
    return result;
  };
  const activeScript = (id: CardId): CardScript | undefined => {
    const current = info(id);
    return current.abilitiesLostAt === null ? scripts[current.def.id] : undefined;
  };
  // Same passive zones as core: field, crests in EX, and equipment (not every card in EX).
  const sources = state.players.flatMap(({ zones }) => [
    ...zones.field,
    ...zones.ex.filter((id) => reader.db.get(reader.card(id)!.def).type === "crest"),
    ...zones.equipmentZone,
  ]).map((id) => ({ id, field: activeScript(id)?.field }));
  const followersFirst = sources.some(({ field }) => field?.followersBeforeLeaders);
  const inForce = (effect: PersistentEffect): boolean => {
    if (effect.until === "endOfOpponentsNextTurn" && state.turn !== effect.createdTurn && state.activePlayer === effect.controller) return false;
    if (effect.givenBy === undefined) return true;
    const lostAt = info(effect.target).abilitiesLostAt;
    return lostAt === null || effect.seq > lostAt;
  };
  const effects = new Map<CardId, PersistentEffect[]>();
  for (const effect of state.effects) {
    if (!["cannotAttack", "cannotAttackLeader", "cannotDealDamage"].includes(effect.change.kind)) continue;
    const list = effects.get(effect.target);
    if (list) list.push(effect);
    else effects.set(effect.target, [effect]);
  }
  const details: Record<CardId, CardRuntimeDetails> = {};
  forEachCard(view, (card) => {
    const id = card.id;
    const applied = effects.get(id) ?? [];
    const prevented = (kind: "cannotAttack" | "cannotAttackLeader") => applied.some((e) => e.change.kind === kind && inForce(e));
    const follower = reader.card(id)?.zone === "field" && card.type === "follower";
    const own = follower ? activeScript(id) : undefined;
    const ban = own?.cannotAttack;
    const cannotAttack = follower && (
      ban === true || (typeof ban === "function" && ban(reader, id)) ||
      sources.some((source) => source.field?.preventsAttack?.(reader, source.id, id)) || prevented("cannotAttack")
    );
    const cannotAttackLeader = follower && (
      own?.cannotAttackLeader?.(reader, id) === true || prevented("cannotAttackLeader") ||
      (followersFirst && reader.followers(reader.opponent(card.controller)).some((target) =>
        (reader.card(target)!.engaged || reader.hasKeyword(id, "assail")) && !reader.hasKeyword(target, "intimidate"),
      ))
    );
    details[id] = {
      enteredFieldThisTurn: reader.enteredFieldThisTurn(id),
      cannotAttack,
      cannotAttackLeader,
      // Current-source damage resolution in core checks presence, unlike attack restrictions' inForce filtering.
      // Keep that behavior, including its ability-loss/duration edge cases, until core changes its damage query.
      cannotDealDamage: applied.some((e) => e.change.kind === "cannotDealDamage"),
    };
  });
  return details;
}
