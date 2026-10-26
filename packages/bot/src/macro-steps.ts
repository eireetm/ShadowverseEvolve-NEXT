import type { Answer, Decision } from "./core";

// Macro steps (PlannerBotOptions.macro): the root search of a turn by actions, not by decisions. A main phase answer (CR
// 7.3.3) and every decision inside its action up to our next main phase decision — targets (CR 10.6.2.3), the order of
// pending abilities (10.5.2.2), optional costs (10.4.7), a Ward follower's entry (12.8.2), the cards selected — are one step
// of the beam: the plans compared at one step have taken the same number of actions, and none is ranked half-paid. The
// decision-by-decision beam ranks every node by the evaluation, so an action that pays first and gets later (BP08-037's
// -10: 3 to 7 cards banished, then the effect) sits below the plans that took no such action at every step in between and
// is cut before it completes; and a plan's depth counts decisions, so a turn of many choices stops early (in the meta-deck
// smoke games the root's best plan stopped at its tenth decision in 10.8% of the searches). Inside an action the decisions
// are searched on their own: whole while its tree fits the allowance (a share of the budget left), else by a small beam;
// what is left unfinished when the allowance is spent is finished by the fast answers (policy.ts), so no action is dropped.
// Completions that differ only in the order of their pending abilities are one (the better kept), and the best few of an
// action go on to the next step.

/** macro's parameters (planner.ts macroBeam). */
export interface MacroOptions {
  /** Most actions in one plan (the beam's steps). */
  actions: number;
  /** Completions of one action kept for the next step (the best, one per position). */
  keep: number;
  /** The least width of the search inside an action (more while its answers fit the allowance). */
  sub: number;
  /** Most decisions in one plan (a guard: an action reaching it is finished by the fast answers). */
  dec: number;
  /** The share of the search's budget left that the decisions inside one action may use (at least one decision's answers). */
  share: number;
}

export const MACRO_DEFAULTS: Readonly<MacroOptions> = { actions: 12, keep: 2, sub: 4, dec: 40, share: 0.25 };

/** The ranges each parameter is taken in (least, most); `share` a fraction above 0. */
export const MACRO_RANGES: Readonly<Record<Exclude<keyof MacroOptions, "share">, readonly [number, number]>> = { actions: [1, 40], keep: [1, 16], sub: [1, 64], dec: [1, 200] };

/** Every reason the parameters are refused (empty: none). */
export function macroProblems(o: MacroOptions): string[] {
  const out: string[] = [];
  for (const [key, [least, most]] of Object.entries(MACRO_RANGES) as [keyof typeof MACRO_RANGES, readonly [number, number]][]) {
    const v = o[key];
    if (!Number.isInteger(v) || v < least || v > most) out.push(`${key}=${String(v)}: a whole number from ${least} to ${most}`);
  }
  if (typeof o.share !== "number" || !(o.share > 0) || o.share > 1) out.push(`share=${String(o.share)}: a number above 0, at most 1`);
  return out;
}

/** The parameters as the records write them: "macro=<actions>:keep=<n>,sub=<n>,dec=<n>,share=<x>". */
export function macroIdentity(o: MacroOptions): string {
  return `macro=${o.actions}:keep=${o.keep},sub=${o.sub},dec=${o.dec},share=${o.share}`;
}

/** A plan's point as this module reads it (planner.ts Node). */
export interface MacroNode {
  parent: MacroNode | null;
  answer: Answer | null;
  depth: number;
  session: { decision: Decision | null };
}

/** How many main phase actions a plan has taken (its answers given at a main phase decision, CR 7.3.3). */
export function actionsOf(node: MacroNode): number {
  let k = 0;
  for (let n: MacroNode | null = node; n && n.parent; n = n.parent) if (n.parent.session.decision?.type === "mainPhase") k += 1;
  return k;
}

/**
 * A completion of an action by what it chose (its answers from `start` on, `start` excluded), leaving out which pending
 * ability went first (CR 10.5.2.2: selectPending): completions that differ only there are one, the better kept.
 */
export function completionKey(node: MacroNode, start: MacroNode): string {
  const out: string[] = [];
  for (let n: MacroNode | null = node; n && n !== start; n = n.parent) {
    if (n.parent?.session.decision?.type === "selectPending") continue;
    out.push(JSON.stringify(n.answer));
  }
  return out.reverse().join("|");
}

/**
 * Of an action's completions (each: done, or at our next main phase decision), the best of each kind (completionKey),
 * then the best `keep` by value, one per position (`key`).
 */
export function keptCompletions<N extends MacroNode & { value: number; key: string }>(completions: readonly N[], start: MacroNode, keep: number): N[] {
  const best = new Map<string, N>();
  for (const n of completions) {
    const k = completionKey(n, start);
    const known = best.get(k);
    if (!known || n.value > known.value) best.set(k, n);
  }
  const ranked = [...best.values()].sort((a, b) => b.value - a.value);
  const out: N[] = [];
  const positions = new Set<string>();
  for (const n of ranked) {
    if (out.length >= keep) break;
    if (positions.has(n.key)) continue;
    positions.add(n.key);
    out.push(n);
  }
  return out;
}
