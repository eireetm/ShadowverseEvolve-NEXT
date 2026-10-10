/**
 * W1: the hand-written evaluation's weights (packages/bot/src/evaluate.ts) refitted by logistic regression on the samples of
 * `rl:encode` (y: won 1 / drawn 0.5 / lost 0; w1: both sides' evaluation terms, tools/rl/eval-terms.ts). The evaluation is
 * my side's value minus the opponent's with the same weights, so the model is logit p = Σ β_t · (my term t − their term t)
 * plus covariates used only to fit (the decks of the game, who went first, which bots played, whether the viewer is the
 * active player): within one decision of a bot they are the same for every candidate, so the bot doesn't need them.
 *
 * Compared on the validation split, Medium-vs-Medium games, by turn and by viewer (active or not), with baselines: the
 * covariates alone; three features (leader defense, board stats and hand size differences); the hand-written evaluation
 * calibrated (one coefficient). Written: the weights as EvalWeights scaled so that a point of leader defense is worth 1 (the
 * bots' `win` and the other limits keep their meaning) with s = logits per point; every model's coefficients and metrics.
 *
 * usage: npm run rl:w1 -- <samples dir> [--out <dir>] [--lambda L]
 */
import { execFileSync } from "node:child_process";
import { cpus } from "node:os";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { DEFAULT_WEIGHTS, type EvalWeights } from "../packages/bot/src";
import { W1_TERMS } from "./rl/eval-terms";
import { readNpy } from "./rl/npy";
import { ROOT } from "./rl/series";

const args = process.argv.slice(2);
const option = (name: string) => {
  const at = args.indexOf(name);
  return at >= 0 ? (args[at + 1] ?? null) : null;
};
const dir = args.find((a, i) => !a.startsWith("--") && !(i > 0 && ["--out", "--lambda"].includes(args[i - 1]!)));
if (!dir || !existsSync(join(dir, "meta.json"))) {
  console.error("usage: npm run rl:w1 -- <samples dir> [--out <dir>] [--lambda L]");
  process.exit(1);
}
const out = resolve(option("--out") ?? join(resolve(dir), "..", "w1"));
const lambda = Number(option("--lambda") ?? 1);
const started = Date.now();

interface Meta {
  columns: { side: string[]; w1: string[] };
  playerTypes: string[];
  decks: string[];
  source: Record<string, unknown>;
  shards: { shard: number; rows: number; files: Record<string, string> }[];
}
const meta = JSON.parse(readFileSync(join(dir, "meta.json"), "utf8")) as Meta;
const SIDE = Object.fromEntries(meta.columns.side.map((c, i) => [c, i])) as Record<string, number>;
const nSide = meta.columns.side.length;
const nW1 = meta.columns.w1.length;
const T = W1_TERMS.length;
if (nW1 !== 2 * T) throw new Error(`w1 has ${nW1} columns, the terms are ${T} per side`);

// ---- the samples ----
const N = meta.shards.reduce((n, s) => n + s.rows, 0);
const side = new Float32Array(N * nSide);
const ys = new Float32Array(N);
const w1 = new Int16Array(N * nW1);
let at = 0;
for (const s of meta.shards) {
  const name = (k: string) => join(dir, `${k}-${String(s.shard).padStart(4, "0")}.npy`);
  const sd = readNpy(readFileSync(name("side"))).data;
  const yd = readNpy(readFileSync(name("y"))).data;
  const wd = readNpy(readFileSync(name("w1"))).data;
  side.set(sd, at * nSide);
  ys.set(yd, at);
  w1.set(wd, at * nW1);
  at += s.rows;
}
const col = (i: number, c: string) => side[i * nSide + SIDE[c]!]!;
const term = (i: number, who: 0 | 1, t: number) => w1[i * nW1 + who * T + t]!;
const diff = (i: number, t: number) => term(i, 0, t) - term(i, 1, t);
const TI = Object.fromEntries(W1_TERMS.map((t, k) => [t, k])) as Record<string, number>;

// ---- models: sparse rows (index, value); the covariates first ----
const D = meta.decks.length;
const EASY = meta.playerTypes.indexOf("easy");
const COVARIATES = ["intercept", "meFirst", "isActive", "meEasy", "oppEasy", ...meta.decks.flatMap((a) => meta.decks.map((b) => `pair.${a}.${b}`))];
type Row = { idx: number[]; val: number[] };
function covariates(i: number, r: Row): void {
  const push = (k: number, v: number) => {
    if (v !== 0) {
      r.idx.push(k);
      r.val.push(v);
    }
  };
  push(0, 1);
  push(1, col(i, "meFirst"));
  push(2, col(i, "isActive"));
  push(3, col(i, "meBot") === EASY ? 1 : 0);
  push(4, col(i, "oppBot") === EASY ? 1 : 0);
  push(5 + col(i, "deckMe") * D + col(i, "deckOpp"), 1);
}
interface Model {
  key: string;
  label: string;
  names: string[];
  features: (i: number, push: (k: number, v: number) => void) => void;
}
const C = COVARIATES.length;
const MODELS: Model[] = [
  { key: "cov", label: "只用协变量（卡组组合、先后手、执棋者、行动方）", names: [], features: () => {} },
  {
    key: "three",
    label: "协变量 + 三特征（体力差、场上攻击力 + 生命值差、手牌差）",
    names: ["leader", "board", "hand"],
    features: (i, push) => {
      push(0, diff(i, TI.leader!));
      push(1, diff(i, TI.attack!) + diff(i, TI.defense!));
      push(2, diff(i, TI.hand!));
    },
  },
  { key: "hand", label: "协变量 + 手写估值（校准一个系数）", names: ["handEval/10"], features: (i, push) => push(0, col(i, "handEval") / 10) },
  { key: "w1", label: "W1：协变量 + 手写估值的 24 项（双方同一组权重）", names: [...W1_TERMS], features: (i, push) => W1_TERMS.forEach((_, t) => push(t, diff(i, t))) },
  {
    key: "w1sep",
    label: "诊断：协变量 + 双方各自的 24 项（48 个权重）",
    names: [...W1_TERMS.map((t) => `me.${t}`), ...W1_TERMS.map((t) => `opp.${t}`)],
    features: (i, push) => W1_TERMS.forEach((_, t) => (push(t, term(i, 0, t)), push(T + t, term(i, 1, t)))),
  },
];

function rowOf(m: Model, i: number): Row {
  const r: Row = { idx: [], val: [] };
  covariates(i, r);
  m.features(i, (k, v) => {
    if (v !== 0) {
      r.idx.push(C + k);
      r.val.push(v);
    }
  });
  return r;
}

const splitOf = (i: number) => col(i, "split");
const train: number[] = [];
for (let i = 0; i < N; i++) if (splitOf(i) === 0) train.push(i);

/** Feature scales on the training split (standard deviations), so that one λ fits every feature. */
function scales(m: Model): Float64Array {
  const P = C + m.names.length;
  const s1 = new Float64Array(P);
  const s2 = new Float64Array(P);
  for (const i of train) {
    const r = rowOf(m, i);
    for (let k = 0; k < r.idx.length; k++) {
      const j = r.idx[k]!;
      s1[j] = s1[j]! + r.val[k]!;
      s2[j] = s2[j]! + r.val[k]! * r.val[k]!;
    }
  }
  const n = train.length;
  return s2.map((v, k) => {
    const sd = Math.sqrt(Math.max(0, v / n - (s1[k]! / n) ** 2));
    return k < C || sd === 0 ? 1 : sd;
  });
}

/** Solves A x = b (A symmetric positive definite) by Cholesky. */
function solve(A: Float64Array, b: Float64Array, P: number): Float64Array {
  const L = new Float64Array(P * P);
  for (let j = 0; j < P; j++) {
    let d = A[j * P + j]!;
    for (let k = 0; k < j; k++) d -= L[j * P + k]! ** 2;
    if (!(d > 0)) throw new Error(`not positive definite at ${j} (${d})`);
    const ljj = Math.sqrt(d);
    L[j * P + j] = ljj;
    for (let i = j + 1; i < P; i++) {
      let s = A[i * P + j]!;
      for (let k = 0; k < j; k++) s -= L[i * P + k]! * L[j * P + k]!;
      L[i * P + j] = s / ljj;
    }
  }
  const z = new Float64Array(P);
  for (let i = 0; i < P; i++) {
    let s = b[i]!;
    for (let k = 0; k < i; k++) s -= L[i * P + k]! * z[k]!;
    z[i] = s / L[i * P + i]!;
  }
  const x = new Float64Array(P);
  for (let i = P - 1; i >= 0; i--) {
    let s = z[i]!;
    for (let k = i + 1; k < P; k++) s -= L[k * P + i]! * x[k]!;
    x[i] = s / L[i * P + i]!;
  }
  return x;
}

/**
 * Logistic regression with fractional labels (a draw is half a win), Newton's method on the training split, an L2 penalty λ on
 * the standardized features (not on the intercept); pair indicators that never occur get only the penalty (they stay 0).
 */
function fit(m: Model): { beta: Float64Array; iterations: number; scale: Float64Array } {
  const P = C + m.names.length;
  const sc = scales(m);
  const rows = train.map((i) => {
    const r = rowOf(m, i);
    return { idx: r.idx, val: r.val.map((v, k) => v / sc[r.idx[k]!]!), y: ys[i]! };
  });
  const beta = new Float64Array(P);
  let iterations = 0;
  for (; iterations < 30; iterations++) {
    const H = new Float64Array(P * P);
    const g = new Float64Array(P);
    for (const r of rows) {
      let z = 0;
      for (let k = 0; k < r.idx.length; k++) z += beta[r.idx[k]!]! * r.val[k]!;
      const p = 1 / (1 + Math.exp(-z));
      const w = p * (1 - p);
      const e = r.y - p;
      for (let a = 0; a < r.idx.length; a++) {
        const ia = r.idx[a]!;
        const va = r.val[a]!;
        g[ia] = g[ia]! + e * va;
        for (let b = 0; b < r.idx.length; b++) {
          const h = ia * P + r.idx[b]!;
          H[h] = H[h]! + w * va * r.val[b]!;
        }
      }
    }
    for (let k = 1; k < P; k++) {
      H[k * P + k] = H[k * P + k]! + lambda;
      g[k] = g[k]! - lambda * beta[k]!;
    }
    H[0] = H[0]! + 1e-9;
    const step = solve(H, g, P);
    let change = 0;
    for (let k = 0; k < P; k++) {
      beta[k] = beta[k]! + step[k]!;
      change = Math.max(change, Math.abs(step[k]!));
    }
    if (change < 1e-8) break;
  }
  return { beta: beta.map((b, k) => b / sc[k]!), iterations: iterations + 1, scale: sc };
}

function predict(m: Model, beta: Float64Array, i: number): number {
  const r = rowOf(m, i);
  let z = 0;
  for (let k = 0; k < r.idx.length; k++) z += beta[r.idx[k]!]! * r.val[k]!;
  return 1 / (1 + Math.exp(-z));
}

interface Metrics {
  n: number;
  logLoss: number;
  brier: number;
  accuracy: number;
}
function metrics(m: Model, beta: Float64Array, rows: number[]): Metrics {
  let ll = 0;
  let br = 0;
  let right = 0;
  let decided = 0;
  for (const i of rows) {
    const p = Math.min(1 - 1e-12, Math.max(1e-12, predict(m, beta, i)));
    const y = ys[i]!;
    ll -= y * Math.log(p) + (1 - y) * Math.log(1 - p);
    br += (p - y) ** 2;
    if (y !== 0.5) {
      decided += 1;
      if ((p > 0.5) === (y === 1)) right += 1;
    }
  }
  return { n: rows.length, logLoss: ll / rows.length, brier: br / rows.length, accuracy: decided ? right / decided : NaN };
}

// ---- slices ----
const mm = (i: number) => col(i, "pairKind") === 0;
const turnBucket = (i: number) => {
  const t = col(i, "turn");
  return t <= 4 ? "1–4" : t <= 8 ? "5–8" : t <= 12 ? "9–12" : "13+";
};
const SLICES: { key: string; label: string; rows: number[] }[] = [];
const slice = (key: string, label: string, keep: (i: number) => boolean) => {
  const rows: number[] = [];
  for (let i = 0; i < N; i++) if (keep(i)) rows.push(i);
  SLICES.push({ key, label, rows });
};
slice("valid.mm", "验证集 Medium 对 Medium（主判据）", (i) => splitOf(i) === 1 && mm(i));
for (const b of ["1–4", "5–8", "9–12", "13+"]) slice(`valid.mm.turn${b}`, `  回合 ${b}`, (i) => splitOf(i) === 1 && mm(i) && turnBucket(i) === b);
slice("valid.mm.active", "  行动方的视角", (i) => splitOf(i) === 1 && mm(i) && col(i, "isActive") === 1);
slice("valid.mm.waiting", "  非行动方的视角", (i) => splitOf(i) === 1 && mm(i) && col(i, "isActive") === 0);
slice("valid.all", "验证集全部（含 Medium 对 Easy）", (i) => splitOf(i) === 1);
slice("train.all", "训练集全部", (i) => splitOf(i) === 0);
slice("test.mm", "测试集 Medium 对 Medium（只报一次）", (i) => splitOf(i) === 2 && mm(i));

// ---- fit, measure, write ----
mkdirSync(out, { recursive: true });
const fits: Record<string, { beta: number[]; iterations: number; seconds: number }> = {};
const table: Record<string, Record<string, Metrics>> = {};
for (const m of MODELS) {
  const t0 = Date.now();
  const f = fit(m);
  fits[m.key] = { beta: [...f.beta], iterations: f.iterations, seconds: (Date.now() - t0) / 1000 };
  table[m.key] = Object.fromEntries(SLICES.map((s) => [s.key, metrics(m, f.beta, s.rows)]));
  console.log(`${m.key}: ${f.iterations} iterations, ${((Date.now() - t0) / 1000).toFixed(1)} s, valid.mm log loss ${table[m.key]!["valid.mm"]!.logLoss.toFixed(5)}`);
}

// W1 as EvalWeights: β per term, scaled so that a point of leader defense is 1.
const w1Beta = fits.w1!.beta.slice(C);
const s = w1Beta[TI.leader!]!;
const termWeight = Object.fromEntries(W1_TERMS.map((t, k) => [t, w1Beta[k]! / s]));
const weights: EvalWeights = {
  ...DEFAULT_WEIGHTS,
  leader: 1,
  leaderDanger: termWeight.leaderDanger!,
  attack: termWeight.attack!,
  defense: termWeight.defense!,
  keywords: Object.fromEntries(W1_TERMS.filter((t) => t.startsWith("kw.")).map((t) => [t.slice(3), termWeight[t]!])),
  evolved: termWeight.evolved!,
  amulet: termWeight.amulet!,
  counter: termWeight.counter!,
  hand: termWeight.hand!,
  ex: termWeight.ex!,
  crest: termWeight.crest!,
  equipment: termWeight.equipment!,
  evolutionPoint: termWeight.evolutionPoint!,
  superEvolutionPoint: termWeight.superEvolutionPoint!,
  maxPlayPoint: termWeight.maxPlayPoint!,
  playPoint: termWeight.playPoint!,
  deckDanger: termWeight.deckDanger!,
};

const git = (...a: string[]) => {
  try {
    return execFileSync("git", ["-C", ROOT, ...a], { encoding: "utf8" }).trim();
  } catch {
    return "";
  }
};
const provenance = {
  tool: "rl:w1",
  command: `rl:w1 ${args.join(" ")}`,
  samples: resolve(dir),
  samplesSource: meta.source,
  rows: N,
  trainRows: train.length,
  lambda,
  commit: git("rev-parse", "--short", "HEAD"),
  dirty: git("status", "--porcelain", "--", "tools", "packages/bot") !== "",
  machine: { cpus: cpus().length, node: process.version },
  date: new Date().toISOString(),
  seconds: (Date.now() - started) / 1000,
};
writeFileSync(
  join(out, "w1-weights.json"),
  JSON.stringify({ format: "sve-eval-weights", version: 1, logitPerLeaderPoint: s, weights, provenance }, null, 1),
);
writeFileSync(
  join(out, "w1-fit.json"),
  JSON.stringify({ provenance, covariates: COVARIATES, models: MODELS.map((m) => ({ key: m.key, label: m.label, names: m.names, ...fits[m.key], metrics: table[m.key] })) }, null, 1),
);

// The report (Chinese, like the other rl tools).
const fmt = (x: number, d = 4) => (Number.isFinite(x) ? x.toFixed(d) : "—");
const lines: string[] = [];
lines.push(`rl:w1 ${provenance.date}  ${resolve(dir)}`);
lines.push(`样本 ${N} 个（训练 ${train.length}），λ = ${lambda}，代码 ${provenance.commit}${provenance.dirty ? "（有未提交的改动）" : ""}，用时 ${fmt(provenance.seconds, 0)} 秒`);
lines.push("");
lines.push("对数损失（越低越好；括号里是 Brier 和猜对胜负的比例）：");
for (const sl of SLICES) {
  lines.push(`${sl.label}（${sl.rows.length} 个样本）`);
  for (const m of MODELS) {
    const r = table[m.key]![sl.key]!;
    lines.push(`    ${m.key.padEnd(6)} ${fmt(r.logLoss)}（${fmt(r.brier)}，${fmt(100 * r.accuracy, 1)}%）`);
  }
}
lines.push("");
lines.push(`W1 的权重（每点体力 = 1；s = 每点体力 ${fmt(s, 5)} logit）和默认权重：`);
const defaults = Object.fromEntries(W1_TERMS.map((t) => [t, t.startsWith("kw.") ? (DEFAULT_WEIGHTS.keywords[t.slice(3) as keyof EvalWeights["keywords"]] ?? 0) : (DEFAULT_WEIGHTS[t as keyof EvalWeights] as number)]));
for (const t of W1_TERMS) lines.push(`    ${t.padEnd(20)} W1 ${fmt(termWeight[t]!, 3).padStart(8)}   默认 ${fmt(defaults[t]!, 2).padStart(6)}`);
lines.push("");
lines.push("双方分开拟合的诊断（每点 logit；行动方 / 非行动方的差别要靠协变量）：");
const sep = fits.w1sep!.beta.slice(C);
for (const [k, t] of W1_TERMS.entries()) lines.push(`    ${t.padEnd(20)} 我方 ${fmt(sep[k]!, 4).padStart(8)}   对方 ${fmt(sep[T + k]!, 4).padStart(8)}`);
lines.push("");
lines.push(`协变量（W1 模型，logit）：先手 ${fmt(fits.w1!.beta[1]!, 3)}，行动方 ${fmt(fits.w1!.beta[2]!, 3)}，我方是 Easy ${fmt(fits.w1!.beta[3]!, 3)}，对方是 Easy ${fmt(fits.w1!.beta[4]!, 3)}`);
writeFileSync(join(out, "report.txt"), lines.join("\n") + "\n");
console.log(lines.join("\n"));
console.log(`-> ${out}`);
