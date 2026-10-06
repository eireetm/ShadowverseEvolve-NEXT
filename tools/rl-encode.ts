/**
 * The value network's samples from a run's games: npm run rl:encode -- <run dir> [--out <dir>] [--workers N] [--limit N] [--force]
 * Reads <run dir>/games.jsonl.gz (the games npm run rl:ingest took), replays every game with this repository's rules code
 * (the same as the games', or the run stops), and at each sample point (tools/rl/sampling.ts: the first main phase decision
 * of the active player in a turn) takes both players' views. Per sample: the label (1 won, 0.5 drawn, 0 lost), side columns
 * (which game and input, who is active and first, which bots, decks, exploration, turns left, leader defense differences now
 * and at the next two sample points, the hand-written evaluation, the split) and the hand-written evaluation's terms of both
 * sides (W1's inputs, tools/rl/eval-terms.ts). The encoder's features come in a later version of this tool.
 * Output (default <run dir>/enc-v1): shards of 1000 games, by game index (the same bytes whatever the number of processes):
 * y-NNNN.npy (float32 [n]), side-NNNN.npy (float32 [n, 21]), w1-NNNN.npy (int16 [n, 2 × terms]); games.csv (one line a game);
 * meta.json (columns, sources, hashes, counts, checks); report.txt (the checks, one line each).
 * A game whose bucket (tools/rl/sampling.ts) is 0–79 is training data, 80–89 validation, 90–99 test; a job with holdout decks
 * (its job file has withOne) is a test set of its own (split 3).
 */
import { execFileSync, fork } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { availableParallelism } from "node:os";
import { join, resolve } from "node:path";
import { DEFAULT_WEIGHTS, evaluate } from "../packages/bot/src";
import { createEngine, opponentOf, type PlayerId } from "../packages/core/src";
import { ALL_CARDS, ALL_SCRIPTS } from "../packages/core/src/sets";
import { rulesFingerprint } from "../packages/gui/fingerprint";
import { writeNpy } from "./rl/npy";
import { gameLines } from "./rl/records";
import { bucketOf, labelOf, replaySamples, splitOf } from "./rl/sampling";
import { DECK_SETS, ROOT } from "./rl/series";
import { W1_TERMS, dotTerms, evalTerms, termWeights } from "./rl/eval-terms";
import { botFingerprint, rulesOfRecorded } from "./train/code";
import type { JobFile, JobGame } from "./train/job";

const args = process.argv.slice(2);
const option = (name: string) => {
  const at = args.indexOf(name);
  return at >= 0 ? (args[at + 1] ?? null) : null;
};
const VALUED = ["--out", "--workers", "--limit", "--worker", "--workers-total"];
const runDir = args.find((a, i) => !a.startsWith("--") && !(i > 0 && VALUED.includes(args[i - 1]!)));
const workers = Number(option("--workers") ?? Math.min(4, Math.max(1, Math.floor(availableParallelism() / 4))));
const limit = option("--limit") === null ? Infinity : Number(option("--limit"));
const records = runDir ? join(resolve(runDir), "games.jsonl.gz") : "";
if (!runDir || !existsSync(records) || !(Number.isInteger(workers) && workers >= 1) || !(limit > 0)) {
  console.error("usage: npm run rl:encode -- <run dir with games.jsonl.gz> [--out <dir>] [--workers N] [--limit N] [--force]");
  process.exit(1);
}
const out = resolve(option("--out") ?? join(resolve(runDir), "enc-v1"));
const SHARD = 1000;

export const SIDE_COLUMNS = [
  "game",
  "input",
  "turn",
  "viewer",
  "isActive",
  "meFirst",
  "meBot",
  "oppBot",
  "deckMe",
  "deckOpp",
  "pairKind",
  "explored",
  "exploredBefore",
  "turnsLeft",
  "hpDiff0",
  "hpDiff1",
  "hpDiff2",
  "handEval",
  "split",
  "bucket",
  "poolMismatch",
] as const;
const COL = Object.fromEntries(SIDE_COLUMNS.map((c, i) => [c, i])) as Record<(typeof SIDE_COLUMNS)[number], number>;
const W1_COLUMNS = [...W1_TERMS.map((t) => `w1.me.${t}`), ...W1_TERMS.map((t) => `w1.opp.${t}`)];
/** The players' bots, as the one-hot of the encoder will have them (v1: the bots of the stage 1 data). */
const PLAYER_TYPES = ["medium", "easy"] as const;
const DECKS = [...DECK_SETS.train, ...DECK_SETS.holdout];

/** One game's line of games.csv, and where its rows are. */
interface GameInfo {
  game: number;
  seed: string;
  volunteer: string;
  deck0: string;
  deck1: string;
  bot0: string;
  bot1: string;
  first: number;
  winner: number | "draw";
  turns: number;
  split: number;
  bucket: number;
  shard: number;
  firstRow: number;
  rows: number;
  explored0: number;
  explored1: number;
}
/** What a worker found in a shard. */
interface ShardResult {
  shard: number;
  rows: number;
  games: GameInfo[];
  files: Record<string, string>;
  dropped: Record<string, number>;
  checks: { labelPairs: number; labelBad: number; predicateDisagree: number; pointGames: number; rebuildBad: number; rebuilt: number; turnGaps: number; broken: number; botBad: number; w1MaxError: number; holdoutInTrain: number; noHoldoutInHoldout: number };
}

/** JSON with every object's keys in order (the same value, the same text). */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_, v: unknown) => (v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0))) : v));
}

/** The job files of tools/rl/jobs, by id. */
function jobFiles(): Map<string, JobFile> {
  const dir = join(ROOT, "tools", "rl", "jobs");
  return new Map(readdirSync(dir).filter((f) => f.endsWith(".json")).map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")) as JobFile).map((j) => [j.id, j]));
}

/** The worker: the shards k, k + N, k + 2N … of the games. */
function runWorker(k: number): void {
  const engine = createEngine({ cards: ALL_CARDS, scripts: ALL_SCRIPTS });
  const fingerprint = rulesFingerprint(join(ROOT, "packages", "gui"));
  const jobs = jobFiles();
  const weights = termWeights(DEFAULT_WEIGHTS);
  const holdoutDecks = new Set(DECK_SETS.holdout);
  let shard = -1;
  let acc: ReturnType<typeof freshShard> | null = null;
  function freshShard(s: number) {
    return { s, y: [] as number[], side: [] as number[], w1: [] as number[], games: [] as GameInfo[], dropped: {} as Record<string, number>, checks: { labelPairs: 0, labelBad: 0, predicateDisagree: 0, pointGames: 0, rebuildBad: 0, rebuilt: 0, turnGaps: 0, broken: 0, botBad: 0, w1MaxError: 0, holdoutInTrain: 0, noHoldoutInHoldout: 0 } };
  }
  const flush = () => {
    if (!acc) return;
    const rows = acc.y.length;
    const name = (kind: string) => `${kind}-${String(acc!.s).padStart(4, "0")}.npy`;
    writeNpy(join(out, name("y")), Float32Array.from(acc.y), [rows]);
    writeNpy(join(out, name("side")), Float32Array.from(acc.side), [rows, SIDE_COLUMNS.length]);
    writeNpy(join(out, name("w1")), Int16Array.from(acc.w1), [rows, W1_COLUMNS.length]);
    const files = Object.fromEntries(["y", "side", "w1"].map((kind) => [name(kind), createHash("sha256").update(readFileSync(join(out, name(kind)))).digest("hex")]));
    const result: ShardResult = { shard: acc.s, rows, games: acc.games, files, dropped: acc.dropped, checks: acc.checks };
    process.send!(result);
    acc = null;
  };
  let index = -1;
  const readStats = { broken: 0 };
  for (const line of gameLines(records, readStats)) {
    index += 1;
    if (index >= limit) break;
    const s = Math.floor(index / SHARD);
    if (s % workersOf() !== k) continue;
    if (s !== shard) {
      flush();
      shard = s;
      acc = freshShard(s);
    }
    const a = acc!;
    const g = JSON.parse(line) as JobGame;
    const drop = (why: string) => (a.dropped[why] = (a.dropped[why] ?? 0) + 1);
    if (rulesOfRecorded(String(g.engine?.fingerprint)) !== fingerprint) {
      drop("other rules code");
      continue;
    }
    if (g.error || g.result.winner === "?") {
      drop("unfinished");
      continue;
    }
    const bots = g.bots.map((b) => PLAYER_TYPES.indexOf(b.level as (typeof PLAYER_TYPES)[number]));
    if (bots.some((b) => b < 0)) {
      drop("a bot the encoder has no player type for");
      continue;
    }
    // The job's own bot specs: a record must have been played by them (its Medium with the job's options).
    const job = jobs.get(g.job);
    const specs = new Set((job?.games ?? []).flatMap((kind) => kind.bots.map((b) => canonical(b))));
    if (!job || g.bots.some((b) => !specs.has(canonical(b)))) a.checks.botBad += 1;
    const holdoutSet = (job?.withOne?.length ?? 0) > 0;
    const hasHoldout = g.decks.some((d) => holdoutDecks.has(d.name));
    if (!holdoutSet && hasHoldout) a.checks.holdoutInTrain += 1;
    if (holdoutSet && !hasHoldout) a.checks.noHoldoutInHoldout += 1;
    const bucket = bucketOf(g.seed);
    const split = holdoutSet ? 3 : splitOf(bucket);
    const winner = g.result.winner as PlayerId | null;
    const game = engine.newGame({ seed: g.seed, players: [g.decks[0]!.deck, g.decks[1]!.deck], config: g.config as never });
    // The samples of this game, then their rows (the leader defense differences ahead need the later samples).
    const samples: { input: number; turn: number; active: PlayerId; first: PlayerId; hp: [number, number]; terms: [ReturnType<typeof evalTerms>, ReturnType<typeof evalTerms>]; hand: [number, number] }[] = [];
    let lastTurn = -1;
    let lastInput = -1;
    const it = replaySamples(game, g.inputs);
    let step = it.next();
    for (; !step.done; step = it.next()) {
      const { point, game: at } = step.value;
      if (lastTurn >= 0 && point.turn !== lastTurn + 1) a.checks.turnGaps += 1;
      lastTurn = point.turn;
      lastInput = point.input;
      const views = [at.view(0), at.view(1)] as const;
      samples.push({
        input: point.input,
        turn: point.turn,
        active: point.active,
        first: at.state.firstPlayer as PlayerId,
        hp: [views[0].players[0].leaderDefense - views[0].players[1].leaderDefense, views[1].players[1].leaderDefense - views[1].players[0].leaderDefense],
        terms: [evalTerms(views[0], 0), evalTerms(views[1], 1)],
        hand: [evaluate(views[0], 0), evaluate(views[1], 1)],
      });
    }
    const end = step.value;
    if (!end.result || end.result.winner !== winner || end.state.turn !== g.result.turns) {
      drop("doesn't end as recorded");
      continue;
    }
    // On every 25th game, checks that don't trust replaySamples. (1) The planner's own stop condition (toNextMainPhase in
    // packages/bot/src/planner.ts: a later turn's first main phase decision of the active player), walked separately over
    // the inputs, stops exactly at the sample points. (2) Replaying the inputs before a sample point's input rebuilds that
    // position (the active player's main phase decision of that turn, the same hand-written evaluation).
    if (index % 25 === 0) {
      a.checks.pointGames += 1;
      const fresh = engine.newGame({ seed: g.seed, players: [g.decks[0]!.deck, g.decks[1]!.deck], config: g.config as never });
      const stops: number[] = [];
      let t = -1;
      for (const [i, [, input]] of g.inputs.entries()) {
        const d = fresh.decision;
        if (d && d.type === "mainPhase" && d.player === fresh.state.activePlayer && fresh.state.turn > t) {
          stops.push(i);
          t = fresh.state.turn;
        }
        fresh.act(input as never);
      }
      if (JSON.stringify(stops) !== JSON.stringify(samples.map((s) => s.input))) a.checks.predicateDisagree += 1;
      for (const smp of [samples[0], samples[Math.floor(samples.length / 2)]]) {
        if (!smp) continue;
        const again = engine.newGame({ seed: g.seed, players: [g.decks[0]!.deck, g.decks[1]!.deck], config: g.config as never });
        for (const [, input] of g.inputs.slice(0, smp.input)) again.act(input as never);
        const d = again.decision;
        a.checks.rebuilt += 1;
        if (!d || d.type !== "mainPhase" || d.player !== again.state.activePlayer || again.state.turn !== smp.turn || evaluate(again.view(0), 0) !== smp.hand[0]) a.checks.rebuildBad += 1;
      }
    }
    const finalViews = [end.view(0), end.view(1)] as const;
    const finalHp = [finalViews[0].players[0].leaderDefense - finalViews[0].players[1].leaderDefense, finalViews[1].players[1].leaderDefense - finalViews[1].players[0].leaderDefense];
    const explored = [new Set(g.explored[0]), new Set(g.explored[1])];
    const allExplored = [...g.explored[0], ...g.explored[1]];
    const firstRow = a.y.length;
    for (const [n, smp] of samples.entries()) {
      const ys: number[] = [];
      for (const viewer of [0, 1] as const) {
        const y = labelOf(winner, viewer);
        ys.push(y);
        const t = smp.terms[viewer];
        const w1 = dotTerms(weights, t.me, t.opp);
        a.checks.w1MaxError = Math.max(a.checks.w1MaxError, Math.abs(w1 - smp.hand[viewer]));
        const row = new Array<number>(SIDE_COLUMNS.length).fill(0);
        row[COL.game] = index;
        row[COL.input] = smp.input;
        row[COL.turn] = smp.turn;
        row[COL.viewer] = viewer;
        row[COL.isActive] = smp.active === viewer ? 1 : 0;
        row[COL.meFirst] = smp.first === viewer ? 1 : 0;
        row[COL.meBot] = bots[viewer]!;
        row[COL.oppBot] = bots[opponentOf(viewer)]!;
        row[COL.deckMe] = DECKS.indexOf(g.decks[viewer]!.name);
        row[COL.deckOpp] = DECKS.indexOf(g.decks[opponentOf(viewer)]!.name);
        row[COL.pairKind] = bots[0] === 0 && bots[1] === 0 ? 0 : 1;
        row[COL.explored] = explored[smp.active]!.has(smp.turn) ? 1 : 0;
        row[COL.exploredBefore] = allExplored.filter((x) => x < smp.turn).length;
        row[COL.turnsLeft] = g.result.turns - smp.turn;
        row[COL.hpDiff0] = smp.hp[viewer];
        row[COL.hpDiff1] = samples[n + 1]?.hp[viewer] ?? finalHp[viewer]!;
        row[COL.hpDiff2] = samples[n + 2]?.hp[viewer] ?? finalHp[viewer]!;
        row[COL.handEval] = smp.hand[viewer];
        row[COL.split] = split;
        row[COL.bucket] = bucket;
        a.y.push(y);
        a.side.push(...row);
        a.w1.push(...t.me, ...t.opp);
      }
      a.checks.labelPairs += 1;
      if (ys[0]! + ys[1]! !== 1) a.checks.labelBad += 1;
    }
    a.games.push({
      game: index,
      seed: g.seed,
      volunteer: String(g.volunteer),
      deck0: g.decks[0]!.name,
      deck1: g.decks[1]!.name,
      bot0: g.bots[0]!.level,
      bot1: g.bots[1]!.level,
      first: g.firstPlayer ?? -1,
      winner: winner === null ? "draw" : winner,
      turns: g.result.turns,
      split,
      bucket,
      shard: a.s,
      firstRow,
      rows: a.y.length - firstRow,
      explored0: g.explored[0].length,
      explored1: g.explored[1].length,
    });
  }
  flush();
  // The file's damaged pieces (every worker reads the whole file: the first one tells), as a shard of nothing.
  if (k === 0) {
    const none = freshShard(-1);
    none.checks.broken = readStats.broken;
    process.send!({ shard: -1, rows: 0, games: [], files: {}, dropped: {}, checks: none.checks } satisfies ShardResult);
  }
}
function workersOf(): number {
  return Number(option("--workers-total") ?? 1);
}

if (option("--worker") !== null) {
  runWorker(Number(option("--worker")));
} else {
  if (existsSync(out) && readdirSync(out).length > 0 && !args.includes("--force")) {
    console.error(`${out} isn't empty: --force to write over it, or --out elsewhere`);
    process.exit(1);
  }
  mkdirSync(out, { recursive: true });
  // What an earlier run left (a smaller run would leave its extra shards next to a meta.json that doesn't list them).
  for (const name of readdirSync(out)) if (/^(x|y|side|w1)-\d{4}\.npy$|^(games\.csv|meta\.json|report\.txt)$/.test(name)) rmSync(join(out, name));
  const started = Date.now();
  let total = 0;
  for (const _ of gameLines(records)) if (++total >= limit) break;
  const shards = Math.ceil(total / SHARD);
  const n = Math.min(workers, shards);
  console.log(`${total} games, ${shards} shards, ${n} processes -> ${out}`);
  const results: ShardResult[] = [];
  await Promise.all(
    Array.from({ length: n }, (_, k) =>
      new Promise<void>((done, fail) => {
        const child = fork(process.argv[1]!, [...args, "--worker", String(k), "--workers-total", String(n)], { stdio: ["ignore", "inherit", "inherit", "ipc"] });
        child.on("message", (r: ShardResult) => {
          results.push(r);
          if (r.shard >= 0) console.log(`  shard ${r.shard}: ${r.games.length} games, ${r.rows} samples`);
        });
        child.on("exit", (code) => (code === 0 ? done() : fail(new Error(`process ${k} ended with ${code}`))));
      }),
    ),
  );
  const broken = results.find((r) => r.shard === -1)?.checks.broken ?? 0;
  results.splice(0, results.length, ...results.filter((r) => r.shard >= 0));
  results.sort((a, b) => a.shard - b.shard);
  // The shards' rows in order: a game's first row in the whole set.
  let offset = 0;
  const games: GameInfo[] = [];
  for (const r of results) {
    for (const g of r.games) games.push({ ...g, firstRow: g.firstRow + offset });
    offset += r.rows;
  }
  const csvColumns: (keyof GameInfo)[] = ["game", "seed", "volunteer", "deck0", "deck1", "bot0", "bot1", "first", "winner", "turns", "split", "bucket", "shard", "firstRow", "rows", "explored0", "explored1"];
  writeFileSync(join(out, "games.csv"), [csvColumns.join(","), ...games.map((g) => csvColumns.map((c) => String(g[c])).join(","))].join("\n") + "\n");
  const sum = (f: (r: ShardResult) => number) => results.reduce((s, r) => s + f(r), 0);
  const dropped: Record<string, number> = {};
  for (const r of results) for (const [why, c] of Object.entries(r.dropped)) dropped[why] = (dropped[why] ?? 0) + c;
  const checks = {
    labelPairs: sum((r) => r.checks.labelPairs),
    labelBad: sum((r) => r.checks.labelBad),
    predicateDisagree: sum((r) => r.checks.predicateDisagree),
    pointGames: sum((r) => r.checks.pointGames),
    rebuilt: sum((r) => r.checks.rebuilt),
    rebuildBad: sum((r) => r.checks.rebuildBad),
    turnGaps: sum((r) => r.checks.turnGaps),
    broken,
    botBad: sum((r) => r.checks.botBad),
    w1MaxError: Math.max(0, ...results.map((r) => r.checks.w1MaxError)),
    holdoutInTrain: sum((r) => r.checks.holdoutInTrain),
    noHoldoutInHoldout: sum((r) => r.checks.noHoldoutInHoldout),
  };
  const bySplit = [0, 1, 2, 3].map((s) => games.filter((g) => g.split === s).length);
  const rows = offset;
  const kept = games.length;
  const share = (s: number) => (kept > 0 ? (100 * bySplit[s]!) / kept : 0);
  const holdoutData = bySplit[3]! > 0;
  const git = (...a: string[]) => {
    try {
      return execFileSync("git", ["-C", ROOT, ...a], { encoding: "utf8" }).trim();
    } catch {
      return "";
    }
  };
  const lines: [boolean, string][] = [
    [kept > 0 && Object.keys(dropped).every((k) => k === "unfinished"), `对局：${total} 局，收下 ${kept} 局${Object.keys(dropped).length ? `，没用 ${Object.entries(dropped).map(([k, v]) => `${v}（${k}）`).join("、")}` : ""}；全部重放到记录的结果。`],
    [checks.broken === 0, `文件：${checks.broken} 块读不出（应为 0）。`],
    [checks.labelBad === 0, `标签：${checks.labelPairs} 个取样点，标签取自记录的胜负（重放到最后和记录一致的对局才用），双方视角相加为 1。`],
    [checks.pointGames > 0 && checks.predicateDisagree === 0, `取样点：${checks.pointGames} 局另走一遍规划器 toNextMainPhase 的停止条件，停的位置和取样点完全相同（不同的 ${checks.predicateDisagree} 局）。`],
    [checks.rebuilt > 0 && checks.rebuildBad === 0, `重建：${checks.rebuilt} 个取样点只凭种子和前面的输入重放，都回到那个回合行动方的主要阶段、手写估值相同（不对的 ${checks.rebuildBad} 个）。`],
    [true, `回合：相邻两个取样点的回合不相连的 ${checks.turnGaps} 处（被跳过的回合；只报告）。`],
    [checks.botBad === 0, `执棋者：每局的 Bot 都是任务里写的（不对的 ${checks.botBad} 局）。`],
    [
      holdoutData
        ? checks.noHoldoutInHoldout === 0 && bySplit[3] === kept
        : checks.holdoutInTrain === 0 && (kept < 2000 || (Math.abs(share(0) - 80) <= 2 && Math.abs(share(1) - 10) <= 2 && Math.abs(share(2) - 10) <= 2)),
      holdoutData
        ? `切分：测试卡组的数据，${bySplit[3]} 局都有测试卡组（没有的 ${checks.noHoldoutInHoldout} 局）。`
        : `切分：训练 / 验证 / 测试 = ${share(0).toFixed(1)}% / ${share(1).toFixed(1)}% / ${share(2).toFixed(1)}%（应为 80 / 10 / 10 ± 2${kept < 2000 ? "；不到 2000 局，不判断比例" : ""}），一局的样本都在同一边；有测试卡组的对局 ${checks.holdoutInTrain} 局（应为 0）。`,
    ],
    [checks.w1MaxError < 1e-9, `W1 的项：默认权重乘以双方的项，和手写估值的差最大 ${checks.w1MaxError.toExponential(1)}（应 < 1e-9）。`],
  ];
  const report = [`rl:encode ${new Date(started).toISOString()}  ${records}`, `样本 ${rows} 个（每局约 ${(rows / Math.max(1, kept)).toFixed(1)} 个），用时 ${((Date.now() - started) / 60000).toFixed(1)} 分钟`, ...lines.map(([ok, text]) => `${ok ? "通过" : "不通过"}  ${text}`)].join("\n");
  writeFileSync(join(out, "report.txt"), report + "\n", "utf8");
  const meta = {
    format: "sve-samples",
    formatVersion: 1,
    encoder: null,
    note: "x (the encoder's features) isn't written yet: y, side and w1 only",
    columns: {
      y: "1 won, 0.5 drawn, 0 lost, from the viewer's side",
      side: SIDE_COLUMNS,
      w1: W1_COLUMNS,
      notes: {
        game: "the game's line in games.jsonl.gz (games.csv's game column; dropped games have no line in games.csv)",
        firstRow: "games.csv: the game's first row in all shards read in shard order",
        w1: "signed so that a side's hand-written value is the sum of weight times term (leaderDanger and deckDanger are minus the shortfall); the evaluation is w1.me minus w1.opp; 24 terms a side",
      },
    },
    playerTypes: PLAYER_TYPES,
    decks: DECKS,
    split: { salt: "split-v1", hash: "FNV-1a 32 of UTF-8 'split-v1|' + seed, mod 100", ranges: { train: [0, 79], valid: [80, 89], test: [90, 99] }, holdout: 3 },
    source: {
      path: records,
      sha256: createHash("sha256").update(readFileSync(records)).digest("hex"),
      games: total,
      rulesFingerprint: rulesFingerprint(join(ROOT, "packages", "gui")),
      botFingerprint: botFingerprint(ROOT),
      commit: git("rev-parse", "--short", "HEAD"),
      dirty: git("status", "--porcelain", "--", "packages/core", "packages/bot", "tools") !== "",
      command: `rl:encode ${args.join(" ")}`,
    },
    shards: results.map((r) => ({ shard: r.shard, rows: r.rows, games: r.games.length, files: r.files })),
    counts: { games: kept, samples: rows, bySplit, dropped },
    checks,
  };
  writeFileSync(join(out, "meta.json"), JSON.stringify(meta, null, 1) + "\n");
  console.log(report);
  if (lines.some(([ok]) => !ok)) process.exitCode = 1;
}
