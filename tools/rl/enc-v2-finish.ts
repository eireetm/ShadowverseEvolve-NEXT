// rl:encode --encoder 2, the main process's part: the definition files, the fixed pooled-check and golden samples (rebuilt
// from the written arrays and compared with the encoder's own), the checks C10–C24 in Chinese, stats.json, the run registry
// and the positions reprinted under v2 (--pick-from).
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  CARD_BODY_COLUMNS_V2,
  CARD_FEATURE_COLUMNS,
  CARD_FEATURES_VERSION,
  CARD_WIDTH_V2,
  ENCODER_V2_VERSION,
  GDEF_COLUMNS_V2,
  GLOBAL_COLUMNS_V2,
  PILE_COLUMNS_V2,
  POOL_LAYOUT_V2,
  REL_COLUMNS_V2,
  ZONES_V2,
  describeV2,
  encode,
  encoderV2Schema,
  poolV2,
  prepareV2,
  type CardFeatureTable,
  type EncoderContext,
  type PreparedV2,
} from "../../packages/bot/src";
import { seedRng, randomInt, type Engine, type GameSession, type PlayerId } from "../../packages/core/src";
import { TRAIT_NAMES } from "../../packages/gui/src/app/traits";
import { zh } from "../../packages/gui/src/i18n/zh";
import type { Calibration, V2Checks, declaredRanges } from "./enc-v2-writer";
import { readNpy, writeNpy } from "./npy";

/** A shard's encoder v2 result (rl-encode.ts's ShardV2Result, as much as this reads). */
export interface V2ShardIn {
  shard: number;
  rows: number;
  files: Record<string, string>;
  v2?: {
    sizes: { cardRows: number; pileRows: number; gdefRows: number };
    diag: Record<string, number>;
    maskBad: number;
    checks: V2Checks;
    rangeNames: Record<string, number>;
    oracleDiffer: Record<string, number>;
    closures: Record<string, { agree: number; disagree: number; examples: string[] }>;
    cal: Calibration;
    nonzeroGlobal: number[];
    nonzeroCard: Record<string, number[]>;
    nonzeroGdef: number[];
    relSums: number[];
    perZone: Record<string, Record<string, number[]>>;
    candidates: { row: number; hash: number; game: number; input: number; viewer: number }[];
  };
}

export interface FinishV2Input {
  out: string;
  runDir: string;
  results: V2ShardIn[];
  table: CardFeatureTable;
  rulesFingerprint: string;
  times: { v2: number[]; v1: number[]; pool: number[] };
  workers: number;
  limit: number;
  compareWith: string | null;
  compareTo: string | null;
  pickFrom: string | null;
  /** The declared value ranges (C17), recorded in meta.json. */
  ranges: ReturnType<typeof declaredRanges>;
  engine: Engine;
  /** A game record by index, for --pick-from; and how a game starts. */
  calibrationView: { view: ReturnType<GameSession["view"]>; me: PlayerId; ctx: EncoderContext } | null;
  guiReplays: string;
  /** The repository (for the Python check). */
  root: string;
  cardName: (def: string) => string;
  /** An encoder v1 pick's replay: the game at its last input, and the encoders' context for it. */
  pickPosition: (replay: PickReplay, game: number) => { game: GameSession; ctx: EncoderContext };
}

/** A replay file of rl:encode --pick (the GUI's sve-replay format). */
export interface PickReplay {
  options: { seed: string; decks: unknown[]; controllers: string[] };
  inputs: { input: unknown }[];
}

const q = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.floor(s.length * p))]! : NaN;
};
const sha = (b: Buffer | string) => createHash("sha256").update(b).digest("hex");
const shardName = (kind: string, shard: number) => `${kind}-${String(shard).padStart(4, "0")}.npy`;

/** The definition files: static.npy (row 0 zeros, then the table's rows in sorted definition order) and defs.json. */
function writeDefs(out: string, table: CardFeatureTable, rulesFingerprint: string): { staticSha: string; defsSha: string; count: number } {
  const ids = Object.keys(table.file.rows).sort();
  const width = CARD_FEATURE_COLUMNS.length;
  const st = new Int16Array((ids.length + 1) * width);
  ids.forEach((d, i) => st.set(table.row(d), (i + 1) * width));
  writeNpy(join(out, "static.npy"), st, [ids.length + 1, width]);
  // Per definition, what REL and gdef depend on: its row, traits, evolve partners and references (a model pins these).
  const hashes = Object.fromEntries(ids.map((d) => [d, sha(JSON.stringify([table.file.rows[d], table.file.cardTraits[d] ?? [], table.file.evolvePartners[d] ?? [], table.file.refs[d] ?? []])).slice(0, 16)]));
  const defs = { ids, hashes, table: { version: table.file.version, columnsHash: table.file.columnsHash, hash: table.file.hash, rulesFingerprint: table.file.rulesFingerprint }, rulesFingerprint };
  writeFileSync(join(out, "defs.json"), JSON.stringify(defs) + "\n");
  return { staticSha: sha(readFileSync(join(out, "static.npy"))), defsSha: sha(readFileSync(join(out, "defs.json"))), count: ids.length };
}

/** A shard's arrays, read once. */
function shardArrays(out: string, shard: number) {
  const r = (k: string) => readNpy(readFileSync(join(out, shardName(k, shard)))).data;
  return { glob: r("glob") as Int16Array, card: r("card") as Int16Array, pile: r("pile") as Int16Array, off: r("off") as Int32Array, gbase: r("gbase") as Int32Array, gdef: r("gdef") as Int16Array };
}

/** A stored sample rebuilt as poolV2 reads it (its game's gdef rows by the stored gd). */
function storedSample(a: ReturnType<typeof shardArrays>, row: number, table: CardFeatureTable, defIds: readonly string[]) {
  const G = GLOBAL_COLUMNS_V2.length;
  const c0 = a.off[row * 2]!;
  const c1 = a.off[row * 2 + 2]!;
  const p0 = a.off[row * 2 + 1]!;
  const p1 = a.off[row * 2 + 3]!;
  const cards = a.card.slice(c0 * CARD_WIDTH_V2, c1 * CARD_WIDTH_V2);
  const piles = a.pile.slice(p0 * PILE_COLUMNS_V2.length, p1 * PILE_COLUMNS_V2.length);
  const base = a.gbase[row]!;
  let maxGd = -1;
  for (let i = 0; i < c1 - c0; i++) maxGd = Math.max(maxGd, cards[i * CARD_WIDTH_V2 + 2]!);
  for (let i = 0; i < p1 - p0; i++) maxGd = Math.max(maxGd, piles[i * 4 + 2]!);
  const W = 2 + GDEF_COLUMNS_V2.length;
  const gdRows = Array.from({ length: maxGd + 1 }, (_, j) => a.gdef.slice((base + j) * W + 2, (base + j + 1) * W));
  const prep = { ctx: { table }, defIds, gdRows, sparse: new Map() } as unknown as PreparedV2;
  return { enc: { global: a.glob.slice(row * G, (row + 1) * G), cards, piles, nCards: c1 - c0, nPiles: p1 - p0 }, prep };
}

/** A ratio's interval by resampling games (200 times, a fixed seed). */
function bootstrap(byGame: Record<number, [number, number]>): [number, number] {
  const games = Object.values(byGame);
  if (games.length < 5) return [NaN, NaN];
  const rng = seedRng("calibration");
  const ratios: number[] = [];
  for (let b = 0; b < 200; b++) {
    let real = 0;
    let exp = 0;
    for (let i = 0; i < games.length; i++) {
      const g = games[randomInt(rng, games.length)]!;
      real += g[0];
      exp += g[1];
    }
    if (exp > 0) ratios.push(real / exp);
  }
  return [q(ratios, 0.025), q(ratios, 0.975)];
}

export function finishV2(input: FinishV2Input): { lines: [boolean, string][]; meta: Record<string, unknown>; checks: Record<string, unknown>; picked: string[] } {
  const { out, results, table } = input;
  const schema = encoderV2Schema();
  const lines: [boolean, string][] = [];
  const shards = results.filter((r) => r.v2);
  const defs = writeDefs(out, table, input.rulesFingerprint);
  const defIds = Object.keys(table.file.rows).sort();

  // ---- Sums over shards ----
  const sum = <T extends Record<string, number>>(get: (r: NonNullable<V2ShardIn["v2"]>) => T): T => {
    const acc: Record<string, number> = {};
    for (const r of shards) for (const [k, v] of Object.entries(get(r.v2!))) acc[k] = (acc[k] ?? 0) + v;
    return acc as T;
  };
  const diag = sum((r) => r.diag);
  const checks = sum((r) => r.checks as unknown as Record<string, number>) as unknown as V2Checks;
  const rangeNames = sum((r) => r.rangeNames);
  const differ = sum((r) => r.oracleDiffer);
  const maskBad = shards.reduce((n, r) => n + r.v2!.maskBad, 0);
  const sizes = shards.reduce((s, r) => ({ cardRows: s.cardRows + r.v2!.sizes.cardRows, pileRows: s.pileRows + r.v2!.sizes.pileRows, gdefRows: s.gdefRows + r.v2!.sizes.gdefRows }), { cardRows: 0, pileRows: 0, gdefRows: 0 });
  const rows = shards.reduce((n, r) => n + r.rows, 0);
  const closures: Record<string, { agree: number; disagree: number; examples: string[] }> = {};
  for (const r of shards) {
    for (const [k, v] of Object.entries(r.v2!.closures)) {
      const e = (closures[k] ??= { agree: 0, disagree: 0, examples: [] });
      e.agree += v.agree;
      e.disagree += v.disagree;
      if (e.examples.length < 3) e.examples.push(...v.examples.slice(0, 3 - e.examples.length));
    }
  }
  const nonzeroGlobal = new Array<number>(GLOBAL_COLUMNS_V2.length).fill(0);
  const nonzeroCard: Record<string, number[]> = {};
  const nonzeroGdef = new Array<number>(GDEF_COLUMNS_V2.length).fill(0);
  const relSums = new Array<number>(REL_COLUMNS_V2.length).fill(0);
  for (const r of shards) {
    r.v2!.nonzeroGlobal.forEach((v, i) => (nonzeroGlobal[i]! += v));
    r.v2!.nonzeroGdef.forEach((v, i) => (nonzeroGdef[i]! += v));
    r.v2!.relSums.forEach((v, i) => (relSums[i]! += v));
    for (const [z, a] of Object.entries(r.v2!.nonzeroCard)) {
      const t = (nonzeroCard[z] ??= new Array<number>(CARD_BODY_COLUMNS_V2.length).fill(0));
      a.forEach((v, i) => (t[i]! += v));
    }
  }

  // ---- The fixed samples: pooled-check (2,000 smallest hashes) and goldens (200 smallest) ----
  const rowStart = new Map<number, number>();
  let at = 0;
  for (const r of results) {
    rowStart.set(r.shard, at);
    at += r.rows;
  }
  const cands = shards.flatMap((r) => r.v2!.candidates.map((c, i) => ({ ...c, shard: r.shard, at: i }))).sort((a, b) => a.hash - b.hash || a.game - b.game || a.viewer - b.viewer);
  const chosen = cands.slice(0, 2000);
  const dims = schema.pooled.dims;
  const pooled = new Int32Array(chosen.length * dims);
  const pooledIdx = new Int32Array(chosen.length);
  const arrays = new Map<number, ReturnType<typeof shardArrays>>();
  const candFiles = new Map<number, Int32Array>();
  let poolDiff = 0;
  chosen.forEach((c, i) => {
    let own = candFiles.get(c.shard);
    if (!own) candFiles.set(c.shard, (own = readNpy(readFileSync(join(out, "tmp", shardName("pooled", c.shard)))).data as Int32Array));
    const mine = own.subarray(c.at * dims, (c.at + 1) * dims);
    let a = arrays.get(c.shard);
    if (!a) arrays.set(c.shard, (a = shardArrays(out, c.shard)));
    const s = storedSample(a, c.row, table, defIds);
    const rebuilt = poolV2(s.enc, s.prep);
    for (let j = 0; j < dims; j++) if (rebuilt[j] !== mine[j]) poolDiff += 1;
    pooled.set(mine, i * dims);
    pooledIdx[i] = rowStart.get(c.shard)! + c.row;
  });
  writeNpy(join(out, "pooled-check.npy"), pooled, [chosen.length, dims]);
  writeNpy(join(out, "pooled-check-idx.npy"), pooledIdx, [chosen.length]);
  const golden = chosen.slice(0, 200);
  const gc: Int16Array[] = [];
  const gp: Int16Array[] = [];
  const gi = new Int32Array(golden.length * 5);
  let nc = 0;
  let np = 0;
  golden.forEach((c, i) => {
    const s = storedSample(arrays.get(c.shard)!, c.row, table, defIds);
    gc.push(s.enc.cards);
    gp.push(s.enc.piles);
    gi.set([rowStart.get(c.shard)! + c.row, nc, s.enc.nCards, np, s.enc.nPiles], i * 5);
    nc += s.enc.nCards;
    np += s.enc.nPiles;
  });
  const cat = (parts: Int16Array[], n: number) => {
    const a = new Int16Array(n);
    let k = 0;
    for (const p of parts) {
      a.set(p, k);
      k += p.length;
    }
    return a;
  };
  writeNpy(join(out, "golden-cards.npy"), cat(gc, nc * CARD_WIDTH_V2), [nc, CARD_WIDTH_V2]);
  writeNpy(join(out, "golden-piles.npy"), cat(gp, np * PILE_COLUMNS_V2.length), [np, PILE_COLUMNS_V2.length]);
  writeNpy(join(out, "golden-index.npy"), gi, [golden.length, 5]);
  rmSync(join(out, "tmp"), { recursive: true, force: true });

  // ---- C10: y, side, w1 as encoder v1 wrote them ----
  const v1meta = join(input.runDir, "enc-v1", "meta.json");
  let c10: [boolean, string];
  const compare: Record<string, unknown> = {};
  if (existsSync(v1meta)) {
    const m = JSON.parse(readFileSync(v1meta, "utf8")) as { shards: { shard: number; rows: number; files: Record<string, string> }[] };
    let compared = 0;
    let differ10 = 0;
    for (const r of results) {
      const o = m.shards.find((x) => x.shard === r.shard);
      if (!o || o.rows !== r.rows) continue;
      for (const k of ["y", "side", "w1"]) {
        compared += 1;
        if (o.files[shardName(k, r.shard)] !== r.files[shardName(k, r.shard)]) differ10 += 1;
      }
    }
    compare["enc-v1"] = { files: ["y", "side", "w1"], compared, differ: differ10 };
    c10 = [differ10 === 0, `C10 和编码器 v1 对照：${compared} 个 y / side / w1 文件，和 enc-v1 逐字节相同（不同的 ${differ10} 个；行数不同的分片不比${compared === 0 ? "，这次一个都没比" : ""}）。`];
  } else c10 = [true, "C10 和编码器 v1 对照：没有 enc-v1，没比（只报告）。"];
  lines.push(c10);

  // ---- C11–C17 ----
  const bad11 = ["saturations", "poolClamps", "poolMismatch", "unknownDefs", "noTest", "refRandom"].map((k) => diag[k] ?? 0);
  lines.push([
    bad11.every((v) => v === 0) && maskBad === 0,
    `C11 诊断：${rows} 个样本（卡 token ${sizes.cardRows}、牌堆项 ${sizes.pileRows}、gdef 行 ${sizes.gdefRows}）；超出 int16 ${diag.saturations ?? 0}、看不到的牌算成负数 ${diag.poolClamps ?? 0}、张数对不上 ${diag.poolMismatch ?? 0}、表里没有的卡 ${diag.unknownDefs ?? 0}、有比较没方向 ${diag.noTest ?? 0}、随机结果 ${diag.refRandom ?? 0}、"现在能做什么"的掩码不对 ${maskBad}（都应为 0）；只报告：数到主战者 / 其他区的计数 ${diag.refZoneOther ?? 0}、对手的选择 ${diag.oppAlt ?? 0}、记得的牌不在卡表 ${diag.knownNotInList ?? 0}。`,
  ]);
  const topDiffer = Object.entries(differ).sort((a, b) => b[1] - a[1]).slice(0, 10);
  lines.push([
    checks.oracleCompared > 0 && checks.oracleDiffer === 0,
    `C12 和引擎对照"在数什么"（每 25 局，原地、没有看不到的部分）：${checks.oracleCompared} 次，不同的 ${checks.oracleDiffer} 次${topDiffer.length ? `（${topDiffer.map(([d, n]) => `${d} ${n}`).join("、")}）` : ""}；类型或卡名被改过的卡另计 ${checks.oracleDifferRenamed} 次（只报告）。`,
  ]);
  const closureList = Object.entries(closures);
  const lowClosures = closureList.filter(([, v]) => v.agree + v.disagree > 0 && v.agree / (v.agree + v.disagree) < 0.999);
  lines.push([
    closureList.length > 0 && lowClosures.length === 0,
    `C13 卡自己的条件函数（按 test 预测）：${closureList.length} 个函数、${checks.closureCalls} 次调用；一致率低于 99.9% 的 ${lowClosures.length} 个${lowClosures.length ? `（${lowClosures.slice(0, 5).map(([k, v]) => `${k} ${v.disagree}/${v.agree + v.disagree}：${v.examples[0] ?? ""}`).join("；")}）` : ""}。`,
  ]);
  lines.push([checks.evoCompared > 0 && checks.evoDiffer === 0, `C14 剩几张进化卡：${checks.evoCompared} 个未进化随从和引擎给的对应进化卡相同（不同的 ${checks.evoDiffer} 个；被改名的另计 ${checks.evoDifferRenamed} 个）。`]);
  lines.push([
    checks.poolsChecked > 0 && checks.poolsBad === 0 && checks.knownBad === 0,
    `C15 牌池是真的：${checks.poolsChecked} 个视角，我方牌组、对手没见过的牌、双方背面的进化牌都和真实的牌相同（不对的 ${checks.poolsBad} 个）；记得的牌 ${checks.knownChecked} 张都是真的那张（不对的 ${checks.knownBad} 张）。`,
  ]);
  lines.push([checks.leakChecked > 0 && checks.leakBad === 0, `C16 隐藏信息：${checks.leakChecked} 次把看不到的牌重新抽样，收集到的特征都完全相同（不同的 ${checks.leakBad} 次；局面变了没比的 ${checks.leakDrift} 次）。`]);
  const topRange = Object.entries(rangeNames).sort((a, b) => b[1] - a[1]).slice(0, 8);
  lines.push([checks.rangeBad === 0, `C17 取值范围：超出规定范围的值 ${checks.rangeBad} 个${topRange.length ? `（${topRange.map(([n, c]) => `${n} ${c}`).join("、")}）` : ""}（应为 0）。`]);

  // ---- C18, C19: features always 0 ----
  const zeroGlobal = GLOBAL_COLUMNS_V2.filter((_, i) => nonzeroGlobal[i] === 0);
  const zeroCard: string[] = [];
  for (const z of ZONES_V2.filter((x) => x.kind === "card")) {
    const nz = nonzeroCard[String(z.code)];
    CARD_BODY_COLUMNS_V2.forEach((c, i) => {
      if (!nz || nz[i] === 0) zeroCard.push(`${z.name}.${c}`);
    });
  }
  const zeroGdef = GDEF_COLUMNS_V2.filter((_, i) => nonzeroGdef[i] === 0);
  const SITUATIONAL: [RegExp, string][] = [
    [/^g\.phase\.(setup|start|end|over)$|^g\.attack\.inProgress$|^g\.resolution\.count$/, "取样点总在主要阶段开头"],
    [/^g\.me\.hand\.hidden$/, "自己的手牌自己总看得到"],
    [/^g\.(me|opp)\.cls\.neutral$/, "主战者都不是中立"],
    [/uni\.|raceZone|driveZone|triggerZone|equipmentZone/, "这些卡组没有用到的合作宇宙或区域"],
    [/^counters\./, "这些卡组不用的指示物"],
    [/^g\.opp\.listExact$/, "恒为 1"],
  ];
  const explained = zeroGlobal.filter((n) => SITUATIONAL.some(([re]) => re.test(n)));
  lines.push([
    true,
    `C18 恒为 0 的特征（只报告）：全局 ${zeroGlobal.length} 个（有原因的 ${explained.length} 个，其余：${zeroGlobal.filter((n) => !explained.includes(n)).slice(0, 20).join(" ") || "无"}）；卡 token 的（区域, 列）${zeroCard.length} 个；gdef 列 ${zeroGdef.length} 个（${zeroGdef.join(" ") || "无"}）。全部列在 meta.json 的 encoder.zeroFeatures。`,
  ]);
  if (input.compareTo) {
    const other = JSON.parse(readFileSync(join(input.compareTo, "meta.json"), "utf8")) as { encoder: { nonzero: { global: number[]; card: Record<string, number[]> } } };
    const deadThere = GLOBAL_COLUMNS_V2.filter((_, i) => other.encoder.nonzero.global[i] === 0 && nonzeroGlobal[i]! > 0);
    const deadCard: string[] = [];
    for (const z of ZONES_V2.filter((x) => x.kind === "card")) {
      const there = other.encoder.nonzero.card[String(z.code)];
      const here = nonzeroCard[String(z.code)];
      CARD_BODY_COLUMNS_V2.forEach((c, i) => {
        if ((!there || there[i] === 0) && here && here[i]! > 0) deadCard.push(`${z.name}.${c}`);
      });
    }
    const list = (xs: string[]) => xs.slice(0, 15).join(" ") + (xs.length > 15 ? " …" : "");
    compare.zeroThere = { dir: input.compareTo, global: deadThere, card: deadCard };
    lines.push([true, `C19 在 ${input.compareTo} 里恒为 0、这里不为 0 的特征（只报告）：全局 ${deadThere.length} 个（${list(deadThere)}），卡 token ${deadCard.length} 个（${list(deadCard)}）；全部列在 meta.json 的 compare.zeroThere。`]);
  }

  // ---- C20: pooled round trip (the Python reader's part runs after meta.json is written: pythonCheck) ----
  lines.push([chosen.length > 0 && poolDiff === 0, `C20 汇总向量：${chosen.length} 个固定样本（按哈希挑）从写出的数组重算，和编码时算的完全相同（不同的值 ${poolDiff} 个）。`]);

  // ---- C21: speed ----
  const v2p50 = q(input.times.v2, 0.5);
  const v1p50 = q(input.times.v1, 0.5);
  const ratio = v2p50 / v1p50;
  lines.push([
    !(ratio > 3),
    `C21 速度（进程 0 的前 ${input.times.v2.length} 次，${input.workers} 个进程同时在跑）：encodeV2 p50 ${v2p50.toFixed(0)} µs、p99 ${q(input.times.v2, 0.99).toFixed(0)} µs；同一批视角 v1 p50 ${v1p50.toFixed(0)} µs（${ratio.toFixed(2)} 倍，超过 3 倍算不通过）；poolV2 p50 ${q(input.times.pool, 0.5).toFixed(0)} µs、p99 ${q(input.times.pool, 0.99).toFixed(0)} µs。`,
  ]);

  // ---- C22: the same bytes as another encoding ----
  const fileHashes = Object.assign({}, ...results.map((r) => r.files)) as Record<string, string>;
  if (input.compareWith) {
    const other = JSON.parse(readFileSync(join(input.compareWith, "meta.json"), "utf8")) as { shards: { files: Record<string, string> }[] };
    const theirs = Object.assign({}, ...other.shards.map((s) => s.files)) as Record<string, string>;
    const names = new Set([...Object.keys(theirs), ...Object.keys(fileHashes)]);
    const diff = [...names].filter((n) => theirs[n] !== fileHashes[n]);
    compare.sameBytes = { dir: input.compareWith, files: names.size, differ: diff };
    lines.push([diff.length === 0, `C22 和 ${input.compareWith} 比：${names.size} 个分片文件逐字节相同（不同的 ${diff.length} 个${diff.length ? `：${diff.slice(0, 6).join(" ")}` : ""}）。`]);
  }

  // ---- C23: calibration ----
  const cal: Calibration = { hidden: {}, bins: Array.from({ length: 10 }, () => ({ n: 0, p: 0, hit: 0 })), brier: 0, brierN: 0, luck: { n: 0, p: 0, hit: 0, brier: 0 }, pHist: new Array<number>(12).fill(0) };
  for (const r of shards) {
    const c = r.v2!.cal;
    for (const [k, h] of Object.entries(c.hidden)) {
      const t = (cal.hidden[k] ??= { real: 0, expected: 0, n: 0, byGame: {} });
      t.real += h.real;
      t.expected += h.expected;
      t.n += h.n;
      for (const [g, v] of Object.entries(h.byGame)) {
        const e = (t.byGame[Number(g)] ??= [0, 0]);
        e[0] += v[0];
        e[1] += v[1];
      }
    }
    c.bins.forEach((b, i) => {
      cal.bins[i]!.n += b.n;
      cal.bins[i]!.p += b.p;
      cal.bins[i]!.hit += b.hit;
    });
    cal.brier += c.brier;
    cal.brierN += c.brierN;
    cal.luck.n += c.luck.n;
    cal.luck.p += c.luck.p;
    cal.luck.hit += c.luck.hit;
    cal.luck.brier += c.luck.brier;
    c.pHist.forEach((v, i) => (cal.pHist[i]! += v));
  }
  const hiddenRows = Object.entries(cal.hidden).filter(([, h]) => h.n >= 100 && h.expected > 0).map(([k, h]) => ({ k, ratio: h.real / h.expected, n: h.n, ci: bootstrap(h.byGame) }));
  // Fails only when the whole interval is outside 0.8–1.25 (a small run's point ratio is noisy; a wrong pool is not).
  const outOfBand = hiddenRows.filter((h) => h.ci[1] < 0.8 || h.ci[0] > 1.25);
  lines.push([
    outOfBand.length === 0,
    `C23 校准（只报告；"看不到的部分"按没见过的牌均匀抽的先验）：真实 / 期望 ${hiddenRows.map((h) => `${h.k} ${h.ratio.toFixed(3)}（${h.ci[0].toFixed(2)}–${h.ci[1].toFixed(2)}，${h.n} 次）`).join("；") || "（不足 100 次的组不列）"}；概率的可靠性 ${cal.bins.map((b, i) => ({ b, i })).filter(({ b }) => b.n > 0).map(({ b, i }) => `${i * 10}–${i * 10 + 9}%档 预测 ${((100 * b.p) / b.n).toFixed(0)}% 实际 ${((100 * b.hit) / b.n).toFixed(0)}%（${b.n}）`).join("、") || "无"}，Brier ${cal.brierN ? (cal.brier / cal.brierN).toFixed(3) : "-"}；牌组顶的运气 预测 ${cal.luck.n ? ((100 * cal.luck.p) / cal.luck.n).toFixed(1) : "-"}% 实际 ${cal.luck.n ? ((100 * cal.luck.hit) / cal.luck.n).toFixed(1) : "-"}%（${cal.luck.n} 次，Brier ${cal.luck.n ? (cal.luck.brier / cal.luck.n).toFixed(3) : "-"}）。真实 / 期望的区间（按对局重抽 200 次的 95%）整个在 0.8–1.25 之外才算不通过（那说明牌池错了）${outOfBand.length ? `；不通过的：${outOfBand.map((h) => h.k).join("、")}` : ""}。`,
  ]);

  // ---- stats.json ----
  const perZone: Record<string, Record<string, { mean: number; p50: number; p99: number; max: number; samples: number }>> = {};
  const merged: Record<string, Record<string, number[]>> = {};
  for (const r of shards) {
    for (const [group, zones] of Object.entries(r.v2!.perZone)) {
      for (const [z, st] of Object.entries(zones)) {
        const t = ((merged[group] ??= {})[z] ??= new Array<number>(st.length).fill(0));
        st.forEach((v, i) => (i === 2 ? (t[i] = Math.max(t[i]!, v)) : (t[i]! += v)));
      }
    }
  }
  const zoneName = new Map(ZONES_V2.map((z) => [String(z.code), z.name]));
  for (const [group, zones] of Object.entries(merged)) {
    for (const [z, st] of Object.entries(zones)) {
      const hist = st.slice(3);
      const n = hist.reduce((a, b) => a + b, 0);
      const pct = (p: number) => {
        let c = 0;
        for (let i = 0; i < hist.length; i++) {
          c += hist[i]!;
          if (c >= p * n) return i;
        }
        return hist.length - 1;
      };
      (perZone[group] ??= {})[zoneName.get(z)!] = { mean: n ? st[0]! / n : 0, p50: pct(0.5), p99: pct(0.99), max: st[2]!, samples: n };
    }
  }
  const relTotals = Object.fromEntries(REL_COLUMNS_V2.map((c, i) => [c, relSums[i]]));
  const calTiming = (() => {
    if (!input.calibrationView) return null;
    const { view, me, ctx } = input.calibrationView;
    const t0 = performance.now();
    for (let i = 0; i < 2000; i++) encode(view, me, ctx);
    return ((performance.now() - t0) * 1000) / 2000;
  })();
  const stats = {
    perZone,
    relTotals,
    pHistogram: { bins: ["0", "1-99", "100-199", "200-299", "300-399", "400-499", "500-599", "600-699", "700-799", "800-899", "900-999", "1000"], counts: cal.pHist, note: "references with odds at the checked views (every 25th game, in place)" },
    c12: { compared: checks.oracleCompared, differ: checks.oracleDiffer, renamed: checks.oracleDifferRenamed, byDef: differ },
    c23: { hidden: Object.fromEntries(Object.entries(cal.hidden).map(([k, h]) => [k, { real: h.real, expected: h.expected, n: h.n, ci: bootstrap(h.byGame) }])), bins: cal.bins, brier: cal.brierN ? cal.brier / cal.brierN : null, luck: cal.luck },
    timing: { workers: input.workers, encodeV2: { p50: v2p50, p99: q(input.times.v2, 0.99) }, encodeV1: { p50: v1p50 }, poolV2: { p50: q(input.times.pool, 0.5), p99: q(input.times.pool, 0.99) }, v1CalibrationMicros: calTiming, note: "os.loadavg() is always 0 on Windows: a fixed v1 timing (2,000 encodes of one stored view) is the machine's load reference" },
  };
  writeFileSync(join(out, "stats.json"), JSON.stringify(stats, null, 1) + "\n");

  // ---- --pick-from: encoder v1's picked positions printed under v2 ----
  const picked: string[] = [];
  if (input.pickFrom) {
    const meta1 = JSON.parse(readFileSync(join(input.pickFrom, "meta.json"), "utf8")) as { picked: string[] };
    const pickDir = join(out, "pick");
    mkdirSync(pickDir, { recursive: true });
    mkdirSync(input.guiReplays, { recursive: true });
    for (const line of meta1.picked) {
      const m = /^(\d+): game (\d+), turn (\d+), viewer (\d)/.exec(line);
      if (!m) continue;
      const base = m[1]!;
      const viewer = Number(m[4]) as PlayerId;
      const replay = JSON.parse(readFileSync(join(input.pickFrom, "pick", `${base}.json`), "utf8")) as PickReplay;
      const { game, ctx } = input.pickPosition(replay, Number(m[2]));
      const v1text = readFileSync(join(input.pickFrom, "pick", `${base}.txt`), "utf8").split("\n").slice(0, 3).join("\n");
      const prep = prepareV2(ctx);
      const text = [
        `编码器 v2 重印编码器 v1 的第 ${Number(base)} 个局面（${line.replace(/^\d+: /, "")}）。`,
        `录像：在对局界面的"录像"里打开"编码器 v2 检查 ${base}"，放到最后就是这个局面。`,
        "",
        "编码器 v1 的说明（前三行）：",
        v1text,
        "",
        describeV2(game.view(viewer), viewer, prep, {
          card: input.cardName,
          trait: (t) => TRAIT_NAMES[t]?.cn ?? t,
          keyword: (kw) => (zh as Record<string, string>)[`keyword.${kw}`] ?? kw,
        }),
      ].join("\n");
      writeFileSync(join(pickDir, `${base}.json`), JSON.stringify(replay));
      writeFileSync(join(pickDir, `${base}.txt`), text, "utf8");
      copyFileSync(join(pickDir, `${base}.json`), join(input.guiReplays, `编码器 v2 检查 ${base}.json`));
      picked.push(`${base}: ${line.replace(/^\d+: /, "")}`);
    }
  }

  const sch = encoderV2Schema();
  const namesHash = (names: readonly string[]) => sha(names.join("\n")).slice(0, 16);
  const layoutHash = sha([namesHash(GLOBAL_COLUMNS_V2), namesHash(CARD_BODY_COLUMNS_V2), namesHash(GDEF_COLUMNS_V2), namesHash(sch.pooled.names), ZONES_V2.map((z) => `${z.code}:${z.name}`).join(",")].join("|")).slice(0, 16);
  const meta = {
    format: "sve-samples",
    formatVersion: 2,
    encoder: {
      version: ENCODER_V2_VERSION,
      variant: "fair",
      refSemantics: "refs-2",
      slotsK: 4,
      zones: ZONES_V2,
      arrays: {
        glob: { dtype: "int16", names: GLOBAL_COLUMNS_V2, ranges: input.ranges.global, masked: sch.global.masked, namesHash: namesHash(GLOBAL_COLUMNS_V2) },
        card: { dtype: "int16", header: sch.card.header, body: CARD_BODY_COLUMNS_V2, ranges: input.ranges.body, applies: sch.card.applies, pointers: ["zone", "def", "gd"], namesHash: namesHash(CARD_BODY_COLUMNS_V2) },
        pile: { dtype: "int16", names: PILE_COLUMNS_V2, pointers: ["zone", "def", "gd"] },
        gdef: { dtype: "int16", header: sch.gdef.header, names: GDEF_COLUMNS_V2, ranges: input.ranges.gdef, pointers: ["def", "seat"], namesHash: namesHash(GDEF_COLUMNS_V2) },
        off: { dtype: "int32", shape: "[n + 1, 2]: first card row, first pile row" },
        gbase: { dtype: "int32", shape: "[n]: the sample's game's first gdef row" },
        pointerNote: "zone, def, gd (cards, piles) and def, seat (gdef) are pointers, never features (D21)",
      },
      pooled: { dims: sch.pooled.dims, names: sch.pooled.names, groups: sch.pooled.groups, layout: POOL_LAYOUT_V2, masked: sch.pooled.masked, namesHash: namesHash(sch.pooled.names) },
      scales: { e16: 16, p: 1000 },
      playerTypes: sch.playerTypes,
      layoutHash,
      zeroFeatures: { global: zeroGlobal, card: zeroCard, gdef: zeroGdef },
      nonzero: { global: nonzeroGlobal, card: nonzeroCard, gdef: nonzeroGdef },
    },
    cardFeatures: { version: CARD_FEATURES_VERSION, columnsHash: table.file.columnsHash, hash: table.file.hash, rulesFingerprint: table.file.rulesFingerprint },
    defs: { count: defs.count, staticSha256: defs.staticSha, defsSha256: defs.defsSha },
    sizes: { ...sizes, rows },
    pooledCheck: { samples: chosen.length, differences: poolDiff },
    golden: { samples: golden.length },
    timing: stats.timing,
    compare,
  };
  // C11–C17's counters (meta.json's checks.v2; encoder v1's own counters stay 0 in a v2 run).
  const v2checks = { ...checks, maskBad, diagnostics: diag, rangeNames, oracleDifferByDef: differ, closures: Object.fromEntries(closureList.map(([k, v]) => [k, { agree: v.agree, disagree: v.disagree }])) };
  return { lines, meta, checks: v2checks, picked };
}

/** One line of the run registry (D:\SVE\rl-runs\registry.jsonl). */
export function appendRegistry(file: string, entry: Record<string, unknown>): void {
  mkdirSync(join(file, ".."), { recursive: true });
  writeFileSync(file, JSON.stringify(entry) + "\n", { flag: "a" });
}

/** C20's Python part: the reference reader (numpy) recomputes the fixed samples' pooled vectors (after meta.json). */
export function pythonCheck(root: string, out: string): [boolean, string] {
  const last = (text: string) => text.trim().split("\n").pop() ?? "";
  try {
    const res = execFileSync("py", ["-3.14", "-I", join(root, "tools", "rl", "py", "check_encv2.py"), out], { encoding: "utf8", timeout: 900_000, stdio: ["ignore", "pipe", "pipe"] });
    return [true, `C20 Python 端：${last(res)}。`];
  } catch (e) {
    const err = e as { code?: string; status?: number | null; stdout?: string; stderr?: string; message: string };
    const stderr = String(err.stderr ?? "");
    // Only a missing Python or numpy leaves the check for later; anything else (a crash included) fails it.
    if (err.code === "ENOENT" || /ModuleNotFoundError: No module named 'numpy'|No suitable Python runtime/.test(stderr)) {
      return [true, `C20 Python 端：待做（运行不了：${(last(stderr) || String(err.message).split("\n")[0]!).slice(0, 100)}；准备好 numpy 再跑）。`];
    }
    return [false, `C20 Python 端：出错（退出码 ${err.status ?? "-"}）：${last(err.stdout ?? "")}${stderr ? ` ${last(stderr).slice(0, 200)}` : ""}。`];
  }
}

