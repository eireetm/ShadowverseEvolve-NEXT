import type { CardId, PlayerId } from "../model/ids";
import type { NextPlayModifier } from "../model/state";
import type { ActivatedAbility, PlayOption } from "../script/types";
import { EngineError } from "./errors";
import type { G } from "./runtime/context";
import { selectCards } from "./runtime/decide";
import type { Proc } from "./runtime/proc";
import { getCard, type Env } from "./state/access";
import { activeScript, characteristics, passiveSources } from "./state/characteristics";
import { effectInForce } from "./state/effects";
import { moveCards, withCardInResolution } from "./state/zones";
import { restrictionCount } from "./state/restrictions";
import { thisTurn } from "./state/turn-counts";
import { makeReader } from "./query";

/**
 * CR 10.4.4.1 / 10.6.2.5.1 — the play points needed to play `card` now.
 *  1. printed cost (2.5), or the value set by a play option / effect ("costs N", "for 0");
 *     set-to-value changes are applied first (10.10.2.4);
 *  2. increases / decreases: the card's own passive (e.g. Spellchain reductions), passives of
 *     cards on either field (e.g. "your Golem followers cost 1 less", "any spell an opponent
 *     plays costs 1 more" — BP05-070, which stacks), effects on the card (e.g. "It costs 2 less
 *     to play"), the chosen play option;
 *  3. never below 0 (1.3.2.2.1).
 * The card's cost information itself does not change (10.4.4.1).
 */
export function playCost(g: Env, card: CardId, player: PlayerId, option: PlayOption | null = null, setTo?: number): number {
  const reader = makeReader(g);
  const base = characteristics(g, card).cost ?? 0;
  // Effects that set the cost (e.g. BP02-091 "Those cards cost 0 play points to play"); the
  // latest one applies (timestamp order, 10.9.1.6).
  let setByEffect: number | undefined;
  for (const e of g.state.effects) if (e.target === card && e.change.kind === "playCostSet" && effectInForce(g.state, e)) setByEffect = e.change.value;
  let cost = setTo ?? option?.setCost ?? setByEffect ?? base;
  cost += g.scripts[getCard(g.state, card).def]?.playCost?.(reader, card, player) ?? 0;
  for (const p of [0, 1] as const) {
    for (const f of passiveSources(g, p)) {
      cost += activeScript(g, f)?.field?.playCostOf?.(reader, f, card, player) ?? 0;
    }
  }
  // A given "This costs N less to play" (BP12-005) is lost with the card's abilities (state/effects.ts).
  for (const e of g.state.effects) if (e.target === card && e.change.kind === "playCost" && effectInForce(g.state, e)) cost += e.change.amount;
  cost += option?.costDelta ?? 0;
  // "The next [matching] card you play this turn costs N less" (BP03-038), after set-to-value
  // changes (its Transcendence ruling: a cost set to 7 is then reduced by 4).
  for (const m of nextPlayModifiersFor(g, card, player)) cost += m.costDelta;
  // BP15-058 "during each opponent's next turn, any card they play costs 1 more" (each one adds 1).
  cost += restrictionCount(g.state, player, "playCostPlus1");
  return Math.max(0, cost);
}

/**
 * CR 10.6.2.1 / 10.6.2.5 — the play points playing `card` now takes: its playCost once it is in the resolution zone, where
 * the cost is determined (flow/play-card.ts checks the play there too). A card counting the cards of the zone it is played
 * from doesn't count itself (BP18-046 ruling), so this may differ from playCost of the card where it is.
 */
export function playCostAsPlayed(g: Env, card: CardId, player: PlayerId, option: PlayOption | null = null, setTo?: number): number {
  return withCardInResolution(g, card, player, (at) => playCost(at, card, player, option, setTo));
}

/** The "next card you play this turn" modifiers of `player` that apply to `card`. */
export function nextPlayModifiersFor(g: Env, card: CardId, player: PlayerId): NextPlayModifier[] {
  if (g.state.nextPlay.length === 0) return [];
  const reader = makeReader(g);
  return g.state.nextPlay.filter((m) => {
    if (m.player !== player || m.of !== undefined) return false;
    const matches = g.scripts[m.sourceDef]?.nextPlay?.[m.key];
    if (!matches) throw new EngineError(`${m.sourceDef} has no nextPlay "${m.key}"`);
    return matches(reader, card, player);
  });
}

/** The "next quick activated ability you play" modifiers of `player` (CP05-047) that apply to `ability`. */
export function nextAbilityModifiersFor(g: Env, player: PlayerId, ability: ActivatedAbility): NextPlayModifier[] {
  if (g.state.nextPlay.length === 0 || !ability.quick) return [];
  return g.state.nextPlay.filter((m) => m.player === player && m.of === "quickAbility");
}

/**
 * CR 10.4.4 / 10.6.2.5 — the play points playing activated ability `ability` of `card` takes now: its play points, changed by
 * passives of cards on either field (CP05-040 "when you play a quick activated ability, it costs 1 less", asked of every card
 * whose passives work, so they check `player`) and by "the next quick activated ability you play costs 1 less" (CP05-047),
 * never below 0 (CR 1.3.2.2.1).
 */
export function activationPlayPoints(g: Env, player: PlayerId, card: CardId, ability: ActivatedAbility): number {
  let points = ability.cost.playPoints ?? 0;
  let reader: ReturnType<typeof makeReader> | null = null;
  for (const p of [0, 1] as const) {
    for (const f of passiveSources(g, p)) {
      const of = activeScript(g, f)?.field?.activationCostOf;
      if (of) points += of((reader ??= makeReader(g)), f, card, ability, player);
    }
  }
  for (const m of nextAbilityModifiersFor(g, player, ability)) points += m.costDelta;
  return Math.max(0, points);
}

/**
 * CR 13.3.3.2 — amulets with Stack on the field that have at least `count` Stack counters. `emptying`: only those paying it
 * empties (exactly `count`), which go to the cemetery as the cost is paid and so free their field slot (10.6.2.6).
 */
export function earthRiteSources(g: Env, player: PlayerId, count = 1, opts: { emptying?: boolean } = {}): CardId[] {
  return makeReader(g)
    .stackCards(player)
    .filter((id) => {
      const stack = getCard(g.state, id).counters.stack ?? 0;
      return opts.emptying ? stack === count : stack >= count;
    });
}

/**
 * CR 13.3.3.2 — pay Earth Rite: remove `count` Stack counters from one amulet with Stack on
 * the player's field (the player picks which); if its last counter was removed, it is put
 * into its owner's cemetery. `emptying`: only from an amulet it empties (earthRiteSources).
 */
export function* payEarthRite(g: G, player: PlayerId, count: number, source: CardId | null, opts: { emptying?: boolean } = {}): Proc<void> {
  const sources = earthRiteSources(g, player, count, opts);
  if (sources.length === 0) throw new EngineError("Earth Rite cannot be paid");
  const [amulet] = yield* selectCards(g, player, "cost", sources, 1, 1, source);
  const c = getCard(g.state, amulet!);
  const left = (c.counters.stack ?? 0) - count;
  c.counters.stack = left;
  thisTurn(g.state, player).stackRemovedByEarthRite += count; // BP14-037
  g.emit({ type: "countersChanged", card: c.id, counter: "stack", count: left });
  if (left <= 0) moveCards(g, [{ card: c.id, to: "cemetery", reason: "effect" }], "effect");
}
