/**
 * The conditional-Fanfare charge (PlannerBotOptions conditional): the planner charges a plan `penalty` (by default what
 * the evaluation gives a card in hand, DEFAULT_WEIGHTS.hand) for every card the plan plays whose Fanfare did nothing
 * because what it needs was not there, so that holding the card until it is (CR 8.2.1: it can be played from the hand or
 * the EX area later) wins unless playing it now is worth more anyway. The charge is in the search's ranking (each plan's
 * position value, the beam and the plan kinds) and in the final comparison of the candidates (the values pick() compares).
 *
 * Why. A conditional card played without its effect is scored as its body on the field: the evaluation has no term for an
 * effect still to come, so the card's best use (the effect) is worth nothing more in the hand than any card, and playing
 * it now and holding it differ only by body against hand card. Stronger players' review of the bots' games found exactly
 * that ("its Fanfare does nothing now, keep it"). The charge is the lost effect's value, at the scale of one card in the
 * hand; it is never charged when the play does something with any of its Fanfares.
 *
 * What is judged (the scopes, each with the ones before it):
 *   declared   a Fanfare (CR 12.4.3) of the played card with a condition its script declares: a trigger restriction
 *              (the script's triggerIf: part of the trigger condition, CR 10.1.1.2.1.1; unmet, the ability doesn't become
 *              pending, 10.7.2) or a condition checked when it is played (the script's condition: unmet, it can't be played
 *              and its pending status is removed, CR 10.7.3.2). Seen in the events of the simulation (abilityTriggered,
 *              CR 10.7.2; abilityPlayed, CR 10.6.2.7) and the condition itself evaluated in the simulated position, so a
 *              Fanfare not played for another reason is not charged here.
 *   unplayed   + a Fanfare of the played card that became pending but could not be played for any other reason
 *              (CR 10.7.3.2): no legal targets (10.6.2.3.3), no option that can be performed (5.18). Never a Fanfare whose
 *              effect is bought with a cost: "[process]: [effect]" in an automatic ability is an option its controller
 *              takes or not when resolving it (CR 10.4.7, 10.4.7.4), and Earth Rite is an additional cost the player may
 *              pay (13.3.3.2). Not being able to pay it (10.4.2.2) and declining it leave the same board with the same
 *              effect untaken, and declining is the plan's own choice, priced like any other; charging only the first
 *              would push the bot to hold a card until it can pay and then decline (a 2-drop whose Fanfare is a
 *              {cost02} add-on held on turn 2). What holding keeps is the option's worth (the effect less the cost),
 *              not the effect's, so such a Fanfare is not judged when it isn't played, whatever kept it from that (the
 *              engine checks the targets before the cost: which one did is not in the events).
 *   gates      + a Fanfare that was played but whose effect has a condition in its code ("if fewer than 3, stop": the part
 *              of the effect is invalid while the condition isn't met, CR 10.3.3), read from the card feature table's
 *              references (card-features.ts: where "resolve", a gate) and counted in the position after the play as the
 *              bot sees it (encoder-v2-refs.ts's own filters; a hidden card in a counted zone: not judged). The gates come
 *              in as a reader (CondGates: conditional-gates.ts tableGates), so this module imports nothing of the table.
 * A Fanfare is "effective" when it was played (and, with gates, its gates are met); the play is charged when one of its
 * Fanfares was wasted and none was effective (a card with two Fanfares, one of which works, is not charged).
 *
 * When. A window opens at a main phase answer of ours that plays a card from the hand or the EX area (CR 8.2.1) in the
 * planner's own search of this turn (the top-level beam; not the later turns of the two-turn search, not the opponent's
 * plans) and closes at our next main phase decision (the play, its triggers and every choice they ask for are resolved:
 * CR 10.7.3, Confirmation Timing) or where the turn or the game ends. The card is followed by its ids (CR 4.1.4: a new card
 * in each zone): its hand id, the id the resolution zone gives it, the id it gets on the field. A card that doesn't enter
 * the field (a spell, a play option like Accelerate) has no Fanfare to judge. With `evolve` (CondParams, off by default) an
 * evolve answer of ours in our main phase (CR 8.3, 12.2) opens a window the same way, for the follower evolved (the same id on
 * the field, CR 5.16.2) and the evolved card's On Evolve abilities (CR 12.6; On Super-Evolve, 12.17, when it super-evolved),
 * judged as Fanfares are but for the gates: the evolve window doesn't read the card table's gates. Of the 200 On Evolve and
 * On Super-Evolve abilities of the 57 decks measured, none has a trigger restriction or a declared condition (68 have
 * required targets), and one has a gate in its effect (BP22-006: only its bonus is under it, the token it puts always
 * comes, so the window couldn't call it wasted); a deck with such gates would need them read here.
 *
 * Fairness: everything is read in the planner's own simulated copies (a sample of what the bot knows, determinize; a
 * cheating planner: the real game), the gates in the bot's view of that copy. Deterministic: no randomness, no clocks.
 */
import type { Answer, AutomaticAbility, CardId, Decision, DefId, GameEvent, GameReader, GameSession, PlayerId, PlayerView, ScriptRegistry } from "./core";
import { DEFAULT_WEIGHTS } from "./evaluate";

// ---- Parameters and identity ----

export const COND_SCOPES = ["declared", "unplayed", "gates"] as const;
export type CondScope = (typeof COND_SCOPES)[number];

export interface CondParams {
  scope: CondScope;
  /** Charged once per card play whose Fanfares did nothing (points of the planner's evaluation). */
  penalty: number;
  /**
   * Also an evolution (CR 8.3, 12.2) whose On Evolve abilities (CR 12.6; On Super-Evolve, 12.17, when it super-evolved) did
   * nothing, judged as a play's Fanfares are (the trigger restriction, the condition, unplayed; not the gates: the card
   * table's gates are a Fanfare's). Default: off.
   */
  evolve?: boolean;
}

/** The narrowest scope and a card in hand's worth (DEFAULT_WEIGHTS.hand). */
export const COND_DEFAULTS: Readonly<CondParams> = { scope: "declared", penalty: DEFAULT_WEIGHTS.hand };

/** Every reason the parameters are refused (empty: none). */
export function condProblems(p: CondParams): string[] {
  const out: string[] = [];
  if (!(COND_SCOPES as readonly string[]).includes(p.scope)) out.push(`scope=${String(p.scope)}: ${COND_SCOPES.join(", ")}`);
  if (typeof p.penalty !== "number" || !Number.isFinite(p.penalty) || p.penalty < 0 || p.penalty > 10) out.push(`penalty=${String(p.penalty)}: a number from 0 to 10`);
  if (p.evolve !== undefined && typeof p.evolve !== "boolean") out.push(`evolve=${String(p.evolve)}: true or false`);
  return out;
}

/**
 * What the gates scope reads (conditional-gates.ts tableGates gives one from the card feature table): the table's hash, a
 * Fanfare's gate references, whether one is met in a position as the bot sees it (null: not countable), how a coverage list
 * prints one. (Method syntax on purpose: a reader of the table's own reference type, tableGates, is one of these.)
 */
export interface CondGates<G = unknown> {
  hash: string;
  gatesOf(def: DefId, index: number): readonly G[];
  met(view: PlayerView, me: PlayerId, self: CardId, gate: G): boolean | null;
  describe(gate: G): string;
}

/**
 * The change's identity in the records: "cond=<scope>:penalty=<n>", and with the gates scope the card feature table's
 * hash (its references decide what is judged): "cond=gates:penalty=<n>:table=<hash>"; ":evolve=1" after it when
 * evolutions are judged too (only then: the identities without it are as they were).
 */
export function condIdentity(p: CondParams, gates?: Pick<CondGates, "hash"> | null): string {
  const base = `cond=${p.scope}:penalty=${String(p.penalty)}`;
  return `${p.scope === "gates" && gates ? `${base}:table=${gates.hash}` : base}${p.evolve ? ":evolve=1" : ""}`;
}

const scopeAtLeast = (scope: CondScope, least: CondScope): boolean => COND_SCOPES.indexOf(scope) >= COND_SCOPES.indexOf(least);

// ---- The Fanfares of a definition ----

/** A Fanfare of a definition (CR 12.4.3) and what may keep it from doing anything. */
export interface FanfareInfo {
  index: number;
  ability: AutomaticAbility;
  /** A declared trigger restriction (CR 10.1.1.2.1.1) or a condition checked when played (CR 10.7.3.2). */
  triggerIf: boolean;
  condition: boolean;
  /** What else can keep it from being played (CR 10.7.3.2): required targets, a cost, a required Earth Rite, options. */
  unplayable: string[];
  /**
   * Its effect is an option bought with a cost the player may pay or not while playing it: an optional cost (CR 10.4.7.4)
   * or an Earth Rite (13.3.3.2). Not judged by the unplayed scope (the header).
   */
  declinable: boolean;
}

const FANFARES = new WeakMap<ScriptRegistry, Map<DefId, FanfareInfo[]>>();

/** The Fanfares of a definition's script, in its order (read once per registry and definition). */
export function fanfaresOf(scripts: ScriptRegistry, def: DefId): FanfareInfo[] {
  let byDef = FANFARES.get(scripts);
  if (!byDef) FANFARES.set(scripts, (byDef = new Map()));
  const known = byDef.get(def);
  if (known) return known;
  const out: FanfareInfo[] = [];
  byDef.set(def, out);
  (scripts[def]?.abilities ?? []).forEach((a, index) => {
    if (a.kind !== "automatic" || a.timing !== "fanfare" || a.delayed) return;
    const unplayable: string[] = [];
    if ((a.targets ?? []).some((t) => !t.upTo && t.count > 0)) unplayable.push("targets");
    if (a.cost) unplayable.push("cost");
    if (a.earthRite?.mode === "required") unplayable.push("earthRite");
    if (a.modes) unplayable.push("modes");
    out.push({ index, ability: a, triggerIf: a.triggerIf !== undefined, condition: a.condition !== undefined, unplayable, declinable: a.cost !== undefined || a.earthRite !== undefined });
  });
  return out;
}

const EVOLVES = new WeakMap<ScriptRegistry, Map<string, FanfareInfo[]>>();

/**
 * The On Evolve abilities of an evolved card's definition (CR 12.6), and its On Super-Evolve ones (CR 12.17) when it
 * super-evolved, in its order, read as fanfaresOf reads Fanfares (once per registry, definition and kind of evolution).
 */
export function evolveAbilitiesOf(scripts: ScriptRegistry, def: DefId, superEvolved: boolean): FanfareInfo[] {
  let byDef = EVOLVES.get(scripts);
  if (!byDef) EVOLVES.set(scripts, (byDef = new Map()));
  const key = `${def}|${superEvolved ? 1 : 0}`;
  const known = byDef.get(key);
  if (known) return known;
  const out: FanfareInfo[] = [];
  byDef.set(key, out);
  (scripts[def]?.abilities ?? []).forEach((a, index) => {
    if (a.kind !== "automatic" || a.delayed || !(a.timing === "onEvolve" || (superEvolved && a.timing === "onSuperEvolve"))) return;
    const unplayable: string[] = [];
    if ((a.targets ?? []).some((t) => !t.upTo && t.count > 0)) unplayable.push("targets");
    if (a.cost) unplayable.push("cost");
    if (a.earthRite?.mode === "required") unplayable.push("earthRite");
    if (a.modes) unplayable.push("modes");
    out.push({ index, ability: a, triggerIf: a.triggerIf !== undefined, condition: a.condition !== undefined, unplayable, declinable: a.cost !== undefined || a.earthRite !== undefined });
  });
  return out;
}

// ---- A play's window ----

/** One card play followed from the answer until our next main phase decision. */
export interface Watch {
  /** The card answered (its id in the hand or the EX area). */
  hand: CardId;
  /** Its definition, its id in the resolution zone and on the field (CR 4.1.4: a new card in each zone). */
  def: DefId | null;
  resolution: CardId | null;
  field: CardId | null;
  /** Indices of its definition's abilities that became pending from the card on the field (CR 10.7.2) and were played (10.6.2.7). */
  triggered: readonly number[];
  played: readonly number[];
  /**
   * The player declined an optional cost or an Earth Rite of the card (CR 10.4.7.4, 13.3.3.2). Kept for the counts and the
   * tests; the judgment doesn't depend on it (a Fanfare with such a cost is never judged unplayed).
   */
  declined: boolean;
  /**
   * An evolution's window (CondParams.evolve), not a play's: `hand` is the follower evolved (it stays on the field under the
   * same id, CR 5.16.2), `field` that id once it evolved, `def` the evolved card's definition (the follower's information
   * from then on); its On Evolve abilities (and On Super-Evolve ones when it super-evolved) are judged. `cards`: the cards put
   * into the evolve zone until then (CR 5.16.1) and their definitions.
   */
  evolve?: { superEvolved: boolean; cards: readonly (readonly [CardId, DefId])[] };
}

/** The window of a play of the card `hand` (from the hand or the EX area), opened at the answer. */
export const openWatch = (hand: CardId): Watch => ({ hand, def: null, resolution: null, field: null, triggered: [], played: [], declined: false });

/** The window of an evolution of the follower `card` (an evolve answer in our main phase, CR 8.3). */
export const openEvolveWatch = (card: CardId): Watch => ({ hand: card, def: null, resolution: null, field: null, triggered: [], played: [], declined: false, evolve: { superEvolved: false, cards: [] } });

/** The watch after some events: the card's moves to the resolution zone and the field, its abilities' triggers and plays. */
export function feedWatch(w: Watch, events: readonly GameEvent[]): Watch {
  if (w.evolve) return feedEvolveWatch(w, events);
  let out = w;
  for (const e of events) {
    if (e.type === "cardsMoved") {
      for (const m of e.moves) {
        if (out.resolution === null && m.card === out.hand && m.to.zone === "resolution") out = { ...out, resolution: m.newCard ?? m.card, def: m.def };
        else if (out.resolution !== null && out.field === null && m.card === out.resolution && m.to.zone === "field") out = { ...out, field: m.newCard ?? m.card, def: m.def };
      }
    } else if ((e.type === "abilityTriggered" || e.type === "abilityPlayed") && out.field !== null && e.source === out.field && e.sourceDef === out.def) {
      // Only the card's own abilities (a keyword's or a given ability's events name another sourceDef).
      out = e.type === "abilityTriggered" ? { ...out, triggered: [...out.triggered, e.ability] } : { ...out, played: [...out.played, e.ability] };
    }
  }
  return out;
}

/**
 * An evolution's watch after some events: the evolve card put into the evolve zone (its definition, CR 5.16.1), the
 * follower evolved (the `evolved` event, CR 12.2), the evolved card's own abilities' triggers and plays from then on.
 */
function feedEvolveWatch(w: Watch, events: readonly GameEvent[]): Watch {
  let out = w;
  for (const e of events) {
    if (e.type === "cardsMoved" && out.field === null) {
      const moved = e.moves.flatMap((m) => {
        const id = m.newCard ?? m.card;
        return m.to.zone === "evolveZone" && id !== null ? [[id, m.def] as const] : [];
      });
      if (moved.length) out = { ...out, evolve: { ...out.evolve!, cards: [...out.evolve!.cards, ...moved] } };
    } else if (e.type === "evolved" && out.field === null && e.card === out.hand) {
      const def = out.evolve!.cards.find(([id]) => id === e.evolveCard)?.[1] ?? null;
      out = { ...out, field: e.card, def, evolve: { superEvolved: e.superEvolved, cards: [] } };
    } else if ((e.type === "abilityTriggered" || e.type === "abilityPlayed") && out.field !== null && e.source === out.field && e.sourceDef === out.def) {
      out = e.type === "abilityTriggered" ? { ...out, triggered: [...out.triggered, e.ability] } : { ...out, played: [...out.played, e.ability] };
    }
  }
  return out;
}

/** A decision of the window answered: an optional cost or Earth Rite of the card declined marks the watch. */
export function answeredInWatch(w: Watch, d: Decision | null, a: Answer): Watch {
  if (d?.type !== "confirm" || (d.reason !== "optionalCost" && d.reason !== "earthRite") || a.type !== "confirm" || a.yes) return w;
  return w.field !== null && d.source === w.field ? { ...w, declined: true } : w;
}

export type WasteKind = "triggerIf" | "condition" | "unplayed" | "gate";
export type FanfareOutcome = { index: number; outcome: "effective" | "wasted" | "unknown"; why: WasteKind | null };

/** A closed window's judgment: each Fanfare's outcome, and the waste charged (null: none). */
export interface PlayJudgment {
  def: DefId | null;
  fanfares: FanfareOutcome[];
  charged: WasteKind | null;
}

/** A predicate of a card's script, null when it throws (not judged then). */
function holds(f: () => boolean): boolean | null {
  try {
    return f();
  } catch {
    return null;
  }
}

/**
 * Judge a closed window in the position where it closed (`session`, a simulated copy; `me` the player who played): each
 * Fanfare of the card effective, wasted or unknown under `scope` (the header), and the play charged when one was wasted and
 * none was effective.
 */
export function judgeWatch(w: Watch, session: GameSession, me: PlayerId, scope: CondScope, scripts: ScriptRegistry, gates: CondGates | null): PlayJudgment {
  const fanfares: FanfareOutcome[] = [];
  if (w.def === null || w.field === null) return { def: w.def, fanfares, charged: null };
  const field = w.field;
  let reader: GameReader | null = null;
  const read = () => (reader ??= session.reader());
  let view: PlayerView | null = null;
  // An evolution's window: the evolved card's On Evolve abilities (CR 12.6, 12.17), judged as Fanfares are but for the gates.
  const abilities = w.evolve ? evolveAbilitiesOf(scripts, w.def, w.evolve.superEvolved) : fanfaresOf(scripts, w.def);
  for (const f of abilities) {
    const triggered = w.triggered.includes(f.index);
    const played = w.played.includes(f.index);
    let outcome: FanfareOutcome = { index: f.index, outcome: "unknown", why: null };
    if (!triggered) {
      // CR 10.1.1.2.1.1 / 10.7.2: a trigger restriction unmet; anything else that kept it from triggering isn't known here.
      if (f.triggerIf && holds(() => !f.ability.triggerIf!(read(), me, field)) === true) outcome = { index: f.index, outcome: "wasted", why: "triggerIf" };
    } else if (!played) {
      // CR 10.7.3.2: pending but not played. Its declared condition first (checked before anything else is chosen).
      if (f.condition && holds(() => !f.ability.condition!(read(), me, field)) === true) outcome = { index: f.index, outcome: "wasted", why: "condition" };
      // Not one whose effect is bought with a cost (CR 10.4.7.4, 13.3.3.2): unpaid, declined or blocked, its option untaken.
      else if (scopeAtLeast(scope, "unplayed") && !f.declinable) outcome = { index: f.index, outcome: "wasted", why: "unplayed" };
    } else {
      outcome = { index: f.index, outcome: "effective", why: null };
      if (!w.evolve && scopeAtLeast(scope, "gates") && gates) {
        const refs = gates.gatesOf(w.def, f.index);
        if (refs.length > 0) {
          view ??= session.view(me);
          const v = view;
          // CR 10.3.3: a part of the effect valid only under a condition does nothing while it isn't met.
          if (refs.some((g) => gates.met(v, me, field, g) === false)) outcome = { index: f.index, outcome: "wasted", why: "gate" };
        }
      }
    }
    fanfares.push(outcome);
  }
  const wasted = fanfares.find((x) => x.outcome === "wasted");
  const charged = wasted && !fanfares.some((x) => x.outcome === "effective") ? wasted.why : null;
  return { def: w.def, fanfares, charged };
}

// ---- The plans' charges (the planner's bookkeeping) ----

/** A plan's state at a node: the open window (if any), the charges so far, how many plays were charged. */
export interface CondState {
  watch: Watch | null;
  penalty: number;
  charged: number;
}
const EMPTY: CondState = { watch: null, penalty: 0, charged: 0 };

/** What a plan's node carries: the plan's state there and the charge taken from its value (0 for a won or lost one). */
export interface CondMark {
  state: CondState;
  applied: number;
}

/** A node of the planner's plans as the charges see it: its value, and its mark once the charges followed it. */
export interface ChargedNode {
  value: number;
  cond?: CondMark;
}

/** One expansion of the planner's own search: the node expanded, the answer given, the decision it answered, the events. */
export interface Expansion<N extends ChargedNode> {
  parent: N;
  answer: Answer;
  decision: Decision | null;
  events: readonly GameEvent[];
}

/** Where a plan's step ended (planner.ts): at our next decision, with our turn over, or with the game over. */
export type StepStop = "decide" | "turnOver" | "gameOver";

/** A value already won or lost (pick()'s own test: half the win weight from 0): never charged. */
const decided = (v: number): boolean => !Number.isFinite(v) || Math.abs(v) >= DEFAULT_WEIGHTS.win / 2;

/** What the change did on one planner. */
export interface ConditionalStats {
  /** Windows opened (card plays in the top-level search), closed and judged, and plays charged by kind. */
  windows: number;
  judged: number;
  charged: Record<WasteKind, number>;
  /** Plays charged by the card's definition. */
  byCard: Record<string, number>;
  /** Comparisons (the plan's final values), those where a candidate was charged, two-turn comparisons made without cuts. */
  comparisons: number;
  adjusted: number;
  exact: number;
  /** With CondParams.evolve only: evolution windows opened, and evolutions charged (also counted above by kind and card). */
  evolve?: { windows: number; charged: number };
}

/**
 * The charges of one planner (PlannerBotOptions conditional): each plan's state carried node to node (a play opens a
 * window, the expansion's events feed it, our next main phase decision closes it), the charge taken from the node's value
 * (the search's ranking) and from the values its candidates are finally compared by. A node made again outside the search
 * from a parent and an answer (a plan replaced where it was stopped, planner.ts unsureWinsStopped) gets the state that
 * expansion left.
 */
export class ConditionalCharges {
  readonly stats: ConditionalStats = { windows: 0, judged: 0, charged: { triggerIf: 0, condition: 0, unplayed: 0, gate: 0 }, byCard: {}, comparisons: 0, adjusted: 0, exact: 0 };
  /** The plans' states after (parent, answer), for a node made again from them outside an expansion. */
  private readonly after = new WeakMap<object, Map<string, CondState>>();

  constructor(
    private readonly scripts: ScriptRegistry,
    readonly params: CondParams,
    readonly gates: CondGates | null,
  ) {
    const problems = condProblems(params);
    if (problems.length) throw new Error(`cond: ${problems.join("; ")}`);
    if (params.scope === "gates" && gates === null) throw new Error("cond=gates needs the gates reader of the card feature table (conditional-gates.ts tableGates)");
    if (params.evolve) this.stats.evolve = { windows: 0, charged: 0 };
  }

  /** The node `made` by an expansion (the position where it stopped: `session`, `stop`), with its plan's state and charge. */
  expanded<N extends ChargedNode>(made: N, x: Expansion<N>, session: GameSession, me: PlayerId, stop: StepStop): N {
    const state = this.step(x, session, me, stop);
    let m = this.after.get(x.parent);
    if (!m) this.after.set(x.parent, (m = new Map()));
    m.set(JSON.stringify(x.answer), state);
    return this.mark(made, state);
  }

  /** A node made again from `parent` and `answer` outside an expansion: the state that expansion left, if any. */
  remade<N extends ChargedNode>(made: N, parent: object, answer: Answer): N {
    const state = this.after.get(parent)?.get(JSON.stringify(answer)) ?? null;
    return state === null ? made : this.mark(made, state);
  }

  /** The charges of a plan (0: none, or a node the change didn't follow). */
  chargeOf(node: ChargedNode | null | undefined): number {
    return node?.cond?.state.penalty ?? 0;
  }

  /** The values the candidates are compared by, each less its plan's charges (a decided value is left as it is). */
  chargedValues(candidates: readonly ChargedNode[], values: readonly number[]): number[] {
    this.stats.comparisons += 1;
    let any = false;
    const out = values.map((v, i) => {
      const p = this.chargeOf(candidates[i]);
      if (p <= 0 || decided(v)) return v;
      any = true;
      return v - p;
    });
    if (any) this.stats.adjusted += 1;
    return out;
  }

  /**
   * Whether a two-turn comparison of these candidates must be made without alpha-beta cuts: their charges differ (a cut
   * value is a bound below the best raw value; with the charges the comparison moves, so the bound may not hold).
   */
  differ(candidates: readonly ChargedNode[]): boolean {
    const differ = new Set(candidates.map((c) => this.chargeOf(c))).size > 1;
    if (differ) this.stats.exact += 1;
    return differ;
  }

  /** The plan's state at a node made by an expansion: a play opens a window; the events feed it; our next main phase decision closes it. */
  private step<N extends ChargedNode>(x: Expansion<N>, session: GameSession, me: PlayerId, stop: StepStop): CondState {
    const parent = x.parent.cond?.state ?? EMPTY;
    let watch = parent.watch;
    const a = x.answer;
    if (x.decision?.type === "mainPhase" && a.type === "mainPhase" && a.action.type === "play") {
      watch = openWatch(a.action.card);
      this.stats.windows += 1;
    } else if (this.params.evolve && x.decision?.type === "mainPhase" && a.type === "mainPhase" && a.action.type === "evolve") {
      // CR 8.3, 12.2: an evolve answer of ours opens an evolution's window (its On Evolve abilities, CR 12.6, 12.17).
      watch = openEvolveWatch(a.action.card);
      this.stats.evolve!.windows += 1;
    } else if (watch) watch = answeredInWatch(watch, x.decision, a);
    if (watch) watch = feedWatch(watch, x.events);
    if (watch === null) return parent;
    if (stop === "decide" && session.decision?.type !== "mainPhase") return watch === parent.watch ? parent : { ...parent, watch };
    this.stats.judged += 1;
    const j = judgeWatch(watch, session, me, this.params.scope, this.scripts, this.gates);
    if (j.charged === null) return { ...parent, watch: null };
    if (watch.evolve) this.stats.evolve!.charged += 1;
    this.stats.charged[j.charged] += 1;
    this.stats.byCard[j.def!] = (this.stats.byCard[j.def!] ?? 0) + 1;
    return { watch: null, penalty: parent.penalty + this.params.penalty, charged: parent.charged + 1 };
  }

  /** The state on the node, and its charge taken from its value unless that value is already won or lost. */
  private mark<N extends ChargedNode>(made: N, state: CondState): N {
    const applied = state.penalty > 0 && !decided(made.value) ? state.penalty : 0;
    made.value -= applied;
    made.cond = { state, applied };
    return made;
  }
}

// ---- The cards covered ----

/** A Fanfare a scope judges, of one definition. */
export interface CoveredFanfare {
  def: DefId;
  index: number;
  kind: "triggerIf" | "condition" | "unplayable" | "gate";
  detail: string;
}

/**
 * The Fanfares of these definitions a scope judges (a definition's printings are one definition): declared — those with a
 * trigger restriction or a condition; unplayed — also those that can fail to be played (required targets, options) and have
 * no cost to buy their effect with (an optional cost, an Earth Rite: never judged, the header); gates — also those whose
 * code has a gate the card table reads.
 */
export function coveredFanfares(scripts: ScriptRegistry, defs: readonly DefId[], scope: CondScope, gates: CondGates | null = null): CoveredFanfare[] {
  const out: CoveredFanfare[] = [];
  for (const def of [...new Set(defs)].sort()) {
    for (const f of fanfaresOf(scripts, def)) {
      if (f.triggerIf) out.push({ def, index: f.index, kind: "triggerIf", detail: "trigger restriction" });
      if (f.condition) out.push({ def, index: f.index, kind: "condition", detail: "condition when played" });
      if (scopeAtLeast(scope, "unplayed") && f.unplayable.length > 0 && !f.declinable) out.push({ def, index: f.index, kind: "unplayable", detail: f.unplayable.join("+") });
      if (scopeAtLeast(scope, "gates") && gates) {
        for (const g of gates.gatesOf(def, f.index)) out.push({ def, index: f.index, kind: "gate", detail: gates.describe(g) });
      }
    }
  }
  return out;
}
