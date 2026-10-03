import {
  defaultAnswer,
  seedRng,
  validateAnswer,
  type Answer,
  type CardId,
  type Decision,
  type Engine,
  type GameSession,
  type PlayerId,
  type RngState,
} from "./core";
import { planBranches } from "./branches";
import { DEFAULT_WEIGHTS, exactResults, weightsEvaluator, type EvalWeights, type Evaluator } from "./evaluate";
import { GreedyBot, type BotStats } from "./greedy";
import { adaptStep, lethalWithinReach, lineWins, searchSureLethal, stepOf, type LethalStep, type Responder } from "./lethal";
import { redrawByExpectation, redrawKnowingDeck } from "./mulligan";
import { fastAnswer, lookupFromReader } from "./policy";

export interface PlannerBotOptions {
  seed?: string | number;
  /**
   * Plan in the real game: every hidden card (the opponent's hand, both decks in order) and every future random result.
   * The hard bot cheats on purpose (the project owner's request); the others plan in samples of what their player knows.
   */
  cheat?: boolean;
  weights?: Partial<EvalWeights>;
  /**
   * Scores the positions the search compares instead of the hand-written evaluation with `weights` (a learned one): every
   * step of a plan, and the plans' final positions unless `replyEvaluator` is given.
   */
  evaluator?: Evaluator;
  /**
   * Scores only the positions the best plans are finally compared by: after the opponent's reply, or where the game or our
   * turn already ended. Default: `evaluator`.
   */
  replyEvaluator?: Evaluator;
  /**
   * The evaluation of the opponent models (the opponent's turn after a plan, their quick windows) and of the greedy bot that
   * answers outside our main phase. Default: the hand-written one with the default weights.
   */
  modelEvaluator?: Evaluator;
  /** Plans kept at each step of the search. */
  beamWidth?: number;
  /** Answers tried at each decision of a plan. */
  maxBranches?: number;
  /** Most decisions in one plan. */
  maxDepth?: number;
  /** How many of the best plans are scored again after a simulated turn of the opponent. */
  replyPlans?: number;
  /** Most answers tried while searching one plan (a count, not a time: the same game gives the same plan). */
  maxSimulations?: number;
  /** Who plays the opponent's next turn when plans are scored after it: the greedy bot, or a smaller planner. */
  replyModel?: "greedy" | "planner";
  /** During our turn the opponent's quick windows are answered by the greedy bot instead of passing (for a bot that knows their hand). */
  opponentQuick?: boolean;
  /** Main phase actions per turn; after that the bot ends its main phase (CR 15.2.1.1: the player decides how often they repeat). */
  maxActionsPerTurn?: number;
  /** Decisions per turn in its main phase; after that it gives default answers, which stop any cycle it can stop. */
  maxDecisionsPerTurn?: number;
  /**
   * Sure lethal first (lethal.ts): before planning at a main phase decision of its turn, look for a line that surely wins this
   * turn with this many answers at most, and play it (0: don't; the opponent models don't).
   */
  lethalSearch?: number;
  /**
   * A fair bot's lethal must win in this many more samples of what it knows, the opponent answering (default 3); its plans
   * that win in its sample count as won only if they do too. A cheating bot plays in the real game and needs none.
   */
  lethalChecks?: number;
  /** "curve": keep or redraw by the curve of the first turns (mulligan.ts); "greedy" (default): the greedy bot's rule. */
  mulligan?: "greedy" | "curve";
}

/** A point of a plan: a copy of the game at one of our decisions in our main phase, or where the plan ends. */
interface Node {
  session: GameSession;
  parent: Node | null;
  /** The answer that led here from the parent. */
  answer: Answer | null;
  depth: number;
  /** The position scored as it stands (the search's ranking). */
  value: number;
  /** The game ended, or our turn did: nothing left to plan. */
  done: boolean;
  key: string;
}

type Stop = "decide" | "turnOver" | "gameOver";

/**
 * A bot that plans its whole turn: at a decision in its main phase it searches sequences of its answers
 * (plays, evolves, abilities, attacks, and the choices they ask for) with a beam search, scoring every plan at the same
 * point — its turn ended there — then plays the opponent's next turn after the best few plans and keeps the one that holds
 * up best. It plays the first answer of that plan and plans again at its next decision. Decisions outside its main phase
 * (quick windows in the opponent's turn, the end phase, mulligan) are the greedy bot's.
 */
export class PlannerBot {
  readonly stats: BotStats = { decisions: 0, simulations: 0, simulationFailures: 0, simulationErrors: {}, fallbacks: 0, lastError: null };
  /**
   * Sure lethal first: searches made and skipped (nothing new since this turn's last one), lines played and dropped on the
   * way (no longer sure), lines found but not sure, and plans that won in the bot's sample but not surely (not taken as won).
   */
  readonly lethalStats = { searches: 0, skipped: 0, played: 0, dropped: 0, rejected: 0, unsurePlans: 0 };
  private readonly evaluator: Evaluator;
  private readonly replyEvaluator: Evaluator;
  private readonly modelEvaluator: Evaluator | undefined;
  private readonly seed: string;
  private readonly cheat: boolean;
  private readonly beamWidth: number;
  private readonly maxBranches: number;
  private readonly maxDepth: number;
  private readonly replyPlans: number;
  private readonly maxSimulations: number;
  private readonly maxActionsPerTurn: number;
  private readonly maxDecisionsPerTurn: number;
  private readonly rng: RngState;
  private readonly replyModel: "greedy" | "planner";
  private readonly opponentQuick: boolean;
  private readonly lethalSearch: number;
  private readonly lethalChecks: number;
  private readonly mulliganMode: "greedy" | "curve";
  private readonly greedy: GreedyBot;
  private plans = 0;
  /** Opponent models made so far (each simulation gets a fresh one: the greedy bot counts actions per turn). */
  private models = 0;
  private turn = -1;
  private actionsThisTurn = 0;
  private decisionsThisTurn = 0;
  /** The plan being carried out: its positions from the first answer on, and how many answers of it were given. */
  private current: { path: Node[]; given: number; turn: number } | null = null;
  /** The sure lethal being played: its steps, how many were given. */
  private lethal: { turn: number; steps: LethalStep[]; given: number } | null = null;
  /** This turn's positions where a lethal search found nothing (a search there again would find nothing new). */
  private lethalSeen: { turn: number; keys: Set<string> } | null = null;
  private lethalSearches = 0;

  constructor(
    private readonly engine: Engine,
    options: PlannerBotOptions = {},
  ) {
    const weights: EvalWeights = { ...DEFAULT_WEIGHTS, ...options.weights, keywords: { ...DEFAULT_WEIGHTS.keywords, ...options.weights?.keywords } };
    // A finished game is scored as won, lost or drawn, never by an evaluation (exactResults).
    this.evaluator = exactResults(options.evaluator ?? weightsEvaluator(weights), weights.win);
    this.replyEvaluator = options.replyEvaluator ? exactResults(options.replyEvaluator, weights.win) : this.evaluator;
    this.modelEvaluator = options.modelEvaluator;
    this.seed = String(options.seed ?? "planner");
    this.cheat = options.cheat ?? false;
    this.beamWidth = options.beamWidth ?? 6;
    this.maxBranches = options.maxBranches ?? 16;
    this.maxDepth = options.maxDepth ?? 10;
    this.replyPlans = options.replyPlans ?? 4;
    this.maxSimulations = options.maxSimulations ?? 600;
    this.maxActionsPerTurn = options.maxActionsPerTurn ?? 40;
    this.maxDecisionsPerTurn = options.maxDecisionsPerTurn ?? 300;
    this.rng = seedRng(`planner:${this.seed}`);
    this.replyModel = options.replyModel ?? "greedy";
    this.opponentQuick = options.opponentQuick ?? false;
    this.lethalSearch = options.lethalSearch ?? 0;
    this.lethalChecks = options.lethalChecks ?? 3;
    this.mulliganMode = options.mulligan ?? "greedy";
    this.greedy = new GreedyBot(engine, { seed: `${this.seed}:greedy`, evaluator: this.modelEvaluator });
  }

  decide(session: GameSession): Answer {
    const d = session.decision;
    if (!d) throw new Error("PlannerBot.decide: the game isn't waiting for a decision");
    this.stats.decisions += 1;
    try {
      const answer = this.choose(session, d);
      const problem = validateAnswer(d, answer);
      if (problem) throw new Error(`illegal answer (${problem})`);
      return answer;
    } catch (e) {
      this.stats.fallbacks += 1;
      this.stats.lastError = e instanceof Error ? e.message : String(e);
      return defaultAnswer(d);
    }
  }

  asAgent(): (decision: Decision, session: GameSession) => Answer {
    return (_decision, session) => this.decide(session);
  }

  private choose(session: GameSession, d: Decision): Answer {
    const me = d.player;
    const state = session.state;
    if (d.type === "mulligan" && this.mulliganMode === "curve") return this.mulligan(session, d);
    if (state.activePlayer !== me || state.phase !== "main" || d.type === "chooseTurnOrder" || d.type === "mulligan") return this.greedy.decide(session);
    if (state.turn !== this.turn) {
      this.turn = state.turn;
      this.actionsThisTurn = 0;
      this.decisionsThisTurn = 0;
    }
    if (++this.decisionsThisTurn > this.maxDecisionsPerTurn) return defaultAnswer(d);
    if (d.type === "mainPhase" && ++this.actionsThisTurn > this.maxActionsPerTurn) return defaultAnswer(d);
    return this.sureLethal(session, me) ?? this.followPlan(session, me) ?? this.plan(session, me);
  }

  /**
   * Sure lethal first (lethal.ts): the next step of the lethal line being played while it is still sure from here, or at a
   * main phase decision with lethal within reach, a new search; a line found is played at once. Null: plan as usual.
   */
  private sureLethal(game: GameSession, me: PlayerId): Answer | null {
    if (this.lethalSearch <= 0) return null;
    const d = game.decision!;
    const turn = game.state.turn;
    if (this.lethal && (this.lethal.turn !== turn || this.lethal.given >= this.lethal.steps.length)) this.lethal = null;
    const line = this.lethal;
    if (line) {
      // An answer of the opponent or a card drawn may have changed it: checked again at each main phase decision.
      const rest = line.steps.slice(line.given);
      const seed = `${this.seed}:lethal:${this.lethalSearches++}`;
      const answer = d.type !== "mainPhase" || this.sureFrom(game, me, rest, seed, 2) ? adaptStep(game, rest[0]!) : null;
      if (answer) {
        line.given += 1;
        return answer;
      }
      this.lethal = null;
      this.lethalStats.dropped += 1;
      return null;
    }
    if (d.type !== "mainPhase") return null;
    const view = game.view(me);
    if (!lethalWithinReach(view, d, me)) return null;
    if (this.lethalSeen?.turn === turn && this.lethalSeen.keys.has(JSON.stringify(view))) {
      this.lethalStats.skipped += 1;
      return null;
    }
    this.lethalStats.searches += 1;
    const seed = `${this.seed}:lethal:${this.lethalSearches++}`;
    const found = searchSureLethal(me, {
      budget: this.lethalSearch,
      beam: 16,
      maxBranches: this.maxBranches,
      world: (i) => (this.cheat ? game.clone() : game.determinized(me, `${seed}:${i}`)),
      checks: this.cheat ? 0 : this.lethalChecks,
      searchResponder: () => this.responder(this.opponentQuick),
      checkResponder: () => this.responder(true),
      maxLines: 6,
      seed,
    });
    this.stats.simulations += found.simulations;
    this.lethalStats.rejected += found.rejected;
    const first = found.line ? adaptStep(game, found.line[0]!) : null;
    if (!found.line || !first) {
      const keys = this.lethalSeen?.turn === turn ? this.lethalSeen.keys : new Set<string>();
      for (const key of found.seen) keys.add(key);
      this.lethalSeen = { turn, keys };
      return null;
    }
    this.lethalStats.played += 1;
    this.lethal = { turn, steps: found.line, given: 1 };
    this.current = null;
    return first;
  }

  /** Does the line surely win from this position: in the real game (cheating), or in `samples` samples of what we know? */
  private sureFrom(game: GameSession, me: PlayerId, line: readonly LethalStep[], seed: string, samples: number): boolean {
    if (this.cheat) return lineWins(game.clone(), line, me, this.responder(true));
    for (let i = 0; i < samples; i++) if (!lineWins(game.determinized(me, `${seed}:${i}`), line, me, this.responder(true))) return false;
    return true;
  }

  /** The opponent in a simulation of our turn: a fresh greedy model (`model` false: they pass). */
  private responder(model: boolean): Responder {
    if (!model) return null;
    const bot = this.model("greedy");
    return (session) => bot.decide(session);
  }

  /**
   * The next answer of the current plan, if the game is where the plan expected it to be (the same view: nothing hidden
   * turned out differently, the opponent answered as expected). Null: plan again.
   */
  private followPlan(game: GameSession, me: PlayerId): Answer | null {
    const plan = this.current;
    if (!plan || plan.turn !== game.state.turn || plan.given === 0) return null;
    if (plan.path[plan.given - 1]!.key !== JSON.stringify(game.view(me))) return null;
    const next = plan.given < plan.path.length ? plan.path[plan.given]!.answer! : canEnd(game.decision!) ? endMainPhase() : null;
    if (!next || validateAnswer(game.decision!, next) !== null) return null;
    plan.given += 1;
    return next;
  }

  /** The first answer of the best plan for the rest of this turn. */
  private plan(game: GameSession, me: PlayerId): Answer {
    const turn = game.state.turn;
    const seed = `${this.seed}:${this.plans++}`;
    const world = () => (this.cheat ? game.clone() : game.determinized(me, seed));
    const root = this.node(world(), null, null, me, turn, "decide");
    let finished: Node[] = [];
    const seen = new Set<string>([root.key]);
    let frontier = [root];
    let budget = this.maxSimulations;
    for (let depth = 0; depth < this.maxDepth && frontier.length > 0 && budget > 0; depth++) {
      const children: Node[] = [];
      for (const node of frontier) {
        const d = node.session.decision!;
        if (canEnd(d)) finished.push(node);
        for (const answer of this.branches(d, lookupFromReader(node.session.reader()))) {
          if (budget-- <= 0) break;
          const child = this.expand(node, answer, me, turn, world);
          if (!child) continue;
          if (child.done) finished.push(child);
          else if (!seen.has(child.key)) {
            seen.add(child.key);
            children.push(child);
          }
        }
      }
      children.sort((a, b) => b.value - a.value);
      frontier = children.slice(0, this.beamWidth);
    }
    for (const node of frontier) if (canEnd(node.session.decision!)) finished.push(node);
    // A plan that wins in our sample only because of what was sampled (a card drawn, the opponent passing) isn't a won one.
    if (!this.cheat && this.lethalChecks > 0) finished = finished.filter((node) => node.session.result?.winner !== me || this.sureWin(node, game, me, seed));
    if (finished.length === 0) return fastAnswer(game.decision!, lookupFromReader(game.reader()));
    // The best plans by the position they leave, then by the position after the opponent's reply.
    finished.sort((a, b) => b.value - a.value);
    const best = new Map<string, Node>();
    for (const node of finished) if (!best.has(node.key) && best.size < this.replyPlans) best.set(node.key, node);
    let choice: Node = finished[0]!;
    let choiceValue = -Infinity;
    for (const node of this.replyPlans > 0 ? best.values() : []) {
      const value = node.done ? this.finalValue(node, me) : this.afterReply(node, me, turn, world);
      if (value > choiceValue) {
        choice = node;
        choiceValue = value;
      }
    }
    return this.carryOut(choice, turn);
  }

  /** Take the plan that ends at `choice` as the current one: its first answer now, the next ones while the game goes as planned. */
  private carryOut(choice: Node, turn: number): Answer {
    const path: Node[] = [];
    for (let n: Node | null = choice; n && n.parent; n = n.parent) path.unshift(n);
    this.current = { path, given: path.length > 0 ? 1 : 0, turn };
    return path[0]?.answer ?? endMainPhase();
  }

  /** A plan that won in our sample: does it win in the other samples too, the opponent answering (lethal.ts)? */
  private sureWin(node: Node, game: GameSession, me: PlayerId, seed: string): boolean {
    const steps: LethalStep[] = [];
    for (let n: Node | null = node; n && n.parent; n = n.parent) steps.unshift(stepOf(n.parent.session, n.answer!));
    const sure = this.sureFrom(game, me, steps, `${seed}:won`, this.lethalChecks);
    if (!sure) this.lethalStats.unsurePlans += 1;
    return sure;
  }

  /**
   * CR 6.2.1.8: keep or redraw by the curve of the first four turns (mulligan.ts). A cheating bot knows the deck's order, so
   * it compares the hand with the four cards on top; a fair one compares with what the rest of its deck list gives on average
   * (the cards of its own deck, which a player knows, not their order).
   */
  private mulligan(game: GameSession, d: Extract<Decision, { type: "mulligan" }>): Answer {
    const me = d.player;
    const reader = game.reader();
    const cost = (id: CardId) => Math.max(0, reader.info(id).cost ?? 0);
    const hand = d.hand.map(cost);
    const deck = reader.cards(me, "deck").map(cost);
    const first = game.state.firstPlayer === me;
    const redraw = this.cheat ? redrawKnowingDeck(hand, deck, first) : redrawByExpectation(hand, deck.sort((a, b) => a - b), first, this.rng);
    return redraw ? { type: "mulligan", redraw: true, bottomOrder: [...d.hand] } : { type: "mulligan", redraw: false };
  }

  /** The answers worth trying at a decision of a plan (branches.ts). */
  private branches(d: Decision, lookup: ReturnType<typeof lookupFromReader>): Answer[] {
    return planBranches(d, lookup, this.rng, this.maxBranches);
  }

  /** Give `answer` in a copy of `node` and play on to our next decision (the opponent passes in their quick windows). */
  private expand(node: Node, answer: Answer, me: PlayerId, turn: number, world: () => GameSession): Node | null {
    this.stats.simulations += 1;
    try {
      const session = this.copy(node, world);
      session.act(answer);
      const stop = this.advance(session, me, turn);
      return this.node(session, node, answer, me, turn, stop);
    } catch (e) {
      this.stats.simulationFailures += 1;
      const message = `${e instanceof Error ? e.name : "Error"}: ${e instanceof Error ? e.message : String(e)}`.slice(0, 300);
      const errors = this.stats.simulationErrors;
      if (message in errors || Object.keys(errors).length < 20) errors[message] = (errors[message] ?? 0) + 1;
      return null;
    }
  }

  /**
   * A fresh copy of a node's game. A sample made in the middle of an action can't be copied until its next main phase
   * (GameSession.determinized), so such a node is rebuilt from its parent.
   */
  private copy(node: Node, world: () => GameSession): GameSession {
    if (node.parent === null) return world();
    try {
      return node.session.clone();
    } catch {
      const session = this.copy(node.parent, world);
      session.act(node.answer!);
      this.advance(session, node.session.decision!.player, node.session.state.turn);
      return session;
    }
  }

  /** Answer the decisions that aren't ours to plan (the opponent's quick windows) until we decide again. */
  private advance(session: GameSession, me: PlayerId, turn: number): Stop {
    for (let steps = 0; steps < 300; steps++) {
      const d = session.decision;
      if (!d) return "gameOver";
      if (session.state.turn !== turn || session.state.phase !== "main") return "turnOver";
      if (d.player === me) return "decide";
      session.act(this.opponentQuick && d.type === "quick" ? this.model("greedy").decide(session) : fastAnswer(d, lookupFromReader(session.reader())));
    }
    return "turnOver";
  }

  private node(session: GameSession, parent: Node | null, answer: Answer | null, me: PlayerId, turn: number, stop: Stop): Node {
    const view = session.view(me);
    return {
      session,
      parent,
      answer,
      depth: parent ? parent.depth + 1 : 0,
      value: this.evaluator(view, me),
      done: stop !== "decide",
      key: JSON.stringify(view),
    };
  }

  /** A fresh model of the opponent (a fair one: it plans with what the opponent can see). */
  private model(kind: "greedy" | "planner"): { decide(session: GameSession): Answer } {
    const seed = `${this.seed}:model:${this.models++}`;
    const evaluator = this.modelEvaluator;
    return kind === "planner"
      ? new PlannerBot(this.engine, { seed, replyPlans: 0, beamWidth: 4, maxBranches: 12, maxSimulations: 150, evaluator, modelEvaluator: evaluator })
      : new GreedyBot(this.engine, { seed, maxCandidates: 12, evaluator });
  }

  /** A plan's position scored as plans are finally compared (where the game or our turn already ended, or a reply failed). */
  private finalValue(node: Node, me: PlayerId): number {
    return this.replyEvaluator === this.evaluator ? node.value : this.replyEvaluator(node.session.view(me), me);
  }

  /** The position at our next main phase after ending the turn at `node` and the opponent's turn (played by a model). */
  private afterReply(node: Node, me: PlayerId, turn: number, world: () => GameSession): number {
    this.stats.simulations += 1;
    try {
      const session = this.copy(node, world);
      const opponent = this.model(this.replyModel);
      session.act(endMainPhase());
      for (let steps = 0; steps < 3000; steps++) {
        const d = session.decision;
        if (!d || (d.player === me && d.type === "mainPhase" && session.state.turn > turn)) break;
        session.act(d.player === me ? fastAnswer(d, lookupFromReader(session.reader())) : opponent.decide(session));
      }
      return this.replyEvaluator(session.view(me), me);
    } catch (e) {
      this.stats.simulationFailures += 1;
      this.stats.lastError = e instanceof Error ? e.message : String(e);
      return this.finalValue(node, me) - 1_000;
    }
  }
}

function canEnd(d: Decision): boolean {
  return d.type === "mainPhase" && d.actions.some((a) => a.type === "endMainPhase");
}

function endMainPhase(): Answer {
  return { type: "mainPhase", action: { type: "endMainPhase" } };
}
