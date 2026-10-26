import type { Answer, Engine, GameSession } from "./core";
import { bundledGates } from "./card-table";
import { COND_DEFAULTS, condIdentity, type CondParams } from "./conditional";
import { DANGER_DEFAULTS, danger, dangerIdentity, dangerStartParams, type DangerParams } from "./danger";
import { PP1_DEFAULTS, pp1Evaluator, pp1GreedyParams, pp1Identity, type Pp1Params } from "./eval-pp";
import type { LeaderCurve } from "./evaluate";
import { GreedyBot } from "./greedy";
import { SIM_DEFAULTS, simIdentity, type SimParams } from "./mulligan-sim";
import { PlannerBot, type PlannerBotOptions } from "./planner";
import { quickIdentity } from "./quick-window";

/**
 * The bots a player chooses between. Easy is the greedy bot (one action at a time). Medium plans its whole
 * turn with what its player can see. Hard plans in the real game, reading every hidden card and the results of future
 * random events: it cheats, on purpose (the project owner's request, 2026-09-30). Hard looks two turns ahead (ours, the
 * opponent's, our next: lookahead 2, since 2026-10-04; it beat the one-turn Hard in 55% of the pairs, thinking about 70%
 * longer), one turn on a slower device (createBot's effort); Medium keeps one turn (two would think about 6 times as
 * long). Both play a sure lethal first (lethal.ts). The beta level, only in `npm run bot:arena`, is Medium with a mulligan
 * by the curve and the leader's defense valued on a curve. The presets below (MEDIUM_NEXT, HARD_NEXT, MEDIUM_V2:
 * createPresetBot) add the expert fixes to these levels; they are not levels of createBot.
 */
export type BotLevel = "easy" | "medium" | "hard" | "medium-beta";

export const BOT_LEVELS: readonly BotLevel[] = ["easy", "medium", "hard", "medium-beta"];

// The opponent answers its quick windows in Medium's plans too (a greedy model in Medium's sample of their hand: fair).
export const MEDIUM_OPTIONS: PlannerBotOptions = { replyPlans: 4, beamWidth: 6, maxSimulations: 600, lethalSearch: 800, opponentQuick: true, replyLethal: 80 };

export const HARD_OPTIONS: PlannerBotOptions = {
  cheat: true,
  replyModel: "planner",
  opponentQuick: true,
  replyPlans: 6,
  beamWidth: 8,
  maxSimulations: 900,
  lethalSearch: 800,
  replyLethal: 80,
  lookahead: 2,
};

/**
 * The beta bot's leader curve (evaluate.ts): the n-th point of defense is worth `base + extra · e^(−(n−1)/scale)` with the
 * values below — about 2.5 for the last point, 1.1 at 10, 0.8 at 20 (a follower's attack point is 1) — counted after half
 * the attack the other side could deal.
 */
export const LEADER_CURVE: LeaderCurve = { base: 0.7, extra: 1.8, scale: 6, threat: 0.5 };

export const MEDIUM_BETA_OPTIONS: PlannerBotOptions = { ...MEDIUM_OPTIONS, mulligan: "curve", weights: { leaderCurve: LEADER_CURVE } };

const PLANNER_OPTIONS: Record<Exclude<BotLevel, "easy">, PlannerBotOptions> = {
  medium: MEDIUM_OPTIONS,
  hard: HARD_OPTIONS,
  "medium-beta": MEDIUM_BETA_OPTIONS,
};

export interface Bot {
  decide(session: GameSession): Answer;
}

/** The evaluations a bot can be given in place of the hand-written one (PlannerBotOptions; the greedy bot takes `evaluator`). */
export type BotEvaluation = Pick<PlannerBotOptions, "evaluator" | "replyEvaluator" | "modelEvaluator">;

/**
 * A bot of a level. `effort` scales how much the planners search, for a slower device (a phone: less, and below 1 one turn
 * ahead only: two turns can take a minute on a PC); it changes how long they think, not what they know. `evaluation` puts
 * other evaluations in the hand-written one's place (a learned one). The same seed and effort give the same answers.
 */
export function createBot(engine: Engine, level: BotLevel, seed: string, effort = 1, evaluation: BotEvaluation = {}): Bot {
  if (level === "easy") return new GreedyBot(engine, { seed, evaluator: evaluation.evaluator });
  return scaledPlanner(engine, PLANNER_OPTIONS[level], seed, effort, evaluation);
}

/** A planner of these options with its searches scaled by `effort` (createBot): fewer answers tried, one turn below 1. */
function scaledPlanner(engine: Engine, options: PlannerBotOptions, seed: string, effort: number, evaluation: BotEvaluation): PlannerBot {
  const scaled = (n: number | undefined, least: number) => Math.max(least, Math.round((n ?? least) * effort));
  return new PlannerBot(engine, {
    ...options,
    ...evaluation,
    seed,
    maxSimulations: scaled(options.maxSimulations, 100),
    replyPlans: scaled(options.replyPlans, 2),
    ...(options.lethalSearch ? { lethalSearch: scaled(options.lethalSearch, 100) } : {}),
    ...(options.replyLethal ? { replyLethal: scaled(options.replyLethal, 30) } : {}),
    ...(options.lookahead === 2 && effort < 1 ? { lookahead: 1 as const } : {}),
  });
}

// ---- The expert fixes (2026-10) and the presets built on them ----

/**
 * The fixes' parameters: the pp1 evaluation (eval-pp.ts: maximum play points by the turns they matter, unused play points
 * by what they can still do, the non-active side's hand limit), the danger transform on it (danger.ts: the visible lethal
 * threat on the side attacked next), the end-phase Quick window's bonus (quick-window.ts: pp1's ppWaste per play point an
 * answer uses there), the conditional-Fanfare charge (conditional.ts, with the card table's gates) and the mulligan by
 * simulation (mulligan-sim.ts). Each was measured in paired games of the two-turn Medium against the same bot without it
 * (search width first, then pp1 with the window, then danger with the charge and the mulligan); the one-turn leaves'
 * form (leafPp1) was not, since those bots looked two turns ahead.
 */
export interface FixParams {
  pp1: Pp1Params;
  danger: DangerParams;
  cond: CondParams;
  sim: SimParams;
}

export const FIX_DEFAULTS: Readonly<FixParams> = { pp1: PP1_DEFAULTS, danger: DANGER_DEFAULTS, cond: { scope: "gates", penalty: COND_DEFAULTS.penalty }, sim: SIM_DEFAULTS };

/**
 * The leaves' pp1 for a bot that looks `lookahead` turns ahead (eval-pp.ts (b)). Two turns: the leaves are the opponent's
 * first main phase decision (planner.ts turnValue), where mainAsEnd changes only how the active opponent's freshly set PP
 * count, an offset: the measured form (mainAsEnd 1). One turn: the leaves are our own next main phase decision, after the
 * opponent's reply (planner.ts playReply), where our PP have just been refilled (CR 7.2.2) and are the same in every line;
 * read as the end of a turn (held), a Quick card kept in hand would earn (ppReserve + ppWaste) per play point of its cost
 * over the same card cast this turn, a bias towards holding it. So one turn ahead the leaves get the start form
 * (mainAsEnd 0), as the bot's own greedy does, which scores there too.
 */
function leafPp1(p: Pp1Params, lookahead: 1 | 2): Pp1Params {
  return lookahead === 1 ? pp1GreedyParams(p) : p;
}

/**
 * The planner options of the fixes for a bot looking `lookahead` turns ahead (default 2: the measured two-turn Medium).
 * Each evaluation in the form that scores where it is used (eval-pp.ts (b), danger.ts "mainAsEnd"): the beam
 * (`evaluator`) reads every plan as the end of the turn; the leaves (`replyEvaluator`: the opponent's first main phase
 * decision two turns ahead, our next one after a one-turn reply; also the Ward choices, scored at our next main phase)
 * and the bot's own greedy (`greedyEvaluator`: scored at the next main phase decision) read danger at the start of a main
 * phase; the greedy's pp1 too, and the leaves' one turn ahead (leafPp1). The mulligan by simulation scores its playouts'
 * ends with `replyEvaluator` (the opponent's first main phase after our t-th turn, mulligan-sim.ts): there both pp1 forms
 * differ only in the active opponent's PP, the same in nearly every line.
 */
export function fixOptions(p: FixParams = FIX_DEFAULTS, lookahead: 1 | 2 = 2): PlannerBotOptions {
  const start = dangerStartParams(p.danger);
  return {
    evaluator: danger(p.danger)(pp1Evaluator(p.pp1)),
    replyEvaluator: danger(start)(pp1Evaluator(leafPp1(p.pp1, lookahead))),
    greedyEvaluator: danger(start)(pp1Evaluator(pp1GreedyParams(p.pp1))),
    quickEndBonus: p.pp1.ppWaste,
    conditional: { scope: p.cond.scope, penalty: p.cond.penalty, ...(p.cond.scope === "gates" ? { gates: bundledGates } : {}) },
    mulligan: "sim",
    mulliganSim: { ...p.sim },
  };
}

/** The fixes' identities as the game records write them: every evaluation with every parameter, the charge, the mulligan. */
export function fixIdentities(p: FixParams = FIX_DEFAULTS, lookahead: 1 | 2 = 2): { eval: string; reply: string; greedy: string; cond: string; mull: string } {
  const start = dangerStartParams(p.danger);
  return {
    eval: `${pp1Identity(p.pp1)}+${dangerIdentity(p.danger)}`,
    reply: `${pp1Identity(leafPp1(p.pp1, lookahead))}+${dangerIdentity(start)}`,
    greedy: `${pp1Identity(pp1GreedyParams(p.pp1))}+${dangerIdentity(start)}+${quickIdentity(p.pp1.ppWaste)}`,
    cond: condIdentity(p.cond, p.cond.scope === "gates" ? bundledGates() : null),
    mull: simIdentity(p.sim),
  };
}

/** Medium (one turn, its search unchanged) with the fixes (the one-turn leaves). */
export const MEDIUM_NEXT: PlannerBotOptions = /* @__PURE__ */ withFixes(MEDIUM_OPTIONS, {});

/** Hard (cheating, two turns) with the fixes and the wider root search. */
export const HARD_NEXT: PlannerBotOptions = /* @__PURE__ */ withFixes(HARD_OPTIONS, { beamWidth: 12, maxSimulations: 1200 });

/**
 * The two-turn Medium of the measured games with every fix (fair): Medium with lookahead 2, 3 samples, the root beam 12
 * wide and 1200 answers per plan search.
 */
export const MEDIUM_V2: PlannerBotOptions = /* @__PURE__ */ withFixes(MEDIUM_OPTIONS, { lookahead: 2, samples: 3, beamWidth: 12, maxSimulations: 1200 });

/** A preset: a level's options, some of them set otherwise, and the fixes for its lookahead. */
function withFixes(level: PlannerBotOptions, changes: PlannerBotOptions): PlannerBotOptions {
  const options = { ...level, ...changes };
  return { ...options, ...fixOptions(FIX_DEFAULTS, lookaheadOf(options, 1)) };
}

/** How far a bot of these options looks at this effort (createBot's scaling: below 1, one turn). */
function lookaheadOf(options: PlannerBotOptions, effort: number): 1 | 2 {
  return options.lookahead === 2 && effort >= 1 ? 2 : 1;
}

/** The presets by name (not levels of createBot yet). */
export type BotPreset = "medium-next" | "hard-next" | "medium-v2";
export const BOT_PRESETS: readonly BotPreset[] = ["medium-next", "hard-next", "medium-v2"];
const PRESET_OPTIONS: Record<BotPreset, PlannerBotOptions> = { "medium-next": MEDIUM_NEXT, "hard-next": HARD_NEXT, "medium-v2": MEDIUM_V2 };

/**
 * A preset's options at an effort, before scaledPlanner scales its counts. At 1 the preset as it is. Below 1 (a slower
 * device): a two-turn preset looks one turn ahead (scaledPlanner) and gets the one-turn leaves (leafPp1), and the mulligan
 * by simulation plays fewer samples (k scaled by the effort, at least 2; its turns and models as they are), as the other
 * searches are scaled. The root beam's width is left as the preset sets it.
 */
function presetAt(preset: BotPreset, effort: number): PlannerBotOptions {
  const options = PRESET_OPTIONS[preset];
  if (effort >= 1) return options;
  const leaves = lookaheadOf(options, 1) === 2 ? { replyEvaluator: fixOptions(FIX_DEFAULTS, 1).replyEvaluator } : {};
  const sim = options.mulligan === "sim" ? { mulliganSim: scaledSim({ ...SIM_DEFAULTS, ...options.mulliganSim }, effort) } : {};
  return { ...options, ...leaves, ...sim };
}

/**
 * The mulligan by simulation's samples scaled by `effort` below 1 (at least 2, so its estimate keeps a spread); adaptive
 * samples' most (kmax, when a preset gives it: none does) scaled the same way, never below the scaled k.
 */
function scaledSim(sim: SimParams, effort: number): SimParams {
  if (effort >= 1) return sim;
  const k = Math.max(2, Math.min(sim.k, Math.round(sim.k * effort)));
  return sim.kmax === undefined ? { ...sim, k } : { ...sim, k, kmax: Math.max(k, Math.min(sim.kmax, Math.round(sim.kmax * effort))) };
}

/**
 * A bot of a preset at an effort: presetAt, then its searches scaled as createBot scales a level's (scaledPlanner: fewer
 * answers tried; below 1 one turn ahead). The presets take no other evaluation (createBot's `evaluation`): their fixes are
 * built on pp1 and danger in every form — the beam's, the leaves', their own greedy's with the end-phase bonus tuned to
 * pp1's ppWaste, the mulligan's self-model —, so a learned evaluation would need its own forms of each, not a swap of three.
 */
export function createPresetBot(engine: Engine, preset: BotPreset, seed: string, effort = 1): PlannerBot {
  return scaledPlanner(engine, presetAt(preset, effort), seed, effort, {});
}

/**
 * A preset's identities at an effort (fixIdentities): the leaves' form by how far it looks there, the mulligan's samples as
 * presetAt scales them. Not recorded: where the mulligan's samples come from — a fair bot's from setup-sample.ts, a cheating
 * one's (hard-next) from copies of the real game (PlannerBot) —, which the preset's name says.
 */
export function presetIdentities(preset: BotPreset, effort = 1): ReturnType<typeof fixIdentities> {
  const options = presetAt(preset, effort);
  const ids = fixIdentities(FIX_DEFAULTS, lookaheadOf(options, effort));
  return { ...ids, mull: simIdentity({ ...SIM_DEFAULTS, ...options.mulliganSim }) };
}
