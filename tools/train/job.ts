// A data-generation job (tools/rl/jobs/*.json) and one game of it, shared by the training kit (tools/train/kit.ts: friends'
// computers make the games) and npm run rl:ingest (it plays a few of them again to check them). A game is fixed by its seed:
// the decks, the seats and the bots are drawn from it, and the bots are seeded from it, so the same seed gives the same game.
import { createEngine, seedRng, randomInt, type Answer, type DeckList, type GameResult, type PlayerId } from "../../packages/core/src";
import { GreedyBot, HARD_OPTIONS, MEDIUM_OPTIONS, PlannerBot, type PlannerBotOptions } from "../../packages/bot/src";

export type Engine = ReturnType<typeof createEngine>;

/** A bot of a job: a level and changed options (a planner's). */
export interface BotSpec {
  level: "easy" | "medium" | "hard";
  options?: Partial<PlannerBotOptions>;
}

/** A job as written in tools/rl/jobs. */
export interface JobFile {
  id: string;
  description: string;
  format: "standard";
  restrictionList: string;
  /** A deck set of tools/rl/decksets.json. */
  decks: "train" | "holdout" | "legal";
  /** Both seats may get the same deck. */
  mirror: boolean;
  /**
   * Every game has at least one of these decks (names of `decks`): one is drawn from them, the other from all of `decks`,
   * and which takes which seat at random — the holdout decks' data, each against anything. Without it, two decks of `decks`.
   */
  withOne?: string[];
  /** The kinds of game, by weight. */
  games: { weight: number; bots: [BotSpec, BotSpec] }[];
}

/** A job as the kit carries it: the decks written out, and the code it was built from. */
export interface Job extends JobFile {
  deckLists: { name: string; deck: DeckList }[];
  /** The engine fingerprint, and a hash of the bots' code: games of other code are not the same games. */
  engine: string;
  bot: string;
  commit: string;
  version: string;
}

/** One recorded game (the arena's format, so npm run rl:verify reads it; the job and its source added). */
export interface JobGame {
  format: "sve-arena-game";
  version: 1;
  job: string;
  /** Who made it (a random name a kit gives itself; nothing personal). */
  volunteer: string;
  seed: string;
  engine: { fingerprint: string; bot: string; commit: string };
  config: Record<string, unknown>;
  rules: { format: string; restrictionList: string };
  bots: [BotSpec, BotSpec];
  decks: { name: string; deck: DeckList }[];
  firstPlayer: PlayerId | null;
  result: { winner: PlayerId | null | "?"; turns: number; reason?: GameResult["losses"] };
  error: string | null;
  problems: { fallbacks: number; simulationFailures: number }[];
  /** The turns each seat explored (drew a plan instead of taking the best: PlannerBotOptions.explore). */
  explored: [number[], number[]];
  inputs: [PlayerId, Answer][];
}

/** The engine's settings for job games: every main phase and quick window asked, as in the GUI and bot:arena. */
export const JOB_CONFIG = {
  autoResolve: ["selectPending", "selectCards", "choose", "orderCards"] as ("selectPending" | "selectCards" | "choose" | "orderCards")[],
  deckRestrictions: true,
};

/** A bot of a spec, seeded. */
export function makeJobBot(engine: Engine, spec: BotSpec, seed: string): { decide: PlannerBot["decide"]; stats: PlannerBot["stats"]; explored?: number[] } {
  if (spec.level === "easy") return new GreedyBot(engine, { seed, ...(spec.options as object) });
  const base = spec.level === "hard" ? HARD_OPTIONS : MEDIUM_OPTIONS;
  return new PlannerBot(engine, { ...base, ...spec.options, seed });
}

/**
 * What the seed draws for a game of the job: the kind of game, the decks and which bot sits where. npm run rl:ingest checks
 * a recorded game against it (a kit changed by hand would play other games).
 */
export function jobSetup(job: Pick<Job, "games" | "deckLists" | "mirror" | "withOne">, seed: string): { decks: Job["deckLists"]; specs: [BotSpec, BotSpec] } {
  const rng = seedRng(`job:${seed}`);
  const total = job.games.reduce((s, g) => s + g.weight, 0);
  let roll = randomInt(rng, total);
  const kind = job.games.find((g) => (roll -= g.weight) < 0) ?? job.games[0]!;
  const n = job.deckLists.length;
  let decks: Job["deckLists"];
  if (job.withOne && job.withOne.length > 0) {
    // One of the listed decks, and any deck (itself too when mirrors are allowed), in seats drawn at random.
    const listed = job.deckLists.filter((d) => job.withOne!.includes(d.name));
    if (listed.length === 0) throw new Error(`withOne names no deck of the job: ${job.withOne.join(", ")}`);
    const one = listed[randomInt(rng, listed.length)]!;
    const others = job.mirror ? job.deckLists : job.deckLists.filter((d) => d !== one);
    const other = others[randomInt(rng, others.length)]!;
    decks = randomInt(rng, 2) === 1 ? [other, one] : [one, other];
  } else {
    const first = randomInt(rng, n);
    let second = randomInt(rng, job.mirror ? n : n - 1);
    if (!job.mirror && second >= first) second += 1;
    decks = [job.deckLists[first]!, job.deckLists[second]!];
  }
  // Which spec sits where: the first spec in seat 0 or 1 at random.
  const swap = randomInt(rng, 2) === 1;
  const specs: [BotSpec, BotSpec] = swap ? [kind.bots[1], kind.bots[0]] : [kind.bots[0], kind.bots[1]];
  return { decks, specs };
}

/** Plays the game of `seed`: the kind of game, the decks and the seats drawn from it (jobSetup). */
export function playJobGame(engine: Engine, job: Job, seed: string, volunteer: string): JobGame {
  const { decks, specs } = jobSetup(job, seed);
  const record: JobGame = {
    format: "sve-arena-game",
    version: 1,
    job: job.id,
    volunteer,
    seed,
    engine: { fingerprint: job.engine, bot: job.bot, commit: job.commit },
    config: JOB_CONFIG,
    rules: { format: job.format, restrictionList: job.restrictionList },
    bots: specs,
    decks,
    firstPlayer: null,
    result: { winner: "?", turns: 0 },
    error: null,
    problems: [],
    explored: [[], []],
    inputs: [],
  };
  const bots = specs.map((spec, seat) => makeJobBot(engine, spec, `${seed}:${seat}`));
  try {
    const game = engine.newGame({ seed, players: [decks[0]!.deck, decks[1]!.deck], config: JOB_CONFIG });
    for (let steps = 0; game.decision && steps < 5000; steps++) {
      const player = game.decision.player;
      const answer = bots[player]!.decide(game);
      game.act(answer);
      record.inputs.push([player, answer]);
    }
    record.firstPlayer = game.state.firstPlayer;
    record.result = { winner: game.result ? game.result.winner : "?", turns: game.state.turn, reason: game.result?.losses };
  } catch (e) {
    record.error = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
  }
  record.problems = bots.map((b) => ({ fallbacks: b.stats.fallbacks, simulationFailures: b.stats.simulationFailures }));
  record.explored = [bots[0]!.explored ?? [], bots[1]!.explored ?? []];
  return record;
}
