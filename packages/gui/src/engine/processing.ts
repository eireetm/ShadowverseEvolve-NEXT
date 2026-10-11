// Which card or ability a decision is part of (CR 10.6.2: the choices, targets and costs of playing it, then its effect),
// for the decision window and the table to say "processing: <card> — <ability>" with its text. The core doesn't say it, and
// it stays untouched; the host knows enough from what it already sees:
//  - a card being played is in the resolution zone from the start of its play to its end (CR 10.6.2.1, 10.6.2.8), and the
//    decisions of its play name it as their source;
//  - an ability starts with the answer that plays it (an activated or evolve ability, a pending one chosen), or when the core
//    plays the only pending one itself: either way it leaves the list of pending abilities (CR 10.7.3);
//  - its "abilityPlayed" event (CR 10.6.2.7) comes after its choices, targets and costs, before its effect;
//  - the decisions of an ability name its card as their source (what the card became when its cost moved it, 4.1.4.1; none
//    once it has left its zone).
// When these don't tell one ability (an ability played by an effect, as the Union Burst one CP04-114 executes; two taken out
// of the list in one step), it says nothing: the decision still shows its source card. Display only: it never changes a game.
import type { CardId, Decision, DefId, GameEvent, GameSession, Input, PlayerId } from "@sve/core";

/** The card or ability a decision is part of. */
export type Processing =
  | { kind: "card"; controller: PlayerId; source: CardId; sourceDef: DefId; playOption?: { id: string; label: string } }
  | { kind: "ability"; controller: PlayerId; source: CardId; sourceDef: DefId; ability: number; sources: readonly CardId[] };

/** An ability that started since the last decision of the game's flow. */
interface Started {
  controller: PlayerId;
  /** The card that has it, then what it became when a cost moved it while it was played (CR 4.1.4.1). */
  sources: CardId[];
  sourceDef: DefId;
  /** Its index among the definition's abilities. */
  ability: number;
  /** An activated or evolve ability: its index among its card's current abilities, as its "abilityPlayed" event names it. */
  refIndex?: number;
  /** In which step (input) it started, and in what order: a later one is played inside or after the earlier ones. */
  step: number;
  order: number;
  /** Started by the answer of its step (chosen): before any other of that step. */
  answered: boolean;
  /** When its "abilityPlayed" event came (CR 10.6.2.7), if it did: from then on it is resolving. */
  playedAt: number | null;
}

/** Decisions of the game's flow, not part of playing anything: what was being played is done when one is answered. */
const FLOW = new Set<Decision["type"]>(["chooseTurnOrder", "mulligan", "mainPhase", "quick", "selectPending"]);

/** Rules processes, not part of an ability: Ward (CR 7.4.3, 12.8.2), the hand limit (7.4.7), the zone limits (11.4, 11.5). */
const RULES = new Set<string>(["wardEngage", "wardEnterEngaged", "handLimitDiscard", "fieldLimitKeep", "exLimitKeep"]);

/** Asked while an ability is being played, before it is (CR 10.6.2.2–10.6.2.5: options, Earth Rite, paying, targets, costs). */
function beforePlayed(d: Decision): boolean {
  switch (d.type) {
    case "selectCards":
      return d.reason === "target" || d.reason === "cost";
    case "choose":
      return d.reason === "mode";
    case "confirm":
      return d.reason === "optionalCost" || d.reason === "earthRite";
    default:
      return false;
  }
}

export class ProcessingTracker {
  private started: Started[] = [];
  private pendingBefore: { id: string; controller: PlayerId; source: CardId; sourceDef: DefId; ability: number }[] = [];
  private answered: Started | null = null;
  private answeredPending: string | null = null;
  /** The play options chosen for the cards being played (by their resolution zone id). */
  private options = new Map<CardId, { id: string; label: string }>();
  private step = 0;
  private order = 0;
  private eventCount = 0;

  reset(): void {
    this.started = [];
    this.pendingBefore = [];
    this.answered = null;
    this.answeredPending = null;
    this.options.clear();
  }

  /** Before `input` is applied to `game`: what was pending, and what the answer starts. */
  beforeInput(game: GameSession, input: Input): void {
    this.step += 1;
    const decision = game.decision;
    this.pendingBefore = game.state.pending.map((p) => ({ id: p.id, controller: p.controller, source: p.source, sourceDef: p.sourceDef, ability: p.ability }));
    this.answered = null;
    this.answeredPending = null;
    if (!decision) return;
    if (FLOW.has(decision.type)) this.started = [];
    if (decision.type === "choose" && decision.reason === "playOption" && input.type === "choose" && decision.source !== null) {
      const id = input.ids[0];
      if (id !== undefined) this.options.set(decision.source, { id, label: decision.options.find((o) => o.id === id)?.label ?? id });
    }
    if ((input.type === "mainPhase" || input.type === "quick") && (input.action.type === "activate" || input.action.type === "evolve")) {
      const { card, ability } = input.action;
      const ref = game.state.cards[card] ? game.reader().info(card).abilities[ability] : undefined;
      if (ref) this.answered = this.start(decision.player, card, ref.def, ref.index, true, ability);
    } else if (input.type === "selectPending") {
      const p = this.pendingBefore.find((x) => x.id === input.id);
      if (p) {
        this.answered = this.start(p.controller, p.source, p.sourceDef, p.ability, true);
        this.answeredPending = p.id;
      }
    }
  }

  /** After the input: the abilities that left the pending list, the ones reported played, where their cards went. */
  afterInput(game: GameSession, events: readonly GameEvent[]): void {
    const remaining = new Set(game.state.pending.map((p) => p.id));
    if (this.answered) this.started.push(this.answered);
    // Taken out of the list in this step besides the one chosen: those the core played itself (each the only one left,
    // CR 10.5.2), the ones triggered meanwhile included.
    const triggered = events.flatMap((e) => (e.type === "abilityTriggered" ? [{ id: e.pendingId, controller: e.player, source: e.source, sourceDef: e.sourceDef, ability: e.ability }] : []));
    for (const p of [...this.pendingBefore, ...triggered]) {
      if (!remaining.has(p.id) && p.id !== this.answeredPending) this.started.push(this.start(p.controller, p.source, p.sourceDef, p.ability, false));
    }
    for (const event of events) {
      this.eventCount += 1;
      if (event.type === "abilityPlayed") {
        // The newest started one it names: an activated or evolve ability by its card's index, a pending one by its definition's.
        const named = [...this.started].reverse().find(
          (s) =>
            s.playedAt === null &&
            s.sources.includes(event.source) &&
            (s.refIndex !== undefined ? s.refIndex === event.ability : s.sourceDef === event.sourceDef && s.ability === event.ability),
        );
        if (named) named.playedAt = this.eventCount;
      } else if (event.type === "cardsMoved") {
        for (const move of event.moves) {
          if (move.card === null || !move.newCard) continue;
          for (const s of this.started) if (s.sources.includes(move.card)) s.sources.push(move.newCard);
        }
      }
    }
    for (const id of [...this.options.keys()]) if (!game.state.resolution.includes(id)) this.options.delete(id);
    this.pendingBefore = [];
    this.answered = null;
    this.answeredPending = null;
  }

  /** What `decision` is part of: null when it is part of nothing (a rules process) or it can't be told. */
  current(game: GameSession, decision: Decision): Processing | null {
    if (decision.type !== "selectCards" && decision.type !== "choose" && decision.type !== "confirm" && decision.type !== "orderCards") return null;
    if (decision.type === "selectCards" && RULES.has(decision.reason)) return null;
    const source = decision.source;
    // A card being played asks (CR 10.6.2.1: it is in the resolution zone until it resolves).
    if (source !== null && game.state.resolution.includes(source)) {
      const card = game.state.cards[source]!;
      const playOption = this.options.get(source);
      return { kind: "card", controller: card.controller, source, sourceDef: card.def, ...(playOption ? { playOption } : {}) };
    }
    // An ability asks: one its card is (no card: one whose card has left its zone).
    const named = this.started.filter((s) => (source !== null ? s.sources.includes(source) : !game.state.cards[s.sources[0]!]));
    if (named.length === 0) return null;
    // While one is being played, the newest not reported played; while one resolves, the one reported last.
    const before = beforePlayed(decision);
    const phase = named.filter((s) => (s.playedAt === null) === before);
    const pool = phase.length > 0 ? phase : named;
    const played = pool.filter((s) => s.playedAt !== null);
    const latest =
      !before && played.length > 0 ? played.reduce((a, b) => (b.playedAt! > a.playedAt! ? b : a)) : pool.reduce((a, b) => (b.order > a.order ? b : a));
    // Others the core took out of the list in the same step and didn't play (CR 10.7.3.2) can't be told from it: nothing,
    // unless they are the same ability.
    if (latest.playedAt === null && !latest.answered) {
      const twins = pool.filter((s) => s !== latest && s.step === latest.step && !s.answered && s.playedAt === null);
      if (twins.some((s) => s.sourceDef !== latest.sourceDef || s.ability !== latest.ability)) return null;
    }
    return { kind: "ability", controller: latest.controller, source: latest.sources[0]!, sourceDef: latest.sourceDef, ability: latest.ability, sources: [...latest.sources] };
  }

  private start(controller: PlayerId, source: CardId, sourceDef: DefId, ability: number, answered: boolean, refIndex?: number): Started {
    return { controller, sources: [source], sourceDef, ability, ...(refIndex !== undefined ? { refIndex } : {}), step: this.step, order: ++this.order, answered, playedAt: null };
  }
}
