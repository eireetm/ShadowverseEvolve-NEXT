/**
 * "danger": an evaluation transform (danger(params)(base), for pp1 or any Evaluator) that values each leader against the
 * attack the other side's board can make on it in the turn that comes next, before the defender has a turn of its own:
 *
 *   value(view, me) = base(view, me) − W · chance(threat on me) + W · chance(threat on the opponent)
 *   chance(threat) = σ((offset − margin) / scale),  margin = the defender's leader defense − the visible potential
 *
 * where σ is the logistic function and W the weight (a chance at or below `floor` counts as none, lossChance). Only the
 * side that is attacked next is threatened (the immediate threat); the other side's threat, which comes after the
 * defender's own turn (it can remove attackers, add Ward, heal or win first), counts `delayed` times (default 0: the search
 * plays that turn; the evaluation's board terms value the board).
 *
 * The visible potential (leaderDamage): the most damage the attacker's followers can deal to the defending leader in that
 * turn, by the rules, from what both players see:
 *   - Attackers. An attacking follower must be reserved (CR 8.4.2) and it is engaged by attacking (8.4.4), so each attacks
 *     once; it can attack the leader only if it has been on the field since the start of the turn (8.4.2.1, 8.4.3.1) or
 *     has Storm (12.9.2; that Storm lifts 8.4.3.1's leader restriction too is the play guide's reading, as the engine
 *     implements it). One that may attack only followers (Rush, 12.10.2; put onto the field this turn and evolved, 8.4.2.1)
 *     exists only in the "now" reading, and is counted there like the others (the view doesn't say when a follower
 *     entered: see the limits).
 *       "next" — the attacker is the non-active player, its turn is next: its start phase refreshes all its cards (7.2.3) but
 *                not a Boxed one (5.31.3), and every follower on its field now has been there since the start of that
 *                turn: all its followers attack, except a Boxed one that is engaged.
 *       "now"  — the attacker is the active player in its main phase (its start or middle): its reserved followers attack
 *                (8.4.2); one played this turn without Storm is counted too (the view can't tell, see the limits).
 *   - Each attack deals damage equal to the attacker's attack (8.4.9; 5.14.1). No blockers: a follower can be attacked only
 *     when engaged (8.4.3.1), and protects its leader only by Ward: while the defender has an engaged Ward follower that can
 *     be selected, every attack must select one (12.8.2 (iii)); one with Intimidate can't be selected (12.12.2), so it does
 *     not force anything. A reserved Ward follower doesn't restrict (Ward is not in effect then; the engine reads 12.8.2
 *     (iii) so): the Ward followers that absorb are
 *       "next" (the defender is the active player, ending its turn) — all of them: the reserved ones it can still engage in
 *                its end phase (7.4.3, 12.8.2 (ii)), the engaged ones stay engaged until its own next start phase (7.2.3);
 *       "now"  (the defender is the non-active player) — its engaged ones (it engages its Ward followers in its own turn
 *                only; 12.8.2 (i) on entry is a hidden card).
 *     A Ward follower is destroyed when the damage it took reaches its defense (5.14.1, 11.3.1; the view's defense is after
 *     damage, CR 2.8.2), or after fighting a Bane follower (12.14.2, 11.3.2; they fight even if the attacker dies in the
 *     same combat, 8.4.9.1–8.4.9.2). The attacker chooses who breaks which Ward follower and goes for the leader with the
 *     rest (the targets are chosen attack by attack, so it breaks the Ward followers first): the potential is the best such
 *     assignment, exactly (every assignment tried, at most 6^5 with the field's limit of 5 cards, CR 4.4.4.1; pruned).
 *     While a Ward follower stays, no attack reaches the leader: then the potential is 0.
 * A margin of 0 or less is a lethal attack on the board (11.2.1: a leader at 0 defense or less loses).
 *
 * Why a logistic in the margin. What the view can't show decides whether a threat lands: the attacker's hand (a Storm
 * follower, a spell that deals damage, an evolution's extra attack, 8.3.2.1: one per turn), the defender's answers (a Quick
 * card in the attack's window, 8.4.7, or in the end phase, 7.4.5) and the players' choices. As a model, the attacker's net
 * hidden damage (its extra damage minus what the defender's answers take away) is a logistic variable with location
 * `offset` and spread `scale`; the threat lands when that variable is at least the margin: chance = σ((offset − margin) /
 * scale). So a lethal attack on the board (margin ≤ 0) is near sure but never certain, a margin of a few points is a real
 * danger, and a margin past offset + 4 · scale is close to nothing; with the floor (a chance of 1 in 1000 or less counts as
 * none: past offset + ln 999 · scale) the transform leaves positions far from lethal exactly as the base scores them, ties
 * too. W is what a landed threat costs in the evaluation's points (a leader defense point is 1, a follower about its attack
 * plus 0.6 per defense): the game, against what the plans that ignore the threat gain (face damage, the followers kept); it
 * must be larger than that and still be a position's value, not a proven result (exactResults keeps those). The chance
 * rises below 0 too (deeper lethal: fewer of the defender's answers are enough), which also gives the beam a slope while a
 * board is cleared one follower at a time.
 *
 * The turn position (mainAsEnd). The view can't tell the start of a main phase from its end (pp1 has the same problem,
 * eval-pp.ts (b)); which side is attacked next depends on it:
 *   mainAsEnd = 1 — the active player's main phase is read as the end of its turn (the planner's beam scores every plan
 *     as if the turn ended there, planner.ts beam / node): the non-active player attacks next ("next"), the active one is
 *     the defender. For the planner's `evaluator`.
 *   mainAsEnd = 0 — read as its start or middle: the active player attacks now ("now"), the non-active one defends. For the
 *     planner's `replyEvaluator` (the two-turn leaves are the opponent's first main phase decision, turnValue; the
 *     one-turn replies and the Ward choices are scored at our next main phase, playReply) and for the planner's own greedy
 *     (it scores at the next main phase decision, greedy.ts simulate: the start of a turn, or the middle of the opponent's).
 *   The end phase is always "next" (the attacker is the next player); the start phase is "now" with the refresh to come
 *   (7.2.3): every follower except an engaged Boxed one; setup (before the first turn, 6.2) has no threat.
 *
 * Compared with the beta's leaderCurve (evaluate.ts, levels.ts MEDIUM_BETA_OPTIONS: the defense lowered by `threat` (0.5)
 * times the attack of all the other side's followers, then valued on a curve): that is a smooth reweighting of the
 * leader's defense, linear in the attack, for both sides in every view whoever moves next, with every follower counted
 * (in the middle of a turn also those that already attacked, and as if no Ward follower stood in the way), and it
 * replaces the leader terms everywhere (pp1 is built on the default ones). This one is zero far from lethal, so it
 * changes no decision there; it counts only the damage the rules let reach the leader in the turn that comes next, and
 * only for the side that faces it; and it is steep at the margin that decides the game, where the curve is not (a board
 * one point short of lethal and a lethal one differ there by half a point of defense, about a point at 7; here by
 * 30 · (0.66 − 0.50) points).
 *
 * Limits. Hidden cards are left to the offset (the attacker's hand, our Quick answers, the evolve deck's extra attack, a
 * card that will enter). The view doesn't say when a follower entered or what it can't do: in the "now" reading a follower
 * played this turn without Storm is counted as an attacker (mid-turn only: at the start of a main phase every follower on
 * the field was there before the turn, unless the start phase put it there), and "can't attack" / "can't attack leaders"
 * texts, "ignores Ward" (BP04-006), attack damage from defense (BP01-129/130), damage modifiers (5.14.2) and "until the end
 * of the turn" changes that end before the attack (7.4.8) are not seen. The base evaluation's own leader terms
 * (leaderDanger below dangerLine) stay; this is added to them.
 */
import { opponentOf, type CardView, type HiddenCardView, type PlayerId, type PlayerSideView, type PlayerView } from "./core";
import type { Evaluator } from "./evaluate";

/** The name of this transform; its identity is the name with every parameter (dangerIdentity). */
export const DANGER_NAME = "danger";

export interface DangerParams {
  /** W: what a threat that lands costs, in the evaluation's points (a leader defense point is 1). */
  weight: number;
  /** The net hidden damage's location: the margin at which a threat lands half the time. */
  offset: number;
  /** Its spread (points of damage): how fast the chance falls with the margin. Above 0. */
  scale: number;
  /**
   * A chance at or below this counts as none: chance = max(0, σ − floor) / (1 − floor), continuous, and exactly 0 far from
   * lethal, so that there the base's values, and its ties, are left as they were (0: no floor; below 0.5).
   */
  floor: number;
  /** The share counted of the threat to the side that has a turn before it is attacked (0: none; at most 1). */
  delayed: number;
  /** 1: the active player's main phase is read as the end of its turn (the planner's evaluator); 0: as its start or middle. */
  mainAsEnd: number;
}

/**
 * The defaults (DANGER_DEFAULTS below). offset 1 and the scale: half the time the hidden cards find one point beyond the
 * board (an evolution's +1 or +2, a burn spell, a Storm follower, less the defender's answers); with the floor the chance is
 * all but 1 at margin −8, 0.66 at 0, 0.50 at 1, 0.34 at 2, 0.12 at 4, 0.033 at 6, 0.008 at 8, 0.0015 at 10 and 0 from
 * offset + scale · ln 999 on (a margin a little above 11). weight 30: a plan that turns a near-sure loss into a coin flip
 * (margin −8 to 1) gains 15 points, more than a turn's usual gain in material or face damage (14 face damage on a leader at
 * 15 against two followers cleared is a little above 12 points of pp1 for the face; weights 20 and 24 lost that comparison
 * in some samples), and a lethal board on us (30 points) is still a position's value, far below a proven result
 * (exactResults: 10^6). W times the chances at those margins: 29.93, 19.81, 15, 10.157, 3.549, 1.004, 0.25, 0.04, 0.
 */
export const DANGER_DEFAULTS: Readonly<DangerParams> = { weight: 30, offset: 1, scale: 1.5, floor: 0.001, delayed: 0, mainAsEnd: 1 };

/** The parameters in their order (the identity's order). */
export const DANGER_KEYS: readonly (keyof DangerParams)[] = ["weight", "offset", "scale", "floor", "delayed", "mainAsEnd"];

/** What is wrong with a parameter set (empty: nothing). */
export function dangerProblems(p: DangerParams): string[] {
  const problems: string[] = [];
  for (const key of DANGER_KEYS) {
    const v = p[key];
    if (typeof v !== "number" || !Number.isFinite(v)) problems.push(`${key} isn't a number`);
  }
  if (problems.length) return problems;
  if (p.weight < 0 || p.weight > 1000) problems.push(`weight=${p.weight}: from 0 to 1000 (a position's value, not a proven result)`);
  if (p.offset < -20 || p.offset > 20) problems.push(`offset=${p.offset}: from -20 to 20`);
  if (p.scale < 0.05 || p.scale > 20) problems.push(`scale=${p.scale}: from 0.05 to 20`);
  if (p.floor < 0 || p.floor >= 0.5) problems.push(`floor=${p.floor}: from 0 to below 0.5`);
  if (p.delayed < 0 || p.delayed > 1) problems.push(`delayed=${p.delayed}: from 0 to 1`);
  if (p.mainAsEnd !== 0 && p.mainAsEnd !== 1) problems.push(`mainAsEnd=${p.mainAsEnd}: 0 or 1`);
  return problems;
}

/** "danger:weight=30,offset=1,scale=...,mainAsEnd=1": the name and every parameter, in DANGER_KEYS order. */
export function dangerIdentity(p: DangerParams): string {
  return `${DANGER_NAME}:${DANGER_KEYS.map((k) => `${k}=${String(p[k])}`).join(",")}`;
}

/**
 * The same parameters read at the start or the middle of a main phase (mainAsEnd 0): for the planner's replyEvaluator and
 * its own greedy bot, which score where a turn starts or goes on (see the header).
 */
export function dangerStartParams(p: DangerParams): DangerParams {
  return { ...p, mainAsEnd: 0 };
}

/** The logistic function, without overflow. */
function sigmoid(x: number): number {
  if (x >= 0) return 1 / (1 + Math.exp(-x));
  const e = Math.exp(x);
  return e / (1 + e);
}

/**
 * The chance that a threat with this margin (defense − visible potential) lands: σ((offset − margin) / scale), less the
 * floor (rescaled so that it still reaches 1; 0 at or below the floor).
 */
export function lossChance(margin: number, p: DangerParams): number {
  return Math.max(0, sigmoid((p.offset - margin) / p.scale) - p.floor) / (1 - p.floor);
}

/** A follower that can attack the leader in the threat's turn. */
export interface Attacker {
  id: string;
  attack: number;
  /** Bane: it destroys the Ward follower it fights whatever the damage (CR 12.14.2, 11.3.2). */
  bane: boolean;
}

/** A Ward follower that every attack must select while it stands (CR 12.8.2 (iii)), with its defense after damage. */
export interface WardBlock {
  id: string;
  defense: number;
}

/**
 * The most damage these attackers can deal to the leader past these Ward followers (CR 8.4.3.1, 8.4.9, 12.8.2 (iii)): every
 * assignment of the attackers to the leader or to a Ward follower tried, one that leaves a Ward follower standing deals the
 * leader nothing (while one stands every attack must select one). A Ward follower falls when the attack assigned to it
 * reaches its defense (5.14.1, 11.3.1) or a Bane attacker fights it (12.14.2, 11.3.2). At most (wards + 1)^attackers
 * assignments (the field holds 5 cards, 4.4.4.1); bounded by the attack still unassigned.
 */
export function leaderDamage(attackers: readonly Attacker[], wards: readonly WardBlock[]): number {
  const strike = attackers.map((a) => ({ attack: Math.max(0, a.attack), bane: a.bane })).sort((a, b) => b.attack - a.attack);
  const total = strike.reduce((s, a) => s + a.attack, 0);
  const left = wards.map((w) => w.defense).filter((d) => d > 0);
  if (left.length === 0) return total;
  let best = 0;
  let standing = left.length;
  const go = (i: number, face: number, rest: number): void => {
    // Nothing better is possible below this one (the rest all to the leader at most).
    if (face + rest <= best) return;
    if (i === strike.length) {
      if (standing === 0) best = face;
      return;
    }
    const a = strike[i]!;
    go(i + 1, face + a.attack, rest - a.attack);
    for (let j = 0; j < left.length; j++) {
      const before = left[j]!;
      if (before <= 0) continue;
      left[j] = a.bane ? 0 : before - a.attack;
      if (left[j]! <= 0) standing -= 1;
      go(i + 1, face, rest - a.attack);
      if (left[j]! <= 0) standing += 1;
      left[j] = before;
    }
  };
  go(0, 0, total);
  return best;
}

/** When the threat comes: the attacker's turn is next, it is the attacker's turn now, or after the defender's own turn. */
export type ThreatWhen = "next" | "now" | "later";

/** One leader's threat in a view, what it was worked out from, and what it is worth. */
export interface Threat {
  attacker: PlayerId;
  defender: PlayerId;
  when: ThreatWhen;
  attackers: Attacker[];
  wards: WardBlock[];
  /** The most damage that can reach the defender's leader (leaderDamage). */
  potential: number;
  defense: number;
  margin: number;
  chance: number;
  /** 1 for the immediate threat, `delayed` for the later one. */
  share: number;
  /** W · chance · share: what the defender loses (and the attacker gains) in the evaluation. */
  penalty: number;
}

const isFollower = (c: CardView | HiddenCardView): c is CardView => !c.hidden && c.type === "follower";

/**
 * The attacker's followers that can attack the leader: "now", its reserved followers (CR 8.4.2; in its start phase, before
 * the refresh of 7.2.3: all but an engaged Boxed one); "next" and "later", all its followers but an engaged Boxed one (its
 * start phase refreshes the rest, 7.2.3, 5.31.3; all have been on the field since that turn's start, 8.4.2.1, 8.4.3.1).
 */
function attackersOf(side: PlayerSideView, when: ThreatWhen, refreshAhead: boolean): Attacker[] {
  const out: Attacker[] = [];
  for (const c of side.field) {
    if (!isFollower(c)) continue;
    const able = when === "now" && !refreshAhead ? !c.engaged : !(c.engaged && c.boxed);
    if (able) out.push({ id: c.id, attack: Math.max(0, c.attack ?? 0), bane: c.keywords.includes("bane") });
  }
  return out;
}

/**
 * The defender's Ward followers that will be engaged and selectable in the threat's turn (CR 12.8.2 (iii), 12.12.2): "now",
 * its engaged ones; "next" and "later", all of them (7.4.3 / 12.8.2 (ii): it may engage the reserved ones in its end phase).
 */
function wardsOf(side: PlayerSideView, when: ThreatWhen): WardBlock[] {
  const out: WardBlock[] = [];
  for (const c of side.field) {
    if (!isFollower(c) || !c.keywords.includes("ward") || c.keywords.includes("intimidate")) continue;
    if (when === "now" && !c.engaged) continue;
    out.push({ id: c.id, defense: Math.max(0, c.defense ?? 0) });
  }
  return out;
}

/** The threat `attacker` makes on the other leader in this view (CR 8.4.2, 12.8.2 (iii)), worth W · chance · share. */
function threatOf(view: PlayerView, attacker: PlayerId, when: ThreatWhen, share: number, p: DangerParams): Threat {
  const defender = opponentOf(attacker);
  const attackers = attackersOf(view.players[attacker], when, view.phase === "start");
  const wards = wardsOf(view.players[defender], when);
  const potential = leaderDamage(attackers, wards);
  const defense = view.players[defender].leaderDefense;
  const margin = defense - potential;
  const chance = lossChance(margin, p);
  return { attacker, defender, when, attackers, wards, potential, defense, margin, chance, share, penalty: p.weight * chance * share };
}

/**
 * The threats of a view: the immediate one (the side attacked next), and the later one when `delayed` > 0. Which side is
 * attacked next (the header): in the end phase, or in the main phase read as the end of the turn (mainAsEnd 1), the
 * non-active player's turn is next; in the main phase read as its start or middle (mainAsEnd 0), or the start phase, the
 * active player is attacking now. Setup (6.2) and a finished game: none.
 */
export function threats(view: PlayerView, p: DangerParams = DANGER_DEFAULTS): Threat[] {
  if (view.result || view.phase === "setup" || view.phase === "over") return [];
  const active = view.activePlayer;
  const ending = view.phase === "end" || (view.phase === "main" && p.mainAsEnd === 1);
  const out: Threat[] = [];
  if (ending) {
    out.push(threatOf(view, opponentOf(active), "next", 1, p));
    if (p.delayed > 0) out.push(threatOf(view, active, "later", p.delayed, p));
  } else {
    out.push(threatOf(view, active, "now", 1, p));
    if (p.delayed > 0) out.push(threatOf(view, opponentOf(active), "later", p.delayed, p));
  }
  return out;
}

/** What the threats add to `me`'s value: the attacker's gain is the defender's loss. */
export function dangerTerm(view: PlayerView, me: PlayerId, p: DangerParams = DANGER_DEFAULTS): number {
  let v = 0;
  for (const t of threats(view, p)) v += t.defender === me ? -t.penalty : t.penalty;
  return v;
}

/**
 * The transform: danger(params)(base) scores a view as base does, minus W · the chance of the threat on `me`, plus the same
 * for the threat on the opponent (refused with every problem when the parameters are wrong). A finished game is base's.
 */
export function danger(params: DangerParams = DANGER_DEFAULTS): (base: Evaluator) => Evaluator {
  const problems = dangerProblems(params);
  if (problems.length) throw new Error(`danger: ${problems.join("; ")}`);
  const p: DangerParams = { ...params };
  return (base) => (view, me) => {
    const v = base(view, me);
    return view.result ? v : v + dangerTerm(view, me, p);
  };
}
