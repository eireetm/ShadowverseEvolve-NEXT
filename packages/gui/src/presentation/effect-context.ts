// Observe the ONE live session. No snapshots, clones, restores, generators or extra inputs.
import { redactEvent, type Decision, type Engine, type GameEvent, type GameSession, type Input, type PlayerId, type PlayerView } from "@sve/core";
import type { GameUpdate as EngineUpdate } from "../engine/protocol";
import { findCard, forEachCard } from "../engine/view-utils";
import { abilitySource } from "./ability-source";
import type { AbilityDisplayContext } from "./protocol";

interface Saved {
  context: AbilityDisplayContext;
  visible: [boolean, boolean];
  /** Only actual zone moves of this processing object; never a reconstructed effect path. */
  sources?: string[];
  runtimeIndex?: number;
  nested?: boolean;
  played?: boolean;
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

const matchesPlayed = (saved: Saved, event: AbilityDisplayContext) =>
  saved.context.sourceDef === event.sourceDef && saved.context.controller === event.controller &&
  (saved.context.source === event.source || saved.sources?.includes(event.source)) &&
  (saved.context.abilityIndex === event.abilityIndex || saved.runtimeIndex === event.abilityIndex);

export class EffectContextObserver {
  private current: Saved | null = null;
  private waiting = new Map<string, Saved>();
  private delayed = new Map<string, Saved>();
  private serial = 0;

  constructor(private readonly engine: Engine, private readonly game: GameSession) {}

  private save(identity: Parameters<typeof abilitySource>[2], views: readonly PlayerView[] = [this.game.view(0), this.game.view(1)]): Saved {
    return {
      context: abilitySource(this.engine, this.game, identity, findCard(views[identity.controller]!, identity.source)),
      visible: [!!findCard(views[0]!, identity.source), !!findCard(views[1]!, identity.source)],
    };
  }

  private cardPlay(source: string, controller: PlayerId, def: string, views: readonly PlayerView[]): Saved {
    const abilities = this.engine.scripts[def]?.abilities ?? [];
    const spell = abilities.findIndex((a) => a.kind === "spell");
    if (spell >= 0) return this.save({ source, controller, sourceDef: def, ability: spell }, views);
    const own = findCard(views[controller]!, source);
    return { context: { source, controller, sourceDef: def, origin: "printed", kind: "cardPlay",
      ...(own ? { sourceCard: { def, printing: own.printing } } : {}),
      textRef: { def, timing: "play", rank: 0, count: 1 } },
      visible: [!!findCard(views[0]!, source), !!findCard(views[1]!, source)] };
  }

  /** Actions index the live AbilityRef list, which can include keywords, equipment and grants. */
  private entry(input: Input, views: readonly PlayerView[]): Saved | null {
    if (input.type !== "mainPhase" && input.type !== "quick") return null;
    if (this.game.decision?.type !== input.type) return null;
    const action = input.action;
    if (!["activate", "evolve", "play"].includes(action.type) || !("card" in action)) return null;
    if (!this.game.state.cards[action.card]) return null;
    const info = this.game.reader().info(action.card);
    const player = this.game.decision!.player;
    if (action.type === "play") return this.cardPlay(action.card, player, info.def.id, views);
    if (action.type !== "activate" && action.type !== "evolve") return null;
    const ref = info.abilities[action.ability];
    return ref ? { ...this.save({ source: action.card, controller: player, sourceDef: ref.def, ability: ref.index }, views), runtimeIndex: action.ability } : null;
  }

  /** Reviewed CP04-114 mode 2 handoff, confirmed by the real inner target question. */
  private freeUnionBurstTarget(parent: AbilityDisplayContext | undefined, before: Decision | null, input: Input, after: Decision | null,
    views: readonly PlayerView[]): Saved | null {
    if (parent?.sourceDef !== "CP04-114" || parent.abilityIndex !== 0 || parent.modeIds?.length !== 1 || parent.modeIds[0] !== "2" ||
      after?.type !== "selectCards" || after.reason !== "target" || !after.source || after.source === parent.source) return null;
    const selected = before?.type === "selectCards" && before.reason === "target" && before.source === parent.source &&
      input.type === "selectCards" && input.cards.length === 1 && input.cards[0] === after.source;
    // A sole legal outer target can be auto-answered in the same act that chooses mode 2.
    const autoSelected = before?.type === "choose" && before.reason === "mode" && before.source === parent.source &&
      input.type === "choose" && input.ids.length === 1 && input.ids[0] === "2";
    if (!selected && !autoSelected) return null;
    const source = after.source;
    const card = this.game.reader().card(source);
    if (card?.zone !== "field" || card.controller !== parent.controller) return null;
    const refs = this.game.reader().info(source).abilities.filter((ref) => ref.ability.kind !== "spell" && ref.ability.unionBurst);
    // No legality simulation or option-label parsing. Multi-UB/no-target paths retain their existing handling.
    const ref = refs.length === 1 ? refs[0] : undefined;
    if (!ref?.ability.targets?.length || ref.ability.modes) return null;
    const saved = this.save({ source, controller: parent.controller, sourceDef: ref.def, ability: ref.index }, views);
    saved.context.instanceId = `action:${this.serial}:freeUB`;
    return saved;
  }

  /** Commit only after the original act succeeds. A rejected input leaves the prior context intact. */
  act(input: Input, from: PlayerId | undefined, delegate: () => GameEvent[]): GameEvent[] {
    const before = this.game.decision;
    const beforeViews = [this.game.view(0), this.game.view(1)];
    const candidates = new Map(this.game.state.pending.map((p) => [p.id, this.waiting.get(p.id) ?? this.save(p, beforeViews)]));
    const delayedBefore = new Map(this.game.state.delayed.map((d) => [d.id, this.delayed.get(d.id) ?? this.save({ ...d, source: d.source ?? "" }, beforeViews)]));
    let prior = this.current;
    const entry = this.entry(input, beforeViews);
    if (entry) entry.context = { ...entry.context, instanceId: `action:${this.serial + 1}` };
    if (prior && before?.type === "choose" && input.type === "choose") {
      const selection = before.reason === "mode" ? { modeIds: [...input.ids] } :
        before.reason === "playOption" ? { playOptionId: input.ids[0], playOptionLabel: before.options.find((o) => o.id === input.ids[0])?.label } : {};
      prior = { ...prior, context: { ...prior.context, ...selection } };
    }
    const events = delegate();
    this.serial++;
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
    let root = entry ?? prior;
    // Moving into resolution is evidence of play before cardPlayed, including an effect's inner play.
    for (const event of events) if (event.type === "cardsMoved") for (const m of event.moves) {
      if (m.reason !== "play" || m.to.zone !== "resolution" || !m.newCard) continue;
      if (root && (root.context.kind === "spell" || root.context.kind === "cardPlay") && root.context.source === m.card) {
        root = { ...root, context: { ...root.context, source: m.newCard }, sources: [root.context.source, m.newCard] };
      } else {
        root = this.cardPlay(m.newCard, m.to.player, m.def, afterViews);
        root.context.instanceId = `action:${this.serial}:play:${m.newCard}`;
        root.nested = true;
      }
    }
    const played: Saved[] = [];
    const claimedPending = new Set<string>();
    const reportedRoots = new Set<Saved>();
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
        // The previous instance can finish its cost just as another instance of the
        // very same ability starts. Claim its one play event before matching new pending IDs.
        const active = [root, prior].find((s): s is Saved => !!s && !s.played && !reportedRoots.has(s) && !!matchesPlayed(s, saved.context));
        const original = active ?? [...candidates].find(([id, s]) => !remaining.has(id) && !claimedPending.has(id) && sameAbility(s.context, saved.context))?.[1] ?? null;
        if (active) reportedRoots.add(active);
        if (original?.context.pendingId) claimedPending.add(original.context.pendingId);
        saved.context.instanceId = `action:${this.serial}:ability:${played.length}`;
        played.push(original ? { ...original, played: true, visible: [original.visible[0] || saved.visible[0], original.visible[1] || saved.visible[1]] } : { ...saved, played: true });
      }
    }
    const consumed = [...candidates].filter(([id]) => !remaining.has(id)).map(([, saved]) => saved);
    const unplayed = [...consumed];
    for (const event of played) {
      const index = unplayed.findIndex((s) => s.context.pendingId === event.context.pendingId && sameAbility(s.context, event.context));
      if (index >= 0) unplayed.splice(index, 1);
    }
    let next: Saved | null;
    const last = played.at(-1);
    if (unplayed.length === 1 &&
      (!last || (root && sameAbility(last.context, root.context)) ||
        (last.context.pendingId && claimedPending.has(last.context.pendingId)))) {
      // One unreported instance remains after excluding every consumed instance with a
      // play event. The old root's late event cannot override its pre-play questions.
      next = unplayed[0]!;
    } else if (unplayed.length > 0) {
      // Disappearing may also mean skipped. Several unreported boundaries are ambiguous.
      next = null;
    } else {
      // A unique inner card entering resolution supersedes the outer play event, even
      // when that outer automatic ability both triggered and was played in this act.
      const innerPlay = root?.nested && root !== prior && after && "source" in after && after.source === root.context.source;
      next = innerPlay ? root : last ?? root;
    }

    // The real target question confirms the child started; a completed/skipped child must not
    // override a later automatic ability, even if that later ability has the same source.
    if (unplayed.length === 0) {
      const freeUnionBurst = this.freeUnionBurstTarget(prior?.context, before, input, after, beforeViews);
      if (freeUnionBurst && !played.some((s) => matchesPlayed(freeUnionBurst, s.context))) next = freeUnionBurst;
    }

    if (next?.context.pendingId) next.context.instanceId = `pending:${next.context.pendingId}`;
    if (next && prior && next.context.instanceId === prior.context.instanceId && sameAbility(next.context, prior.context)) {
      next = { ...next, context: { ...next.context, modeIds: prior.context.modeIds,
        playOptionId: prior.context.playOptionId, playOptionLabel: prior.context.playOptionLabel } };
    }
    // An activated cost may move its own source and continue with the resulting object.
    // Do not follow an automatic ability's source into unrelated new abilities on that card.
    if (next && next.context.kind === "activated") {
      const sources = [...(next.sources ?? [next.context.source])];
      for (const event of events) if (event.type === "cardsMoved") for (const m of event.moves) {
        if (m.card && sources.includes(m.card) && m.newCard) sources.push(m.newCard);
      }
      if (after && "source" in after && after.source && sources.includes(after.source)) {
        next = { ...next, sources, context: { ...next.context, source: after.source } };
      }
    }
    if (next) for (const p of [0, 1] as const) {
      const card = visible[p]!.get(next.context.source);
      if (card) { next.visible[p] = true; next.context.sourceCard ??= card; }
    }
    const completedPlay = next && ["spell", "cardPlay"].includes(next.context.kind ?? "") && events.some((e) =>
      e.type === "cardsMoved" && e.moves.some((m) => m.card === next!.context.source && m.from?.zone === "resolution" && m.reason === "resolve"));
    const nestedCard = next?.nested || events.some((e) => e.type === "cardPlayed" && e.card !== next?.context.source);
    this.current = next && !completedPlay && !(after && "source" in after && after.source === null && nestedCard) &&
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
