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
  type GameEvent,
  type GameSession,
  type PlayerId,
  type PlayerView,
  type RngState,
} from "./core";
import { planBranches } from "./branches";
import { candidateAnswers } from "./candidates";
import { closeProblems, isClose, mean, type CloseSampleOptions } from "./close-samples";
import { COND_DEFAULTS, ConditionalCharges, type CondGates, type CondMark, type CondScope, type ConditionalStats, type Expansion } from "./conditional";
import { answerSigner, type SameCard } from "./distinct-answers";
import { DEFAULT_WEIGHTS, evaluate, exactResults, weightsEvaluator, type EvalWeights, type Evaluator } from "./evaluate";
import { GreedyBot, type BotStats } from "./greedy";
import { positionKey } from "./keys";
import { adaptStep, lethalFirstModel, lethalWithinReach, lineWinsAgainstAll, replayLine, searchSureLethal, stepOf, type Adversary, type LethalStep, type Model, type Responder } from "./lethal";
import { keptCompletions, macroProblems, type MacroOptions } from "./macro-steps";
import { redrawByExpectation, redrawKnowingDeck } from "./mulligan";
import { SIM_DEFAULTS, simIdentity, simMulligan, simProblems, type MulliganDecision, type MulliganStats, type MulliganWorld, type SimParams } from "./mulligan-sim";
import { fastAnswer, lookupFromReader } from "./policy";
import { actionSegments, drawToFront, drewCards, handAt, keepsMoreCards, lineSlots, type LineSlotOptions } from "./plan-lines";
import { setupWorld } from "./setup-sample";
import { ownDeckList, turnOrderFor, turnOrderProblems, type TurnOrderChoice, type TurnOrderTable } from "./turn-order";

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
   * Default: the hand-written one with the default weights. (The bot's own decisions outside its main phase use
   * `greedyEvaluator`.)
   */
  modelEvaluator?: Evaluator;
  /**
   * The evaluation of the bot's own decisions outside its main phase (its own greedy bot: quick windows in the opponent's
   * turn, its start and end phases, the mulligan by the greedy rule). Those are scored at the next main phase decision
   * (greedy.ts simulate): the start of a main phase or the middle of the opponent's, never the end of a turn, which is how
   * the beam reads every plan (`evaluator`); an evaluation whose reading depends on that (pp1, danger: mainAsEnd) gets its
   * start form here. Default: `evaluator`.
   */
  greedyEvaluator?: Evaluator;
  /**
   * Its own greedy bot at the opponent's end-phase Quick window (CR 7.4.5, the last before our refill, CR 7.2.2): each
   * answer's score plus this per play point it uses there (quick-window.ts; pp1's ppWaste). The models are not changed.
   * Default: none.
   */
  quickEndBonus?: number;
  /**
   * A card a plan plays whose Fanfares did nothing (CR 12.4.3, 10.7.3.2, 10.3.3) is charged in the bot's own search of this
   * turn and in the comparison of its plans (conditional.ts). Default: none.
   */
  conditional?: ConditionalOptions;
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
   * A fair bot's lethal must win in this many more samples of what it knows, whatever the opponent answers (default 3); its
   * plans that win in its sample count as won only if they do too (0: no checks). A cheating bot checks in the real game.
   */
  lethalChecks?: number;
  /**
   * "curve": keep or redraw by the curve of the first turns (mulligan.ts); "sim": by playing the first turns of samples both
   * ways (mulligan-sim.ts; a cheating bot plays them in copies of the real game); "greedy" (default): the greedy bot's rule.
   */
  mulligan?: "greedy" | "curve" | "sim";
  /** "sim"'s parameters (SIM_DEFAULTS for those left out). */
  mulliganSim?: Partial<SimParams>;
  /** Where "sim" samples a fair bot's openings (default: setup-sample.ts, the public sampler at the setup). */
  mulliganWorld?: MulliganWorld;
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
  /**
   * Selections and choices told apart by what they choose (distinct-answers.ts): the answers tried at a decision of a plan
   * (the root's search and the two-turn search's inner ones), the Ward engaging at the end phase, the sure-lethal searches
   * (ours, and the opponent's and ours two turns ahead) and the opponent's answers a lethal is checked against. A search of 15
   * cards of 6 kinds tries its 6 different answers (and none), not 15; the same action on either of two identical cards is
   * tried once. Default: off (the answers as they are).
   */
  choiceDedupe?: boolean;
  /**
   * Two turns: every plan compared with the same random numbers in each sample (common random numbers): the later turns'
   * models and the samples drawn among many answers come from the plan's seed, the sample and where they are, not from the
   * plan's place in the list or from the planner's counts, so two plans' values differ by what the plans do. Default: off.
   */
  commonRandom?: boolean;
  /**
   * The plans compared at the end by distinct lines (plan-lines.ts): the best of each of the best lines (plans that differ
   * only in the own cards picked or the order are one line), a slot for a line attacking less within `margin` points, then
   * the next lines; as many plans as without it (replyPlans). Takes the place of planKinds. Default: off.
   */
  lineSlots?: LineSlotOptions;
  /**
   * The comparison's tie-break: among the plans whose values are within this many points of the best, the one keeping the
   * most cards in hand (then the higher value, then the first). A tied plan whose two-turn value has a sample cut by
   * alpha-beta (a bound, not its value) is played there exactly first. Exploring is unchanged. Default: 0, off.
   */
  tieKeepHand?: number;
  /**
   * Information first (plan-lines.ts): before a plan is carried out, an action of it that draws cards (CR 5.10) is moved to
   * its front when the plan, played again so in its own sample, makes the same decisions and ends in the same position with
   * the same value; then the drawn cards are seen before the rest is played (the plan is made again where they differ from
   * the sample's). At most the first two drawing actions are tried; a plan won or ended is left as it is. Default: off.
   */
  drawFirst?: boolean;
  /**
   * The turn order (CR 6.2.1.6) by a table of decks (turn-order.ts): the answer of the entry closest to the bot's own deck
   * list, the table's default otherwise. Default: none (its greedy bot's: go first).
   */
  turnOrder?: TurnOrderTable;
  /**
   * The root search by actions (macro-steps.ts): a main phase answer with every decision inside its action is one step of
   * the beam, the plans at a step have taken as many actions, a plan is at most `actions` actions long (and `dec` decisions;
   * `maxDepth` is then the two-turn search's inner searches' only). The decisions inside an action are searched whole while
   * they fit a `share` of the budget left, else by a beam at least `sub` wide, and finished by the fast answers where that
   * runs out; the best `keep` completions of each action go on. Its budget is `maxSimulations`, every expansion counted.
   * Default: none (the beam by decisions).
   */
  macro?: MacroOptions;
  /**
   * Two turns: the opponent's lethal search in their simulated turn tries at most this many answers (it searches when one is
   * within reach), in place of `replyLethal` there; ours in our turn after and the one-turn reply keep `replyLethal`. With
   * `replyLethalKey` "position" that search tells positions apart as the beam does (positionKey: the same position reached
   * by attacks in another order is searched once) instead of by the exact view. Default: 0, `replyLethal` everywhere.
   */
  replyLethalOpp?: number;
  replyLethalKey?: "view" | "position";
  /**
   * Two turns, a fair bot: a plan close to the best in the comparison (close-samples.ts: its gap, sample by sample, less
   * than `z` standard errors) is played in more samples, up to `max` in all, with the best, and they are compared by the
   * longer average. Default: none.
   */
  closeSamples?: CloseSampleOptions;
}

/** The conditional-Fanfare charge's options (conditional.ts). */
export interface ConditionalOptions {
  /** Which Fanfares are judged: "declared" conditions, also "unplayed" ones, also the effects' "gates" (the card table's). */
  scope: CondScope;
  /** The charge per card play whose Fanfares did nothing (default: a card in hand's worth, DEFAULT_WEIGHTS.hand). */
  penalty?: number;
  /** The gates scope's reader of the card feature table (conditional-gates.ts tableGates; a function: called once, when the bot is built). */
  gates?: CondGates | (() => CondGates);
  /** Also an evolution whose On Evolve / On Super-Evolve abilities did nothing (CR 12.6, 12.17; conditional.ts). Default: off. */
  evolve?: boolean;
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
  /** A plan that won in our sample but not surely, where it was stopped (unsureWinsStopped). */
  unsure?: true;
  /** The position however it was reached (positionKey): one position, one plan. */
  key: string;
  /** The conditional charges of the plan up to here (conditional.ts), when the bot has them. */
  cond?: CondMark;
}

type Stop = "decide" | "turnOver" | "gameOver";

/**
 * A bot that plans its whole turn: at a decision in its main phase it searches sequences of its answers
 * (plays, evolves, abilities, attacks, and the choices they ask for) with a beam search, scoring every plan at the same
 * point — its turn ended there — then plays the opponent's next turn after the best few plans and keeps the one that holds
 * up best. It plays the first answer of that plan and plans again at its next decision. Decisions outside its main phase
 * (quick windows in the opponent's turn, the end phase, mulligan) are the greedy bot's, but for the mulligan by another
 * rule (`mulligan`) and the Ward choices.
 */
export class PlannerBot {
  readonly stats: BotStats = { decisions: 0, simulations: 0, simulationFailures: 0, simulationErrors: {}, fallbacks: 0, lastError: null };
  /**
   * Sure lethal first: searches made and skipped (nothing new since this turn's last one), lines played and dropped on the
   * way (no longer sure), lines found but not sure, plans that won in the bot's sample but not surely (scored where they were
   * stopped), and checks with too many answers of the opponent to try them all (not sure).
   */
  readonly lethalStats = { searches: 0, skipped: 0, played: 0, dropped: 0, rejected: 0, unsurePlans: 0, capped: 0 };
  /** The turns where it drew a plan instead of taking the best (`explore`). */
  readonly explored: number[] = [];
  /** The mulligan by simulation at work (null: another mulligan rule). */
  readonly mulliganStats: MulliganStats | null;
  /**
   * drawFirst: plans carried out with it on; those with a drawing action after their first; moves tried and made; plans
   * whose own sample, played again as planned, didn't reach their end (an opponent model answered otherwise), and replays
   * that threw (both left as they are).
   */
  readonly drawFirstStats = { plans: 0, drawPlans: 0, tried: 0, moved: 0, mismatch: 0, failed: 0 };
  /** turnOrder: the choices made by the table, how many went second, and the last one. */
  readonly turnOrderStats: { choices: number; second: number; last: TurnOrderChoice | null } = { choices: 0, second: 0, last: null };
  /**
   * macro: root searches by actions; their steps; actions expanded (a main phase answer and its decisions); expansions
   * inside actions; actions finished by the fast answers (their allowance or the decision cap ran out); searches whose plans
   * were still going when the action limit, the budget or the decision cap stopped them.
   */
  readonly macroStats = { searches: 0, layers: 0, actions: 0, subExpansions: 0, finishedFast: 0, actionCut: 0, budgetOut: 0, decisionCut: 0 };
  /** closeSamples: comparisons looked at, those made longer, samples added, cut samples played again exactly, choices changed. */
  readonly closeStats = { comparisons: 0, refined: 0, extraSamples: 0, recomputed: 0, changed: 0 };
  /**
   * tieKeepHand: comparisons it broke ties in, those with another plan within the tie, cut samples of tied plans played
   * again exactly (exactTies), and choices it changed (another plan than the first of the best it was given).
   */
  readonly tieStats = { comparisons: 0, tied: 0, recomputed: 0, changed: 0 };
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
  private readonly mulliganMode: "greedy" | "curve" | "sim";
  /** "sim"'s parameters and where it samples (mulligan-sim.ts). */
  private readonly simParams: SimParams | null;
  private readonly mulliganWorld: MulliganWorld;
  /** Its own greedy bot's evaluation as that bot scores (the mulligan by simulation's self-model outside our main phase). */
  private readonly greedyScore: Evaluator;
  /** The conditional charges (null: none), and the expansion they follow while it runs (expandWatched). */
  private readonly cond: ConditionalCharges | null;
  private watching: Expansion<Node> | null = null;
  private readonly lookahead: 1 | 2;
  private readonly innerPlans: [number, number];
  private readonly innerSimulations: number;
  private readonly innerBeam: number;
  private readonly samples: number;
  private readonly planKinds: number;
  private readonly exploreRate: number;
  private readonly exploreTemperature: number;
  private readonly exploreRng: RngState;
  /** choiceDedupe, commonRandom, lineSlots, tieKeepHand (the options; off: false, false, null, 0). */
  private readonly choiceDedupe: boolean;
  private readonly commonRandom: boolean;
  private readonly lineSlotOptions: LineSlotOptions | null;
  private readonly tieKeepHand: number;
  /** drawFirst, turnOrder (off: false, null). */
  private readonly drawFirst: boolean;
  private readonly turnOrder: TurnOrderTable | null;
  /** macro, replyLethalOpp, replyLethalKey, closeSamples (off: null, 0, "view", null). */
  private readonly macro: MacroOptions | null;
  private readonly replyLethalOpp: number;
  private readonly replyLethalKey: "view" | "position";
  private readonly closeSamples: CloseSampleOptions | null;
  /**
   * closeSamples, tieKeepHand: the latest comparison's values per plan and sample (raw: before charges) and where it was
   * made; dropped when a plan is carried out (it holds the comparison's games).
   */
  private look: Look | null = null;
  /** The node whose decision the beam is asking branches() for (choiceDedupe, commonRandom: its view and key). */
  private at: Node | null = null;
  /** commonRandom: the stream of the (plan, sample) of the two-turn comparison being played, and its models so far. */
  private stream: { base: string; models: number } | null = null;
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
    this.choiceDedupe = options.choiceDedupe ?? false;
    this.commonRandom = options.commonRandom ?? false;
    this.lineSlotOptions = options.lineSlots ? { ...options.lineSlots } : null;
    this.tieKeepHand = options.tieKeepHand ?? 0;
    this.drawFirst = options.drawFirst ?? false;
    const order = options.turnOrder ?? null;
    const orderProblems = order ? turnOrderProblems(order) : [];
    if (orderProblems.length) throw new Error(`turn order table: ${orderProblems.join("; ")}`);
    this.turnOrder = order;
    const macro = options.macro ? { ...options.macro } : null;
    const macroIssues = macro ? macroProblems(macro) : [];
    if (macroIssues.length) throw new Error(`macro: ${macroIssues.join("; ")}`);
    this.macro = macro;
    this.replyLethalOpp = options.replyLethalOpp ?? 0;
    this.replyLethalKey = options.replyLethalKey ?? "view";
    const close = options.closeSamples ? { ...options.closeSamples } : null;
    const closeIssues = close ? closeProblems(close) : [];
    if (closeIssues.length) throw new Error(`closeSamples: ${closeIssues.join("; ")}`);
    this.closeSamples = close;
    // Its own decisions outside its main phase (quick windows, end phase, targets) are scored with its own evaluation, in
    // the form that scores where those decisions are scored (greedyEvaluator), with the end-phase window's bonus if given.
    const greedyEvaluator = options.greedyEvaluator ?? this.evaluator;
    this.greedy = new GreedyBot(engine, {
      seed: `${this.seed}:greedy`,
      evaluator: greedyEvaluator,
      ...(options.quickEndBonus !== undefined ? { endPhaseQuickBonus: options.quickEndBonus } : {}),
    });
    this.greedyScore = exactResults(greedyEvaluator);
    const cond = options.conditional;
    const gates = typeof cond?.gates === "function" ? cond.gates() : (cond?.gates ?? null);
    this.cond = cond ? new ConditionalCharges(engine.scripts, { scope: cond.scope, penalty: cond.penalty ?? COND_DEFAULTS.penalty, ...(cond.evolve ? { evolve: true } : {}) }, gates) : null;
    const sim = this.mulliganMode === "sim" ? { ...SIM_DEFAULTS, ...options.mulliganSim } : null;
    const problems = sim ? simProblems(sim) : [];
    if (problems.length) throw new Error(`mulligan sim: ${problems.join("; ")}`);
    this.simParams = sim;
    // A cheating bot plays its openings in copies of the real game, as it plans every turn there (mulligan-sim.ts).
    this.mulliganWorld = this.cheat ? (session) => session.clone() : (options.mulliganWorld ?? setupWorld(engine));
    this.mulliganStats = sim ? { identity: simIdentity(sim), mulligans: 0, redraws: 0, fallbacks: 0, failures: 0, simulations: 0, inputs: 0, last: null } : null;
  }

  /** The conditional charges at work (null: the bot has none). */
  get condStats(): ConditionalStats | null {
    return this.cond?.stats ?? null;
  }

  /** The end-phase window's bonus at work on its own greedy bot (null: none). */
  get quickStats() {
    return this.greedy.quickStats;
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
    if (d.type === "mulligan" && this.mulliganMode === "sim") return this.simulatedMulligan(session, d);
    const me = d.player;
    const state = session.state;
    if (d.type === "mulligan" && this.mulliganMode === "curve") return this.mulligan(session, d);
    if (d.type === "chooseTurnOrder" && this.turnOrder !== null) return this.orderByTable(session, me, this.turnOrder);
    if (d.type === "selectCards" && d.reason === "wardEngage" && this.replyPlans > 0) return this.wardAtEnd(session, d, me);
    if (d.type === "selectCards" && d.reason === "wardEnterEngaged" && this.replyPlans > 0) return this.wardOnEntry(session, d, me);
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
      const answer = d.type !== "mainPhase" || this.sureFrom(game, me, rest, seed, 2) === null ? adaptStep(game, rest[0]!) : null;
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
      adversary: this.adversary(`${seed}:check`),
      maxLines: 6,
      seed,
      ...(this.choiceDedupe ? { dedupe: true } : {}),
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

  /**
   * Does the line surely win from this position, whatever the opponent answers: in the real game (cheating), or in `samples`
   * samples of what we know? Null if it does; else the world and the opponent's answers that stop it.
   */
  private sureFrom(game: GameSession, me: PlayerId, line: readonly LethalStep[], seed: string, samples: number): Stopped | null {
    for (let i = 0; i < (this.cheat ? 1 : samples); i++) {
      const world = () => (this.cheat ? game.clone() : game.determinized(me, `${seed}:${i}`));
      const adversary = this.adversary(`${seed}:${i}`);
      const check = lineWinsAgainstAll(world, line, me, adversary);
      if (check.capped) this.lethalStats.capped += 1;
      if (!check.won) return { world, script: check.script ?? null, adversary };
    }
    return null;
  }

  /** The opponent of a lethal check: every answer of theirs tried (lethal.ts). */
  private adversary(seed: string): Adversary {
    return { cap: 200, maxAnswers: 8, seed, ...(this.choiceDedupe ? { dedupe: true } : {}) };
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
    // A plan that wins in our sample only because of what was sampled (a card drawn) or of how the opponent answered isn't a
    // won one: it is scored where it was stopped (D10: only a sure win counts as one).
    if (this.lethalChecks > 0) finished = this.unsureWinsStopped(finished, game, me, turn, seed);
    if (finished.length === 0) return fastAnswer(game.decision!, lookupFromReader(game.reader()));
    const candidates = this.kinds(finished, root, me, this.replyPlans);
    // The best plan that can still win (not surely) is always compared.
    const unsure = finished.find((node) => node.unsure);
    if (unsure && !candidates.includes(unsure) && this.replyPlans > 0) candidates.push(unsure);
    if (this.lookahead >= 2 && candidates.length > 1) {
      const values = this.unsureFloor(candidates, this.lookAhead(candidates, game, me, turn, seed, world, this.explores(turn)));
      return this.carryOut(this.pick(candidates, values, turn), turn, me);
    }
    if (this.replyPlans <= 0) return this.carryOut(finished[0]!, turn, me);
    // The plans by the position they leave, then by the position after the opponent's reply.
    const values = this.unsureFloor(candidates, candidates.map((node) => (node.done ? this.finalValue(node, me) : this.afterReply(node, me, turn, world))));
    return this.carryOut(this.pick(candidates, values, turn), turn, me);
  }

  /**
   * A plan that wins in some samples but not surely, scored where it was stopped, is never scored as a sure loss (where it was
   * stopped, the opponent wins in their turn): when every other plan loses too, it is the one that can still win.
   */
  private unsureFloor(candidates: Node[], values: number[]): number[] {
    // The values the plans are compared by, each less its plan's conditional charges (conditional.ts).
    if (this.cond !== null) values = this.cond.chargedValues(candidates, values);
    const floor = -DEFAULT_WEIGHTS.win / 2 + 1;
    return values.map((v, i) => (candidates[i]!.unsure ? Math.max(v, floor) : v));
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
    // closeSamples: the plans close to the best played in more samples (refine; a new array: the callers' stays as it was).
    if (this.closeSamples !== null) ({ values, best } = this.refine(candidates, values, best));
    // Values equal within tieKeepHand: the plan keeping more cards in hand (plan-lines.ts keepsMoreCards).
    if (this.tieKeepHand > 0) best = this.keepsMore(candidates, values, best);
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
    // macro: this turn's own search by actions (the two-turn search's inner ones stay by decisions).
    if (this.macro !== null && !inner) return this.macroBeam(root, actor, turn, world, budget, width, score, this.macro);
    const finished: Node[] = [];
    const seen = new Set<string>([root.key]);
    let frontier = [root];
    for (let depth = 0; depth < this.maxDepth && frontier.length > 0 && budget > 0; depth++) {
      const children: Node[] = [];
      for (const node of frontier) {
        const d = node.session.decision!;
        if (canEnd(d)) finished.push(node);
        if (this.choiceDedupe || this.commonRandom) this.at = node;
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
   * beam() by actions (macro, macro-steps.ts): each step takes one more action on every plan kept — a main phase answer
   * (CR 7.3.3) and the decisions inside its action up to our next main phase decision (completeAction) — and keeps the best
   * `width` positions, so the plans ranked against each other have taken as many actions and none is half-paid. At most
   * `o.actions` steps, and no action from a plan of `o.dec` decisions. Every expansion counts against `budget`. A root inside
   * an action (a plan made again in the middle of one) finishes that action as its first step. Returns the finished plans,
   * best first, one per position (as beam()).
   */
  private macroBeam(root: Node, actor: PlayerId, turn: number, world: () => GameSession, budget: number, width: number, score: Evaluator, o: MacroOptions): Node[] {
    const stats = this.macroStats;
    stats.searches += 1;
    const finished: Node[] = [];
    const seen = new Set<string>([root.key]);
    const left = { budget };
    let frontier = [root];
    let step = 0;
    for (; step < o.actions && frontier.length > 0 && left.budget > 0; step++) {
      stats.layers += 1;
      const children: Node[] = [];
      const add = (nodes: Node[]) => {
        for (const c of nodes) {
          if (c.done) finished.push(c);
          else if (!seen.has(c.key)) {
            seen.add(c.key);
            children.push(c);
          }
        }
      };
      for (const node of frontier) {
        const d = node.session.decision!;
        if (d.type !== "mainPhase") {
          // The root in the middle of an action: that action is this step.
          add(this.completeAction(node, actor, turn, world, score, left, o));
          continue;
        }
        if (canEnd(d)) finished.push(node);
        if (node.depth >= o.dec) continue;
        if (this.choiceDedupe || this.commonRandom) this.at = node;
        for (const answer of this.branches(d, lookupFromReader(node.session.reader()))) {
          if (left.budget <= 0) break;
          left.budget -= 1;
          const child = this.expand(node, answer, actor, turn, world, score);
          if (!child) continue;
          stats.actions += 1;
          add(child.done || child.session.decision?.type === "mainPhase" ? [child] : this.completeAction(child, actor, turn, world, score, left, o));
        }
      }
      children.sort((a, b) => b.value - a.value);
      frontier = children.slice(0, width);
    }
    if (frontier.length > 0) {
      if (step >= o.actions) stats.actionCut += 1;
      else if (left.budget <= 0) stats.budgetOut += 1;
      else stats.decisionCut += 1;
    }
    for (const node of frontier) if (canEnd(node.session.decision!)) finished.push(node);
    finished.sort((a, b) => b.value - a.value);
    const one = new Map<string, Node>();
    for (const node of finished) if (!one.has(node.key)) one.set(node.key, node);
    return [...one.values()];
  }

  /**
   * The decisions inside one action, from `start` (a decision of ours inside it) to its completions: our next main phase
   * decision, or the end of the turn or the game. Searched level by level, each answer by expand (so the conditional
   * charges follow it as in beam()); a level keeps every position while the allowance can give each the answers of one
   * more decision (at this action's average), else the best `o.sub` or more by value (all inside the same action). The
   * allowance is a share of the budget left (`o.share`, at least one decision's answers). The best position left
   * unexpanded where the allowance or the decision cap (`o.dec`) ran out is finished by the fast answers (policy.ts), so an
   * action is never dropped and a long one still reaches its end. Returns the completions kept (macro-steps.ts
   * keptCompletions: the better of two that differ only in which pending ability went first, then the best `o.keep`, one
   * per position), with every completion that ended the turn or the game.
   */
  private completeAction(start: Node, actor: PlayerId, turn: number, world: () => GameSession, score: Evaluator, left: { budget: number }, o: MacroOptions): Node[] {
    const stats = this.macroStats;
    let allowance = Math.min(left.budget, Math.max(this.maxBranches, Math.floor(left.budget * o.share)));
    const completions: Node[] = [];
    const open: Node[] = [];
    const inside = new Set<string>([start.key]);
    let level = [start];
    let tried = 0;
    let expanded = 0;
    while (level.length > 0) {
      const next: Node[] = [];
      for (const node of level) {
        if (allowance <= 0 || node.depth >= o.dec) {
          open.push(node);
          continue;
        }
        if (this.choiceDedupe || this.commonRandom) this.at = node;
        const answers = this.branches(node.session.decision!, lookupFromReader(node.session.reader()));
        expanded += 1;
        tried += answers.length;
        for (const answer of answers) {
          if (allowance <= 0) break;
          allowance -= 1;
          left.budget -= 1;
          stats.subExpansions += 1;
          const child = this.expand(node, answer, actor, turn, world, score);
          if (!child) continue;
          if (child.done || child.session.decision?.type === "mainPhase") completions.push(child);
          else if (!inside.has(child.key)) {
            inside.add(child.key);
            next.push(child);
          }
        }
      }
      next.sort((a, b) => b.value - a.value);
      const fit = Math.floor(allowance / Math.max(1, tried / Math.max(1, expanded)));
      level = next.slice(0, Math.max(o.sub, fit));
    }
    let best: Node | undefined;
    for (const n of open) if (best === undefined || n.value > best.value) best = n;
    if (best !== undefined) {
      const done = this.finishFast(best, actor, turn, world, score, left, o);
      if (done !== null) {
        stats.finishedFast += 1;
        completions.push(done);
      }
    }
    const ended = completions.filter((c) => c.done);
    return [...ended, ...keptCompletions(completions.filter((c) => !c.done), start, o.keep)];
  }

  /** A position inside an action played on by the fast answers (policy.ts) to the action's end (null: a step failed or too many). */
  private finishFast(node: Node, actor: PlayerId, turn: number, world: () => GameSession, score: Evaluator, left: { budget: number }, o: MacroOptions): Node | null {
    let at = node;
    for (let i = 0; i <= o.dec && !at.done && at.session.decision?.type !== "mainPhase"; i++) {
      const d = at.session.decision!;
      left.budget -= 1;
      const next = this.expand(at, fastAnswer(d, lookupFromReader(at.session.reader())), actor, turn, world, score);
      if (next === null) return null;
      at = next;
    }
    return at.done || at.session.decision?.type === "mainPhase" ? at : null;
  }

  /**
   * At most `k` of the finished plans (best first), of different kinds (`planKinds`): the best two, and among the plans within
   * `planKinds` points of the best, the one keeping the most cards in hand, the most play points, attacking least, spending
   * evolution points, dealing the most damage to the opponent's leader; the rest by the position. A turn's best plan by the
   * position it leaves is often only the one that commits most: holding a combo piece, keeping play points for a Quick card
   * or not attacking into a trade never reached the comparison after the opponent's reply.
   */
  private kinds(finished: Node[], root: Node, actor: PlayerId, k: number, pad = true): Node[] {
    // By distinct lines (lineSlots): the root's comparison only (the two-turn search's inner levels pass pad false).
    if (this.lineSlotOptions !== null && pad) return lineSlots(finished, k, this.lineSlotOptions);
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
    // Candidates charged differently are compared without cuts: a cut is a bound on the raw value, not on the charged one.
    if (this.cond !== null && !exact && this.cond.differ(candidates)) exact = true;
    const worlds = this.cheat ? 1 : Math.max(1, this.samples);
    // closeSamples, tieKeepHand: each plan's value in each sample kept for pick (refine; a tie's cut samples played again
    // exactly, exactTies), with where the comparison was made.
    const look = (this.closeSamples !== null && !this.cheat) || this.tieKeepHand > 0 ? this.lookAt(game, me, turn, seed, world, worlds) : null;
    let bestTotal = -Infinity;
    const totals: number[] = [];
    for (const [i, plan] of candidates.entries()) {
      let total = 0;
      for (let w = 0; w < worlds; w++) {
        let value: number;
        let bound = false;
        // commonRandom: this sample's random numbers are the same for every plan (the stream: the plan's seed and the sample).
        if (this.commonRandom) this.stream = { base: `${seed}:w${w}`, models: 0 };
        try {
          const session = w === 0 ? this.copy(plan, world) : this.replayPlan(plan, this.cheat ? game.clone() : game.determinized(me, `${seed}:w${w}`), me, turn);
          // The last world may stop as soon as the plan can't reach the best total any more (a cut returns a bound at most that).
          const alpha = w === worlds - 1 && !exact ? bestTotal - total : -Infinity;
          value = this.turnValue(session, me, opponentOf(me), turn, 1, alpha, Infinity, null, this.commonRandom ? `${seed}:w${w}` : `${seed}:w${w}:p${i}`);
          // A value at or below a finite alpha may be a bound (the search was cut there), not the plan's value.
          bound = alpha !== -Infinity && value <= alpha;
        } catch (e) {
          this.stats.simulationFailures += 1;
          this.stats.lastError = e instanceof Error ? e.message : String(e);
          value = this.finalValue(plan, me) - 1_000;
        } finally {
          this.stream = null;
        }
        total += value;
        if (look !== null) lookRow(look, plan, i).values[w] = { value, bound };
      }
      totals.push(total / worlds);
      bestTotal = Math.max(bestTotal, total);
    }
    return totals;
  }

  /**
   * closeSamples: where this comparison's samples are kept (lookAhead fills it plan by plan; a second lookAhead of the same
   * plan() — explore2's variants — adds its plans to the same one).
   */
  private lookAt(game: GameSession, me: PlayerId, turn: number, seed: string, world: () => GameSession, worlds: number): Look {
    if (this.look !== null && this.look.seed === seed && this.look.game === game) return this.look;
    this.look = { seed, game, me, turn, world, worlds, rows: new Map(), memo: new WeakMap(), refined: new WeakMap(), ties: new WeakMap() };
    return this.look;
  }

  /**
   * closeSamples (close-samples.ts) at pick: when plans are close to the best (by the latest comparison's samples, a cut
   * sample played again exactly first), the best and the closest (at most `most` in all) are played in the samples after
   * those (the same seeds as lookAhead's, so with commonRandom the same random numbers) up to `max`, and each one's value
   * moves by the change of its raw average (its charges, if any, stay as they were). Plans won or lost, held at the floor
   * of a plan that can still win, or with a sample that failed, are left as they are. Returns new values and the best
   * (the first of the highest); the same arrays when nothing is close. Memoized per values array (a caller asking twice).
   */
  private refine(candidates: Node[], values: number[], best: number): { values: number[]; best: number } {
    const o = this.closeSamples!;
    const look = this.look;
    // A cheating planner has one sample, the real game: none to add (its comparison is kept for tieKeepHand only).
    if (look === null || this.cheat || look.worlds >= o.max) return { values, best };
    const known = look.memo.get(values);
    if (known) return known;
    const half = DEFAULT_WEIGHTS.win / 2;
    const floor = -half + 1;
    const rows = candidates.map((c) => look.rows.get(c) ?? null);
    const open = (i: number) => {
      const v = values[i]!;
      const r = rows[i];
      return r !== null && r !== undefined && r.values.length === look.worlds && Number.isFinite(v) && Math.abs(v) < half && !(candidates[i]!.unsure && v <= floor);
    };
    const unchanged = { values, best };
    if (!open(best)) return unchanged;
    this.closeStats.comparisons += 1;
    // Each open plan's samples (copied: the comparison's own stay as lookAhead left them), its raw average before any change.
    const samples = rows.map((r) => (r ? r.values.map((x) => ({ ...x })) : []));
    const base = samples.map((s) => (s.length ? mean(s.map((x) => x.value)) : 0));
    const raw = (i: number) => samples[i]!.map((x) => x.value);
    /** The plans whose samples changed (a cut sample played again exactly, more samples): their values move. */
    const changed = new Set<number>();
    const exactly = (i: number) => {
      for (const [w, x] of samples[i]!.entries()) {
        if (!x.bound) continue;
        samples[i]![w] = { value: this.sampleValue(candidates[i]!, rows[i]!.index, w, look), bound: false };
        this.closeStats.recomputed += 1;
        changed.add(i);
      }
    };
    const now = (i: number) => values[i]! + mean(raw(i)) - base[i]!;
    exactly(best);
    const close: { i: number; lead: number }[] = [];
    for (let i = 0; i < candidates.length; i++) {
      if (i === best || !open(i)) continue;
      // A cut sample is a bound above the plan's value: not close even so, it isn't; close so, it is played again exactly.
      if (!isClose(raw(best), raw(i), now(best) - now(i), o)) continue;
      if (samples[i]!.some((x) => x.bound)) {
        exactly(i);
        if (!isClose(raw(best), raw(i), now(best) - now(i), o)) continue;
      }
      close.push({ i, lead: now(best) - now(i) });
    }
    if (close.length === 0) {
      const out = changed.size > 0 ? this.reranked(values, [...changed], now) : unchanged;
      if (changed.size > 0) look.refined.set(out.values, changed);
      look.memo.set(values, out);
      return out;
    }
    close.sort((a, b) => a.lead - b.lead);
    const more = [best, ...close.slice(0, o.most - 1).map((c) => c.i)];
    for (const k of more) {
      for (let w = look.worlds; w < o.max; w++) {
        samples[k]!.push({ value: this.sampleValue(candidates[k]!, rows[k]!.index, w, look), bound: false });
        this.closeStats.extraSamples += 1;
      }
      changed.add(k);
    }
    this.closeStats.refined += 1;
    const out = this.reranked(values, [...changed], now);
    if (out.best !== best) this.closeStats.changed += 1;
    look.refined.set(out.values, changed);
    look.memo.set(values, out);
    return out;
  }

  /** The values with those of `changed` replaced (now), and the first of the highest. */
  private reranked(values: number[], changed: number[], now: (i: number) => number): { values: number[]; best: number } {
    const out = [...values];
    for (const i of changed) out[i] = now(i);
    let best = 0;
    for (let i = 1; i < out.length; i++) if (out[i]! > out[best]!) best = i;
    return { values: out, best };
  }

  /** closeSamples, tieKeepHand: one plan's value in sample `w` of a comparison, as lookAhead scores it (no cut). */
  private sampleValue(plan: Node, index: number, w: number, look: Look): number {
    const { game, me, turn, seed, world } = look;
    if (this.commonRandom) this.stream = { base: `${seed}:w${w}`, models: 0 };
    try {
      const session = w === 0 ? this.copy(plan, world) : this.replayPlan(plan, this.cheat ? game.clone() : game.determinized(me, `${seed}:w${w}`), me, turn);
      return this.turnValue(session, me, opponentOf(me), turn, 1, -Infinity, Infinity, null, this.commonRandom ? `${seed}:w${w}` : `${seed}:w${w}:p${index}`);
    } catch (e) {
      this.stats.simulationFailures += 1;
      this.stats.lastError = e instanceof Error ? e.message : String(e);
      return this.finalValue(plan, me) - 1_000;
    } finally {
      this.stream = null;
    }
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
    // replyLethalOpp: the opponent's search with its own budget (and, by "position", positions told apart as the beam does).
    const opp = actor !== me && this.replyLethalOpp > 0;
    const lethalBudget = opp ? this.replyLethalOpp : this.replyLethal;
    if (lethalBudget > 0 && lethalWithinReach(start.view(actor), d, actor, 3, 0)) {
      const found = searchSureLethal(actor, {
        budget: lethalBudget,
        beam: 12,
        maxBranches: this.maxBranches,
        world: (i) => (i === 0 ? start.clone() : start.determinized(actor, `${seed}:lethal-check`)),
        checks: 1,
        searchResponder: () => null,
        checkResponder: () => this.responder(true),
        maxLines: 2,
        seed: `${seed}:lethal`,
        key: opp && this.replyLethalKey === "position" ? positionKey : (view) => JSON.stringify(view),
        ...(this.choiceDedupe ? { dedupe: true } : {}),
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
    // The search is over: what it kept of its games (the comparison's samples, the beam's node) isn't kept to the next one.
    this.look = null;
    this.at = null;
    // drawFirst: the same plan with an action that draws moved to its front, when it still ends where it did (infoFirst).
    if (this.drawFirst) choice = this.infoFirst(choice, turn, me) ?? choice;
    const path: Node[] = [];
    for (let n: Node | null = choice; n && n.parent; n = n.parent) path.unshift(n);
    // The views exactly, ids too: following the plan in the real game needs the same cards under the same ids.
    const exact = path.map((n) => JSON.stringify(n.session.view(me)));
    this.current = { path, exact, given: path.length > 0 ? 1 : 0, turn };
    return path[0]?.answer ?? endMainPhase();
  }

  /**
   * drawFirst (plan-lines.ts "Information first"): the plan ending at `choice` with its first action that draws (or, if that
   * one can't move, its second) moved to the front, as nodes of the same sample; null: carry it out as it is. The plan is
   * first played again as it is in a copy of its own sample, to find the actions whose events draw cards for us (CR 5.10);
   * if that copy doesn't reach the plan's positions (an opponent model answered otherwise), nothing moves. The moved order is
   * played by expand (the conditional charges follow it as they follow the search), each answer matched to the cards by
   * definition (lethal.ts adaptStep), and taken only if every answer has its decision (a main phase decision where an action
   * begins, decisions inside it after that: none more, none fewer) and it ends in the plan's position with the plan's value.
   * Its opponent models are seeded in a stream of its own (as commonRandom's), so neither the planner's model count nor its
   * rng moves: a plan left as it is changes nothing after it. A plan won or ended (done) is left as it is.
   */
  private infoFirst(choice: Node, turn: number, me: PlayerId): Node | null {
    this.drawFirstStats.plans += 1;
    if (choice.done || choice.unsure) return null;
    const path: Node[] = [];
    for (let n: Node | null = choice; n && n.parent; n = n.parent) path.unshift(n);
    const root = path[0]?.parent ?? null;
    const actions = actionSegments(path.map((n) => n.parent!.session.decision?.type === "mainPhase"));
    if (root === null || actions === null || actions.length < 2) return null;
    const saved = this.stream;
    this.stream = { base: `${this.seed}:draw:${this.plans}`, models: 0 };
    try {
      // The root's game is the sample itself (the search copies it, never plays it).
      const world = () => root.session.clone();
      const session = world();
      const drawing: number[] = [];
      for (const [a, steps] of actions.entries()) {
        const events: GameEvent[] = [];
        for (const i of steps) {
          events.push(...session.act(path[i]!.answer!));
          this.advance(session, me, turn, false, events);
          if (positionKey(session.view(me)) !== path[i]!.key) {
            this.drawFirstStats.mismatch += 1;
            return null;
          }
        }
        if (drewCards(events, me)) drawing.push(a);
      }
      const movable = drawing.filter((a) => a > 0).slice(0, 2);
      if (movable.length === 0) return null;
      this.drawFirstStats.drawPlans += 1;
      for (const a of movable) {
        this.drawFirstStats.tried += 1;
        const moved = this.replayActions(root, path, actions, drawToFront(actions.length, a), me, turn, world);
        if (moved !== null && !moved.done && moved.session.decision?.type === "mainPhase" && moved.key === choice.key && Math.abs(moved.value - choice.value) < 1e-9) {
          this.drawFirstStats.moved += 1;
          return moved;
        }
      }
      return null;
    } catch {
      this.drawFirstStats.failed += 1;
      return null;
    } finally {
      this.stream = saved;
    }
  }

  /**
   * The plan's actions (`actions`: its steps' indexes per action) played in `order` from its root by expand, each answer
   * matched to the cards there (adaptStep); null where a step has no decision of its kind (a main phase decision at an
   * action's first step, another decision at the others) or no matching answer, or a step fails.
   */
  private replayActions(root: Node, path: Node[], actions: number[][], order: number[], me: PlayerId, turn: number, world: () => GameSession): Node | null {
    let at: Node = root;
    for (const a of order) {
      for (const [j, i] of actions[a]!.entries()) {
        const d = at.session.decision;
        if (at.done || !d || (d.type === "mainPhase") !== (j === 0)) return null;
        const step = path[i]!;
        const answer = adaptStep(at.session, stepOf(step.parent!.session, step.answer!));
        if (answer === null) return null;
        const next = this.expand(at, answer, me, turn, world);
        if (next === null) return null;
        at = next;
      }
    }
    return at;
  }

  /**
   * CR 6.2.1.6 by the table (turnOrder, turn-order.ts): the answer of the entry closest to our own deck list (the definitions
   * of our cards in hand, deck and evolve deck: the list a player knows, never their order), or the table's default.
   */
  private orderByTable(game: GameSession, me: PlayerId, table: TurnOrderTable): Answer {
    const choice = turnOrderFor(table, ownDeckList(game, me));
    this.turnOrderStats.choices += 1;
    if (!choice.goFirst) this.turnOrderStats.second += 1;
    this.turnOrderStats.last = choice;
    return { type: "chooseTurnOrder", goFirst: choice.goFirst };
  }

  /**
   * The finished plans with each that won in our sample checked (lethal.ts: in the other samples too — a cheating bot: in the
   * real game — whatever the opponent answers). One that isn't sure is replaced by where it was stopped: its steps given in
   * the world and against the answers that stopped it, our turn played on to our next main phase decision there (our choices
   * the fast answers), and scored as a plan that ends there; without that world (too many answers to try), it is left out.
   */
  private unsureWinsStopped(finished: Node[], game: GameSession, me: PlayerId, turn: number, seed: string): Node[] {
    if (!finished.some((node) => node.session.result?.winner === me)) return finished;
    const out: Node[] = [];
    for (const node of finished) {
      if (node.session.result?.winner !== me) {
        out.push(node);
        continue;
      }
      const steps: LethalStep[] = [];
      for (let n: Node | null = node; n && n.parent; n = n.parent) steps.unshift(stepOf(n.parent.session, n.answer!));
      const stopped = this.sureFrom(game, me, steps, `${seed}:won`, this.lethalChecks);
      if (!stopped) {
        out.push(node);
        continue;
      }
      this.lethalStats.unsurePlans += 1;
      if (stopped.script === null) continue;
      try {
        const session = stopped.world();
        replayLine(session, steps, me, stopped.script, stopped.adversary);
        let stop: Stop = "decide";
        for (let i = 0; i < 100; i++) {
          const d = session.decision;
          if (!d) stop = "gameOver";
          else if (session.state.turn !== turn || session.state.phase !== "main") stop = "turnOver";
          else if (d.player !== me) {
            stop = this.advance(session, me, turn);
            if (stop === "decide") continue;
          } else if (d.type !== "mainPhase") {
            session.act(fastAnswer(d, lookupFromReader(session.reader())));
            continue;
          }
          break;
        }
        out.push({ ...this.node(session, node.parent, node.answer, me, turn, stop), unsure: true });
      } catch (e) {
        this.stats.simulationFailures += 1;
        this.stats.lastError = e instanceof Error ? e.message : String(e);
      }
    }
    // Best first again, one plan per position.
    const seen = new Set<string>();
    return out.sort((a, b) => b.value - a.value).filter((n) => !seen.has(n.key) && (seen.add(n.key), true));
  }

  /**
   * CR 7.4.3: which reserved Ward followers to engage at our end phase. Engaged, a Ward follower protects (12.8.2 iii) but can
   * be attacked, by Rush followers too (8.4.3.1): each choice is played through the opponent's turn in the same sample, the
   * opponent played by the same model, and scored at our next main phase. Ties keep the fast answer (all of them).
   */
  private wardAtEnd(game: GameSession, d: Extract<Decision, { type: "selectCards" }>, me: PlayerId): Answer {
    // choiceDedupe: told apart by the cards as our player sees them in the real game (its view and the decision only).
    const same = this.choiceDedupe ? answerSigner(game.view(me), d) : undefined;
    const answers = candidateAnswers(d, lookupFromReader(game.reader()), this.rng, Math.max(2, this.replyPlans), false, same);
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
   * CR 12.8.2 (i): a Ward follower entering reserved or engaged, outside our own main phase. Engaged it protects at once
   * (12.8.2 iii) but can be attacked, by Rush followers too (8.4.3.1); reserved it gives an attacker that can only attack
   * followers nothing to hit; in the opponent's turn our start phase refreshes it either way (7.2.3). Each answer is played to
   * our next main phase in the same samples (two for a fair bot, the real game for a cheating one), the opponent played by
   * the model, and scored there; ties keep the fast answer (policy.ts). Before our own end phase's engaging (7.4.3) it stays
   * reserved without a comparison: that step can still engage it.
   */
  private wardOnEntry(game: GameSession, d: Extract<Decision, { type: "selectCards" }>, me: PlayerId): Answer {
    const fast = fastAnswer(d, lookupFromReader(game.reader()));
    const state = game.state;
    if (state.activePlayer === me && (state.phase !== "end" || this.wardEngageAhead(game, me))) return fast;
    const answers = [fast, ...wardSelections(d)].filter((a, i, all) => all.findIndex((b) => JSON.stringify(b) === JSON.stringify(a)) === i);
    const seed = `${this.seed}:wardEntry:${this.plans++}`;
    const samples = this.cheat ? 1 : 2;
    let best = fast;
    let bestValue = -Infinity;
    for (const answer of answers) {
      let total = 0;
      try {
        for (let i = 0; i < samples; i++) {
          this.stats.simulations += 1;
          const session = this.cheat ? game.clone() : game.determinized(me, `${seed}:${i}`);
          session.act(answer);
          total += this.playReply(session, me, state.turn, `${seed}:${i}:reply`);
        }
      } catch (e) {
        this.stats.simulationFailures += 1;
        this.stats.lastError = e instanceof Error ? e.message : String(e);
        continue;
      }
      if (total > bestValue) {
        best = answer;
        bestValue = total;
      }
    }
    return best;
  }

  /** In our own end phase: whether its Ward engaging (CR 7.4.3) is still ahead (played on with fast answers until it asks). */
  private wardEngageAhead(game: GameSession, me: PlayerId): boolean {
    const session = this.cheat ? game.clone() : game.determinized(me, `${this.seed}:wardAhead`);
    const turn = session.state.turn;
    for (let i = 0; i < 300 && session.decision && !session.result && session.state.turn === turn; i++) {
      const d = session.decision;
      if (i > 0 && d.type === "selectCards" && d.reason === "wardEngage" && d.player === me) return true;
      session.act(fastAnswer(d, lookupFromReader(session.reader())));
    }
    return false;
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

  /**
   * CR 6.2.1.8 by playing the first turns of samples both ways (mulligan-sim.ts): our decisions there scored with the bot's
   * own evaluations (its main phases with `evaluator`, its other decisions with its own greedy's, the leaves with
   * `replyEvaluator`), the opponent's with its models'. The samples are seeded from the bot's seed and the mulligan's number.
   * When every sample fails, its own greedy bot's rule answers.
   */
  private simulatedMulligan(game: GameSession, d: MulliganDecision): Answer {
    const stats = this.mulliganStats!;
    stats.mulligans += 1;
    const outcome = simMulligan(game, d, {
      engine: this.engine,
      world: this.mulliganWorld,
      seed: `${this.seed}:mull:${stats.mulligans}`,
      params: this.simParams!,
      evaluator: this.evaluator,
      greedyEvaluator: this.greedyScore,
      leafEvaluator: this.replyEvaluator,
      // As the models score (the hand-written evaluation when the bot was given none).
      modelEvaluator: this.modelEvaluator ?? ((view, me) => evaluate(view, me)),
    });
    stats.last = outcome;
    stats.failures += outcome.failures;
    stats.simulations += outcome.simulations;
    stats.inputs += outcome.inputs;
    let answer: Answer;
    if (outcome.keep.length === 0) {
      stats.fallbacks += 1;
      answer = this.greedy.decide(game);
    } else answer = outcome.redraw ? { type: "mulligan", redraw: true, bottomOrder: [...d.hand] } : { type: "mulligan", redraw: false };
    if (answer.type === "mulligan" && answer.redraw) stats.redraws += 1;
    return answer;
  }

  /** The answers worth trying at a decision of a plan (branches.ts). */
  private branches(d: Decision, lookup: ReturnType<typeof lookupFromReader>): Answer[] {
    // Told apart by what they choose (choiceDedupe), or sampled in a two-turn sample's own stream (commonRandom).
    if (this.choiceDedupe || this.stream !== null) return this.distinctBranches(d, lookup);
    return planBranches(d, lookup, this.rng, this.maxBranches);
  }

  /**
   * branches() with choiceDedupe or commonRandom. The node asked about is the beam's (`at`, when its decision is `d`): its
   * view, as the deciding player sees it in the sample, tells the answers apart (distinct-answers.ts); in a two-turn sample's
   * stream, the answers sampled among many come from the stream and the position (its key), not from the planner's rng.
   * Without the node (a caller other than the beam), no signatures, and the stream with the decision itself.
   */
  private distinctBranches(d: Decision, lookup: ReturnType<typeof lookupFromReader>): Answer[] {
    const at = this.at !== null && this.at.session.decision === d ? this.at : null;
    let same: SameCard | undefined;
    if (this.choiceDedupe && at !== null) {
      // Built when first asked (a main phase decision with nothing to tell apart never builds the view).
      let signer: SameCard | null = null;
      same = (id) => (signer ??= answerSigner(at.session.view(d.player), d))(id);
    }
    const stream = this.stream;
    const sampled = stream !== null && (d.type === "selectCards" || d.type === "choose");
    const rng = sampled ? seedRng(`${stream.base}:b:${textHash(at?.key ?? JSON.stringify(d))}`) : this.rng;
    return planBranches(d, lookup, rng, this.maxBranches, same);
  }

  /** Give `answer` in a copy of `node` and play on to our next decision (the opponent passes in their quick windows). */
  private expand(node: Node, answer: Answer, me: PlayerId, turn: number, world: () => GameSession, score: Evaluator = this.evaluator, inner = false): Node | null {
    // The conditional charges follow this turn's own search only (not the later turns of a two-turn search).
    if (this.cond !== null && !inner && this.watching === null) return this.expandWatched(node, answer, me, turn, world, score);
    this.stats.simulations += 1;
    try {
      const session = this.copy(node, world);
      session.act(answer);
      const stop = this.advance(session, me, turn, inner);
      return this.node(session, node, answer, me, turn, stop, score);
    } catch (e) {
      return this.expansionFailed(e);
    }
  }

  /**
   * expand, with the conditional charges following it (conditional.ts): the events of the answer and of the opponent's
   * answers after it (the copy's inputs, not those that rebuilt the copy), and the plan's state and charge on the node.
   */
  private expandWatched(node: Node, answer: Answer, me: PlayerId, turn: number, world: () => GameSession, score: Evaluator): Node | null {
    const events: GameEvent[] = [];
    const x: Expansion<Node> = { parent: node, answer, decision: node.session.decision, events };
    this.watching = x;
    this.stats.simulations += 1;
    try {
      const session = this.copy(node, world);
      events.push(...session.act(answer));
      const stop = this.advance(session, me, turn, false, events);
      return this.cond!.expanded(this.node(session, node, answer, me, turn, stop, score), x, session, me, stop);
    } catch (e) {
      return this.expansionFailed(e);
    } finally {
      this.watching = null;
    }
  }

  /** A simulation of a plan's step that threw: counted with its message (at most 20 different ones); no node. */
  private expansionFailed(e: unknown): null {
    this.stats.simulationFailures += 1;
    const message = `${e instanceof Error ? e.name : "Error"}: ${e instanceof Error ? e.message : String(e)}`.slice(0, 300);
    const errors = this.stats.simulationErrors;
    if (message in errors || Object.keys(errors).length < 20) errors[message] = (errors[message] ?? 0) + 1;
    return null;
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
      // A node whose game has ended has no decision: advance stops at once, whoever it is asked for.
      this.advance(session, node.session.decision?.player ?? 0, node.session.state.turn);
      return session;
    }
  }

  /**
   * Answer the decisions that aren't ours to plan (the opponent's, during our turn) until we decide again: a greedy model
   * (`opponentQuick`), or the fast answers. In the later turns of a two-turn search (`inner`) a cheaper model, at quick windows
   * with something to play only. `events` collects the events of the answers given (the conditional charges read them).
   */
  private advance(session: GameSession, me: PlayerId, turn: number, inner = false, events?: GameEvent[]): Stop {
    for (let steps = 0; steps < 300; steps++) {
      const d = session.decision;
      if (!d) return "gameOver";
      if (session.state.turn !== turn || session.state.phase !== "main") return "turnOver";
      if (d.player === me) return "decide";
      // A quick window where passing is all they can do needs no model.
      const real = this.opponentQuick && !(d.type === "quick" && d.actions.length === 1) && (!inner || d.type === "quick");
      const given = session.act(real ? this.model("greedy", undefined, inner ? 4 : 12).decide(session) : fastAnswer(d, lookupFromReader(session.reader())));
      if (events) events.push(...given);
    }
    return "turnOver";
  }

  private node(session: GameSession, parent: Node | null, answer: Answer | null, me: PlayerId, turn: number, stop: Stop, score: Evaluator = this.evaluator): Node {
    const view = session.view(me);
    const made: Node = {
      session,
      parent,
      answer,
      depth: parent ? parent.depth + 1 : 0,
      value: score(view, me),
      done: stop !== "decide",
      key: positionKey(view),
    };
    // A plan's node made again from its parent and answer outside the search (a plan replaced where it was stopped,
    // unsureWinsStopped) keeps the conditional charges its expansion found.
    return this.cond !== null && this.watching === null && parent !== null && answer !== null ? this.cond.remade(made, parent, answer) : made;
  }

  /**
   * A fresh model of a player (a fair one: it plans with what that player can see): the opponent in our simulations, or us in
   * the opponent's simulated turn. Attacks come first among the greedy model's candidates, so none is left out.
   */
  private model(kind: "greedy" | "planner", seed = this.modelSeed(), maxCandidates = 12): Model {
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

  /**
   * A fresh model's seed: the planner's count of models, or in a two-turn sample's stream (commonRandom) the stream's own
   * count, so the models of one plan's sample don't depend on how many the plans before it made.
   */
  private modelSeed(): string {
    return this.stream !== null ? `${this.stream.base}:q:${this.stream.models++}` : `${this.seed}:model:${this.models++}`;
  }

  /**
   * tieKeepHand's tie-break (plan-lines.ts keepsMoreCards): our cards in hand where each plan ends, compared on values, not
   * bounds (exactTies first: a cut's bound can tie with the best's value without being the plan's).
   */
  private keepsMore(candidates: Node[], values: number[], best: number): number {
    let me: PlayerId | undefined;
    for (let n: Node | null = candidates[best] ?? null; n; n = n.parent) if (n.parent === null) me = n.session.decision?.player;
    if (me === undefined) return best;
    const player = me;
    const exact = this.exactTies(candidates, values, best);
    const pick = keepsMoreCards(exact.values, exact.best, this.tieKeepHand, (i) => handAt(candidates[i]!.session, player));
    const top = exact.values[exact.best]!;
    this.tieStats.comparisons += 1;
    if (exact.values.some((v, i) => i !== exact.best && v >= top - this.tieKeepHand)) this.tieStats.tied += 1;
    if (pick !== best) this.tieStats.changed += 1;
    return pick;
  }

  /**
   * tieKeepHand at pick: a plan within the tie of the best whose value has a cut sample — lookAhead's alpha-beta returns a
   * bound there (the true value is at or below it, and the bound at most the best's total: a plan cut so often ties with
   * the best exactly, a sure win of 1e6 in every sample but a cut one included) — is played there exactly first
   * (sampleValue: the comparison's own seeds, with commonRandom the same random numbers), its value moving by its raw
   * average's change (its charges, and the floor of a plan that can still win, stay as they were); again with the new best
   * until no plan within the tie of it has a cut sample. The plans refine changed have none. Returns the values and the
   * best (the first of the highest); the same arrays when no tied plan had a cut sample. Memoized per values array.
   */
  private exactTies(candidates: Node[], values: number[], best: number): { values: number[]; best: number } {
    const look = this.look;
    if (look === null) return { values, best };
    const known = look.ties.get(values);
    if (known) return known;
    const floor = -DEFAULT_WEIGHTS.win / 2 + 1;
    const exact = new Set<number>(look.refined.get(values));
    let out = values;
    for (;;) {
      const top = out[best]!;
      if (!Number.isFinite(top)) break;
      const todo: number[] = [];
      for (let i = 0; i < out.length; i++) {
        if (exact.has(i) || !(out[i]! >= top - this.tieKeepHand)) continue;
        const row = look.rows.get(candidates[i]!);
        if (row !== undefined && row.values.length === look.worlds && row.values.some((x) => x.bound)) todo.push(i);
      }
      if (todo.length === 0) break;
      if (out === values) out = [...values];
      for (const i of todo) {
        exact.add(i);
        const row = look.rows.get(candidates[i]!)!;
        const raw = row.values.map((x, w) => {
          if (!x.bound) return x.value;
          this.tieStats.recomputed += 1;
          return this.sampleValue(candidates[i]!, row.index, w, look);
        });
        const moved = out[i]! + mean(raw) - mean(row.values.map((x) => x.value));
        out[i] = candidates[i]!.unsure ? Math.max(moved, floor) : moved;
      }
      best = 0;
      for (let i = 1; i < out.length; i++) if (out[i]! > out[best]!) best = i;
    }
    const result = { values: out, best };
    look.ties.set(values, result);
    return result;
  }

  /** How the models score a position (the opponent's plans in a two-turn search are ranked as their model would). */
  private modelScore(): Evaluator {
    return exactResults(this.modelEvaluator ?? weightsEvaluator(DEFAULT_WEIGHTS));
  }

  /** A plan's position scored as plans are finally compared (where the game or our turn already ended, or a reply failed). */
  private finalValue(node: Node, me: PlayerId): number {
    // Without the node's conditional charge: the comparison takes a plan's charges off once (unsureFloor).
    const applied = node.cond?.applied ?? 0;
    if (applied !== 0) node = { ...node, value: node.value + applied };
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

/** Where a line was stopped: the world, and the opponent's answers there (null: too many to try them all). */
interface Stopped {
  world: () => GameSession;
  script: number[] | null;
  adversary: Adversary;
}

/** closeSamples: one two-turn comparison (lookAhead's arguments) and each plan's value in each of its samples. */
interface Look {
  seed: string;
  game: GameSession;
  me: PlayerId;
  turn: number;
  world: () => GameSession;
  worlds: number;
  rows: Map<Node, LookRow>;
  /** refine's results by the values array it was given. */
  memo: WeakMap<number[], { values: number[]; best: number }>;
  /** refine's output arrays: the plans whose values it changed (each cut sample of theirs played again exactly). */
  refined: WeakMap<number[], ReadonlySet<number>>;
  /** exactTies' results by the values array it was given. */
  ties: WeakMap<number[], { values: number[]; best: number }>;
}

/** A plan's place in lookAhead's list (its seeds without commonRandom) and its values by sample (bound: maybe a cut's bound). */
interface LookRow {
  index: number;
  values: { value: number; bound: boolean }[];
}

/** The row of a plan in a comparison, made when first written. */
function lookRow(look: Look, plan: Node, index: number): LookRow {
  let row = look.rows.get(plan);
  if (!row) look.rows.set(plan, (row = { index, values: [] }));
  return row;
}

/** The Ward followers entering to engage: every subset of up to three, else none or all of them. */
function wardSelections(d: Extract<Decision, { type: "selectCards" }>): Answer[] {
  const n = d.candidates.length;
  if (n > 3) return [{ type: "selectCards", cards: [] }, { type: "selectCards", cards: [...d.candidates] }];
  const out: Answer[] = [];
  for (let mask = 0; mask < 1 << n; mask++) out.push({ type: "selectCards", cards: d.candidates.filter((_, i) => mask & (1 << i)) });
  return out;
}

/** A 32-bit FNV-1a hash of a text, in hex (a stream's seed from a position's key). */
function textHash(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}

function canEnd(d: Decision): boolean {
  return d.type === "mainPhase" && d.actions.some((a) => a.type === "endMainPhase");
}

function endMainPhase(): Answer {
  return { type: "mainPhase", action: { type: "endMainPhase" } };
}
