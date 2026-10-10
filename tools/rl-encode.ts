/**
 * The value network's samples from a run's games: npm run rl:encode -- <run dir> [--out <dir>] [--workers N] [--limit N]
 *   [--no-x] [--pick N] [--leak-every N] [--leaf-check N] [--force]
 * Reads <run dir>/games.jsonl.gz (the games npm run rl:ingest took), replays every game with this repository's rules code
 * (the same as the games', or older rules code a replay certificate of npm run rl:certify vouches for; other games are left
 * out), and at each sample point (tools/rl/sampling.ts: the first main phase decision
 * of the active player in a turn) takes both players' views. Per sample: the encoder's features (x: encoder v1 of
 * packages/bot/src/encoder.ts, with the card feature table card-features.json, both decks' lists and both players' bots),
 * the label (1 won, 0.5 drawn, 0 lost), side columns (which game and input, who is active and first, which bots, decks,
 * exploration, turns left, leader defense differences now and at the next two sample points, the hand-written evaluation,
 * the split) and the hand-written evaluation's terms of both sides (W1's inputs, tools/rl/eval-terms.ts).
 * Output (default <run dir>/enc-v1): shards of 1000 games, by game index (the same bytes whatever the number of processes):
 * x-NNNN.npy (int16 [n, dims]; not with --no-x), y-NNNN.npy (float32 [n]), side-NNNN.npy (float32 [n, 21]), w1-NNNN.npy
 * (int16 [n, 2 × terms]); games.csv (one line a game); meta.json (columns, the encoder's names and groups, sources, hashes,
 * counts, checks); report.txt (the checks, one line each, in Chinese). --pick N writes N positions (some at random, some the
 * hand-written evaluation found most surprising) for a person to check: pick/NN.json, a replay the GUI opens that stops at
 * the position (also copied into the GUI's replays folder), and pick/NN.txt, the encoder's reading of it.
 * A game whose bucket (tools/rl/sampling.ts) is 0–79 is training data, 80–89 validation, 90–99 test; a job with holdout decks
 * (its job file has withOne) is a test set of its own (split 3).
 * --encoder 2 (default output <run dir>/enc-v2): encoder v2 (packages/bot/src/encoder-v2.ts) instead of x — per shard
 * glob-NNNN.npy (int16 [n, 159]), card-NNNN.npy (int16 card tokens [Nc, 103]), pile-NNNN.npy (int16 [Np, 4]), off-NNNN.npy
 * (int32 [n + 1, 2]: each sample's first card and pile row), gbase-NNNN.npy (int32 [n]: its game's first gdef row),
 * gdef-NNNN.npy (int16 [Ng, 25]), with the same y / side / w1; static.npy and defs.json (the card table's rows by
 * definition index), pooled-check (poolV2 of fixed samples, recomputed from the written arrays), goldens, stats.json, and
 * the checks C1–C24 (tools/rl/enc-v2-writer.ts). --compare-with <dir> compares every file with another encoding of the same
 * games (C22: 1 and 8 processes give the same bytes); --compare-to <dir> lists features always 0 there but not here (C19);
 * --pick-from <enc-v1 dir> prints that encoding's picked positions under v2.
 * Every run adds a line to ../rl-runs/registry.jsonl (the command, the code, the input and output, the checks), except with
 * --no-registry (tests).
 */
import { execFileSync, fork } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { availableParallelism } from "node:os";
import { join, resolve } from "node:path";
import {
  CARD_FEATURE_COLUMNS,
  CARD_FEATURES_VERSION,
  DEFAULT_WEIGHTS,
  MEDIUM_OPTIONS,
  PlannerBot,
  cardFeatureTable,
  decode,
  describe,
  describeV2,
  emptyDiagnosticsV2,
  encode,
  encodeV2,
  encoderSchema,
  encoderV2Schema,
  poolV2,
  prepareV2,
  type EncodedV2,
  type EncodeDiagnosticsV2,
  type PreparedV2,
  evaluate,
  infoDefOf,
  knownDeck,
  type CardFeatureFile,
  type EncodeDiagnostics,
  type EncoderContext,
  type PlayerType,
} from "../packages/bot/src";
import { createEngine, opponentOf, type CardView, type DefId, type GameSession, type HiddenCardView, type PlayerId, type PlayerView } from "../packages/core/src";
import { ALL_CARDS, ALL_SCRIPTS } from "../packages/core/src/sets";
import { rulesFingerprint } from "../packages/gui/fingerprint";
import { COUNTER_NAMES } from "../packages/gui/src/i18n/counters";
import { zh } from "../packages/gui/src/i18n/zh";
import { certifiedRules } from "./rl/certificate";
import { readNpy, writeNpy } from "./rl/npy";
import * as V2 from "./rl/enc-v2-writer";
import { appendRegistry, finishV2, pythonCheck, type PickReplay } from "./rl/enc-v2-finish";
import { analyzeScripts } from "./rl/script-analysis";
import { gameLines } from "./rl/records";
import { bucketOf, labelOf, replaySamples, splitOf } from "./rl/sampling";
import { DECK_SETS, ROOT, sampleDeck } from "./rl/series";
import { W1_TERMS, dotTerms, evalTerms, termWeights } from "./rl/eval-terms";
import { botFingerprint, rulesOfRecorded } from "./train/code";
import type { JobFile, JobGame } from "./train/job";

const args = process.argv.slice(2);
const option = (name: string) => {
  const at = args.indexOf(name);
  return at >= 0 ? (args[at + 1] ?? null) : null;
};
const VALUED = ["--out", "--workers", "--limit", "--worker", "--workers-total", "--pick", "--leak-every", "--leaf-check", "--encoder", "--compare-with", "--compare-to", "--pick-from", "--games-total"];
const runDir = args.find((a, i) => !a.startsWith("--") && !(i > 0 && VALUED.includes(args[i - 1]!)));
const workers = Number(option("--workers") ?? Math.min(4, Math.max(1, Math.floor(availableParallelism() / 4))));
const limit = option("--limit") === null ? Infinity : Number(option("--limit"));
const withX = !args.includes("--no-x");
const pick = Number(option("--pick") ?? 0);
const encoderVersion = Number(option("--encoder") ?? 1);
const v2 = encoderVersion === 2;
const leakEvery = Number(option("--leak-every") ?? (v2 ? 250 : 500));
const leafCheck = Number(option("--leaf-check") ?? 0);
const records = runDir ? join(resolve(runDir), "games.jsonl.gz") : "";
if (!runDir || !existsSync(records) || !(Number.isInteger(workers) && workers >= 1) || !(limit > 0) || !(pick >= 0) || !(leakEvery >= 1) || !(leafCheck >= 0) || ![1, 2].includes(encoderVersion) || (v2 && !withX)) {
  console.error("usage: npm run rl:encode -- <run dir with games.jsonl.gz> [--out <dir>] [--workers N] [--limit N] [--no-x] [--pick N] [--leak-every N] [--leaf-check N] [--force] [--encoder 2 [--compare-with <dir>] [--compare-to <dir>] [--pick-from <enc-v1 dir>]]");
  process.exit(1);
}
const out = resolve(option("--out") ?? join(resolve(runDir), v2 ? "enc-v2" : "enc-v1"));
const SHARD = 1000;
const TABLE_PATH = join(ROOT, "packages", "bot", "src", "card-features.json");

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
/** The players' bots, as the encoder's one-hot has them (v1: the bots of the stage 1 data). */
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
const freshChecks = () => ({
  labelPairs: 0,
  labelBad: 0,
  predicateDisagree: 0,
  pointGames: 0,
  rebuildBad: 0,
  rebuilt: 0,
  turnGaps: 0,
  broken: 0,
  botBad: 0,
  w1MaxError: 0,
  holdoutInTrain: 0,
  noHoldoutInHoldout: 0,
  // The encoder: its own diagnostics, the engine against the decoded vector, the unseen cards against the hidden zones,
  // hidden information.
  saturations: 0,
  poolClamps: 0,
  poolMismatch: 0,
  unknownDefs: 0,
  maskBad: 0,
  engineChecked: 0,
  engineBad: 0,
  poolsChecked: 0,
  poolsBad: 0,
  leakChecked: 0,
  leakBad: 0,
  leakDrift: 0,
});
type Checks = ReturnType<typeof freshChecks>;
/** What a worker found in a shard. */
interface ShardResult {
  shard: number;
  rows: number;
  games: GameInfo[];
  files: Record<string, string>;
  dropped: Record<string, number>;
  checks: Checks;
  /** By feature: how many samples have it non-zero. */
  nonzero?: number[];
  /** Encode times (µs) measured by worker 0. */
  times?: number[];
  /** Encoder v2's part. */
  v2?: ShardV2Result;
}

/** What a worker found in a shard with encoder v2. */
interface ShardV2Result {
  sizes: { cardRows: number; pileRows: number; gdefRows: number };
  diag: EncodeDiagnosticsV2;
  maskBad: number;
  checks: V2.V2Checks;
  rangeNames: Record<string, number>;
  oracleDiffer: Record<string, number>;
  closures: Record<string, { agree: number; disagree: number; examples: string[] }>;
  cal: V2.Calibration;
  nonzeroGlobal: number[];
  nonzeroCard: Record<string, number[]>;
  nonzeroGdef: number[];
  relSums: number[];
  /** Per zone code: card tokens (or pile copies) per sample, as [Σ, Σ², max, histogram up to 63] by split and activeness. */
  perZone: Record<string, Record<string, number[]>>;
  /** Fixed samples (by hash) whose pooled vectors the worker kept: row in the shard, hash, game, input, viewer. */
  candidates: { row: number; hash: number; game: number; input: number; viewer: number }[];
  /** Encode times (µs, worker 0): v2, v1 on the same views, poolV2. */
  timesV2?: number[];
  timesV1?: number[];
  timesPool?: number[];
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

const engine = createEngine({ cards: ALL_CARDS, scripts: ALL_SCRIPTS });
const table = cardFeatureTable(JSON.parse(readFileSync(TABLE_PATH, "utf8")) as CardFeatureFile);
const schema = encoderSchema();
const definitionOf = (p: string) => engine.db.ofPrinting(p).id;
const contextOf = (g: JobGame): EncoderContext => ({
  table,
  decks: [knownDeck(definitionOf, g.decks[0]!.deck), knownDeck(definitionOf, g.decks[1]!.deck)],
  players: [g.bots[0]!.level as PlayerType, g.bots[1]!.level as PlayerType],
});
const newGameOf = (g: JobGame) => engine.newGame({ seed: g.seed, players: [g.decks[0]!.deck, g.decks[1]!.deck], config: g.config as never });

/**
 * The engine against the encoder, at a position (a part of the games): the decoded numbers against the reader's (the number
 * of followers, their attack and their defense left, CR 2.8.2; every faceup field card's information definition), and the unseen cards of each list against the zones that hide
 * them (my deck; the opponent's hand, deck and facedown cards; each facedown evolve deck), computed here on their own.
 */
function engineAgrees(game: GameSession, view: PlayerView, me: PlayerId, x: Int16Array, ctx: EncoderContext): { engine: boolean; pools: boolean } {
  const reader = game.reader();
  const get = decode(x);
  let engineOk = true;
  for (const [side, pre] of [
    [me, "field.me"],
    [opponentOf(me), "field.opp"],
  ] as const) {
    const followers = reader.followers(side);
    let atk = 0;
    let def = 0;
    for (const id of followers) {
      const stats = reader.statsOf(id);
      atk += stats.attack ?? 0;
      def += stats.defense ?? 0;
    }
    if (get(`${pre}.sum.follower.now`) !== followers.length || get(`${pre}.sum.atk.now`) !== atk || get(`${pre}.sum.def.now`) !== def) engineOk = false;
  }
  for (const s of view.players) for (const c of s.field) if (!c.hidden && infoDefOf(view, c, table) !== reader.info(c.id).def.id) engineOk = false;
  // The unseen cards: a list minus the cards of its owner the view shows, as a multiset, against the zones' real cards.
  const visible = (c: CardView | HiddenCardView): c is CardView => !c.hidden;
  const shown = (owner: PlayerId) => {
    const m = new Map<DefId, number>();
    for (const s of view.players) {
      for (const zone of [s.hand, s.field, s.ex, s.cemetery, s.banished, s.evolveZone, s.raceZone, s.driveZone, s.triggerZone, s.equipmentZone]) for (const c of zone) if (visible(c) && c.owner === owner) m.set(c.def, (m.get(c.def) ?? 0) + 1);
      for (const c of s.evolveDeck) if (visible(c) && c.owner === owner && c.faceUp) m.set(c.def, (m.get(c.def) ?? 0) + 1);
    }
    for (const c of view.resolution) if (c.owner === owner) m.set(c.def, (m.get(c.def) ?? 0) + 1);
    return m;
  };
  const minus = (list: ReadonlyMap<DefId, number>, seen: Map<DefId, number>) => {
    const m = new Map<DefId, number>();
    for (const [d, n] of list) if (n - (seen.get(d) ?? 0) > 0) m.set(d, n - (seen.get(d) ?? 0));
    return m;
  };
  const real = (ids: readonly string[]) => {
    const m = new Map<DefId, number>();
    for (const id of ids) {
      const d = reader.card(id)!.def;
      m.set(d, (m.get(d) ?? 0) + 1);
    }
    return m;
  };
  const same = (a: Map<DefId, number>, b: Map<DefId, number>) => a.size === b.size && [...a].every(([k, v]) => b.get(k) === v);
  const opp = opponentOf(me);
  const hiddenIds = (cards: readonly (CardView | HiddenCardView)[]) => cards.filter((c) => c.hidden).map((c) => c.id);
  const oppHidden = [...reader.cards(opp, "deck"), ...hiddenIds(view.players[opp].hand), ...hiddenIds(view.players[opp].banished), ...hiddenIds(view.players[opp].field)];
  const faceDown = (p: PlayerId) => reader.cards(p, "evolveDeck").filter((id) => !reader.card(id)!.faceUp);
  const pools =
    same(minus(ctx.decks[me].main, shown(me)), real(reader.cards(me, "deck"))) &&
    same(minus(ctx.decks[opp].main, shown(opp)), real(oppHidden)) &&
    same(minus(ctx.decks[me].evolve, shown(me)), real(faceDown(me))) &&
    same(minus(ctx.decks[opp].evolve, shown(opp)), real(faceDown(opp)));
  return { engine: engineOk, pools };
}

/** The worker: the shards k, k + N, k + 2N … of the games. */
function runWorker(k: number): void {
  const fingerprint = rulesFingerprint(join(ROOT, "packages", "gui"));
  const certified = certifiedRules(resolve(runDir!), fingerprint, records)?.accepted ?? new Set<string>();
  const jobs = jobFiles();
  const weights = termWeights(DEFAULT_WEIGHTS);
  const holdoutDecks = new Set(DECK_SETS.holdout);
  const times: number[] = [];
  const timesV2: number[] = [];
  const timesV1: number[] = [];
  const timesPool: number[] = [];
  // Encoder v2: the references as the analysis reads them (the oracle's sites, by definition, in the table's order), the
  // declared ranges, and the share of samples whose pooled vector is kept for the fixed pooled check (about 4,000 over the
  // run: the 2,000 with the smallest hash are kept).
  const analyses = v2 ? analyzeScripts(ALL_SCRIPTS) : null;
  const sitesOf = (def: DefId) => analyses?.get(def)?.refs;
  const maxRefs = Math.max(10, ...Object.values(table.file.refs).map((r) => r.length));
  const ranges = V2.declaredRanges(maxRefs);
  const gamesTotal = Number(option("--games-total") ?? 1);
  const candidateBound = Math.min(1, 4000 / Math.max(1, gamesTotal * 58)) * 2 ** 32;
  const pooledBuffer = new Float64Array(v2 ? encoderV2Schema().pooled.dims : 0);
  let shard = -1;
  let acc: ReturnType<typeof freshShard> | null = null;
  function freshShard(s: number) {
    return {
      s,
      y: [] as number[],
      side: [] as number[],
      w1: [] as number[],
      x: [] as Int16Array[],
      nonzero: new Array<number>(schema.dims).fill(0),
      games: [] as GameInfo[],
      dropped: {} as Record<string, number>,
      checks: freshChecks(),
      v2: v2 ? new V2.ShardV2() : null,
      v2diag: emptyDiagnosticsV2(),
      v2maskBad: 0,
      v2checks: V2.freshV2Checks(),
      v2rangeNames: new Map<string, number>(),
      v2differ: new Map<string, number>(),
      v2closures: {} as Record<string, { agree: number; disagree: number; examples: string[] }>,
      v2cal: V2.freshCalibration(),
      v2perZone: {} as Record<string, Record<string, number[]>>,
      v2candidates: [] as { row: number; hash: number; game: number; input: number; viewer: number; pooled: Int32Array }[],
    };
  }
  const flush = () => {
    if (!acc) return;
    const rows = acc.y.length;
    const name = (kind: string) => `${kind}-${String(acc!.s).padStart(4, "0")}.npy`;
    const kinds = ["y", "side", "w1"];
    writeNpy(join(out, name("y")), Float32Array.from(acc.y), [rows]);
    writeNpy(join(out, name("side")), Float32Array.from(acc.side), [rows, SIDE_COLUMNS.length]);
    writeNpy(join(out, name("w1")), Int16Array.from(acc.w1), [rows, W1_COLUMNS.length]);
    if (withX && !v2) {
      const x = new Int16Array(rows * schema.dims);
      for (const [r, v] of acc.x.entries()) x.set(v, r * schema.dims);
      writeNpy(join(out, name("x")), x, [rows, schema.dims]);
      kinds.unshift("x");
    }
    const files = Object.fromEntries(kinds.map((kind) => [name(kind), createHash("sha256").update(readFileSync(join(out, name(kind)))).digest("hex")]));
    let v2result: ShardV2Result | undefined;
    if (acc.v2) {
      Object.assign(files, acc.v2.write(out, acc.s));
      // The kept pooled vectors (a temporary file the main process reads and removes).
      const cands = acc.v2candidates;
      const dims = encoderV2Schema().pooled.dims;
      const data = new Int32Array(cands.length * dims);
      cands.forEach((c, i) => data.set(c.pooled, i * dims));
      mkdirSync(join(out, "tmp"), { recursive: true });
      writeNpy(join(out, "tmp", name("pooled")), data, [cands.length, dims]);
      v2result = {
        sizes: acc.v2.sizes(),
        diag: acc.v2diag,
        maskBad: acc.v2maskBad,
        checks: acc.v2checks,
        rangeNames: Object.fromEntries(acc.v2rangeNames),
        oracleDiffer: Object.fromEntries(acc.v2differ),
        closures: acc.v2closures,
        cal: acc.v2cal,
        nonzeroGlobal: acc.v2.nonzeroGlobal,
        nonzeroCard: Object.fromEntries([...acc.v2.nonzeroCard].map(([z, a]) => [String(z), a])),
        nonzeroGdef: acc.v2.nonzeroGdef,
        relSums: acc.v2.relSums,
        perZone: acc.v2perZone,
        candidates: cands.map(({ pooled: _p, ...c }) => c),
      };
    }
    const result: ShardResult = { shard: acc.s, rows, games: acc.games, files, dropped: acc.dropped, checks: acc.checks, nonzero: acc.nonzero, ...(v2result ? { v2: v2result } : {}) };
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
    const recordedRules = rulesOfRecorded(String(g.engine?.fingerprint));
    if (recordedRules !== fingerprint && !certified.has(recordedRules)) {
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
    const ctx = contextOf(g);
    const game = newGameOf(g);
    const checkThis = index % 25 === 0;
    const leakThis = index % leakEvery === 0;
    // The samples of this game, then their rows (the leader defense differences ahead need the later samples).
    const samples: { input: number; turn: number; active: PlayerId; first: PlayerId; hp: [number, number]; terms: [ReturnType<typeof evalTerms>, ReturnType<typeof evalTerms>]; hand: [number, number]; x: [Int16Array, Int16Array] | null; e2: [EncodedV2, EncodedV2] | null; pooled: [Int32Array | null, Int32Array | null]; mismatch: [number, number] }[] = [];
    // Encoder v2: one prepared context per game (its gdef rows are the game's own).
    const prep: PreparedV2 | null = v2 ? prepareV2(ctx) : null;
    let lastTurn = -1;
    const it = replaySamples(game, g.inputs);
    let step = it.next();
    for (; !step.done; step = it.next()) {
      const { point, game: at } = step.value;
      if (lastTurn >= 0 && point.turn !== lastTurn + 1) a.checks.turnGaps += 1;
      lastTurn = point.turn;
      const views = [at.view(0), at.view(1)] as const;
      let xs: [Int16Array, Int16Array] | null = null;
      let e2: [EncodedV2, EncodedV2] | null = null;
      const pooled: [Int32Array | null, Int32Array | null] = [null, null];
      const mismatch: [number, number] = [0, 0];
      if (v2 && prep) {
        const pair: EncodedV2[] = [];
        for (const v of [0, 1] as const) {
          const diag = emptyDiagnosticsV2();
          const t0 = performance.now();
          const e = encodeV2(views[v], v, prep, diag);
          const t1 = performance.now();
          pair.push(e);
          if (k === 0 && timesV2.length < 3000) {
            timesV2.push((t1 - t0) * 1000);
            const t2 = performance.now();
            encode(views[v], v, ctx);
            timesV1.push((performance.now() - t2) * 1000);
            const t3 = performance.now();
            poolV2(e, prep, pooledBuffer);
            timesPool.push((performance.now() - t3) * 1000);
          }
          mismatch[v] = diag.poolMismatch;
          for (const key of Object.keys(diag) as (keyof EncodeDiagnosticsV2)[]) a.v2diag[key] += diag[key];
          // The "not known" mask: global act.* and the applicable A columns are −1 exactly when I'm not deciding.
          const deciding = views[v].decision?.type === "mainPhase" && views[v].decision.player === v;
          const sch = encoderV2Schema();
          let bad = e.global[0] !== (deciding ? 1 : 0) || sch.global.masked.some((j) => (deciding ? e.global[j]! < 0 : e.global[j] !== -1));
          for (let r = 0; r < e.nCards && !bad; r++) for (const col of sch.card.applies[e.cards[r * sch.card.width]!] ?? []) {
            const val = e.cards[r * sch.card.width + 3 + sch.card.body.indexOf(col)]!;
            if (deciding ? val < 0 : val !== -1) bad = true;
          }
          if (bad) a.v2maskBad += 1;
          a.v2checks.rangeBad += V2.rangeViolations(e, prep, ranges, a.v2rangeNames);
          if (checkThis) {
            V2.oracleAtView(at, views[v], v, table, ctx.decks, sitesOf, a.v2checks, a.v2cal, index, a.v2differ);
            V2.poolsAtView(at, views[v], v, table, ctx.decks, a.v2checks);
            V2.evoAtView(at, views[v], v, e, a.v2checks, engine, ALL_SCRIPTS as never);
          }
          if (leakThis) V2.leakAtView(at, views[v], v, prep, e, a.v2checks);
          // The fixed pooled-check samples: the encoder's own pooled vector, kept to compare with one rebuilt from the files.
          if (V2.sampleHash(index, point.input, v) < candidateBound) pooled[v] = Int32Array.from(poolV2(e, prep, pooledBuffer));
        }
        e2 = [pair[0]!, pair[1]!];
        // The cards' own conditions against the tests (C13), on the real game at this point.
        if (checkThis) {
          const r = V2.closuresAt([at], sitesOf, ALL_SCRIPTS);
          a.v2checks.closureCalls += r.calls;
          for (const [key, val] of r.byClosure) {
            const e = (a.v2closures[key] ??= { agree: 0, disagree: 0, examples: [] });
            e.agree += val.agree;
            e.disagree += val.disagree;
            if (e.examples.length < 3) e.examples.push(...val.examples.slice(0, 3 - e.examples.length));
          }
        }
      }
      if (withX && !v2) {
        xs = [new Int16Array(0), new Int16Array(0)];
        for (const v of [0, 1] as const) {
          const diag: EncodeDiagnostics = { saturations: 0, poolClamps: 0, poolMismatch: 0, unknownDefs: 0 };
          const t0 = performance.now();
          const x = encode(views[v], v, ctx, undefined, diag);
          if (k === 0 && times.length < 3000) times.push((performance.now() - t0) * 1000);
          xs[v] = x;
          mismatch[v] = diag.poolMismatch;
          a.checks.saturations += diag.saturations;
          a.checks.poolClamps += diag.poolClamps;
          a.checks.poolMismatch += diag.poolMismatch;
          a.checks.unknownDefs += diag.unknownDefs;
          // The "not known" mask: what I can do now is known (0 or more) exactly when I'm the one deciding.
          const deciding = views[v].decision?.type === "mainPhase" && views[v].decision.player === v;
          if (x[schema.maskIndicator] !== (deciding ? 1 : 0) || schema.masked.some((j) => (deciding ? x[j]! < 0 : x[j] !== -1))) a.checks.maskBad += 1;
          if (checkThis) {
            const agrees = engineAgrees(at, views[v], v, x, ctx);
            a.checks.engineChecked += 1;
            a.checks.poolsChecked += 1;
            if (!agrees.engine) a.checks.engineBad += 1;
            if (!agrees.pools) a.checks.poolsBad += 1;
          }
          // Hidden information: samples of what the viewer can't see give the same view, so the same vector.
          if (leakThis) {
            for (let s2 = 0; s2 < 20; s2++) {
              const copy = at.determinized(v, `leak:${s2}`);
              const cv = copy.view(v);
              if (cv.turn !== views[v].turn || cv.decision?.type !== views[v].decision?.type) {
                a.checks.leakDrift += 1;
                continue;
              }
              a.checks.leakChecked += 1;
              const y = encode(cv, v, ctx);
              if (y.some((val, i) => val !== x[i])) a.checks.leakBad += 1;
            }
          }
        }
      }
      samples.push({
        input: point.input,
        turn: point.turn,
        active: point.active,
        first: at.state.firstPlayer as PlayerId,
        hp: [views[0].players[0].leaderDefense - views[0].players[1].leaderDefense, views[1].players[1].leaderDefense - views[1].players[0].leaderDefense],
        terms: [evalTerms(views[0], 0), evalTerms(views[1], 1)],
        hand: [evaluate(views[0], 0), evaluate(views[1], 1)],
        x: xs,
        e2,
        pooled,
        mismatch,
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
    if (checkThis) {
      a.checks.pointGames += 1;
      const fresh = newGameOf(g);
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
      if (JSON.stringify(stops) !== JSON.stringify(samples.map((smp) => smp.input))) a.checks.predicateDisagree += 1;
      for (const smp of [samples[0], samples[Math.floor(samples.length / 2)]]) {
        if (!smp) continue;
        const again = newGameOf(g);
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
        row[COL.poolMismatch] = smp.mismatch[viewer];
        a.y.push(y);
        a.side.push(...row);
        a.w1.push(...t.me, ...t.opp);
        if (smp.x) {
          const x = smp.x[viewer];
          a.x.push(x);
          for (let i = 0; i < x.length; i++) if (x[i] !== 0) a.nonzero[i]! += 1;
        }
      }
      a.checks.labelPairs += 1;
      if (ys[0]! + ys[1]! !== 1) a.checks.labelBad += 1;
    }
    if (a.v2 && prep) {
      const encs = samples.flatMap((smp) => [smp.e2![0], smp.e2![1]]);
      a.v2.addGame(prep, encs);
      // Tokens and entries per zone (stats.json), by split and by whether the viewer is the active player.
      samples.forEach((smp, n) => {
        for (const viewer of [0, 1] as const) {
          const e = smp.e2![viewer];
          const counts = new Map<number, number>();
          for (let r = 0; r < e.nCards; r++) counts.set(e.cards[r * 103]!, (counts.get(e.cards[r * 103]!) ?? 0) + 1);
          for (let r = 0; r < e.nPiles; r++) counts.set(e.piles[r * 4]!, (counts.get(e.piles[r * 4]!) ?? 0) + e.piles[r * 4 + 3]!);
          const group = `${split}:${smp.active === viewer ? "active" : "waiting"}`;
          const zones = (a.v2perZone[group] ??= {});
          for (const z of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27]) {
            const c = counts.get(z) ?? 0;
            const st = (zones[String(z)] ??= [0, 0, 0, ...new Array<number>(64).fill(0)]);
            st[0]! += c;
            st[1]! += c * c;
            st[2] = Math.max(st[2]!, c);
            st[3 + Math.min(63, c)]! += 1;
          }
          const pv = smp.pooled[viewer];
          if (pv) a.v2candidates.push({ row: firstRow + 2 * n + viewer, hash: V2.sampleHash(index, smp.input, viewer), game: index, input: smp.input, viewer, pooled: pv });
        }
      });
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
  // The file's damaged pieces (every worker reads the whole file: the first one tells) and the times, as a shard of nothing.
  if (k === 0) {
    const none = freshChecks();
    none.broken = readStats.broken;
    process.send!({ shard: -1, rows: 0, games: [], files: {}, dropped: {}, checks: none, times, ...(v2 ? { v2: { timesV2, timesV1, timesPool } as unknown as ShardV2Result } : {}) } satisfies ShardResult);
  }
}
function workersOf(): number {
  return Number(option("--workers-total") ?? 1);
}

/**
 * Features that are 0 in every sample, sorted by why. Explained: what a sample point can't have, or what no card that can be
 * in that place has (a column of the card table no such card of the decks these games used has, a keyword none of them has
 * printed, a counter or keyword no card of those decks mentions): data can't teach those. The rest could happen but didn't in these games (a rare
 * situation, or something the encoder doesn't read as it should): listed for a person to look over.
 */
function zeroFeatures(nonzero: readonly number[], deckNames: readonly string[]): { explained: Record<string, string[]>; unexplained: string[] } {
  const main = new Set<string>();
  const evolve = new Set<string>();
  for (const name of deckNames) {
    const deck = sampleDeck(name)!.deck;
    for (const p of deck.main) main.add(definitionOf(p));
    for (const p of deck.evolve) evolve.add(definitionOf(p));
  }
  const col = (c: string) => CARD_FEATURE_COLUMNS.indexOf(c);
  const onField = (d: string) => table.row(d)[col("type.follower")] !== 0 || table.row(d)[col("type.amulet")] !== 0;
  // The cards of these decks that can be in a group's place: the field holds followers and amulets (of the main deck, and
  // the evolved followers of the evolve deck; not its Carrots, CR 14.2); an evolve deck its evolve cards; every other place
  // main deck cards (an evolve deck's card moved anywhere else goes to the evolve deck faceup, CR 9.2.2).
  const fieldDefs = [...main, ...evolve].filter(onField);
  const placeDefs = (group: string): string[] =>
    group.startsWith("field.") ? fieldDefs : group.startsWith("pool.") && group.endsWith(".evolveLeft") ? [...evolve] : [...main];
  const noneHas = (defs: readonly string[], column: string) => col(column) >= 0 && defs.every((d) => table.row(d)[col(column)] === 0);
  // The decks' card data and scripts (their functions' source too) as text: does any of it mention a word at all?
  const text = [...main, ...evolve]
    .map((d) => JSON.stringify(engine.db.get(d)) + JSON.stringify(ALL_SCRIPTS[d] ?? null, (_, v: unknown) => (typeof v === "function" ? String(v) : v)))
    .join("\n")
    .toLowerCase();
  const mentioned = (word: string) => text.includes(word.toLowerCase());
  // The collaboration universes none of these decks is from, and what only their cards use (CR 14: Umamusume's race zone,
  // Vanguard's drive and trigger zones, Princess Connect's equipment).
  const ZONES_OF: Record<string, string> = {
    umamusume: "\\.raceZone\\.count$|\\.link\\.race$",
    cinderellaGirls: "$^",
    vanguard: "\\.(driveZone|triggerZone)\\.count$|\\.link\\.drive$",
    princessConnect: "\\.equipmentZone\\.count$|^equipment\\.|\\.link\\.equipment$",
  };
  const absent = Object.keys(ZONES_OF).filter((u) => noneHas([...main], `uni.${u}`));
  const absentRe = absent.length ? new RegExp(absent.map((u) => `^g\\.(me|opp)\\.uni\\.${u}$|${ZONES_OF[u]}`).join("|")) : /$^/;
  const UNIVERSE_NAMES: Record<string, string> = { umamusume: "赛马娘", cinderellaGirls: "灰姑娘女孩", vanguard: "先导者", princessConnect: "公主连结" };
  // The equipment zone holds equipment only (CR 4.16): the columns no equipment card of the whole card pool has.
  const equipmentDefs = ALL_CARDS.map((d) => d.id).filter((d) => table.row(d)[col("type.equipment")] !== 0);
  // What a sample point (the active player's first main phase decision: no attack, nothing resolving) can't have, and what
  // these decks can't make.
  const SITUATIONAL: [RegExp, string][] = [
    [/^g\.phase\.(setup|start|end|over)$|^g\.attack\.inProgress$|^g\.resolution\.count$/, "取样点总在主要阶段开头：不在攻击中、没有正在处理的卡"],
    [/^g\.me\.hand\.hidden$/, "自己的手牌自己总看得到"],
    [absentRe, `这些卡组没有${absent.map((u) => UNIVERSE_NAMES[u] ?? u).join("、")}的卡组（没有它们的区域）`],
    [/^g\.(me|opp)\.cls\.neutral$/, "这些卡组的主战者都不是中立"],
    [/^hand\.oppRevealed\./, "公开的牌在效果处理完就不再公开（CR 5.21.1.1），取样点没有正在处理的效果"],
    [/^counters\.(me|opp)\.other$/, "没有表外的指示物（不在那 22 种里的计在这里）"],
    ...(mentioned("boxed") ? [] : ([[/\.boxed$/, "这些卡组的卡没有提到装箱（CR 5.31）"]] as [RegExp, string][])),
    ...(mentioned("maneuver") ? [] : ([[/\.type\.changed$/, "这些卡组的卡没有提到机动（CR 5.32，护符变成随从）"]] as [RegExp, string][])),
    ...(["face down", "facedown", "face-down"].some(mentioned) ? [] : ([[/^g\.(me|opp)\.(field|banished)\.hidden$/, "这些卡组的卡没有提到背面放置"]] as [RegExp, string][])),
    [/\.unknownDef$/, "卡牌特征表认识所有的卡"],
  ];
  const explained: Record<string, string[]> = {};
  const unexplained: string[] = [];
  const add = (why: string, name: string) => (explained[why] ??= []).push(name);
  const group = (name: string) => schema.groups.find((g) => schema.names.indexOf(name) >= g.start && schema.names.indexOf(name) < g.end)!.name;
  for (const [i, name] of schema.names.entries()) {
    if (nonzero[i] !== 0) continue;
    const situational = SITUATIONAL.find(([re]) => re.test(name));
    const g = group(name);
    const pooled = /^(field|hand|ex|pool|cemetery|banished)\./.test(g);
    const column = pooled ? CARD_FEATURE_COLUMNS.find((c) => name.endsWith(`.${c}`)) : undefined;
    const keyword = /\.kw\.now\.(\w+)$/.exec(name)?.[1];
    const counter = /^counters\.(?:me|opp)\.(\w+)$|\.ctr\.(stack)$/.exec(name);
    const counterName = counter?.[1] ?? counter?.[2];
    if (situational) add(situational[1], name);
    else if (column && noneHas(placeDefs(g), column)) add("能在这个位置的卡（这些卡组的）都没有这一列", name);
    else if (/^equipment\./.test(g) && noneHas(equipmentDefs, name.replace(/^equipment\.(me|opp)\.sum\./, ""))) add("装备区只放装备（CR 4.16），装备卡都没有这一列", name);
    else if (keyword && !mentioned(keyword === "driveChecks" ? "drive" : keyword)) add("这些卡组的卡没有提到这个关键词", name);
    else if (keyword && pooled && noneHas(placeDefs(g), `kw.${keyword}`)) add("能在这个位置的卡都没有印着这个关键词（这批对局里也没有被给予）", name);
    // A counter as the English card texts name it ("Spirit counter" for fightingSpirit; Stack is a keyword's, CR 13.3.2).
    else if (counterName && !mentioned(`${COUNTER_NAMES[counterName]?.en ?? counterName} counter`) && !(counterName === "stack" && mentioned("stack"))) add("这些卡组的卡没有提到这种指示物", name);
    else unexplained.push(name);
  }
  return { explained, unexplained };
}

/**
 * The search's leaves (stage 4's network calls): a real two-turn Medium deciding at recorded positions, its leaf evaluation
 * spied on — every position it scores must be a main phase decision of the active player, with no attack or resolution in
 * progress, the decision in the view exactly when the viewer is the active player: the kind of position the samples are.
 */
function checkLeaves(positions: { g: JobGame; input: number }[]): { leaves: number; bad: number; nonActive: number } {
  let leaves = 0;
  let bad = 0;
  let nonActive = 0;
  for (const { g, input } of positions) {
    const game = newGameOf(g);
    for (const [, inp] of g.inputs.slice(0, input)) game.act(inp as never);
    const spy = (view: PlayerView, me: PlayerId) => {
      leaves += 1;
      const ok = view.phase === "main" && view.attack === null && view.resolution.length === 0 && view.waitingFor === view.activePlayer && (view.decision !== null) === (view.activePlayer === me);
      if (!ok) bad += 1;
      if (view.activePlayer !== me) nonActive += 1;
      return evaluate(view, me);
    };
    const bot = new PlannerBot(engine, { ...MEDIUM_OPTIONS, lookahead: 2, samples: 2, seed: `leaf:${g.seed}:${input}`, replyEvaluator: spy });
    bot.decide(game);
  }
  return { leaves, bad, nonActive };
}

/** Games of the records by their line's index, in one pass over the file. */
function gamesAt(indices: Iterable<number>): Map<number, JobGame> {
  const want = new Set(indices);
  const found = new Map<number, JobGame>();
  let i = 0;
  for (const line of gameLines(records)) {
    if (want.has(i)) found.set(i, JSON.parse(line) as JobGame);
    if (found.size === want.size) break;
    i += 1;
  }
  return found;
}

if (option("--worker") !== null) {
  runWorker(Number(option("--worker")));
} else {
  if (existsSync(out) && readdirSync(out).length > 0 && !args.includes("--force")) {
    console.error(`${out} isn't empty: --force to write over it, or --out elsewhere`);
    process.exit(1);
  }
  // Never over another encoder version's files (nothing a model was trained on is overwritten by mistake).
  if (existsSync(join(out, "meta.json"))) {
    const old = JSON.parse(readFileSync(join(out, "meta.json"), "utf8")) as { encoder?: { version?: number } | null };
    if (old.encoder && old.encoder.version !== encoderVersion) {
      console.error(`${out} holds encoder v${old.encoder.version}'s files: --out elsewhere`);
      process.exit(1);
    }
  }
  mkdirSync(out, { recursive: true });
  // What an earlier run left (a smaller run would leave its extra shards next to a meta.json that doesn't list them).
  for (const name of readdirSync(out)) {
    if (/^(x|y|side|w1|glob|card|pile|off|gbase|gdef)-\d{4}\.npy$|^(games\.csv|meta\.json|report\.txt|stats\.json|static\.npy|defs\.json|pooled-check\.npy|pooled-check-idx\.npy|golden-(cards|piles|index)\.npy)$/.test(name)) rmSync(join(out, name));
  }
  rmSync(join(out, "pick"), { recursive: true, force: true });
  rmSync(join(out, "tmp"), { recursive: true, force: true });
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
        const child = fork(process.argv[1]!, [...args, "--worker", String(k), "--workers-total", String(n), "--games-total", String(total)], { stdio: ["ignore", "inherit", "inherit", "ipc"] });
        child.on("message", (r: ShardResult) => {
          results.push(r);
          if (r.shard >= 0) console.log(`  shard ${r.shard}: ${r.games.length} games, ${r.rows} samples`);
        });
        child.on("exit", (code) => (code === 0 ? done() : fail(new Error(`process ${k} ended with ${code}`))));
      }),
    ),
  );
  const extra = results.find((r) => r.shard === -1);
  const broken = extra?.checks.broken ?? 0;
  const times = (extra?.times ?? []).sort((a, b) => a - b);
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
  const dropped: Record<string, number> = {};
  for (const r of results) for (const [why, c] of Object.entries(r.dropped)) dropped[why] = (dropped[why] ?? 0) + c;
  const checks = freshChecks();
  for (const r of results) for (const key of Object.keys(checks) as (keyof Checks)[]) checks[key] = key === "w1MaxError" ? Math.max(checks[key], r.checks[key]) : checks[key] + r.checks[key];
  checks.broken = broken;
  const nonzero = new Array<number>(schema.dims).fill(0);
  for (const r of results) for (const [i, c] of (r.nonzero ?? []).entries()) nonzero[i]! += c;
  const bySplit = [0, 1, 2, 3].map((s) => games.filter((g) => g.split === s).length);
  const rows = offset;
  const kept = games.length;
  const share = (s: number) => (kept > 0 ? (100 * bySplit[s]!) / kept : 0);
  const holdoutData = bySplit[3]! > 0;
  const zeros = withX && !v2 ? zeroFeatures(nonzero, [...new Set(games.flatMap((g) => [g.deck0, g.deck1]))]) : { explained: {}, unexplained: [] };
  const explainedCount = Object.values(zeros.explained).reduce((n, names) => n + names.length, 0);
  // The search's leaves: positions spread evenly over the kept games, each at the middle sample point of its game.
  const leafGames = leafCheck > 0 ? games.filter((_, i) => i % Math.max(1, Math.floor(kept / leafCheck)) === 0).slice(0, leafCheck) : [];
  const leafRecords = gamesAt(leafGames.map((g) => g.game));
  const leaf = checkLeaves(
    leafGames.map((info) => {
      const g = leafRecords.get(info.game)!;
      const points = [...replaySamples(newGameOf(g), g.inputs)].map((s) => s.point.input);
      return { g, input: points[Math.floor(points.length / 2)]! };
    }),
  );
  const git = (...a: string[]) => {
    try {
      return execFileSync("git", ["-C", ROOT, ...a], { encoding: "utf8" }).trim();
    } catch {
      return "";
    }
  };
  const rulesNow = rulesFingerprint(join(ROOT, "packages", "gui"));
  const certificate = certifiedRules(resolve(runDir), rulesNow, records)?.certificate ?? null;
  const lines: [boolean, string][] = [
    [
      true,
      certificate
        ? `规则代码：现在 ${rulesNow}；记录时 ${Object.entries(certificate.recordedRules).map(([fp, n]) => `${fp}（${n} 局）`).join("、")}，认证书 certified-${rulesNow}.json：${certificate.replayed} 局在现在的代码下重放一致（${certificate.date.slice(0, 10)}）。`
        : `规则代码：现在 ${rulesNow}，没有认证书（只收用它记录的对局）。`,
    ],
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
  // Encoder v2: its files and checks C10–C24.
  let finished: ReturnType<typeof finishV2> | null = null;
  if (v2) {
    const extraV2 = extra?.v2 as unknown as { timesV2: number[]; timesV1: number[]; timesPool: number[] } | undefined;
    const first = games[0] ? gamesAt([games[0].game]).get(games[0].game) : undefined;
    let calibrationView: Parameters<typeof finishV2>[0]["calibrationView"] = null;
    if (first) {
      const step = replaySamples(newGameOf(first), first.inputs).next();
      if (!step.done) calibrationView = { view: step.value.game.view(0), me: 0, ctx: contextOf(first) };
    }
    finished = finishV2({
      out,
      runDir: resolve(runDir),
      results: results as never,
      table,
      rulesFingerprint: rulesFingerprint(join(ROOT, "packages", "gui")),
      times: { v2: extraV2?.timesV2 ?? [], v1: extraV2?.timesV1 ?? [], pool: extraV2?.timesPool ?? [] },
      workers: n,
      limit,
      compareWith: option("--compare-with"),
      compareTo: option("--compare-to"),
      pickFrom: option("--pick-from"),
      engine,
      calibrationView,
      guiReplays: join(ROOT, "packages", "gui", "replays"),
      root: ROOT,
      cardName: (d) => engine.db.get(d).names.cn ?? engine.db.get(d).name,
      pickPosition: (replay: PickReplay, index: number) => {
        // The record itself (the replay has the GUI's options): its inputs up to the replay's end.
        const g = gamesAt([index]).get(index)!;
        const game = newGameOf(g);
        for (const [, input] of g.inputs.slice(0, replay.inputs.length)) game.act(input as never);
        return { game, ctx: contextOf(g) };
      },
    });
    lines.push(...finished.lines);
  }
  if (withX && !v2) {
    lines.push(
      [checks.saturations + checks.poolClamps + checks.poolMismatch + checks.unknownDefs + checks.maskBad === 0, `编码：${rows} 个向量，每个 ${schema.dims} 维；超出范围 ${checks.saturations}、看不到的牌算成负数 ${checks.poolClamps}、张数对不上 ${checks.poolMismatch}、表里没有的卡 ${checks.unknownDefs}、"现在能做什么"的掩码不对 ${checks.maskBad}（都应为 0）。`],
      [checks.engineChecked > 0 && checks.engineBad === 0, `和引擎对照：${checks.engineChecked} 个视角，向量里的随从数、攻击力和防御力合计、场上每张卡的信息定义和引擎一致（不一致的 ${checks.engineBad} 个）。`],
      [checks.poolsChecked > 0 && checks.poolsBad === 0, `看不到的牌：${checks.poolsChecked} 个视角，卡表减去看得到的牌，正好是牌组、对手的手牌和牌组、背面的进化牌组里真正的牌（不对的 ${checks.poolsBad} 个）。`],
      [checks.leakChecked > 0 && checks.leakBad === 0, `隐藏信息：${checks.leakChecked} 次把看不到的牌重新抽样，编码都完全相同（不同的 ${checks.leakBad} 次；局面变了没比的 ${checks.leakDrift} 次）。`],
      [true, `恒为 0 的特征：${explainedCount + zeros.unexplained.length} 个。不可能不为 0 的 ${explainedCount} 个（${Object.entries(zeros.explained).map(([why, names]) => `${why} ${names.length}`).join("；")}）；能出现、但这批对局里没出现过的 ${zeros.unexplained.length} 个（只报告，要人看一遍${zeros.unexplained.length ? `：${zeros.unexplained.slice(0, 40).join(" ")}${zeros.unexplained.length > 40 ? " …" : ""}` : ""}；全部列在 meta.json 的 encoder.zeroFeatures）。`],
      [true, `速度：每次编码 p50 ${times[Math.floor(times.length / 2)]?.toFixed(0) ?? "-"} µs、p99 ${times[Math.floor(times.length * 0.99)]?.toFixed(0) ?? "-"} µs（${times.length} 次，进程 0；只报告）。`],
    );
  }
  if (leafCheck > 0) {
    lines.push([leaf.leaves > 0 && leaf.bad === 0, `搜索的叶子：两回合 Medium 在 ${leafGames.length} 个局面上决策，评估了 ${leaf.leaves} 个叶子，都是行动方主要阶段开始那种局面、和样本同类（不是的 ${leaf.bad} 个；其中非行动方视角 ${leaf.nonActive} 个）。`]);
  }
  // A few positions for a person to check (the user check of stage 1): at random, and where the hand-written evaluation was
  // most wrong (a one-variable logistic fit of it on the training split; its largest losses in Medium-vs-Medium games, turn 9 on).
  const picked: string[] = [...(finished?.picked ?? [])];
  if (withX && !v2 && pick > 0) {
    const side: number[][] = [];
    const ys: number[] = [];
    for (const r of results) {
      const s = readNpy(readFileSync(join(out, `side-${String(r.shard).padStart(4, "0")}.npy`)));
      const y = readNpy(readFileSync(join(out, `y-${String(r.shard).padStart(4, "0")}.npy`)));
      for (let i = 0; i < y.data.length; i++) {
        side.push(Array.from(s.data.subarray(i * SIDE_COLUMNS.length, (i + 1) * SIDE_COLUMNS.length)));
        ys.push(y.data[i]!);
      }
    }
    // Logistic regression of the label on the hand-written evaluation (Newton's method, a few steps).
    let a0 = 0;
    let b0 = 0;
    const train = side.map((r, i) => [r[COL.handEval]! / 10, ys[i]!] as const).filter((_, i) => side[i]![COL.split] === 0);
    for (let iter = 0; iter < 25; iter++) {
      let ga = 0, gb = 0, haa = 0, hab = 0, hbb = 0;
      for (const [h, y] of train) {
        const p = 1 / (1 + Math.exp(-(a0 + b0 * h)));
        ga += p - y;
        gb += (p - y) * h;
        const w = p * (1 - p);
        haa += w;
        hab += w * h;
        hbb += w * h * h;
      }
      const det = haa * hbb - hab * hab;
      if (det === 0) break;
      a0 -= (hbb * ga - hab * gb) / det;
      b0 -= (haa * gb - hab * ga) / det;
    }
    const loss = (i: number) => {
      const p = 1 / (1 + Math.exp(-(a0 + (b0 * side[i]![COL.handEval]!) / 10)));
      const y = ys[i]!;
      return -(y * Math.log(Math.max(p, 1e-9)) + (1 - y) * Math.log(Math.max(1 - p, 1e-9)));
    };
    const candidates = side.map((_, i) => i).filter((i) => side[i]![COL.pairKind] === 0 && side[i]![COL.turn]! >= 9);
    const surprising = [...candidates].sort((x, y) => loss(y) - loss(x));
    const chosen: number[] = [];
    const usedGames = new Set<number>();
    for (const i of surprising) {
      if (chosen.length >= Math.min(2, pick)) break;
      if (!usedGames.has(side[i]![COL.game]!)) chosen.push(i), usedGames.add(side[i]![COL.game]!);
    }
    for (let k = 0; chosen.length < pick && k < side.length; k++) {
      const i = parseInt(createHash("sha256").update(`pick:${k}`).digest("hex").slice(0, 8), 16) % side.length;
      if (!usedGames.has(side[i]![COL.game]!)) chosen.push(i), usedGames.add(side[i]![COL.game]!);
    }
    const pickDir = join(out, "pick");
    const guiReplays = join(ROOT, "packages", "gui", "replays");
    mkdirSync(pickDir, { recursive: true });
    mkdirSync(guiReplays, { recursive: true });
    const pickRecords = gamesAt(chosen.map((i) => side[i]![COL.game]!));
    for (const [j, i] of chosen.entries()) {
      const r = side[i]!;
      const g = pickRecords.get(r[COL.game]!)!;
      const input = r[COL.input]!;
      const viewer = r[COL.viewer]! as PlayerId;
      const game = newGameOf(g);
      const replayInputs: { input: unknown; by: PlayerId | null }[] = [];
      for (const [by, inp] of g.inputs.slice(0, input)) {
        const d = game.decision!;
        // The quick windows where passing was all a seat could do are passed by the GUI itself (by no seat).
        replayInputs.push({ input: inp, by: d.type === "quick" && d.actions.every((x) => x.type === "pass") ? null : by });
        game.act(inp as never);
      }
      const controllerOf = (level: string) => (level === "easy" ? "greedy" : level);
      const replay = {
        format: "sve-replay",
        version: 1,
        options: {
          seed: g.seed,
          decks: [g.decks[0]!.deck, g.decks[1]!.deck],
          deckNames: [g.decks[0]!.name, g.decks[1]!.name],
          controllers: [controllerOf(g.bots[0]!.level), controllerOf(g.bots[1]!.level)],
          deckRestrictions: true,
          format: g.rules.format,
          restrictionList: g.rules.restrictionList,
          showEveryMainPhase: true,
          askEveryQuickWindow: true,
          turnOrder: "choose",
        },
        inputs: replayInputs,
        info: { result: null, turn: r[COL.turn] },
      };
      const why = j < Math.min(2, pick) ? "手写估值最想不到的" : "随机挑的";
      const text = [
        `第 ${j + 1} 个局面（${why}）：对局 ${r[COL.game]}（${g.decks[0]!.name} 对 ${g.decks[1]!.name}，种子 ${g.seed}），第 ${r[COL.turn]} 回合，从玩家 ${viewer + 1}（${g.decks[viewer]!.name}）的视角。`,
        `录像：在对局界面的"录像"里打开"编码器检查 ${String(j + 1).padStart(2, "0")}"，放到最后就是这个局面（录像里双方的手牌都看得到，下面只写这个视角看得到的）。`,
        `这局最后：${g.result.winner === null ? "平局" : g.result.winner === viewer ? "这个视角的玩家赢了" : "这个视角的玩家输了"}；手写估值 ${r[COL.handEval]!.toFixed(1)}，按它估计赢的概率 ${(100 / (1 + Math.exp(-(a0 + (b0 * r[COL.handEval]!) / 10)))).toFixed(0)}%。`,
        "",
        describe(game.view(viewer), viewer, contextOf(g), { card: (d) => engine.db.get(d).names.cn ?? engine.db.get(d).name, keyword: (kw) => (zh as Record<string, string>)[`keyword.${kw}`] ?? kw, counter: (k) => COUNTER_NAMES[k]?.zh ?? k }),
      ].join("\n");
      const base = `${String(j + 1).padStart(2, "0")}`;
      writeFileSync(join(pickDir, `${base}.json`), JSON.stringify(replay));
      writeFileSync(join(pickDir, `${base}.txt`), text, "utf8");
      copyFileSync(join(pickDir, `${base}.json`), join(guiReplays, `编码器检查 ${base}.json`));
      picked.push(`${base}: game ${r[COL.game]}, turn ${r[COL.turn]}, viewer ${viewer} (${why})`);
    }
  }
  const report = [
    `rl:encode ${new Date(started).toISOString()}  ${records}`,
    `样本 ${rows} 个（每局约 ${(rows / Math.max(1, kept)).toFixed(1)} 个），用时 ${((Date.now() - started) / 60000).toFixed(1)} 分钟`,
    ...lines.map(([ok, text]) => `${ok ? "通过" : "不通过"}  ${text}`),
    ...(picked.length ? [`给人检查的局面（${join(out, "pick")}，录像也复制进了对局界面的录像文件夹）：`, ...picked.map((p) => `  ${p}`)] : []),
  ].join("\n");
  writeFileSync(join(out, "report.txt"), report + "\n", "utf8");
  const meta = {
    format: "sve-samples",
    formatVersion: v2 ? 2 : 1,
    ...(finished ? { ...finished.meta } : {}),
    encoder: v2
      ? finished!.meta.encoder
      : withX
      ? {
          version: schema.version,
          dims: schema.dims,
          names: schema.names,
          namesHash: createHash("sha256").update(schema.names.join("\n")).digest("hex").slice(0, 16),
          groups: schema.groups,
          masked: schema.masked,
          maskIndicator: schema.maskIndicator,
          maskFill: schema.maskFill,
          playerTypes: schema.playerTypes,
          zeroFeatures: zeros,
          /** By feature: how many samples have it non-zero (of counts.samples). */
          nonzero,
        }
      : null,
    cardFeatures: { version: CARD_FEATURES_VERSION, columnsHash: table.file.columnsHash, hash: table.file.hash },
    columns: {
      x: v2 ? "not written: encoder v2's glob / card / pile / off / gbase / gdef arrays (encoder.arrays)" : withX ? "int16 [n, dims]: encoder v1 of the viewer's view (encoder.names)" : "not written (--no-x)",
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
      rulesFingerprint: rulesNow,
      certificate: certificate ? { file: `certified-${rulesNow}.json`, recordedRules: certificate.recordedRules, replayed: certificate.replayed, date: certificate.date } : null,
      botFingerprint: botFingerprint(ROOT),
      commit: git("rev-parse", "--short", "HEAD"),
      dirty: git("status", "--porcelain", "--", "packages/core", "packages/bot", "tools") !== "",
      command: `rl:encode ${args.join(" ")}`,
    },
    shards: results.map((r) => ({ shard: r.shard, rows: r.rows, games: r.games.length, files: r.files })),
    counts: { games: kept, samples: rows, bySplit, dropped },
    checks: { ...checks, leaf },
    picked,
  };
  writeFileSync(join(out, "meta.json"), JSON.stringify(meta, null, 1) + "\n");
  // C20's Python part reads the written files (meta.json included): its line goes at the end of the report.
  if (v2) {
    const py = pythonCheck(ROOT, out);
    lines.push(py);
    writeFileSync(join(out, "report.txt"), `${report}\n${py[0] ? "通过" : "不通过"}  ${py[1]}\n`, "utf8");
  }
  // The run registry: one line per rl:* run (not for tests: --no-registry).
  if (!args.includes("--no-registry")) appendRegistry(join(ROOT, "..", "rl-runs", "registry.jsonl"), {
    date: new Date(started).toISOString(),
    tool: "rl:encode",
    command: `rl:encode ${args.join(" ")}`,
    commit: git("rev-parse", "--short", "HEAD"),
    dirty: git("status", "--porcelain", "--", "packages/core", "packages/bot", "tools") !== "",
    rulesFingerprint: rulesNow,
    botFingerprint: botFingerprint(ROOT),
    cardFeatures: { version: CARD_FEATURES_VERSION, columnsHash: table.file.columnsHash, hash: table.file.hash },
    encoder: { version: encoderVersion, layoutHash: (meta.encoder as { layoutHash?: string } | null)?.layoutHash ?? (meta.encoder as { namesHash?: string } | null)?.namesHash ?? null },
    input: { path: records, sha256: meta.source.sha256, games: total },
    output: { dir: out, metaSha256: createHash("sha256").update(readFileSync(join(out, "meta.json"))).digest("hex"), rows },
    checks: lines.map(([ok, text]) => ({ ok, check: text.slice(0, 40) })),
    pass: lines.every(([ok]) => ok),
    minutes: (Date.now() - started) / 60000,
  });
  console.log(readFileSync(join(out, "report.txt"), "utf8"));
  if (lines.some(([ok]) => !ok)) process.exitCode = 1;
}
