/**
 * "pp1": the hand-written evaluation (evaluate.ts, DEFAULT_WEIGHTS) with three of its terms replaced for each side, as an
 * Evaluator the bots take (PlannerBotOptions evaluator / replyEvaluator / greedyEvaluator). The rest of the evaluation is
 * the hand-written one, unchanged:
 *
 *   value(view, me) = evaluate(view, me) + correction(mine) − correction(theirs)
 *   correction(side) = (new max-PP, unused-PP and hand terms) − (the same three terms as evaluate() counts them)
 *
 * (a) Maximum play points by the turns they will matter. evaluate() counts 0.5 per point up to 10; here the m-th point is
 *     worth v(m) = mppBase + mppSlope · (10 − m + 1). 11 − m is the number of the side's own turns from the one where the
 *     natural curve reaches m (CR 7.2.1: +1 each start phase) to the one where it reaches the cap 10 (CR 3.2.4.1), both
 *     counted: the turns in which a point m is there to spend. Defaults 0.2 and 0.3: v(3) = 0.2 + 8 · 0.3, v(5) = 2, v(10) = 0.5
 *     (the hand-written evaluation's 0.5 a point at the cap). As the value of a ramp it counts one turn too many: a point
 *     gained by an effect in the main phase raises only the maximum (play points are set to the maximum at the start phase,
 *     CR 7.2.2), so at the end of turn t the point gained (the m-th) pays from the next refill until the natural curve
 *     reaches 10, which is 10 − m own turns. The formula is kept as it was measured; read mppSlope's one extra turn as part
 *     of the point's weight.
 * (b) Unused play points. evaluate() counts 0.1 per point anywhere. Here they count by what they can still do: they stay
 *     until the side's next start phase sets them to its maximum (CR 7.2.2), and outside the side's own main phase only Quick
 *     can spend them — after an opponent's follower attacked, or in the opponent's end phase (CR 12.3.4, 7.4.5).
 *     - "spendable": the side is active, before its main phase (the game's setup, CR 6.2; its start phase, CR 7.2):
 *       ppSpendable each, a tie-break so that a useless action is not preferred.
 *     - "held": the side is active in its main phase (mainAsEnd = 1, the default; see below) or past it (its end phase), or
 *       it is the other player's turn before that turn's end phase: the PP its visible Quick cards could use (the reserve,
 *       quickReserve) ppReserve each, the rest (wasted when the refill comes) −ppWaste each.
 *     - "lost": the other player's end phase. Exact once its Quick window has closed (CR 7.4.5, repeated by 7.4.6): it is the
 *       last one before this side's start phase (7.4.7–7.4.9 hold none), so no reserve, every unused point −ppWaste. The
 *       view only says "end phase", so a view at 7.4.1–7.4.4 (end-phase triggers, Ward engaging), before that window, is
 *       scored the same though the window is still to come. The bots never score there (the greedy bot plays on to the
 *       next main phase decision before it scores, greedy.ts simulate; the planner's nodes and leaves are main phase
 *       decisions): this case is for direct calls.
 *     The active side's main phase (mainAsEnd). The evaluator cannot tell a finished plan's position (the planner's beam
 *     scores every plan "as if the turn ended there", planner.ts beam / node) from the start or the middle of a turn: all are
 *     the active player's main phase decisions. With mainAsEnd = 1 they are scored as the end of the turn (held): a partial
 *     plan that leaves PP unspent is not yet better than spending them, and the finished plans, which the search ranks and
 *     the two-turn comparison starts from, are scored where they really end. The cost is at the start of a main phase:
 *     - The two-turn search's leaves are at the opponent's first main phase decision (planner.ts turnValue): the opponent's
 *       freshly set PP count as wasted (its reserve is from the cards we see: its EX area, mostly nothing). Its maximum is
 *       the same in every line of a decision, so that is an offset.
 *     - Not an offset: a greedy bot's answer outside its main phase is scored at the next main phase decision (greedy.ts
 *       simulate). For a quick window in the opponent's end phase (CR 7.4.5) that is our own next main phase, after the
 *       refill (CR 7.2.2): a Quick card kept in hand would earn reserve credit there, (ppReserve + ppWaste) · its cost more
 *       than casting it at the last window those PP had — a bias towards passing. So the planner's own greedy bot (its
 *       decisions outside its main phase) gets this evaluation with mainAsEnd = 0 (pp1GreedyParams, PlannerBotOptions
 *       greedyEvaluator): it only ever scores at the start of a main phase, or in the middle of the opponent's one, where
 *       the opponent's PP are the same for every answer. With mainAsEnd = 0 our refilled PP are the same for every answer,
 *       so the PP term is neutral there, as in the hand-written evaluation: pp1 does not reward the cast either (that needs
 *       the window scored before the refill, a change in how the decision is made, not in the evaluation: GreedyBotOptions
 *       endPhaseQuickBonus). A greedy model given pp1 plays its own main phases too (where 1 is right).
 *     mainAsEnd = 0 treats the active main phase as spendable everywhere (a variant to compare).
 *     The opponent's hand is hidden from us: its reserve is computed from the cards we see (none, mostly), so its unused PP
 *     in our turn count as wasted; that too is about the same in every line of a decision.
 *     In the two-turn bots (lookahead 2) the final choice compares the leaves, where this turn's PP have been refilled
 *     (CR 7.2.2) twice: this turn's reserve and waste, and the end-of-turn value of a ramp, only decide which plans become
 *     the candidates (replyPlans); at the leaves a point gained this turn is worth v(m + 2) (the natural point of the next
 *     turn's refill comes first) and this turn's unused PP not at all.
 * (c) The hand limit. evaluate() counts at most handCap (7) cards. The limit is applied at the active player's own end
 *     phase (CR 7.4.7, the limit of CR 4.7.3.1), so the non-active side's cards above 7 are still there for a whole turn:
 *     they count up to handCapOther (9). The active side keeps the cap (its discard is the next one). That is right at the
 *     end of its turn; at the start of its main phase (after the draw, CR 7.2.4: the greedy's scoring point, the opponent at
 *     the leaves) an 8th card can still be played before the discard yet counts nothing, as in the hand-written evaluation.
 *
 * Constant offsets between the sides cancel within a decision: every position a bot compares at one decision has the same
 * players, and a term that is the same in all of them (e.g. the opponent's maximum PP, or its freshly set PP at a leaf)
 * moves every value by the same amount, so it changes no choice.
 */
import { opponentOf, type PlayerId, type PlayerSideView, type PlayerView } from "./core";
import { DEFAULT_WEIGHTS, evaluate, type Evaluator } from "./evaluate";

/** The name of this evaluation; its identity is the name with every parameter (pp1Identity). */
export const PP1_NAME = "pp1";

export interface Pp1Params {
  /** v(m) = mppBase + mppSlope · (10 − m + 1): the m-th point of maximum PP (a). */
  mppBase: number;
  mppSlope: number;
  /** Per unused PP that a visible Quick card in hand or EX area could use outside the side's main phase (b). */
  ppReserve: number;
  /** Per unused PP that nothing can use before the side's refill: subtracted (b). */
  ppWaste: number;
  /** Per unused PP the active side can still spend in its own main phase (b). */
  ppSpendable: number;
  /** The most cards the non-active side's hand counts (c); the active side counts DEFAULT_WEIGHTS.handCap. */
  handCapOther: number;
  /** 1: the active side's main phase is scored as the end of its turn (held); 0: as spendable (b). */
  mainAsEnd: number;
}

export const PP1_DEFAULTS: Readonly<Pp1Params> = { mppBase: 0.2, mppSlope: 0.3, ppReserve: 0.2, ppWaste: 0.25, ppSpendable: 0.05, handCapOther: 9, mainAsEnd: 1 };

/** The parameters in their order (the identity's order). */
export const PP1_KEYS: readonly (keyof Pp1Params)[] = ["mppBase", "mppSlope", "ppReserve", "ppWaste", "ppSpendable", "handCapOther", "mainAsEnd"];

/** What is wrong with a parameter set (empty: nothing): every value finite, the weights 0–10, the caps whole numbers. */
export function pp1Problems(p: Pp1Params): string[] {
  const problems: string[] = [];
  for (const key of PP1_KEYS) {
    const v = p[key];
    if (typeof v !== "number" || !Number.isFinite(v)) problems.push(`${key} isn't a number`);
  }
  if (problems.length) return problems;
  for (const key of ["mppBase", "mppSlope", "ppReserve", "ppWaste", "ppSpendable"] as const) if (p[key] < 0 || p[key] > 10) problems.push(`${key}=${p[key]}: from 0 to 10`);
  if (!Number.isInteger(p.handCapOther) || p.handCapOther < DEFAULT_WEIGHTS.handCap || p.handCapOther > 20) problems.push(`handCapOther=${p.handCapOther}: a whole number from ${DEFAULT_WEIGHTS.handCap} to 20`);
  if (p.mainAsEnd !== 0 && p.mainAsEnd !== 1) problems.push(`mainAsEnd=${p.mainAsEnd}: 0 or 1`);
  return problems;
}

/**
 * The parameters for the planner's own greedy bot (its decisions outside its main phase): the same with mainAsEnd = 0. The
 * greedy scores an answer at the next main phase decision (greedy.ts simulate), which for those decisions is the start of
 * a main phase or the middle of the opponent's (never the end of the active side's turn): see (b) above.
 */
export function pp1GreedyParams(p: Pp1Params): Pp1Params {
  return { ...p, mainAsEnd: 0 };
}

/** "pp1:mppBase=0.2,mppSlope=0.3,...": the name and every parameter, in PP1_KEYS order (numbers as JavaScript prints them). */
export function pp1Identity(p: Pp1Params): string {
  return `${PP1_NAME}:${PP1_KEYS.map((k) => `${k}=${String(p[k])}`).join(",")}`;
}

/** Σ v(m) for m = 1 … min(maxPP, 10) in closed form (a; CR 3.2.4.1: at most 10, at least 0). */
export function maxPpValue(maxPlayPoints: number, p: Pp1Params): number {
  const m = Math.max(0, Math.min(maxPlayPoints, 10));
  return m * p.mppBase + p.mppSlope * (11 * m - (m * (m + 1)) / 2);
}

/**
 * The most play points a side's visible Quick cards could use together within `unused` (a subset sum over their costs):
 * the cards with the standalone Quick keyword (CR 12.3.2) in its hand and EX area (CR 7.4.5 plays them from either), whose
 * cost the viewer sees. Cards it can't see (the opponent's hand) and Quick activated abilities (CR 12.3.3, not a keyword of
 * the card) are not counted; whether a card has a target is not checked either.
 */
export function quickReserve(side: PlayerSideView, unused: number): number {
  // Play points are at most the maximum, at most 10 (CR 3.2.4.1, 3.2.4.2); the bound only keeps the table small.
  const cap = Math.max(0, Math.min(Math.floor(unused), 100));
  if (cap === 0) return 0;
  // can[k]: some set of the cards costs k in all (each card once).
  const can: boolean[] = Array.from({ length: cap + 1 }, (_, k) => k === 0);
  for (const card of [...side.hand, ...side.ex]) {
    if (card.hidden || card.cost === null || card.cost <= 0 || card.cost > cap || !card.keywords.includes("quick")) continue;
    for (let k = cap; k >= card.cost; k--) if (can[k - card.cost]) can[k] = true;
  }
  for (let k = cap; k > 0; k--) if (can[k]) return k;
  return 0;
}

/** How a side's unused play points count in this view (b). */
export type PpMode = "spendable" | "held" | "lost";

/** The reading of (b): spendable before the active side's main phase (or in it with mainAsEnd 0), lost in the other's end phase. */
export function ppMode(view: PlayerView, side: PlayerId, p: Pp1Params): PpMode {
  if (view.activePlayer === side) {
    if (view.phase === "setup" || view.phase === "start") return "spendable";
    if (view.phase === "main") return p.mainAsEnd === 1 ? "held" : "spendable";
    return "held";
  }
  return view.phase === "end" ? "lost" : "held";
}

/** One side's three terms, the old (as evaluate() counts them) and the new (a, b, c), and what they were worked out from. */
export interface Pp1Parts {
  side: PlayerId;
  mode: PpMode;
  unused: number;
  reserve: number;
  handCap: number;
  old: { maxPp: number; pp: number; hand: number };
  now: { maxPp: number; pp: number; hand: number };
  /** (now − old) summed: what pp1 adds to this side's value. */
  correction: number;
}

/** A side's terms in a view (a, b, c) and the correction pp1 makes to its value. */
export function pp1Parts(view: PlayerView, side: PlayerId, p: Pp1Params = PP1_DEFAULTS): Pp1Parts {
  const s = view.players[side];
  const w = DEFAULT_WEIGHTS;
  const mode = ppMode(view, side, p);
  const unused = Math.max(0, s.playPoints);
  const reserve = mode === "held" ? quickReserve(s, unused) : 0;
  const handCap = view.activePlayer === side ? w.handCap : p.handCapOther;
  // The same three terms as evaluate.ts sideValue.
  const old = { maxPp: Math.min(s.maxPlayPoints, 10) * w.maxPlayPoint, pp: s.playPoints * w.playPoint, hand: Math.min(s.hand.length, w.handCap) * w.hand };
  const pp = mode === "spendable" ? unused * p.ppSpendable : mode === "held" ? reserve * p.ppReserve - (unused - reserve) * p.ppWaste : -unused * p.ppWaste;
  const now = { maxPp: maxPpValue(s.maxPlayPoints, p), pp, hand: Math.min(s.hand.length, handCap) * w.hand };
  const correction = now.maxPp - old.maxPp + (now.pp - old.pp) + (now.hand - old.hand);
  return { side, mode, unused, reserve, handCap, old, now, correction };
}

/**
 * The pp1 evaluation with these parameters (refused with every problem when they are wrong). A finished game is the
 * hand-written evaluation's (won, lost, drawn), as the bots score it anyway (exactResults).
 */
export function pp1Evaluator(params: Pp1Params = PP1_DEFAULTS): Evaluator {
  const problems = pp1Problems(params);
  if (problems.length) throw new Error(`pp1: ${problems.join("; ")}`);
  const p: Pp1Params = { ...params };
  return (view, me) => {
    const base = evaluate(view, me);
    if (view.result) return base;
    return base + pp1Parts(view, me, p).correction - pp1Parts(view, opponentOf(me), p).correction;
  };
}
