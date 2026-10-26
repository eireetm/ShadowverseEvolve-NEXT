/**
 * The mulligan by simulation (PlannerBotOptions mulligan "sim"): play the first turns and compare.
 *
 * The rule (CR 6.2.1.7, 6.2.1.8). Each player draws four (6.2.1.7). The player going first may move ALL the cards of their
 * hand to the bottom of their deck in any order and draw the top four again; then the player going second may do the same;
 * each at most once (6.2.1.8). So the answer is one bit, keep or redraw the whole hand (there is no partial redraw), and the
 * order of the cards put at the bottom matters only once the deck is drawn down to them. There is no card disadvantage in
 * redrawing: the new hand has four cards too. What differs: the first player doesn't draw in their first turn (CR 7.2.4.1)
 * and the second player has 3 evolution points (6.2.1.10); the maximum play points grow by one each own turn (CR 7.2.1),
 * set as the play points at the start phase (7.2.2): turn t has t to spend. A player's own deck is a non-public zone whose
 * order nobody knows (CR 4.5.2, 4.1.2); its composition (the deck list minus the hand) is known.
 *
 * "sim": for each of k samples of the game as the bot knows it (a MulliganWorld: by default setup-sample.ts, the bot's deck
 * order and the opponent's hand and deck dealt again from what the bot can't see; its hand kept), the opening is played
 * twice from the same sample: once keeping, once redrawing (common random numbers: the same sample, the same model seeds,
 * so the difference is the hand's, not the deal's). In each, a greedy self-model (GreedyBot with the bot's own evaluation)
 * plays the bot's decisions and an opponent model the other player's ("passive": fast answers — it keeps, ends every main
 * phase at once, never uses a Quick window; "greedy": a GreedyBot with the bot's model evaluation, the hand-written one by
 * default, its own mulligan rule included), until the opponent's first main phase decision after the bot's t-th own turn —
 * the point the planner's two-turn leaves are scored at (planner.ts turnValue) — or the bot's next turn if the opponent's
 * turn had no main phase decision. There the position is scored as the planner scores its leaves, with its replyEvaluator.
 * The self-model decides as the planner hands its decisions out (planner.ts choose): those of our own main phase (the
 * planner's plans) by a greedy bot with the planner's evaluation, the form its beam scores with (every plan as if the turn
 * ended there: pp1 and danger with mainAsEnd 1), every other one (the opponent's turn, our start and end phases) by a
 * greedy bot with the evaluation of the planner's own greedy (the form that scores at the start or in the middle of a main
 * phase: mainAsEnd 0). One form for both would score a quick window in the opponent's turn as the end of the opponent's turn
 * (with danger: on the threat to the opponent instead of the threat to us). Not mirrored: the planner's two-turn search and
 * sure-lethal search (a greedy plays our main phases), the end-phase Quick bonus, the planner's Ward choices. Redraw when the
 * mean over the samples of (redraw − keep) is above margin. A game that ended before (practically never in three turns: 20
 * defense) counts ±FINISHED points instead of the evaluation's ±1,000,000, so one sample cannot outweigh the others by
 * orders of magnitude.
 *
 * Why it is principled: the question 6.2.1.8 asks is which of two lotteries is better — the known hand with unknown draws,
 * or an unknown hand from the same deck — and the samples estimate both expectations without bias, under the same
 * information the bot has, with the bot's own measure of a position; the opening turns are where a hand's cards decide what
 * a player can do with its play points (7.2.1), and the evaluation counts what the hand produced (board, damage, cards kept)
 * rather than a fixed reading of costs. What it can't see: what the cards are worth after turn t (a finisher kept is one
 * card in hand, as any other), the opponent's real plays (the models'), and noise (k samples: se in the outcome).
 * Fair: the world is the information set's sample; the models decide inside the sample (their own simulations are
 * determinized copies of it from its first main phase on); the bot's real deck order is never read. Deterministic: every
 * sample and model is seeded from the bot's seed and the decision's number (no clocks, no Math.random).
 * A cheating planner (Hard) plays the same openings in copies of the real game instead (PlannerBot: its world is the real
 * game, as for every plan it makes): the hands, both decks' order and the random results are the real ones, and the k
 * samples differ only by the models' seeds, so they average the models' own noise.
 * Defaults (SIM_DEFAULTS): k 8, t 3 own turns, margin 0, opp greedy, cand 32 (GreedyBot's own). Margin 0: the estimate is
 * unbiased and, over random hands, centred on 0 (a random hand is as good as a random redraw on average), so shrinking it
 * towards that centre never changes its sign — redraw when the redraw is expected better; near-ties cost little either
 * way (measured on the training decks with an independent 32-sample judge: the gain is flat for margins −0.5 … 0.5 and
 * falls beyond; k 16 adds about a tenth of what k 8 gains, for twice the time).
 *
 * Two parameters off unless given (none of the presets gives them). kmax: adaptive samples — after the first k, while the
 * mean difference is within z standard errors of 0 (|mean| < z·se: the samples can't tell the sign apart from the noise),
 * `step` more are played, numbered on from k (the first k are the same samples), up to kmax in all; the rule looks only at
 * the end of each batch, a few looks rather than one per sample. A close hand is where k samples decide by noise (the
 * estimate's se is of the size of the differences that matter); a clear one stops at k, so the time goes to the close ones.
 * tfirst: the horizon when the bot goes first (CR 6.2.1.6 is decided before the mulligan, 6.2.1.8), t otherwise — a longer
 * horizon sees a card whose turn comes after t (a ramp's payoff), at more noise per sample; on human openings 4 turns agreed
 * less than 3 with the players' own mulligans going first and not going second, so a longer one can be kept to the second
 * player.
 */
import type { Answer, Decision, Engine, GameEvent, GameSession, PlayerId } from "./core";
import type { Evaluator } from "./evaluate";
import { GreedyBot } from "./greedy";
import { fastAnswer, lookupFromReader } from "./policy";

/** A mulligan decision. */
export type MulliganDecision = Extract<Decision, { type: "mulligan" }>;

/**
 * A copy of the game as `viewer` knows it at their pending decision, also during the setup (setup-sample.ts): what the
 * viewer can't see dealt again (seeded by `seed`), the rest as it is.
 */
export type MulliganWorld = (session: GameSession, viewer: PlayerId, seed: string) => GameSession;

/** "sim"'s parameters. */
export interface SimParams {
  /** Samples of what the bot knows; each is played twice (keep, redraw). */
  k: number;
  /** The bot's own turns played before the position is scored. */
  t: number;
  /** Redraw when the redraw's mean beats keeping's by more than this (points of the bot's evaluation). */
  margin: number;
  /** The opponent model: fast answers ("passive") or a greedy bot ("greedy"). */
  opp: "passive" | "greedy";
  /** The most candidates the models compare per decision (GreedyBot maxCandidates; its default is 32). */
  cand: number;
  /** The horizon when the bot goes first (the header; not given: t). */
  tfirst?: number;
  /** Adaptive samples, up to this many in all (the header; not given, or at most k: off — k samples). */
  kmax?: number;
  /** Adaptive samples: more while |mean| < z standard errors (default SIM_ADAPTIVE.z). */
  z?: number;
  /** Adaptive samples: this many more at a time (default SIM_ADAPTIVE.step). */
  step?: number;
}

export const SIM_DEFAULTS: Readonly<SimParams> = { k: 8, t: 3, margin: 0, opp: "greedy", cand: 32 };
/** The parameters in their order (the identity's order), with the values each is taken in. */
export const SIM_KEYS: readonly (keyof SimParams)[] = ["k", "t", "margin", "opp", "cand"];
/** The parameters off unless given (the header), in the identity's order after SIM_KEYS. */
export const SIM_EXTRA_KEYS = ["tfirst", "kmax", "z", "step"] as const;
/** The adaptive samples' z and step when kmax is given without them: two standard errors, batches of 8 (k's default). */
export const SIM_ADAPTIVE: Readonly<{ z: number; step: number }> = { z: 2, step: 8 };
const SIM_RANGES = { k: [1, 64], t: [1, 10], margin: [-20, 20], cand: [1, 64] } as const;
const OPPONENTS: readonly SimParams["opp"][] = ["passive", "greedy"];

/** A finished game in a playout, in points (instead of exactResults' ±1,000,000). */
export const FINISHED = 100;
/** Most inputs one playout plays (the models stop their own loops: GreedyBot's per-turn caps). */
const MAX_INPUTS = 3000;

/** What is wrong with a parameter set (empty: nothing). */
export function simProblems(p: SimParams): string[] {
  const problems: string[] = [];
  for (const key of ["k", "t", "cand"] as const) {
    const v = p[key];
    if (!Number.isInteger(v) || v < SIM_RANGES[key][0] || v > SIM_RANGES[key][1]) problems.push(`${key}=${String(v)}: a whole number from ${SIM_RANGES[key][0]} to ${SIM_RANGES[key][1]}`);
  }
  if (typeof p.margin !== "number" || !Number.isFinite(p.margin) || p.margin < SIM_RANGES.margin[0] || p.margin > SIM_RANGES.margin[1]) problems.push(`margin=${String(p.margin)}: a number from ${SIM_RANGES.margin[0]} to ${SIM_RANGES.margin[1]}`);
  if (!OPPONENTS.includes(p.opp)) problems.push(`opp=${String(p.opp)}: ${OPPONENTS.join(" or ")}`);
  problems.push(...simExtraProblems(p));
  return problems;
}

/** What is wrong with the parameters off unless given (SIM_EXTRA_KEYS). */
export function simExtraProblems(p: Pick<SimParams, "k" | "tfirst" | "kmax" | "z" | "step">): string[] {
  const problems: string[] = [];
  const whole = (key: string, v: number | undefined, least: number, most: number) => {
    if (v !== undefined && (!Number.isInteger(v) || v < least || v > most)) problems.push(`${key}=${String(v)}: a whole number from ${least} to ${most}`);
  };
  whole("tfirst", p.tfirst, SIM_RANGES.t[0], SIM_RANGES.t[1]);
  // kmax at most k plays k samples (off); below k it would read as fewer samples, which k says.
  whole("kmax", p.kmax, Number.isInteger(p.k) ? p.k : SIM_RANGES.k[0], SIM_RANGES.k[1]);
  whole("step", p.step, 1, SIM_RANGES.k[1]);
  if (p.z !== undefined && (typeof p.z !== "number" || !Number.isFinite(p.z) || p.z <= 0 || p.z > 10)) problems.push(`z=${String(p.z)}: a number above 0, at most 10`);
  if (p.kmax === undefined && (p.z !== undefined || p.step !== undefined)) problems.push("z and step are the adaptive samples' (kmax=): not without kmax");
  return problems;
}

/** Whether the samples are adaptive (kmax above k), and how many at most (k when not). */
export function simSampleLimit(p: Pick<SimParams, "k" | "kmax">): number {
  return p.kmax !== undefined && p.kmax > p.k ? p.kmax : p.k;
}

/**
 * The mean of (redrawn − keep) over the samples played both ways, and its standard error (0 with fewer than two samples):
 * the rule's estimate.
 */
export function simEstimate(keep: readonly number[], redrawn: readonly number[]): { diff: number; se: number } {
  const diffs = keep.map((v, i) => redrawn[i]! - v);
  const n = diffs.length;
  if (n === 0) return { diff: 0, se: 0 };
  const diff = diffs.reduce((s, x) => s + x, 0) / n;
  return { diff, se: n > 1 ? Math.sqrt(diffs.reduce((s, x) => s + (x - diff) ** 2, 0) / (n - 1) / n) : 0 };
}

/**
 * Adaptive samples (the header): before sample `i` (0-based), whether to stop — at the end of each batch past the first k,
 * once the estimate is clear (|mean| ≥ z·se; with fewer than two samples se is 0: clear) or kmax is reached. Never before k.
 */
export function simStopsBefore(i: number, p: Pick<SimParams, "k" | "kmax" | "z" | "step">, keep: readonly number[], redrawn: readonly number[]): boolean {
  const limit = simSampleLimit(p);
  if (i >= limit) return true;
  if (i < p.k || (i - p.k) % (p.step ?? SIM_ADAPTIVE.step) !== 0) return false;
  const { diff, se } = simEstimate(keep, redrawn);
  return !(Math.abs(diff) < (p.z ?? SIM_ADAPTIVE.z) * se);
}

/** The bot's own turns played before scoring: tfirst when given and the bot goes first, t otherwise. */
export function simHorizon(p: Pick<SimParams, "t" | "tfirst">, goesFirst: boolean): number {
  return goesFirst && p.tfirst !== undefined ? p.tfirst : p.t;
}

/**
 * The rule's identity, every parameter written: "mull=sim:k=8,t=3,margin=0,opp=greedy,cand=32". The evaluations it scores
 * and plays with are the bot's own (its evaluator, greedyEvaluator, replyEvaluator, modelEvaluator), recorded with them.
 * The parameters off unless given are written only when they change something (simExtraIdentity), so the identity of a
 * rule without them is what it always was.
 */
export function simIdentity(p: SimParams): string {
  return `mull=sim:${SIM_KEYS.map((k) => `${k}=${String(p[k])}`).join(",")}${simExtraIdentity(p)}`;
}

/**
 * The identity's tail for the parameters off unless given: ",tfirst=<n>" when it differs from t, ",kmax=<n>,z=<z>,step=<n>"
 * when the samples are adaptive (kmax above k); "" otherwise.
 */
export function simExtraIdentity(p: Pick<SimParams, "k" | "t" | "tfirst" | "kmax" | "z" | "step">): string {
  const tfirst = p.tfirst !== undefined && p.tfirst !== p.t ? `,tfirst=${p.tfirst}` : "";
  const adaptive = simSampleLimit(p) > p.k ? `,kmax=${String(p.kmax)},z=${String(p.z ?? SIM_ADAPTIVE.z)},step=${String(p.step ?? SIM_ADAPTIVE.step)}` : "";
  return `${tfirst}${adaptive}`;
}

/** One opening played from a sample: the value where it was scored, the inputs, how it ended. */
export interface Playout {
  value: number;
  inputs: number;
  /** leaf: the opponent's main phase after our t-th turn (or our next turn); over: the game ended; cut: MAX_INPUTS. */
  ended: "leaf" | "over" | "cut";
  /** Our own turns started. */
  turns: number;
}

/** What "sim" found at one mulligan. */
export interface SimOutcome {
  redraw: boolean;
  /** Per sample played both ways (failed pairs left out): the value keeping, and redrawing. */
  keep: number[];
  redrawn: number[];
  /** Mean of (redrawn − keep), and its standard error (0 with fewer than two samples). */
  diff: number;
  se: number;
  /** Pairs that threw (an engine or model error, or no world): left out. */
  failures: number;
  /** The models' simulations (their GreedyBot stats) and the inputs played, over all samples. */
  simulations: number;
  inputs: number;
  /** Playouts that ended before the leaf (game over) or were cut. */
  over: number;
  cut: number;
  /** Our decisions in the playouts by the self-model's form: those of our main phase (the beam's), the others (the greedy's). */
  own: { main: number; other: number };
}

/** A player's model in a playout: an answer for its pending decision. */
export type Agent = (game: GameSession) => Answer;

/** A decision the planner plans itself (planner.ts choose: in its own main phase as the active player): its beam's form scores it. */
export const plansItself = (game: GameSession, me: PlayerId): boolean => game.state.activePlayer === me && game.state.phase === "main";

/**
 * Give `answer` (our mulligan) in `world` and play on — `self` for our decisions, `opp` for theirs — until the opponent's
 * first main phase decision after our t-th own turn (or our next turn, if theirs had none), and score it there.
 */
export function playOpening(world: GameSession, me: PlayerId, answer: Answer, t: number, self: Agent, opp: Agent, evaluator: Evaluator): Playout {
  let turns = 0;
  let past = false;
  const see = (events: readonly GameEvent[]) => {
    for (const e of events) {
      if (e.type !== "turnStarted") continue;
      if (e.player === me) turns += 1;
      else if (turns >= t) past = true;
    }
  };
  see(world.act(answer));
  let inputs = 1;
  let ended: Playout["ended"] = "leaf";
  for (;;) {
    const d = world.decision;
    if (world.result || !d) {
      ended = "over";
      break;
    }
    if (turns > t || (past && d.type === "mainPhase" && d.player !== me)) break;
    if (inputs >= MAX_INPUTS) {
      ended = "cut";
      break;
    }
    see(world.act(d.player === me ? self(world) : opp(world)));
    inputs += 1;
  }
  const result = world.result;
  const value = result ? (result.winner === me ? FINISHED : result.winner === null ? 0 : -FINISHED) : evaluator(world.view(me), me);
  return { value, inputs, ended, turns };
}

const passive: Agent = (game) => fastAnswer(game.decision!, lookupFromReader(game.reader()));

/** What sim needs from the bot: the world, its seed, its evaluations (its own; its models'), the engine. */
export interface SimContext {
  engine: Engine;
  world: MulliganWorld;
  /** The decision's seed: the samples and models are seeded from it. */
  seed: string;
  params: SimParams;
  /** The self-model's evaluation in our own main phase (the planner's evaluation: the form its beam scores with). */
  evaluator: Evaluator;
  /**
   * The self-model's evaluation for our other decisions (the evaluation of the planner's own greedy, which answers them:
   * the form that scores at the start or in the middle of a main phase); default: evaluator.
   */
  greedyEvaluator?: Evaluator;
  /** Where the playout stops, the position's score (the planner's replyEvaluator, its two-turn leaves'); default: evaluator. */
  leafEvaluator?: Evaluator;
  modelEvaluator: Evaluator;
}

/** "sim" at a mulligan decision of `game` (header): the samples, both ways, and the answer. */
export function simMulligan(game: GameSession, d: MulliganDecision, ctx: SimContext): SimOutcome {
  const me = d.player;
  const { margin, opp, cand } = ctx.params;
  // The horizon (tfirst when given and we go first: CR 6.2.1.6 was decided before this, 6.2.1.8).
  const t = simHorizon(ctx.params, game.state.firstPlayer === me);
  const keepAnswer: Answer = { type: "mulligan", redraw: false };
  // CR 6.2.1.8: any order at the bottom; it matters only once the deck is drawn down to them.
  const redrawAnswer: Answer = { type: "mulligan", redraw: true, bottomOrder: [...d.hand] };
  const out: SimOutcome = { redraw: false, keep: [], redrawn: [], diff: 0, se: 0, failures: 0, simulations: 0, inputs: 0, over: 0, cut: 0, own: { main: 0, other: 0 } };
  // k samples; with kmax (adaptive), more in batches while the estimate is close (simStopsBefore: never before k).
  for (let i = 0; !simStopsBefore(i, ctx.params, out.keep, out.redrawn); i++) {
    const seed = `${ctx.seed}:${i}`;
    // The same sample and the same model seeds both ways (common random numbers): the sample is built once (a world is
    // determined by the game, the viewer and the seed), keeping plays in a copy of it, redrawing in the sample itself.
    let sample: GameSession | null = null;
    try {
      sample = ctx.world(game, me, seed);
    } catch {
      sample = null;
    }
    const both = [keepAnswer, redrawAnswer].map((answer, way) => {
      // Our decisions as the planner hands them out (the header): its main phase plans, everything else its own greedy.
      const main = new GreedyBot(ctx.engine, { seed: `${seed}:self`, evaluator: ctx.evaluator, maxCandidates: cand });
      const other = new GreedyBot(ctx.engine, { seed: `${seed}:self-other`, evaluator: ctx.greedyEvaluator ?? ctx.evaluator, maxCandidates: cand });
      const self: Agent = (g) => (plansItself(g, me) ? main : other).decide(g);
      const model = opp === "greedy" ? new GreedyBot(ctx.engine, { seed: `${seed}:opp`, evaluator: ctx.modelEvaluator, maxCandidates: cand }) : null;
      try {
        if (sample === null) return null;
        const world = way === 0 ? sample.clone() : sample;
        const played = playOpening(world, me, answer, t, self, model ? (g) => model.decide(g) : passive, ctx.leafEvaluator ?? ctx.evaluator);
        return { played, sims: main.stats.simulations + other.stats.simulations + (model?.stats.simulations ?? 0), own: { main: main.stats.decisions, other: other.stats.decisions } };
      } catch {
        return null;
      }
    });
    const [kept, redrawn] = both;
    if (!kept || !redrawn) {
      out.failures += 1;
      continue;
    }
    for (const b of [kept, redrawn]) {
      out.simulations += b.sims;
      out.inputs += b.played.inputs;
      out.own.main += b.own.main;
      out.own.other += b.own.other;
      if (b.played.ended === "over") out.over += 1;
      if (b.played.ended === "cut") out.cut += 1;
    }
    out.keep.push(kept.played.value);
    out.redrawn.push(redrawn.played.value);
  }
  const { diff, se } = simEstimate(out.keep, out.redrawn);
  out.diff = diff;
  out.se = se;
  out.redraw = out.keep.length > 0 && out.diff > margin;
  return out;
}

/** What the rule did on one planner (PlannerBot mulliganStats). */
export interface MulliganStats {
  identity: string;
  mulligans: number;
  redraws: number;
  /** Decisions where every sample failed (answered by the planner's own greedy rule instead). */
  fallbacks: number;
  failures: number;
  simulations: number;
  inputs: number;
  /** The last outcome (null: none yet). */
  last: SimOutcome | null;
}
