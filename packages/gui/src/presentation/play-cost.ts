import type { CardId, Characteristics, GameReader, PersistentEffect, PlayerId, ScriptRegistry } from "@sve/core";

/**
 * Read-only GUI adapter for core engine/costs.ts (normal play, no option or caller setTo).
 * Core has no public cost query. Keep the order/ability-loss rules aligned and covered by
 * oracle tests; never pay an option or consume nextPlay/group records while previewing.
 * Create afresh for each published view, so shared offers refresh together.
 */
export function createPlayCostQuery(reader: GameReader, scripts: ScriptRegistry): (id: CardId, player: PlayerId) => number | undefined {
  const { state } = reader;
  const infos = new Map<CardId, Characteristics>();
  const info = (id: CardId) => {
    let value = infos.get(id);
    if (!value) infos.set(id, value = reader.info(id));
    return value;
  };
  const inForce = (effect: PersistentEffect) => {
    if (effect.until === "endOfOpponentsNextTurn" && state.turn !== effect.createdTurn && state.activePlayer === effect.controller) return false;
    const lostAt = info(effect.target).abilitiesLostAt;
    return effect.givenBy === undefined || lostAt === null || effect.seq > lostAt;
  };
  const sources = state.players.flatMap(({ zones }) => [
    ...zones.field,
    ...zones.ex.filter(id => reader.db.get(reader.card(id)!.def).type === "crest"),
    ...zones.equipmentZone,
  ]).map(id => ({ id, field: info(id).abilitiesLostAt === null ? scripts[info(id).def.id]?.field : undefined }));

  return (id, player) => {
    const base = info(id).cost;
    if (base === null) return undefined;
    let cost = base;
    for (const effect of state.effects) {
      if (effect.target === id && effect.change.kind === "playCostSet" && inForce(effect)) cost = effect.change.value;
    }
    // Own playCost intentionally uses the instance's registered definition, just as core does.
    cost += scripts[reader.card(id)!.def]?.playCost?.(reader, id, player) ?? 0;
    for (const source of sources) cost += source.field?.playCostOf?.(reader, source.id, id, player) ?? 0;
    for (const effect of state.effects) {
      if (effect.target === id && effect.change.kind === "playCost" && inForce(effect)) cost += effect.change.amount;
    }
    for (const modifier of state.nextPlay) {
      if (modifier.player !== player) continue;
      const matches = scripts[modifier.sourceDef]?.nextPlay?.[modifier.key];
      if (!matches) throw new Error(`${modifier.sourceDef} has no nextPlay "${modifier.key}"`);
      if (matches(reader, id, player)) cost += modifier.costDelta;
    }
    if (state.activePlayer === player) {
      cost += state.restrictions.filter(r => r.player === player && r.kind === "playCostPlus1" && state.turn > r.createdTurn).length;
    }
    return Math.max(0, cost);
  };
}
