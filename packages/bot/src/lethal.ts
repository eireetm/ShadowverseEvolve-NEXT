import { opponentOf, seedRng, validateAnswer, type Answer, type CardId, type Decision, type DefId, type GameSession, type PlayerId, type PlayerView } from "./core";
import { planBranches } from "./branches";
import { evaluate } from "./evaluate";
import { positionKey } from "./keys";
import { fastAnswer, lookupFromReader } from "./policy";

// Sure lethal first. A won game is the best position there is (the evaluation's win), so a planner always takes a plan that
// wins once it sees one; what it can miss is the line itself: ranked by the whole position, the steps of a lethal that takes
// several actions (Wards taken out by small followers, then every attack at the leader) look worse than a good trade, and are
// cut from the beam. So before planning its turn a planner looks for a line ranked by what decides lethal — the defense the
// opponent's leader keeps once the attacks it can declare land — and plays it at once if it is sure:
//   - knowing the real game (the cheating bot): the line wins there, the opponent answering its quick windows as modelled;
//   - knowing what its player knows (a fair bot): the line wins in each of several samples of the hidden cards
//     (GameSession.determinized), every decision of the opponent answered by a model — so it rests neither on a card drawn
//     or a random result its player can't know, nor on the opponent passing.
// Measured on 961 recorded Medium games (2026-10-03): Medium missed a sure lethal in 121 of them and lost 33 of those games.

/** Who answers the opponent's decisions in a simulation of our turn: a model, or nobody (they pass, the fast answers). */
export type Responder = ((session: GameSession) => Answer) | null;

/** A step of a lethal line: the answer, and the cards it names as they were (matched by card where their ids differ). */
export interface LethalStep {
  answer: Answer;
  defs: Record<CardId, DefId>;
}

export interface LethalSearchOptions {
  /** Most answers tried (a count, not a time: the same game gives the same line). */
  budget: number;
  /** Positions kept at each step. */
  beam: number;
  /** Answers tried at each decision. */
  maxBranches: number;
  /** The worlds searched and checked: 0 is searched; a line must also win in 1 .. `checks` (none: the real game, cheating). */
  world: (i: number) => GameSession;
  checks: number;
  /** The opponent while searching: their quick windows answered by a model (a bot that knows their hand), or passing. */
  searchResponder: () => Responder;
  /** The opponent in the checks: a fresh model for each, answering all their decisions. */
  checkResponder: () => Responder;
  /** Winning lines checked at most; the search goes on after one that isn't sure. */
  maxLines: number;
  seed: string;
  /** The key positions are told apart by (default positionKey; a throwaway search can use a cheaper exact one). */
  key?: (view: PlayerView) => string;
}

export interface LethalResult {
  line: LethalStep[] | null;
  /** The positions looked at (their views): nothing new there, nothing to search again this turn. */
  seen: Set<string>;
  simulations: number;
  /** Lines that won where they were found but not in every check. */
  rejected: number;
}

/**
 * Is lethal worth looking for? The opponent's defense is low, or at most the attack of every follower that can declare an
 * attack now (on anything: a Ward in the way counts, CR 12.8.2 — its attacks are declarable on the Ward), plus the Storm
 * followers in hand it can play (CR 12.9.2), plus a margin for what spells, evolutions and abilities may add.
 */
export function lethalWithinReach(view: PlayerView, d: Decision, me: PlayerId, margin = 8, low = 12): boolean {
  if (d.type !== "mainPhase") return false;
  const attackers = new Set<CardId>();
  for (const a of d.actions) if (a.type === "attack") attackers.add(a.attacker);
  const side = view.players[me];
  let attack = 0;
  for (const card of side.field) if (!card.hidden && attackers.has(card.id)) attack += Math.max(0, card.attack ?? 0);
  for (const card of side.hand) {
    if (!card.hidden && card.type === "follower" && card.keywords.includes("storm") && (card.cost ?? 99) <= side.playPoints) attack += Math.max(0, card.attack ?? 0);
  }
  const defense = view.players[opponentOf(me)].leaderDefense;
  return defense <= low || defense <= attack + margin;
}

/** The face damage of the attacks on the opponent's leader that can be declared at this main phase decision (each attacker once). */
function faceReach(view: PlayerView, d: Decision, me: PlayerId): number {
  if (d.type !== "mainPhase" || d.player !== me) return -1;
  const leader = view.players[opponentOf(me)].leader?.id;
  const attackers = new Set<CardId>();
  for (const a of d.actions) if (a.type === "attack" && a.target === leader) attackers.add(a.attacker);
  let sum = 0;
  for (const card of view.players[me].field) if (!card.hidden && attackers.has(card.id)) sum += Math.max(0, card.attack ?? 0);
  return sum;
}

type Stop = "decide" | "turnOver" | "won" | "gameOver";

/** Play on to our next decision in this main phase, the opponent answered by `respond` (only in quick windows, unless `all`). */
function advance(s: GameSession, me: PlayerId, turn: number, respond: Responder, all: boolean): Stop {
  for (let steps = 0; steps < 300; steps++) {
    const d = s.decision;
    if (!d) return s.result?.winner === me && s.state.turn === turn ? "won" : "gameOver";
    if (s.state.turn !== turn || s.state.phase !== "main") return "turnOver";
    if (d.player === me) return "decide";
    s.act(respond && (all || d.type === "quick") ? respond(s) : fastAnswer(d, lookupFromReader(s.reader())));
  }
  return "turnOver";
}

const CARD_ID = /^c\d+$/;
function cardIds(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string" && CARD_ID.test(value)) out.push(value);
  else if (Array.isArray(value)) for (const x of value) cardIds(x, out);
  else if (value && typeof value === "object") for (const x of Object.values(value)) cardIds(x, out);
  return out;
}
function replaceIds(value: unknown, map: (id: string) => string): unknown {
  if (typeof value === "string" && CARD_ID.test(value)) return map(value);
  if (Array.isArray(value)) return value.map((x) => replaceIds(x, map));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, replaceIds(v, map)]));
  return value;
}

/** The step of giving `answer` in `s`: with the cards it names. */
export function stepOf(s: GameSession, answer: Answer): LethalStep {
  const lookup = lookupFromReader(s.reader());
  const defs: Record<CardId, DefId> = {};
  for (const id of cardIds(answer)) defs[id] = lookup(id)?.def ?? "";
  return { answer, defs };
}

/**
 * The step's answer at this decision of another world (another sample, the real game): as it is if it is legal and every card
 * it names is still the same card there, else with its cards matched by card definition — a hidden card's id holds another
 * card in another sample (determinize keeps the ids and deals the cards again), and a card that moved has a new id (CR 4.1.4);
 * null if nothing matches.
 */
export function adaptStep(s: GameSession, step: LethalStep): Answer | null {
  const d = s.decision;
  if (!d || d.type !== step.answer.type) return null;
  const lookup = lookupFromReader(s.reader());
  const same = cardIds(step.answer).every((id) => !step.defs[id] || lookup(id)?.def === step.defs[id]);
  if (same && validateAnswer(d, step.answer) === null) return step.answer;
  const signature = (x: unknown, defOf: (id: string) => string) => JSON.stringify(replaceIds(x, defOf));
  if (d.type === "mainPhase" || d.type === "quick") {
    const want = signature((step.answer as { action: unknown }).action, (id) => step.defs[id] || id);
    const match = d.actions.find((x) => signature(x, (id) => lookup(id)?.def ?? id) === want);
    return match ? ({ type: d.type, action: match } as Answer) : null;
  }
  if (d.type === "selectCards" && step.answer.type === "selectCards") {
    const used = new Set<CardId>();
    const cards: CardId[] = [];
    for (const id of step.answer.cards) {
      const sameCard = (c: CardId) => !step.defs[id] || lookup(c)?.def === step.defs[id];
      const pick = d.candidates.includes(id) && !used.has(id) && sameCard(id) ? id : d.candidates.find((c) => !used.has(c) && sameCard(c));
      if (pick === undefined) return null;
      used.add(pick);
      cards.push(pick);
    }
    const answer: Answer = { type: "selectCards", cards };
    return validateAnswer(d, answer) === null ? answer : null;
  }
  if (d.type === "orderCards" && step.answer.type === "orderCards") {
    // The same cards by what they are, in the step's order; the others after them.
    const left = d.cards.map((c) => c.id);
    const order: CardId[] = [];
    for (const id of step.answer.order) {
      const pick = left.find((c) => lookup(c)?.def === step.defs[id]);
      if (pick === undefined) continue;
      order.push(pick);
      left.splice(left.indexOf(pick), 1);
    }
    const answer: Answer = { type: "orderCards", order: [...order, ...left] };
    return validateAnswer(d, answer) === null ? answer : null;
  }
  return null;
}

/** Does the line win this turn when played from `s` (each step matched to its decision), the opponent answered by `respond`? */
export function lineWins(s: GameSession, line: readonly LethalStep[], me: PlayerId, respond: Responder): boolean {
  const turn = s.state.turn;
  try {
    for (const step of line) {
      if (s.decision?.player !== me) return false;
      const answer = adaptStep(s, step);
      if (!answer) return false;
      s.act(answer);
      const stop = advance(s, me, turn, respond, true);
      if (stop === "won") return true;
      if (stop !== "decide") return false;
    }
    return false;
  } catch {
    return false;
  }
}

interface Node {
  session: GameSession;
  parent: Node | null;
  step: LethalStep | null;
  /** The opponent's defense left once the face attacks declarable now land (lower first), then their defense. */
  rank: number;
  /** The position (ties). */
  value: number;
  reach: number;
  key: string;
}

/**
 * Look for a sure lethal line (see the top of this file): a beam search over this turn's answers in world 0, ranked by the
 * opponent's defense left once every attack on their leader declarable now lands, ties by the position; each line that wins
 * there is checked in the other worlds, and the first sure one is returned.
 */
export function searchSureLethal(me: PlayerId, o: LethalSearchOptions): LethalResult {
  const rng = seedRng(`lethal:${o.seed}`);
  const root = o.world(0);
  const turn = root.state.turn;
  const searchResponder = o.searchResponder;
  const keyOf = o.key ?? positionKey;
  const node = (session: GameSession, parent: Node | null, step: LethalStep | null): Node => {
    const view = session.view(me);
    const r = faceReach(view, session.decision!, me);
    const reach = r >= 0 ? r : (parent?.reach ?? 0);
    const defense = view.players[opponentOf(me)].leaderDefense;
    return { session, parent, step, rank: (defense - reach) * 10 + defense, value: evaluate(view, me), reach, key: keyOf(view) };
  };
  // A sample made in the middle of an action can't be copied until its next main phase (GameSession.determinized): rebuilt.
  const copy = (n: Node): GameSession => {
    try {
      return n.session.clone();
    } catch {
      const s = n.parent ? copy(n.parent) : o.world(0);
      if (n.step) {
        s.act(n.step.answer);
        advance(s, me, turn, searchResponder(), false);
      }
      return s;
    }
  };
  const lineOf = (n: Node, last: LethalStep): LethalStep[] => {
    const steps = [last];
    for (let x: Node | null = n; x && x.step; x = x.parent) steps.unshift(x.step);
    return steps;
  };
  const sure = (line: LethalStep[]): boolean => {
    for (let i = o.checks > 0 ? 0 : 1; i <= o.checks; i++) if (!lineWins(o.world(i), line, me, o.checkResponder())) return false;
    return true;
  };
  const first = node(root, null, null);
  const seen = new Set<string>([first.key]);
  let frontier = [first];
  let simulations = 0;
  let lines = 0;
  let rejected = 0;
  for (let depth = 0; depth < 24 && frontier.length > 0 && simulations < o.budget && lines < o.maxLines; depth++) {
    const children: Node[] = [];
    for (const n of frontier) {
      for (const answer of planBranches(n.session.decision!, lookupFromReader(n.session.reader()), rng, o.maxBranches)) {
        if (simulations >= o.budget || lines >= o.maxLines) break;
        simulations += 1;
        const step = stepOf(n.session, answer);
        let s: GameSession;
        let stop: Stop;
        try {
          s = copy(n);
          s.act(answer);
          stop = advance(s, me, turn, searchResponder(), false);
        } catch {
          continue;
        }
        if (stop === "won") {
          lines += 1;
          const line = lineOf(n, step);
          if (sure(line)) return { line, seen, simulations, rejected };
          rejected += 1;
          continue;
        }
        if (stop !== "decide") continue;
        const child = node(s, n, step);
        if (seen.has(child.key)) continue;
        seen.add(child.key);
        children.push(child);
      }
    }
    children.sort((a, b) => a.rank - b.rank || b.value - a.value);
    frontier = children.slice(0, o.beam);
  }
  return { line: null, seen, simulations, rejected };
}

/** Something that answers a player's decisions (a bot used as a model of a player). */
export interface Model {
  decide(session: GameSession): Answer;
}

/**
 * `model`, playing first a lethal it finds at its first main phase decision of a turn: an opponent model that sees our coming
 * loss (the greedy model alone missed about one in four of the winning turns that beat Medium). The search (`budget`
 * answers) runs in the session it is given — in a simulation the world being simulated — and its line must also win in a
 * sample of what that player can't see there (our hand, the decks' order), so it doesn't rest on luck. Only when its attackers,
 * Storm followers and a small margin reach the defense. Otherwise, and once the line is off, `model` answers. `spent` is told
 * the answers each search tried.
 */
export function lethalFirstModel(model: Model, budget: number, maxBranches: number, seed: string, spent: (simulations: number) => void = () => {}): Model {
  let line: { turn: number; steps: LethalStep[]; given: number } | null = null;
  let searched = -1;
  return {
    decide(s) {
      const d = s.decision!;
      const st = s.state;
      if (line && line.turn === st.turn && line.given < line.steps.length) {
        const answer = adaptStep(s, line.steps[line.given]!);
        if (answer) {
          line.given += 1;
          return answer;
        }
        line = null;
      }
      if (budget > 0 && d.type === "mainPhase" && st.activePlayer === d.player && st.phase === "main" && searched !== st.turn && lethalWithinReach(s.view(d.player), d, d.player, 3, 0)) {
        searched = st.turn;
        const found = searchSureLethal(d.player, {
          budget,
          beam: 12,
          maxBranches,
          world: (i) => (i === 0 ? s.clone() : s.determinized(d.player, `${seed}:${st.turn}:check`)),
          checks: 1,
          searchResponder: () => null,
          checkResponder: () => null,
          maxLines: 2,
          seed: `${seed}:${st.turn}`,
          key: (view) => JSON.stringify(view),
        });
        spent(found.simulations);
        const first = found.line ? adaptStep(s, found.line[0]!) : null;
        if (found.line && first) {
          line = { turn: st.turn, steps: found.line, given: 1 };
          return first;
        }
      }
      return model.decide(s);
    },
  };
}
