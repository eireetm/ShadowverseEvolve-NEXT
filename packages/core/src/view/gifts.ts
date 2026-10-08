import type { DefId } from "../model/card";
import type { CardId } from "../model/ids";
import type { Env } from "../engine/state/access";
import { getCard } from "../engine/state/access";
import { effectInForce } from "../engine/state/effects";
import { abilitiesLostAt, activeScript, inAbilityZone, infoDefId, passiveSources, textDefOf } from "../engine/state/characteristics";
import { equipmentOf } from "../engine/abilities/equipment";
import { makeReader } from "../engine/query";

/** CR 10.9.1.2 — an ability given to a card, with the card definition whose text quotes it ("Give it '...'"). */
export interface Gift {
  /** The definition whose text quotes the ability: the giving card's, the equipment token's, or the card's own. */
  by: DefId;
  /**
   * Which ability: a given ability's id, "text:" and a gained text, an effect's kind, "equipment", "quoted" (its own
   * text's) or "delayed:" and the trigger's ability. Two the same are two abilities (BP13-119: each triggers).
   */
  ability: string;
}

/**
 * The abilities given to a card as the player view shows them, oldest first (CR 10.9.1.6):
 *  - effects that are given abilities (`PersistentEffect.givenBy`): a given ability or text while the card has it (not one
 *    from before it lost all abilities, BP05-061 ruling); another effect while it applies;
 *  - abilities given by passive abilities of cards on the field (`FieldPassives.grantsFor`, BP12-029) and by the
 *    equipment tokens it equips (CR 14.5.2), unless it lost them;
 *  - the ability its own text quotes while the condition holds (`CardScript.quotedWhile`), where its abilities work;
 *  - a delayed trigger that is an ability given to it (`AutomaticAbility.gives`, CP04-045).
 */
export function giftsOf(env: Env, id: CardId): Gift[] {
  const { state } = env;
  const at = abilitiesLostAt(state, id);
  const kept = (seq: number) => at === null || seq > at;
  const out: { seq: number; gift: Gift }[] = [];
  for (const e of state.effects) {
    if (e.target !== id || e.givenBy === undefined || !effectInForce(state, e)) continue;
    const change = e.change;
    if ((change.kind === "grantedAbility" || change.kind === "gainedText") && !kept(e.seq)) continue;
    const ability = change.kind === "grantedAbility" ? change.grant : change.kind === "gainedText" ? `text:${change.text}` : change.kind;
    out.push({ seq: e.seq, gift: { by: e.givenBy, ability } });
  }
  let reader: ReturnType<typeof makeReader> | null = null;
  for (const p of [0, 1] as const) {
    for (const giver of passiveSources(env, p)) {
      const grantsFor = activeScript(env, giver)?.field?.grantsFor;
      const since = getCard(state, giver).zoneSeq;
      if (!grantsFor || !kept(since)) continue;
      reader ??= makeReader(env);
      for (const grant of grantsFor(reader, giver, id)) out.push({ seq: since, gift: { by: infoDefId(env, giver), ability: grant } });
    }
  }
  for (const token of equipmentOf(env, id)) {
    const t = getCard(state, token);
    if (kept(t.zoneSeq)) out.push({ seq: t.zoneSeq, gift: { by: t.def, ability: "equipment" } });
  }
  const own = infoDefId(env, id);
  const quotedWhile = env.scripts[own]?.quotedWhile;
  if (quotedWhile && at === null && inAbilityZone(env, id)) {
    reader ??= makeReader(env);
    if (quotedWhile(reader, id)) out.push({ seq: getCard(state, id).zoneSeq, gift: { by: own, ability: "quoted" } });
  }
  for (const d of state.delayed) {
    if (d.data?.card !== id) continue;
    const ability = env.scripts[d.sourceDef]?.abilities?.[d.ability];
    const by = textDefOf(env, d.sourceDef);
    if (ability?.kind === "automatic" && ability.gives && by !== null) out.push({ seq: d.seq, gift: { by, ability: `delayed:${d.ability}` } });
  }
  return out.sort((a, b) => a.seq - b.seq).map((x) => x.gift);
}
