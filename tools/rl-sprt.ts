/**
 * The sequential test of a new bot against the old one (G1): npm run rl:sprt -- <arena out dir>... [--h1 0.015]
 *
 * Reads the games of one or more `bot:arena --out` folders (the same series, A the new bot, B the old one; the folders can be
 * parts of one run made with --range), takes the pairs (the same decks and seed, seats swapped) in series order while they
 * are complete, and runs the pairs' SPRT the way chess engine testing (fishtest) does: a pair where A won both games or lost
 * both carries the information, a split pair (one each, about 80% of them) doesn't; with q the share of those two kinds among
 * the pairs so far, A's chance to win both of an informative pair is 0.5 under H0 (no change) and p1 = 0.5 + h1 / q under H1
 * (A's pair score is h1 higher), and each pair adds ln(p1 / 0.5) or ln((1 − p1) / 0.5) to the log-likelihood ratio. Pairs
 * with a draw or an unfinished game are left out. Bounds: ln((1 − β) / α) = 2.89 passes, ln(β / (1 − α)) = −2.25 fails
 * (α 5%, β 10%); still between them at --max-pairs: undecided.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { gunzipSync } from "node:zlib";

const args = process.argv.slice(2);
const option = (name: string) => {
  const at = args.indexOf(name);
  return at >= 0 ? (args[at + 1] ?? null) : null;
};
const VALUED = ["--h1", "--alpha", "--beta", "--max-pairs", "--out"];
const dirs = args.filter((a, i) => !a.startsWith("--") && !(i > 0 && VALUED.includes(args[i - 1]!)));
const h1 = Number(option("--h1") ?? 0.015);
const alpha = Number(option("--alpha") ?? 0.05);
const beta = Number(option("--beta") ?? 0.1);
const maxPairs = Number(option("--max-pairs") ?? 4000);
if (dirs.length === 0 || dirs.some((d) => !existsSync(join(d, "games.jsonl.gz")))) {
  console.error("usage: npm run rl:sprt -- <arena out dir with games.jsonl.gz>... [--h1 0.015] [--alpha 0.05] [--beta 0.1] [--max-pairs 4000] [--out file.json]");
  process.exit(1);
}

interface Game {
  series: string;
  index: number;
  pair: number | null;
  bots: { a: string; b: string; seatOfA: number };
  result: { winner: number | null | "?" };
}
const games: Game[] = [];
for (const d of dirs) {
  const text = gunzipSync(readFileSync(join(d, "games.jsonl.gz"))).toString("utf8");
  for (const line of text.split("\n")) if (line.trim()) games.push(JSON.parse(line) as Game);
}
const series = new Set(games.map((g) => g.series));
const botsKey = new Set(games.map((g) => `${g.bots.a} | ${g.bots.b}`));
if (series.size !== 1 || botsKey.size !== 1) {
  console.error(`the folders mix series (${[...series].join(", ")}) or bots (${[...botsKey].join(", ")})`);
  process.exit(1);
}
const scoreOf = (g: Game) => (g.result.winner === "?" ? null : g.result.winner === null ? 0.5 : g.result.winner === g.bots.seatOfA ? 1 : 0);
const byPair = new Map<number, Game[]>();
for (const g of games) if (g.pair !== null) byPair.set(g.pair, [...(byPair.get(g.pair) ?? []), g]);

// The pairs in series order, as long as they are complete (a later part of the series may already be in).
const pairs: { pair: number; scores: [number | null, number | null] }[] = [];
for (let p = 0; byPair.has(p) && byPair.get(p)!.length === 2; p++) {
  const [x, y] = byPair.get(p)!;
  pairs.push({ pair: p, scores: [scoreOf(x!), scoreOf(y!)] });
}

const upper = Math.log((1 - beta) / alpha);
const lower = Math.log(beta / (1 - alpha));
let ww = 0;
let ll = 0;
let split = 0;
let skipped = 0;
let llr = 0;
let decision: "通过" | "否定" | "未定" = "未定";
let decidedAt: number | null = null;
const trace: { pairs: number; llr: number; q: number }[] = [];
for (const [k, p] of pairs.entries()) {
  if (k >= maxPairs) break;
  const [s1, s2] = p.scores;
  if (s1 === null || s2 === null || s1 === 0.5 || s2 === 0.5) skipped += 1;
  else if (s1 + s2 === 2) ww += 1;
  else if (s1 + s2 === 0) ll += 1;
  else split += 1;
  const informative = ww + ll;
  const q = informative / Math.max(1, informative + split);
  const p1 = q > 0 ? Math.min(0.999, 0.5 + h1 / q) : 0.5;
  llr = q > 0 ? ww * Math.log(p1 / 0.5) + ll * Math.log((1 - p1) / 0.5) : 0;
  if ((k + 1) % 50 === 0) trace.push({ pairs: k + 1, llr, q });
  if (decidedAt === null && (llr >= upper || llr <= lower)) {
    decision = llr >= upper ? "通过" : "否定";
    decidedAt = k + 1;
    break;
  }
}
const used = decidedAt ?? Math.min(pairs.length, maxPairs);
if (decidedAt === null && used >= maxPairs) decision = "未定";

// A's pair score with a 95% interval (by pairs), over the pairs used.
const pairScores = pairs.slice(0, used).flatMap((p) => (p.scores[0] === null || p.scores[1] === null ? [] : [(p.scores[0] + p.scores[1]) / 2]));
const mean = pairScores.reduce((a, b) => a + b, 0) / Math.max(1, pairScores.length);
const sd = Math.sqrt(pairScores.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, pairScores.length - 1));
const half = (1.96 * sd) / Math.sqrt(Math.max(1, pairScores.length));
const pct = (x: number) => `${(100 * x).toFixed(1)}%`;
const summary = {
  series: [...series][0],
  bots: [...botsKey][0],
  dirs: dirs.map((d) => resolve(d)),
  h1,
  alpha,
  beta,
  bounds: { upper, lower },
  decision: decidedAt === null && used < maxPairs ? "未定（还没打完）" : decision,
  decidedAt,
  pairsComplete: pairs.length,
  pairsUsed: used,
  winBoth: ww,
  loseBoth: ll,
  split,
  skipped,
  q: (ww + ll) / Math.max(1, ww + ll + split),
  llr,
  pairScore: { mean, low: mean - half, high: mean + half, n: pairScores.length },
  trace,
};
console.log(`${summary.bots}  (${summary.series})`);
console.log(`完整的对 ${pairs.length}，用到 ${used}：两局都赢 ${ww}、两局都输 ${ll}、一胜一负 ${split}、有平局或未完成 ${skipped}；q = ${summary.q.toFixed(3)}`);
console.log(`LLR ${llr.toFixed(3)}（通过 ≥ ${upper.toFixed(2)}，否定 ≤ ${lower.toFixed(2)}）→ ${summary.decision}${decidedAt !== null ? `（第 ${decidedAt} 对）` : ""}`);
console.log(`A 按对的得分 ${pct(mean)}（95%：${pct(mean - half)}–${pct(mean + half)}，${pairScores.length} 对）`);
const outFile = option("--out");
if (outFile) writeFileSync(outFile, JSON.stringify(summary, null, 1));
