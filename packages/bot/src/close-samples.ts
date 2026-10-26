// More samples where the comparison is close (PlannerBotOptions.closeSamples). A fair two-turn planner compares its best
// plans by their average over a few samples of what it can't see (3 in the measured bots); one sample's value moves by
// several points with the cards dealt in it, so two plans a point apart are often apart by the samples, not by the plans.
// When a plan is close to the best — the best's lead, sample by sample (the same samples, the same random numbers with
// commonRandom), is less than `z` standard errors of that lead — both are played in more samples (up to `max` in all) and
// compared by the longer average. A lead decided by a lethal in some samples and not others is the widest of those spreads,
// so it is close too. Plans already won or lost, or held at the floor of a plan that can still win, are left as they are.

/** closeSamples' parameters: the samples in all when close, how many standard errors are close, a floor in points, how many plans. */
export interface CloseSampleOptions {
  max: number;
  z: number;
  /** A lead of at most this many points is close whatever the spread (0: only by the spread). */
  margin: number;
  /** The plans played in more samples: the best and at most `most - 1` close ones (the closest first). */
  most: number;
}

export const CLOSE_DEFAULTS: Readonly<CloseSampleOptions> = { max: 8, z: 2, margin: 0, most: 3 };

/** Every reason the parameters are refused (empty: none). */
export function closeProblems(o: CloseSampleOptions): string[] {
  const out: string[] = [];
  if (!Number.isInteger(o.max) || o.max < 2 || o.max > 16) out.push(`max=${String(o.max)}: a whole number from 2 to 16`);
  if (typeof o.z !== "number" || !(o.z >= 0) || o.z > 10) out.push(`z=${String(o.z)}: a number from 0 to 10`);
  if (typeof o.margin !== "number" || !(o.margin >= 0) || o.margin > 100) out.push(`margin=${String(o.margin)}: a number from 0 to 100`);
  if (!Number.isInteger(o.most) || o.most < 2 || o.most > 16) out.push(`most=${String(o.most)}: a whole number from 2 to 16`);
  return out;
}

/** The parameters as the records write them: "close=<max>:z=<z>,margin=<m>,most=<n>". */
export function closeIdentity(o: CloseSampleOptions): string {
  return `close=${o.max}:z=${o.z},margin=${o.margin},most=${o.most}`;
}

export const mean = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;

/**
 * Whether a plan is close to the best: `best` and `other` are their values in the same samples (raw, before any charge),
 * `lead` the best's lead in the values compared (charges included: a charge is the same in every sample, so the lead's
 * spread is the raw values' spread). Close when the lead is at most `margin`, or less than `z` standard errors of the
 * per-sample lead (the sample standard deviation over the square root of the samples; fewer than 2 samples: not close).
 */
export function isClose(best: readonly number[], other: readonly number[], lead: number, o: Pick<CloseSampleOptions, "z" | "margin">): boolean {
  if (lead <= o.margin) return true;
  const n = Math.min(best.length, other.length);
  if (n < 2) return false;
  const d = Array.from({ length: n }, (_, w) => best[w]! - other[w]!);
  const m = mean(d);
  const variance = d.reduce((s, x) => s + (x - m) ** 2, 0) / (n - 1);
  const se = Math.sqrt(variance / n);
  return lead < o.z * se;
}
