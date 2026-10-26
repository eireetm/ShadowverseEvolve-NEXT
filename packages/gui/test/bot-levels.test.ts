import { describe, expect, it } from "vitest";
import { createBot, createPresetBot } from "@sve/bot";
import { createEngine, type PlayerId } from "@sve/core";
import { ALL_CARDS, ALL_SCRIPTS } from "@sve/core/sets";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { botRecipe, configOf, CONTROLLER_PRESETS, GameHost, type Scheduler } from "../src/engine/game-host";
import type { GameOptions, RecordedInput, SeatController } from "../src/engine/protocol";
import { knownController } from "../src/engine/protocol";
import { migrateSettings } from "../src/app/settings";
import { parseDeckFile, toDeckList } from "../src/decks/format";

// The GUI's bot levels (game-host.ts botRecipe): which bot each controller plays, with which seed and effort, and that the
// worker's bot answers exactly as that bot built by hand.
const engine = createEngine({ cards: ALL_CARDS, scripts: ALL_SCRIPTS });
const deck = (name: string) => toDeckList(parseDeckFile(JSON.parse(readFileSync(join(__dirname, "..", "decks", "samples", `${name}.json`), "utf8"))));

class ManualScheduler implements Scheduler {
  private queue: (() => void)[] = [];
  schedule(fn: () => void): () => void {
    this.queue.push(fn);
    return () => (this.queue = this.queue.filter((f) => f !== fn));
  }
  /** One scheduled answer (false: none is waiting). */
  step(): boolean {
    const fn = this.queue.shift();
    fn?.();
    return fn !== undefined;
  }
}

/** A game in the worker's host until the bot in seat 0 has given `answers` answers (or the game ends): its inputs. */
function hostGame(controllers: [SeatController, SeatController], seed: string, effort: number, answers: number): { options: GameOptions; inputs: RecordedInput[] } {
  const scheduler = new ManualScheduler();
  const errors: unknown[] = [];
  const host = new GameHost(engine, (m) => (m.kind === "error" ? errors.push(m) : undefined), scheduler, { botEffort: effort });
  const options: GameOptions = {
    seed,
    decks: [deck("sd01"), deck("sd02")],
    deckNames: ["SD01", "SD02"],
    controllers,
    deckRestrictions: true,
    showEveryMainPhase: true,
    askEveryQuickWindow: true,
  };
  host.handle({ kind: "start", options });
  const byBot = () => host.replay()!.inputs.filter((i) => i.by === 0).length;
  for (let i = 0; i < 2000 && byBot() < answers && scheduler.step(); i++);
  expect(errors).toEqual([]);
  return { options, inputs: host.replay()!.inputs };
}

/**
 * The same game played again input by input, seat 0's answers asked of `bot` (as the host asks its bot: every decision of
 * its seat, but the quick windows the host passes itself): the answers it gives where the host's bot answered.
 */
function answersOf(options: GameOptions, inputs: readonly RecordedInput[], decide: (game: ReturnType<typeof engine.newGame>) => unknown) {
  const game = engine.newGame({ seed: options.seed, players: options.decks, config: configOf(options) });
  const mine: unknown[] = [];
  for (const { input, by } of inputs) {
    if (by === 0) mine.push(decide(game));
    game.act(input, by ?? undefined);
  }
  return mine;
}

describe("the GUI's bot levels", () => {
  it("each controller plays its bot: Bot-Easy, the presets with the seat's seed and the host's effort, the random bot", () => {
    expect(CONTROLLER_PRESETS).toEqual({ medium: "medium-next", "medium-v2": "medium-v2", hard: "hard-next" });
    const seat: PlayerId = 1;
    expect(botRecipe("greedy", "s", seat, 0.5)).toEqual({ kind: "easy", seed: "s:greedy:1" });
    expect(botRecipe("medium", "s", seat, 0.5)).toEqual({ kind: "preset", preset: "medium-next", seed: "s:medium:1", effort: 0.5 });
    expect(botRecipe("medium-v2", "s", seat, 1)).toEqual({ kind: "preset", preset: "medium-v2", seed: "s:medium-v2:1", effort: 1 });
    expect(botRecipe("hard", "s", 0, 1)).toEqual({ kind: "preset", preset: "hard-next", seed: "s:hard:0", effort: 1 });
    expect(botRecipe("random", "s", 0, 1)).toEqual({ kind: "random", seed: "s:random:0" });
    expect(botRecipe("human", "s", 0, 1)).toBeNull();
    expect(botRecipe("remote", "s", 0, 1)).toBeNull();
  });

  // Each level at the effort it is checked at: medium-v2 at a phone's (one turn ahead, fewer mulligan samples), the
  // others at a PC's; a dozen answers each (the mulligan and the first turns). Medium and Hard in games where createBot's
  // level of that name (the bot they played before the presets) answers otherwise within those answers.
  const cases: [keyof typeof CONTROLLER_PRESETS, number, string][] = [
    ["medium", 1, "levels-medium-1"],
    ["medium-v2", 0.5, "levels-medium-v2"],
    ["hard", 1, "levels-hard"],
  ];
  for (const [controller, effort, seed] of cases) {
    it(`${controller} at effort ${effort} answers as createPresetBot's ${CONTROLLER_PRESETS[controller]} with the seat's seed`, () => {
      const { options, inputs } = hostGame([controller, "random"], seed, effort, 12);
      const botSeed = `${seed}:${controller}:0`;
      const bot = createPresetBot(engine, CONTROLLER_PRESETS[controller], botSeed, effort);
      const recorded = inputs.filter((i) => i.by === 0).map((i) => i.input);
      expect(recorded.length).toBeGreaterThanOrEqual(12);
      expect(answersOf(options, inputs, (game) => bot.decide(game))).toEqual(recorded);
      if (controller !== "medium-v2") {
        const before = createBot(engine, controller, botSeed, effort);
        expect(answersOf(options, inputs, (game) => before.decide(game))).not.toEqual(recorded);
      }
    }, 120_000);
  }

  it("the same game and inputs give Bot-Medium v2's same answers again", () => {
    const first = hostGame(["medium-v2", "random"], "levels-again", 0.5, 10);
    const second = hostGame(["medium-v2", "random"], "levels-again", 0.5, 10);
    expect(second.inputs).toEqual(first.inputs);
  }, 120_000);

  it("saved settings keep their levels: a saved Bot-Medium or Bot-Hard is today's, Bot-Medium v2 stays, Bot-Hard beta is Bot-Hard", () => {
    expect(migrateSettings({ setupControllers: ["human", "medium-v2"] }).setupControllers).toEqual(["human", "medium-v2"]);
    expect(migrateSettings({ setupControllers: ["medium", "hard"] }).setupControllers).toEqual(["medium", "hard"]);
    expect(knownController("medium-v2")).toBe("medium-v2");
    expect(knownController("hard-beta")).toBe("hard");
  });
});
