import type { Answer, GameEvent, GameSession, MainAction, PlayerId } from "./core";
import { lookupFromReader, type CardLookup } from "./policy";

// The lines of a turn's plans (PlannerBotOptions.lineSlots): which plans are compared two turns ahead. The beam keeps one
// plan per position, so its best plans are often one line several times — the same cards played, evolved and attacked
// with, only another card searched or the same choices in another order —, and a different line (holding back an attack,
// another target) never reaches the comparison (in reviewed games, about half the plans experts named were not among the
// 4 compared). Here the comparison's slots go to different lines: the best plan of each of the best lines, one slot for a
// line attacking less within a margin of the best, then the best plans left. The number of slots is unchanged
// (replyPlans): slots replaced, not added (planKinds 6, which added slots, measured worse in paired games).

/** A plan's point as this module reads it (planner.ts Node): the game there, the answer that led there, its rank. */
export interface LineNode {
  session: GameSession;
  parent: LineNode | null;
  answer: Answer | null;
  value: number;
}

/** lineSlots' parameters: the best `lines` lines first, the slot of fewer attacks within `margin` points, the line's key. */
export interface LineSlotOptions {
  lines: number;
  margin: number;
  /** "set": the actions of a line in any order; "seq": in the order played. */
  key: "set" | "seq";
}

export const LINE_SLOT_DEFAULTS: Readonly<LineSlotOptions> = { lines: 3, margin: 3, key: "set" };

/**
 * A main phase action by what it does (the cards by definition): playing a card from a zone (CR 8.2); evolving a follower
 * with an evolve card, paying play or evolution points, super-evolving or not (CR 8.3, 12.2); an activated ability of a card
 * (with an evolution point or not, CR 12.16.3); an attack of a follower on a follower or the leader (CR 8.4).
 */
function actionToken(action: MainAction, lookup: CardLookup): string {
  const def = (id: string) => lookup(id)?.def ?? "?";
  switch (action.type) {
    case "play":
      return `P:${def(action.card)}:${lookup(action.card)?.zone ?? "?"}`;
    case "evolve":
      return `E:${def(action.card)}>${def(action.evolveCard)}:${action.useEvolutionPoint ? "ep" : "pp"}${action.superEvolve ? ":super" : ""}${action.backFace ? ":back" : ""}`;
    case "activate":
      return `A:${def(action.card)}:${action.ability}${action.useEvolutionPoint ? ":ep" : ""}`;
    case "attack":
      return `X:${def(action.attacker)}>${lookup(action.target)?.zone === "leader" ? "leader" : def(action.target)}`;
    default:
      return JSON.stringify(action);
  }
}

/**
 * A decision inside an action by what it decides for the line, or null when the line leaves it out: yes or no (an optional
 * cost, "you may"); a choice of options (a mode, CR 5.18; how to play a card; how damage is divided) as a set; the enemy
 * cards a selection picks (a target, CR 10.6.2.3), by definition. Left out: the own cards picked (searched, discarded,
 * banished for a cost), which pending ability goes first (CR 10.5.2.2) and the order of cards.
 */
function subToken(parent: GameSession, answer: Answer, lookup: CardLookup): string | null {
  const d = parent.decision;
  if (!d) return null;
  const source = (id: string | null) => (id === null ? "-" : (lookup(id)?.def ?? "?"));
  if (d.type === "confirm" && answer.type === "confirm") return `C:${source(d.source)}:${answer.yes ? 1 : 0}`;
  if (d.type === "choose" && answer.type === "choose") return `M:${source(d.source)}:${d.reason}:${[...answer.ids].sort().join(",")}`;
  if (d.type === "selectCards" && answer.type === "selectCards") {
    const enemy = (id: string) => {
      const c = lookup(id)?.controller;
      return c !== undefined && c !== d.player;
    };
    if (!d.candidates.some(enemy)) return null;
    return `S:${source(d.source)}:${answer.cards.filter(enemy).map((id) => lookup(id)?.def ?? "?").sort().join(",")}`;
  }
  return null;
}

/** The tokens of a node's own step (its answer at its parent's decision), memoized: a plan's steps are shared by its children. */
const tokens = new WeakMap<LineNode, { main: boolean; token: string | null }>();
function stepOf(n: LineNode): { main: boolean; token: string | null } {
  let t = tokens.get(n);
  if (t === undefined) {
    const parent = n.parent!.session;
    const lookup = lookupFromReader(parent.reader());
    const a = n.answer!;
    t = a.type === "mainPhase" ? { main: true, token: actionToken(a.action, lookup) } : { main: false, token: subToken(parent, a, lookup) };
    tokens.set(n, t);
  }
  return t;
}

/**
 * A plan's line: its main phase actions, each with the decisions inside it that the line keeps (subToken), in the order
 * played ("seq") or as a multiset ("set": the same actions in another order are one line).
 */
export function lineKey(node: LineNode, key: "set" | "seq"): string {
  const steps: { main: boolean; token: string | null }[] = [];
  for (let n: LineNode | null = node; n && n.parent; n = n.parent) steps.push(stepOf(n));
  steps.reverse();
  const actions: string[][] = [];
  for (const s of steps) {
    if (s.main) actions.push([s.token!]);
    else if (s.token !== null) {
      if (actions.length === 0) actions.push(["-"]);
      actions[actions.length - 1]!.push(s.token);
    }
  }
  const parts = actions.map((a) => a.join(" "));
  return (key === "set" ? parts.sort() : parts).join(" | ");
}

/** How many attacks a plan declares (CR 8.4). */
export function attacksOf(node: LineNode): number {
  let k = 0;
  for (let n: LineNode | null = node; n && n.parent; n = n.parent) if (n.answer?.type === "mainPhase" && n.answer.action.type === "attack") k += 1;
  return k;
}

/**
 * At most `k` of the finished plans (best first) for the comparison, by line: the plans grouped by lineKey (each line's best
 * plan stands for it); the best `lines` lines; then the line attacking least among those attacking less than the best line
 * and within `margin` points of it (the better one among equals); then the next lines; then, when there are fewer lines than
 * slots, the best plans not taken. `keyOf` reads a plan's line (default lineKey with `o.key`).
 */
export function lineSlots<N extends LineNode>(finished: readonly N[], k: number, o: LineSlotOptions, keyOf: (n: N) => string = (n) => lineKey(n, o.key)): N[] {
  const best = new Map<string, N>();
  for (const n of finished) {
    const key = keyOf(n);
    if (!best.has(key)) best.set(key, n);
  }
  const lines = [...best.values()];
  const out: N[] = [];
  const take = (n: N | undefined) => {
    if (n !== undefined && out.length < k && !out.includes(n)) out.push(n);
  };
  for (const n of lines.slice(0, Math.min(o.lines, k))) take(n);
  if (lines.length > 0) {
    const top = lines[0]!;
    const fewer = lines
      .filter((n) => !out.includes(n) && attacksOf(n) < attacksOf(top) && n.value >= top.value - o.margin)
      .sort((x, y) => attacksOf(x) - attacksOf(y) || y.value - x.value);
    take(fewer[0]);
  }
  for (const n of lines) take(n);
  for (const n of finished) take(n);
  return out;
}

/**
 * The tie-break of the comparison (PlannerBotOptions.tieKeepHand): among the plans whose values are within `eps` of the best
 * (`best`: the first of the highest), the one keeping the most cards in hand; then the higher value; then the first listed.
 * `hand(i)` counts the cards in hand where plan i ends (asked only for the plans within `eps`).
 */
export function keepsMoreCards(values: readonly number[], best: number, eps: number, hand: (i: number) => number): number {
  const top = values[best]!;
  if (!(eps > 0) || !Number.isFinite(top)) return best;
  let pick = best;
  let most = -1;
  for (let i = 0; i < values.length; i++) {
    const v = values[i]!;
    if (!(v >= top - eps)) continue;
    const h = hand(i);
    if (h > most || (h === most && v > values[pick]!)) {
      pick = i;
      most = h;
    }
  }
  return pick;
}

/** The cards in `player`'s hand at a plan's end. */
export const handAt = (session: GameSession, player: PlayerId): number => session.reader().cards(player, "hand").length;

// ---- Information first (PlannerBotOptions.drawFirst) ----
//
// A fair planner searches its turn in one sample of what it can't see (the cards it will draw are dealt there), so in the
// search a card drawn is known before it is drawn and drawing first is worth nothing: two orders reaching one position are
// one plan, and which is kept depends on the beam's ranking of the steps in between. In the real game the cards drawn are
// seen only once drawn, and the plan is made again from there (planner.ts followPlan): drawing first leaves the play points
// for what is drawn. So before a plan is carried out, an action that draws is moved to the front when the plan still ends
// in the same position (and value) in its own sample — never a fixed "draw first" rule: an action whose result depends on
// the order (a counter put by a card played before, a condition on the cards in hand, a cost) ends elsewhere when moved
// and is left where it is.

/**
 * A plan's steps by action: each action starts at a main phase answer (CR 7.3.3) and takes the decisions inside it (targets,
 * costs, the order of triggers, a Ward follower's entry, selections) up to the next main phase decision. `mainAt[i]`: step i
 * was answered at a main phase decision. Returns the steps' indexes per action; null when the plan doesn't start with a main
 * phase answer (a plan made in the middle of an action).
 */
export function actionSegments(mainAt: readonly boolean[]): number[][] | null {
  if (mainAt.length === 0 || !mainAt[0]) return null;
  const out: number[][] = [];
  for (const [i, main] of mainAt.entries()) {
    if (main) out.push([i]);
    else out[out.length - 1]!.push(i);
  }
  return out;
}

/** Whether these events drew cards for `me` (CR 5.10, the move's reason "draw"; a card searched for moves by an effect: not a draw). */
export function drewCards(events: readonly GameEvent[], me: PlayerId): boolean {
  return events.some((e) => e.type === "cardsMoved" && e.moves.some((m) => m.reason === "draw" && m.to.player === me && m.to.zone === "hand"));
}

/** The actions' order with action `s` moved to the front, the others as they were. */
export function drawToFront(count: number, s: number): number[] {
  return [s, ...Array.from({ length: count }, (_, i) => i).filter((i) => i !== s)];
}
