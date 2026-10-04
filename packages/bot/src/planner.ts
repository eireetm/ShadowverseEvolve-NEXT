import {
  defaultAnswer,
  opponentOf,
  randomInt,
  seedRng,
  validateAnswer,
  type Answer,
  type CardId,
  type Decision,
  type Engine,
  type GameSession,
  type PlayerId,
  type PlayerView,
  type RngState,
} from "./core";
import { planBranches } from "./branches";
import { candidateAnswers } from "./candidates";
import { DEFAULT_WEIGHTS, exactResults, weightsEvaluator, type EvalWeights, type Evaluator } from "./evaluate";
import { GreedyBot, type BotStats } from "./greedy";
import { positionKey } from "./keys";
import { adaptStep, lethalFirstModel, lethalWithinReach, lineWins, searchSureLethal, stepOf, type LethalStep, type Model, type Responder } from "./lethal";
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
   * The evaluation of the models of a player: the opponent in our plans and in their simulated turn, and us in that turn.
   * Default: the hand-written one with the default weights. (The bot's own decisions outside its main phase use `evaluator`.)
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
  /**
   * During our turn the opponent's decisions (quick windows, choices our effects give them) are answered by a greedy model
   * instead of the fast answers (it passes, it buries its best follower ...).
   */
  opponentQuick?: boolean;
  /** The opponent model in the simulated reply first looks for a lethal on us with this many answers at most (0: doesn't). */
  replyLethal?: number;
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
  /**
   * How far a turn's plans are compared (2026-10-03: the owner wants two turns): 1 — each after the opponent's simulated
   * reply (a model's one line); 2 — a search over whole turns, our plans, then the opponent's plans of their next turn (the
   * worst for us), then our plans of the turn after, scored there (lookAhead).
   */
  lookahead?: 1 | 2;
  /** Two turns: the plans kept at the opponent's turn and at our next one (ours now: `replyPlans`). */
  innerPlans?: [number, number];
  /** Two turns: the answers tried for each plan search of a later turn, and the plans kept at each of its steps. */
  innerSimulations?: number;
  innerBeam?: number;
  /** Two turns, a fair bot: the samples of the hidden cards each choice is averaged over. */
  samples?: number;
  /**
   * The plans compared at the end are of different kinds, not only the best few by the position: besides the best, the one
   * keeping the most cards, the most play points (a Quick card), attacking least, spending evolution points, dealing the most
   * damage to the leader — among the plans within this many points of the best (0: the best few only).
   */
  planKinds?: number;
  /**
   * Training data (stage 1): in this share of its turns the bot doesn't take the best plan it compared but draws one of them,
   * the better scored the likelier (softmax at `temperature` points of the evaluation), never one already won or lost; the
   * turns are listed in `explored` (the samples of those turns are marked). Default: never.
   */
  explore?: { rate: number; temperature: number };
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
  /** The position however it was reached (positionKey): one position, one plan. */
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
  /** The turns where it drew a plan instead of taking the best (`explore`). */
  readonly explored: number[] = [];
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
  private readonly replyLethal: number;
  private readonly mulliganMode: "greedy" | "curve";
  private readonly lookahead: 1 | 2;
  private readonly innerPlans: [number, number];
  private readonly innerSimulations: number;
  private readonly innerBeam: number;
  private readonly samples: number;
  private readonly planKinds: number;
  private readonly exploreRate: number;
  private readonly exploreTemperature: number;
  private readonly exploreRng: RngState;
  /** This turn may still explore (decided once per turn). */
  private exploreTurn: { turn: number; open: boolean } = { turn: -1, open: false };
  private readonly greedy: GreedyBot;
  private plans = 0;
  /** Opponent models made so far (each simulation gets a fresh one: the greedy bot counts actions per turn). */
  private models = 0;
  private turn = -1;
  private actionsThisTurn = 0;
  private decisionsThisTurn = 0;
  /** The plan being carried out: its positions from the first answer on, and how many answers of it were given. */
  private current: { path: Node[]; exact: string[]; given: number; turn: number } | null = null;
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
    this.replyLethal = options.replyLethal ?? 0;
    this.mulliganMode = options.mulligan ?? "greedy";
    this.lookahead = options.lookahead ?? 1;
    this.innerPlans = options.innerPlans ?? [2, 3];
    this.innerSimulations = options.innerSimulations ?? 300;
    this.innerBeam = options.innerBeam ?? 4;
    this.samples = options.samples ?? 1;
    this.planKinds = options.planKinds ?? 0;
    this.exploreRate = options.explore?.rate ?? 0;
    this.exploreTemperature = Math.max(0.01, options.explore?.temperature ?? 2);
    this.exploreRng = seedRng(`explore:${this.seed}`);
    // Its own decisions outside its main phase (quick windows, end phase, targets) are scored with its own evaluation.
    this.greedy = new GreedyBot(engine, { seed: `${this.seed}:greedy`, evaluator: this.evaluator });
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
    if (d.type === "selectCards" && d.reason === "wardEngage" && this.replyPlans > 0) return this.wardAtEnd(session, d, me);
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
    if (this.lethalSeen?.turn === turn && this.lethalSeen.keys.has(positionKey(view))) {
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
    if (plan.exact[plan.given - 1] !== JSON.stringify(game.view(me))) return null;
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
    let finished = this.beam(root, me, turn, world, this.maxSimulations, this.beamWidth);
    // A plan that wins in our sample only because of what was sampled (a card drawn, the opponent passing) isn't a won one.
    if (!this.cheat && this.lethalChecks > 0) finished = finished.filter((node) => node.session.result?.winner !== me || this.sureWin(node, game, me, seed));
    if (finished.length === 0) return fastAnswer(game.decision!, lookupFromReader(game.reader()));
    const candidates = this.kinds(finished, root, me, this.replyPlans);
    if (this.lookahead >= 2 && candidates.length > 1) {
      const values = this.lookAhead(candidates, game, me, turn, seed, world, this.explores(turn));
      return this.carryOut(this.pick(candidates, values, turn), turn, me);
    }
    if (this.replyPlans <= 0) return this.carryOut(finished[0]!, turn, me);
    // The plans by the position they leave, then by the position after the opponent's reply.
    const values = candidates.map((node) => (node.done ? this.finalValue(node, me) : this.afterReply(node, me, turn, world)));
    return this.carryOut(this.pick(candidates, values, turn), turn, me);
  }

  /** Whether this turn still explores (`explore`): drawn once per turn, at its first plan; a draw spends it. */
  private explores(turn: number): boolean {
    if (this.exploreTurn.turn !== turn) this.exploreTurn = { turn, open: this.exploreRate > 0 && randomInt(this.exploreRng, 1_000_000) < this.exploreRate * 1_000_000 };
    return this.exploreTurn.open;
  }

  /**
   * The plan to carry out among those compared: the best (the first of the best on a tie), or in a turn that explores
   * (`explore`, decided at the turn's first plan) one drawn by softmax over the values, among those not already won or lost
   * (a decided value is far beyond any position's: half the evaluation's win) — unless the best is won: then the best.
   */
  private pick(candidates: Node[], values: number[], turn: number): Node {
    let best = 0;
    for (let i = 1; i < values.length; i++) if (values[i]! > values[best]!) best = i;
    // A plan already won is never given up to explore.
    if (!this.explores(turn) || values[best]! >= DEFAULT_WEIGHTS.win / 2) return candidates[best]!;
    const open = values.map((v, i) => ({ v, i })).filter(({ v }) => Number.isFinite(v) && Math.abs(v) < DEFAULT_WEIGHTS.win / 2);
    if (open.length < 2) return candidates[best]!;
    this.exploreTurn.open = false;
    const top = Math.max(...open.map(({ v }) => v));
    const weights = open.map(({ v }) => Math.exp((v - top) / this.exploreTemperature));
    let r = (randomInt(this.exploreRng, 1_000_000) / 1_000_000) * weights.reduce((a, b) => a + b, 0);
    for (const [k, w] of weights.entries()) {
      r -= w;
      if (r <= 0) {
        this.explored.push(turn);
        return candidates[open[k]!.i]!;
      }
    }
    this.explored.push(turn);
    return candidates[open[open.length - 1]!.i]!;
  }

  /**
   * The plans `actor` can make from `root` for the rest of this turn: a beam search over its answers, every plan scored where
   * its turn would end there. Returns the finished plans, best first, one per position.
   */
  private beam(root: Node, actor: PlayerId, turn: number, world: () => GameSession, budget: number, width: number, score: Evaluator = this.evaluator, inner = false): Node[] {
    const finished: Node[] = [];
    const seen = new Set<string>([root.key]);
    let frontier = [root];
    for (let depth = 0; depth < this.maxDepth && frontier.length > 0 && budget > 0; depth++) {
      const children: Node[] = [];
      for (const node of frontier) {
        const d = node.session.decision!;
        if (canEnd(d)) finished.push(node);
        for (const answer of this.branches(d, lookupFromReader(node.session.reader()))) {
          if (budget-- <= 0) break;
          const child = this.expand(node, answer, actor, turn, world, score, inner);
          if (!child) continue;
          if (child.done) finished.push(child);
          else if (!seen.has(child.key)) {
            seen.add(child.key);
            children.push(child);
          }
        }
      }
      children.sort((a, b) => b.value - a.value);
      frontier = children.slice(0, width);
    }
    for (const node of frontier) if (canEnd(node.session.decision!)) finished.push(node);
    finished.sort((a, b) => b.value - a.value);
    const one = new Map<string, Node>();
    for (const node of finished) if (!one.has(node.key)) one.set(node.key, node);
    return [...one.values()];
  }

  /**
   * At most `k` of the finished plans (best first), of different kinds (`planKinds`): the best two, and among the plans within
   * `planKinds` points of the best, the one keeping the most cards in hand, the most play points, attacking least, spending
   * evolution points, dealing the most damage to the opponent's leader; the rest by the position. A turn's best plan by the
   * position it leaves is often only the one that commits most: holding a combo piece, keeping play points for a Quick card
   * or not attacking into a trade never reached the comparison after the opponent's reply.
   */
  private kinds(finished: Node[], root: Node, actor: PlayerId, k: number, pad = true): Node[] {
    if (this.planKinds <= 0 || (pad && finished.length <= k)) return finished.slice(0, k);
    const start = root.session.view(actor);
    const trait = new Map<Node, { kept: number; pp: number; attacks: number; ep: number; face: number }>();
    for (const node of finished) {
      const view = node.session.view(actor);
      let attacks = 0;
      for (let n: Node | null = node; n && n.parent; n = n.parent) if (n.answer?.type === "mainPhase" && n.answer.action.type === "attack") attacks += 1;
      const mine = (v: PlayerView) => v.players[actor];
      const theirs = (v: PlayerView) => v.players[opponentOf(actor)];
      trait.set(node, {
        kept: mine(view).hand.length,
        pp: mine(view).playPoints,
        attacks,
        ep: mine(start).evolutionPoints + mine(start).superEvolutionPoints - mine(view).evolutionPoints - mine(view).superEvolutionPoints,
        face: theirs(start).leaderDefense - theirs(view).leaderDefense,
      });
    }
    const near = finished.filter((n) => n.value >= finished[0]!.value - this.planKinds);
    const out: Node[] = [];
    const take = (n: Node | undefined) => {
      if (n && out.length < k && !out.includes(n)) out.push(n);
    };
    /** The plan with the most of something (the better position first among equals), if any has more than the best plan. */
    const most = (score: (n: Node) => number) => {
      let best: Node | undefined;
      for (const n of near) if (score(n) > score(finished[0]!) && (!best || score(n) > score(best))) best = n;
      return best;
    };
    take(finished[0]);
    take(most((n) => trait.get(n)!.kept));
    take(finished[1]);
    take(most((n) => trait.get(n)!.pp));
    take(most((n) => -trait.get(n)!.attacks));
    take(most((n) => trait.get(n)!.ep));
    take(most((n) => trait.get(n)!.face));
    // Inner levels of a two-turn search aren't padded with plans like the best (each costs a search of the next turn).
    if (pad) for (const n of finished) take(n);
    return out;
  }

  /**
   * Two turns ahead (`lookahead` 2): each of our plans is played to the opponent's next turn, where their plans (a lethal on
   * us first, then a beam search of their own) are compared by the worst for us; after each of those our plans of the turn
   * after are searched the same way and scored where that turn ends (alpha-beta: a line already worse than one found is cut).
   * A fair bot does this in `samples` samples of the hidden cards (our plans played again in each by matching their cards)
   * and takes the average. Returns each plan's value (a plan cut by alpha-beta: a bound below the best's; `exact`, for a turn
   * that explores and draws by these values: no cuts).
   */
  private lookAhead(candidates: Node[], game: GameSession, me: PlayerId, turn: number, seed: string, world: () => GameSession, exact = false): number[] {
    const worlds = this.cheat ? 1 : Math.max(1, this.samples);
    let bestTotal = -Infinity;
    const totals: number[] = [];
    for (const [i, plan] of candidates.entries()) {
      let total = 0;
      for (let w = 0; w < worlds; w++) {
        let value: number;
        try {
          const session = w === 0 ? this.copy(plan, world) : this.replayPlan(plan, this.cheat ? game.clone() : game.determinized(me, `${seed}:w${w}`), me, turn);
          // The last world may stop as soon as the plan can't reach the best total any more (a cut returns a bound at most that).
          const alpha = w === worlds - 1 && !exact ? bestTotal - total : -Infinity;
          value = this.turnValue(session, me, opponentOf(me), turn, 1, alpha, Infinity, null, `${seed}:w${w}:p${i}`);
        } catch (e) {
          this.stats.simulationFailures += 1;
          this.stats.lastError = e instanceof Error ? e.message : String(e);
          value = this.finalValue(plan, me) - 1_000;
        }
        total += value;
      }
      totals.push(total / worlds);
      bestTotal = Math.max(bestTotal, total);
    }
    return totals;
  }

  /**
   * Our plan's answers given again in another sample (cards matched by what they are). Where a step doesn't fit, the plan goes
   * on: a decision the plan didn't have there (a choice inside an action) gets the fast answer and the step waits for the next
   * one; a main phase action that can't be taken there is left out.
   */
  private replayPlan(plan: Node, session: GameSession, me: PlayerId, turn: number): GameSession {
    const steps: LethalStep[] = [];
    for (let n: Node | null = plan; n && n.parent; n = n.parent) steps.unshift(stepOf(n.parent.session, n.answer!));
    for (let i = 0, guard = 0; i < steps.length && guard < 200; guard++) {
      const d = session.decision;
      if (d?.player !== me || session.state.turn !== turn || session.state.phase !== "main") break;
      const answer = adaptStep(session, steps[i]!);
      if (answer) {
        session.act(answer);
        i += 1;
      } else if (d.type !== "mainPhase") session.act(fastAnswer(d, lookupFromReader(session.reader())));
      else {
        i += 1;
        continue;
      }
      this.advance(session, me, turn);
    }
    return session;
  }

  /**
   * The value for us of a position where a turn is over (a plan's end): it ends, the next player's turn is played to their
   * first main phase decision, and then — `level` 1, the opponent's turn — the worst for us of their plans, or — `level` 2,
   * our turn after — the best of ours, each scored where its turn ends (a turn without a main phase decision of its own counts
   * as passed: the level goes on). Past level 2, or once the game is over, the position is scored as it stands. A loss is
   * told apart from another by the position when the opponent began their turn (`before`), so the plan conceding least is kept.
   */
  private turnValue(session: GameSession, me: PlayerId, next: PlayerId, turn: number, level: number, alpha: number, beta: number, before: number | null, seed: string): number {
    this.toNextMainPhase(session, turn, seed);
    const leaf = () => {
      const value = this.replyEvaluator(session.view(me), me);
      const result = session.result;
      return result && result.winner !== me && result.winner !== null && before !== null ? value + Math.max(-1_000, Math.min(1_000, before)) : value;
    };
    if (session.isOver) return leaf();
    const d = session.decision!;
    const actor = d.player;
    if (d.type !== "mainPhase") return leaf();
    if (actor !== next) level += 1;
    if (level > 2) return leaf();
    const nextTurn = session.state.turn;
    const start = session.clone();
    const world = () => start.clone();
    if (actor !== me && before === null) before = this.replyEvaluator(start.view(me), me);
    // Their lethal (or ours) first: found and still winning with the other player answering (a Quick card) and in a sample of
    // what the attacker can't see, the turn's value is the game's.
    if (this.replyLethal > 0 && lethalWithinReach(start.view(actor), d, actor, 3, 0)) {
      const found = searchSureLethal(actor, {
        budget: this.replyLethal,
        beam: 12,
        maxBranches: this.maxBranches,
        world: (i) => (i === 0 ? start.clone() : start.determinized(actor, `${seed}:lethal-check`)),
        checks: 1,
        searchResponder: () => null,
        checkResponder: () => this.responder(true),
        maxLines: 2,
        seed: `${seed}:lethal`,
        key: (view) => JSON.stringify(view),
      });
      this.stats.simulations += found.simulations;
      if (found.line) {
        const decided = this.replyEvaluator({ ...start.view(me), result: { winner: actor, losses: [] } } as PlayerView, me);
        return actor === me || before === null ? decided : decided + Math.max(-1_000, Math.min(1_000, before));
      }
    }
    const score = actor === me ? this.evaluator : this.modelScore();
    const root = this.node(world(), null, null, actor, nextTurn, "decide", score);
    const finished = this.beam(root, actor, nextTurn, world, this.innerSimulations, this.innerBeam, score, true);
    const plans = this.kinds(finished, root, actor, level === 1 ? this.innerPlans[0] : this.innerPlans[1], false);
    if (plans.length === 0) return leaf();
    let value = actor === me ? -Infinity : Infinity;
    for (const [i, plan] of plans.entries()) {
      let v: number;
      try {
        v = this.turnValue(this.copy(plan, world), me, opponentOf(actor), nextTurn, level + 1, alpha, beta, before, `${seed}:${level}:${i}`);
      } catch (e) {
        this.stats.simulationFailures += 1;
        this.stats.lastError = e instanceof Error ? e.message : String(e);
        continue;
      }
      if (actor === me) {
        value = Math.max(value, v);
        alpha = Math.max(alpha, v);
      } else {
        value = Math.min(value, v);
        beta = Math.min(beta, v);
      }
      if (alpha >= beta) break;
    }
    return Number.isFinite(value) ? value : leaf();
  }

  /**
   * Play on from where a turn's plan stopped (in its main phase, or already past it) to the next player's first main phase
   * decision of a later turn, or the game's end: the main phase is ended, and every other decision (end phase, quick windows,
   * the start phase) is a greedy model's, a fresh one per player.
   */
  private toNextMainPhase(session: GameSession, turn: number, seed: string): void {
    const models: [Model, Model] = [this.model("greedy", `${seed}:m0`), this.model("greedy", `${seed}:m1`)];
    for (let steps = 0; steps < 3000; steps++) {
      const d = session.decision;
      if (!d) return;
      if (session.state.turn > turn && d.type === "mainPhase" && d.player === session.state.activePlayer) return;
      if (session.state.turn === turn && d.type === "mainPhase" && d.player === session.state.activePlayer && canEnd(d)) session.act(endMainPhase());
      else session.act(models[d.player]!.decide(session));
    }
  }

  /** Take the plan that ends at `choice` as the current one: its first answer now, the next ones while the game goes as planned. */
  private carryOut(choice: Node, turn: number, me: PlayerId): Answer {
    const path: Node[] = [];
    for (let n: Node | null = choice; n && n.parent; n = n.parent) path.unshift(n);
    // The views exactly, ids too: following the plan in the real game needs the same cards under the same ids.
    const exact = path.map((n) => JSON.stringify(n.session.view(me)));
    this.current = { path, exact, given: path.length > 0 ? 1 : 0, turn };
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
   * CR 7.4.3: which reserved Ward followers to engage at our end phase. Engaged, a Ward follower protects (12.8.2 iii) but can
   * be attacked, by Rush followers too (8.4.3.1): each choice is played through the opponent's turn in the same sample, the
   * opponent played by the same model, and scored at our next main phase. Ties keep the fast answer (all of them).
   */
  private wardAtEnd(game: GameSession, d: Extract<Decision, { type: "selectCards" }>, me: PlayerId): Answer {
    const answers = candidateAnswers(d, lookupFromReader(game.reader()), this.rng, Math.max(2, this.replyPlans));
    if (answers.length <= 1) return answers[0] ?? fastAnswer(d, lookupFromReader(game.reader()));
    const seed = `${this.seed}:ward:${this.plans++}`;
    const turn = game.state.turn;
    let best = answers[0]!;
    let bestValue = -Infinity;
    for (const answer of answers) {
      this.stats.simulations += 1;
      let value: number;
      try {
        const session = this.cheat ? game.clone() : game.determinized(me, seed);
        session.act(answer);
        value = this.playReply(session, me, turn, `${seed}:reply`);
      } catch (e) {
        this.stats.simulationFailures += 1;
        this.stats.lastError = e instanceof Error ? e.message : String(e);
        continue;
      }
      if (value > bestValue) {
        best = answer;
        bestValue = value;
      }
    }
    return best;
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
  private expand(node: Node, answer: Answer, me: PlayerId, turn: number, world: () => GameSession, score: Evaluator = this.evaluator, inner = false): Node | null {
    this.stats.simulations += 1;
    try {
      const session = this.copy(node, world);
      session.act(answer);
      const stop = this.advance(session, me, turn, inner);
      return this.node(session, node, answer, me, turn, stop, score);
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

  /**
   * Answer the decisions that aren't ours to plan (the opponent's, during our turn) until we decide again: a greedy model
   * (`opponentQuick`), or the fast answers. In the later turns of a two-turn search (`inner`) a cheaper model, at quick windows
   * with something to play only.
   */
  private advance(session: GameSession, me: PlayerId, turn: number, inner = false): Stop {
    for (let steps = 0; steps < 300; steps++) {
      const d = session.decision;
      if (!d) return "gameOver";
      if (session.state.turn !== turn || session.state.phase !== "main") return "turnOver";
      if (d.player === me) return "decide";
      // A quick window where passing is all they can do needs no model.
      const real = this.opponentQuick && !(d.type === "quick" && d.actions.length === 1) && (!inner || d.type === "quick");
      session.act(real ? this.model("greedy", undefined, inner ? 4 : 12).decide(session) : fastAnswer(d, lookupFromReader(session.reader())));
    }
    return "turnOver";
  }

  private node(session: GameSession, parent: Node | null, answer: Answer | null, me: PlayerId, turn: number, stop: Stop, score: Evaluator = this.evaluator): Node {
    const view = session.view(me);
    return {
      session,
      parent,
      answer,
      depth: parent ? parent.depth + 1 : 0,
      value: score(view, me),
      done: stop !== "decide",
      key: positionKey(view),
    };
  }

  /**
   * A fresh model of a player (a fair one: it plans with what that player can see): the opponent in our simulations, or us in
   * the opponent's simulated turn. Attacks come first among the greedy model's candidates, so none is left out.
   */
  private model(kind: "greedy" | "planner", seed = `${this.seed}:model:${this.models++}`, maxCandidates = 12): Model {
    const evaluator = this.modelEvaluator;
    const bot =
      kind === "planner"
        ? new PlannerBot(this.engine, { seed, replyPlans: 0, beamWidth: 4, maxBranches: 12, maxSimulations: 150, evaluator, modelEvaluator: evaluator })
        : new GreedyBot(this.engine, { seed, maxCandidates, evaluator, attacksFirst: true });
    // Its simulations are this bot's work too (the arena reports them).
    return {
      decide: (session) => {
        const before = bot.stats.simulations;
        const answer = bot.decide(session);
        this.stats.simulations += bot.stats.simulations - before;
        return answer;
      },
    };
  }

  /** How the models score a position (the opponent's plans in a two-turn search are ranked as their model would). */
  private modelScore(): Evaluator {
    return exactResults(this.modelEvaluator ?? weightsEvaluator(DEFAULT_WEIGHTS));
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
      session.act(endMainPhase());
      return this.playReply(session, me, turn, `${this.seed}:model:${this.models++}`);
    } catch (e) {
      this.stats.simulationFailures += 1;
      this.stats.lastError = e instanceof Error ? e.message : String(e);
      return this.finalValue(node, me) - 1_000;
    }
  }

  /**
   * Play on from the end of our turn to our next main phase and score it there. The opponent is a model that plays a lethal
   * on us first if it finds one (lethal.ts); our own decisions in their turn (quick windows, Ward, choices) are a greedy
   * model's too, so a plan that keeps play points for a Quick card gets the credit (they used to pass). A plan that loses this
   * way is still told apart from another that loses: by the position when the opponent begins their main phase, so that when
   * every plan loses the one that concedes least is kept.
   */
  private playReply(session: GameSession, me: PlayerId, turn: number, seed: string): number {
    const opponent = lethalFirstModel(this.model(this.replyModel, `${seed}:opponent`), this.replyLethal, this.maxBranches, `${seed}:lethal`, (n) => {
      this.stats.simulations += n;
    });
    const ours = this.model("greedy", `${seed}:ours`);
    let before = 0;
    let seen = false;
    for (let steps = 0; steps < 3000; steps++) {
      const d = session.decision;
      if (!d || (d.player === me && d.type === "mainPhase" && session.state.turn > turn)) break;
      if (!seen && d.player !== me && d.type === "mainPhase") {
        seen = true;
        before = this.replyEvaluator(session.view(me), me);
      }
      session.act(d.player === me ? ours.decide(session) : opponent.decide(session));
    }
    const value = this.replyEvaluator(session.view(me), me);
    const result = session.result;
    return result && result.winner !== me && result.winner !== null ? value + Math.max(-1_000, Math.min(1_000, before)) : value;
  }
}

function canEnd(d: Decision): boolean {
  return d.type === "mainPhase" && d.actions.some((a) => a.type === "endMainPhase");
}

function endMainPhase(): Answer {
  return { type: "mainPhase", action: { type: "endMainPhase" } };
}
