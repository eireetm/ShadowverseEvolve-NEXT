// Observe the ONE live session. No snapshots, clones, restores, generators or extra inputs.
import { redactEvent, type Decision, type Engine, type GameEvent, type GameSession, type Input, type PlayerId, type PlayerView } from "@sve/core";
import type { GameUpdate as EngineUpdate } from "../engine/protocol";
import { findCard, forEachCard } from "../engine/view-utils";
import { abilitySource } from "./ability-source";
import type { AbilityDisplayContext } from "./protocol";

interface Saved {
  context: AbilityDisplayContext;
  visible: [boolean, boolean];
}

/** Rules and nested drive/combat decisions are not evidence of the outer ability's identity. */
function related(d: Decision | null, context: AbilityDisplayContext, sourceMissing: boolean): boolean {
  if (!d || !("source" in d) || (d.source !== context.source && !(d.source === null && sourceMissing))) return false;
  if (d.type === "selectCards" && ["wardEngage", "wardEnterEngaged", "handLimitDiscard", "fieldLimitKeep", "exLimitKeep", "zoneEntry"].includes(d.reason)) return false;
  if (d.type === "confirm" && d.reason === "driveTrigger") return false;
  if (d.type === "choose" && d.reason === "damageOrder") return false;
  return true;
}

const sameAbility = (a: AbilityDisplayContext, b: AbilityDisplayContext) =>
  a.source === b.source && a.sourceDef === b.sourceDef && a.abilityIndex === b.abilityIndex && a.controller === b.controller;

export class EffectContextObserver {
  private current: Saved | null = null;
  private waiting = new Map<string, Saved>();
  private delayed = new Map<string, Saved>();

  constructor(private readonly engine: Engine, private readonly game: GameSession) {}

  private save(identity: Parameters<typeof abilitySource>[2], views: readonly PlayerView[] = [this.game.view(0), this.game.view(1)]): Saved {
    return {
      context: abilitySource(this.engine, this.game, identity, findCard(views[identity.controller]!, identity.source)),
      visible: [!!findCard(views[0]!, identity.source), !!findCard(views[1]!, identity.source)],
    };
  }

  /** Commit only after the original act succeeds. A rejected input leaves the prior context intact. */
  act(input: Input, from: PlayerId | undefined, delegate: () => GameEvent[]): GameEvent[] {
    const before = this.game.decision;
    const beforeViews = this.game.state.pending.length || this.game.state.delayed.length ? [this.game.view(0), this.game.view(1)] : [];
    const candidates = new Map(this.game.state.pending.map((p) => [p.id, this.waiting.get(p.id) ?? this.save(p, beforeViews)]));
    const delayedBefore = new Map(this.game.state.delayed.map((d) => [d.id, this.delayed.get(d.id) ?? this.save({ ...d, source: d.source ?? "" }, beforeViews)]));
    const prior = this.current;
    const events = delegate();
    const after = this.game.decision;
    const afterViews = [this.game.view(0), this.game.view(1)];
    const remaining = new Set(this.game.state.pending.map((p) => p.id));
    const visible = ([0, 1] as const).map((p) => {
      const cards = new Map<string, { def: string; printing: string | null }>();
      forEachCard(afterViews[p]!, (c) => cards.set(c.id, { def: c.def, printing: c.printing }));
      for (const event of events) {
        const redacted = redactEvent(event, p);
        if (redacted.type === "cardsMoved") for (const m of redacted.moves) {
          if (!m.def) continue;
          for (const id of [m.card, m.newCard]) if (id) cards.set(id, { def: m.before?.abilityDef ?? m.def, printing: m.printing || null });
        }
      }
      return cards;
    });
    const played: Saved[] = [];
    for (const event of events) {
      if (event.type !== "abilityTriggered" && event.type !== "abilityPlayed") continue;
      const saved = this.save({ controller: event.player, source: event.source, sourceDef: event.sourceDef, ability: event.ability,
        ...(event.type === "abilityTriggered" ? { id: event.pendingId } : {}) }, afterViews);
      const delayed = [...delayedBefore.values()].find((s) => sameAbility(s.context, saved.context));
      if (delayed) {
        saved.context.sourceCard ??= delayed.context.sourceCard;
        saved.visible = [saved.visible[0] || delayed.visible[0], saved.visible[1] || delayed.visible[1]];
      }
      for (const p of [0, 1] as const) {
        const card = visible[p]!.get(event.source);
        if (card) {
          saved.visible[p] = true;
          saved.context.sourceCard ??= card;
        }
      }
      if (event.type === "abilityTriggered") candidates.set(event.pendingId, saved);
      else {
        const original = [...candidates].find(([id, s]) => !remaining.has(id) && sameAbility(s.context, saved.context))?.[1] ??
          (prior && sameAbility(prior.context, saved.context) ? prior : null);
        played.push(original ? { context: original.context, visible: [original.visible[0] || saved.visible[0], original.visible[1] || saved.visible[1]] } : saved);
      }
    }
    const consumed = [...candidates].filter(([id]) => !remaining.has(id)).map(([, saved]) => saved);
    let next: Saved | null = null;
    if (consumed.length === 1) {
      // This also covers a newly triggered sole ability, before abilityPlayed (mode/cost/targets).
      next = consumed[0]!;
      const last = played.at(-1);
      if (last && !sameAbility(last.context, next.context)) next = last.context.timing ? last : null;
    } else if (consumed.length > 1) {
      const unplayed = [...consumed];
      for (const event of played) {
        const index = unplayed.findIndex((s) => sameAbility(s.context, event.context));
        if (index >= 0) unplayed.splice(index, 1);
      }
      // No unreported pre-play boundary: only the last explicit played identity can be used.
      const last = played.at(-1);
      if (unplayed.length === 0 && last?.context.timing) next = last;
    } else if (played.length > 0) {
      // Could be an activated ability or a nested play. Only automatic text references are supported.
      const last = played.at(-1)!;
      if (last.context.timing) next = last;
    } else next = prior;

    if (next && prior && sameAbility(prior.context, next.context) && next.context.pendingId === prior.context.pendingId) {
      const modeIds = before?.type === "choose" && before.reason === "mode" && input.type === "choose" ? [...input.ids] : prior.context.modeIds;
      next = { ...next, context: { ...next.context, ...(modeIds ? { modeIds } : {}) } };
    }
    const nestedCard = events.some((e) => e.type === "cardPlayed" && e.card !== next?.context.source);
    this.current = next && !(after && "source" in after && after.source === null && nestedCard) &&
      related(after, next.context, !this.game.state.cards[next.context.source]) ? next : null;
    this.waiting = new Map([...candidates].filter(([id]) => remaining.has(id)));
    this.delayed = new Map(this.game.state.delayed.map((d) => {
      const saved = delayedBefore.get(d.id) ?? this.save({ ...d, source: d.source ?? "" }, afterViews);
      for (const p of [0, 1] as const) {
        const card = visible[p]!.get(saved.context.source);
        if (card) { saved.visible[p] = true; saved.context.sourceCard ??= card; }
      }
      return [d.id, saved];
    }));
    return events;
  }

  /** Publish only the current decision's allowed identities, never all internal pending objects. */
  presentation(update: Pick<EngineUpdate, "decision" | "perspective" | "view">): { pendingAbilities: Record<string, AbilityDisplayContext>; effectContext: AbilityDisplayContext | null } {
    const pendingAbilities: Record<string, AbilityDisplayContext> = {};
    const decision = update.decision?.decision;
    const permitted = (saved: Saved) => saved.visible[update.perspective] || !!update.decision?.cards[saved.context.source] || !!findCard(update.view, saved.context.source);
    const pendingViews = decision?.type === "selectPending" ? [this.game.view(0), this.game.view(1)] : [];
    if (decision?.type === "selectPending") for (const id of decision.options) {
      const pending = this.game.state.pending.find((p) => p.id === id);
      if (!pending) continue;
      const saved = this.waiting.get(id) ?? this.save(pending, pendingViews);
      if (permitted(saved)) {
        const told = update.decision?.cards[saved.context.source];
        if (told) {
          saved.context.sourceCard ??= told;
          saved.visible[update.perspective] = true;
        }
        this.waiting.set(id, saved);
        pendingAbilities[id] = saved.context;
      }
    }
    const current = this.current;
    return { pendingAbilities, effectContext: current && decision && related(decision, current.context, !this.game.state.cards[current.context.source]) && permitted(current) ? current.context : null };
  }
}

/** Proxies delegate with the original receiver. Neither the engine nor its live sessions are mutated. */
export function observePresentationEngine(engine: Engine): { engine: Engine; observers: WeakMap<GameSession, EffectContextObserver> } {
  const observers = new WeakMap<GameSession, EffectContextObserver>();
  const wrap = (game: GameSession) => {
    const observer = new EffectContextObserver(engine, game);
    const act: GameSession["act"] = (input, from) => observer.act(input, from, () => game.act(input, from));
    const proxy = new Proxy(game, { get(target, key) {
      if (key === "act") return act;
      const value = Reflect.get(target, key, target);
      return typeof value === "function" ? value.bind(target) : value;
    } });
    observers.set(proxy, observer);
    return proxy;
  };
  const proxy = new Proxy(engine, { get(target, key) {
    if (key === "newGame") return (...args: Parameters<Engine["newGame"]>) => wrap(target.newGame(...args));
    const value = Reflect.get(target, key, target);
    return typeof value === "function" ? value.bind(target) : value;
  } });
  return { engine: proxy, observers };
}
