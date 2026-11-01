import { describe, expect, it } from "vitest";
import { createEngine, script } from "../src/core";
import {
  BOT_PRESETS,
  bundledCardTable,
  createPresetBot,
  FIX_DEFAULTS,
  fixIdentities,
  fixOptions,
  HARD_NEXT,
  HARD_NEXT_MACRO,
  HARD_OPTIONS,
  MACRO_DEFAULTS,
  macroProblems,
  MEDIUM_NEXT,
  MEDIUM_NEXT_MACRO,
  MEDIUM_OPTIONS,
  MEDIUM_V2,
  presetIdentities,
  presetSearchIdentity,
  type BotPreset,
  type PlannerBotOptions,
} from "../src";
import { ALL_CARDS, ALL_SCRIPTS } from "../../core/src/sets";
import { drive, scenario, testFollower } from "../../core/src/testing";

// The presets built on the expert fixes (levels.ts): what each is, what it records, and the levels left as they are.

describe("presets", () => {
  it("leave the levels' options as they are", () => {
    expect(MEDIUM_OPTIONS).toEqual({ replyPlans: 4, beamWidth: 6, maxSimulations: 600, lethalSearch: 800, opponentQuick: true, replyLethal: 80 });
    expect(HARD_OPTIONS).toEqual({ cheat: true, replyModel: "planner", opponentQuick: true, replyPlans: 6, beamWidth: 8, maxSimulations: 900, lethalSearch: 800, replyLethal: 80, lookahead: 2 });
  });

  it("are the levels' searches with the fixes: Medium one turn, Hard two (cheating) and wider, the two-turn Medium of the measured games", () => {
    const search = (o: object) => {
      const { evaluator: _e, replyEvaluator: _r, greedyEvaluator: _g, conditional: _c, ...rest } = o as Record<string, unknown>;
      return rest;
    };
    const fixes = { quickEndBonus: 0.25, mulligan: "sim", mulliganSim: { k: 8, t: 3, margin: 0, opp: "greedy", cand: 32 } };
    expect(search(MEDIUM_NEXT)).toEqual({ ...MEDIUM_OPTIONS, ...fixes });
    expect(search(HARD_NEXT)).toEqual({ ...HARD_OPTIONS, beamWidth: 12, maxSimulations: 1200, ...fixes });
    expect(search(MEDIUM_V2)).toEqual({ ...MEDIUM_OPTIONS, lookahead: 2, samples: 3, beamWidth: 12, maxSimulations: 1200, ...fixes });
    for (const p of [MEDIUM_NEXT, HARD_NEXT, MEDIUM_V2]) expect(p.conditional).toMatchObject({ scope: "gates", penalty: 1.5 });
    expect(fixOptions(FIX_DEFAULTS).conditional?.gates).toBeTypeOf("function");
  });

  // Two candidates, not in the GUI: Hard's and Medium's presets with their own turn searched by actions (macro-steps.ts) and
  // the choices told apart, everything else their bases'. The two search options are recorded on their own.
  it("add two candidates: hard-next and medium-next with exactly the root search by actions and the choices told apart", () => {
    const withoutSearch = (o: PlannerBotOptions) => {
      const { choiceDedupe: _d, macro: _m, ...rest } = o;
      return rest;
    };
    const candidates = [
      [HARD_NEXT_MACRO, HARD_NEXT],
      [MEDIUM_NEXT_MACRO, MEDIUM_NEXT],
    ] as const;
    for (const [candidate, base] of candidates) {
      // toStrictEqual compares functions by reference: the same evaluations, the same reader of the charge's table.
      expect(withoutSearch(candidate)).toStrictEqual(base);
      for (const key of ["evaluator", "replyEvaluator", "greedyEvaluator"] as const) expect(candidate[key]).toBe(base[key]);
      expect([base.choiceDedupe, base.macro]).toEqual([undefined, undefined]);
      expect(candidate.choiceDedupe).toBe(true);
      // Written out in levels.ts; today's defaults with 12 actions.
      expect(candidate.macro).toEqual({ ...MACRO_DEFAULTS, actions: 12 });
      expect(macroProblems(candidate.macro!)).toEqual([]);
    }
    expect(HARD_NEXT_MACRO.macro).not.toBe(MEDIUM_NEXT_MACRO.macro);
    expect(HARD_NEXT_MACRO.cheat).toBe(true);
    expect(MEDIUM_NEXT_MACRO.cheat).toBeUndefined();
    expect(BOT_PRESETS).toEqual(["medium-next", "hard-next", "medium-v2", "hard-next-macro", "medium-next-macro"]);
    const search = "dedupe=1+macro=12:keep=2,sub=4,dec=40,share=0.25";
    expect(BOT_PRESETS.map((p) => presetSearchIdentity(p))).toEqual([null, null, null, search, search]);
  });

  // presetSearchIdentity records two search options (choiceDedupe, macro): a preset setting another one would be recorded as
  // its base is. Every preset leaves the others off; a preset that needs one adds it to presetSearchIdentity first.
  it("set no search option presetSearchIdentity doesn't record", () => {
    const options: Record<BotPreset, PlannerBotOptions> = { "medium-next": MEDIUM_NEXT, "hard-next": HARD_NEXT, "medium-v2": MEDIUM_V2, "hard-next-macro": HARD_NEXT_MACRO, "medium-next-macro": MEDIUM_NEXT_MACRO };
    expect(Object.keys(options).sort()).toEqual([...BOT_PRESETS].sort());
    const unrecorded = ["commonRandom", "lineSlots", "tieKeepHand", "drawFirst", "turnOrder", "replyLethalOpp", "replyLethalKey", "closeSamples", "explore"] as const;
    for (const preset of BOT_PRESETS) for (const key of unrecorded) expect(options[preset][key] || undefined, `${preset}.${key}`).toBeUndefined();
  });

  it("record every evaluation's parameters, the charge's table and the mulligan's parameters", () => {
    const pp1 = "pp1:mppBase=0.2,mppSlope=0.3,ppReserve=0.2,ppWaste=0.25,ppSpendable=0.05,handCapOther=9";
    const danger = "danger:weight=30,offset=1,scale=1.5,floor=0.001,delayed=0";
    const twoTurns = {
      eval: `${pp1},mainAsEnd=1+${danger},mainAsEnd=1`,
      reply: `${pp1},mainAsEnd=1+${danger},mainAsEnd=0`,
      greedy: `${pp1},mainAsEnd=0+${danger},mainAsEnd=0+quick=end:ppWaste=0.25`,
      cond: `cond=gates:penalty=1.5:table=${bundledCardTable().file.hash}`,
      mull: "mull=sim:k=8,t=3,margin=0,opp=greedy,cand=32",
    };
    const oneTurn = { ...twoTurns, reply: `${pp1},mainAsEnd=0+${danger},mainAsEnd=0` };
    expect(fixIdentities()).toEqual(twoTurns);
    expect(fixIdentities(FIX_DEFAULTS, 1)).toEqual(oneTurn);
    expect(presetIdentities("medium-v2")).toEqual(twoTurns);
    expect(presetIdentities("hard-next")).toEqual(twoTurns);
    expect(presetIdentities("medium-next")).toEqual(oneTurn);
    // The candidates record their bases' (their own search options apart: presetSearchIdentity).
    expect(presetIdentities("hard-next-macro")).toEqual(twoTurns);
    expect(presetIdentities("medium-next-macro")).toEqual(oneTurn);
    // On a slower device: one turn ahead, the mulligan's samples scaled (at least 2).
    const half = { ...oneTurn, mull: "mull=sim:k=4,t=3,margin=0,opp=greedy,cand=32" };
    for (const preset of BOT_PRESETS) expect(presetIdentities(preset, 0.5), preset).toEqual(half);
    expect(presetIdentities("medium-next", 0.1).mull).toBe("mull=sim:k=2,t=3,margin=0,opp=greedy,cand=32");
    expect(createPresetBot(cards, "medium-v2", "p", 0.5).mulliganStats?.identity).toBe(half.mull);
    expect(createPresetBot(cards, "medium-v2", "p").mulliganStats?.identity).toBe(twoTurns.mull);
  });

  // Our main phase after the opponent's reply (where a one-turn bot scores its plans, planner.ts playReply), PP refilled:
  // a Quick card kept in hand instead of cast this turn (another card in its place) is worth the same there.
  it("score a one-turn bot's leaves at the start of our main phase: no credit for a Quick card held (eval-pp.ts (b))", () => {
    const engine = createEngine({ cards: ALL_CARDS, scripts: ALL_SCRIPTS });
    const FILLER = ["SD04-003", "SD04-005", "SD04-006", "SD04-009"];
    const at = (hand: string[]) =>
      scenario(engine, {
        turn: 5,
        firstPlayer: 0,
        players: [
          { deck: many(10, "SD04-003"), leader: "SD03-LD01", hand, playPoints: 5, maxPlayPoints: 5 },
          { deck: many(10, "SD04-003"), leader: "SD04-LD01", hand: FILLER },
        ],
      }).view(0);
    const held = at(["SD03-015", ...FILLER]); // Magic Missile: 3 play points, Quick
    const cast = at([...FILLER, "SD04-003"]);
    const gain = (o: PlannerBotOptions) => o.replyEvaluator!(held, 0) - o.replyEvaluator!(cast, 0);
    expect(gain(MEDIUM_NEXT)).toBeCloseTo(0, 9);
    // Two turns ahead the leaves are the opponent's main phase (the measured form): read here, it would credit the card.
    expect(gain(MEDIUM_V2)).toBeCloseTo(3 * (0.2 + 0.25), 9);
    expect(MEDIUM_NEXT.replyEvaluator).not.toBe(MEDIUM_V2.replyEvaluator);
  });

  // This turn 1 play point and PIECE (1) and PAYOFF (3, Combo 2: 8 to the leader) in hand, the opponent at 8: held, next
  // turn PIECE then PAYOFF is lethal; a one-turn plan plays PIECE now.
  const { defineCard, fanfare } = script;
  const cards = createEngine({
    cards: [testFollower("PIECE", 1, 1, 1), testFollower("PAYOFF", 3, 2, 2), testFollower("BIG", 5, 5, 5), testFollower("FILLER", 1, 1, 1)],
    scripts: {
      PAYOFF: defineCard({
        abilities: [
          fanfare({
            *resolve(fx) {
              if (fx.game.combo(fx.controller, 2)) yield* fx.dealDamage(fx.game.leader(fx.game.opponent(fx.controller)), 8);
            },
          }),
        ],
      }),
    },
  });
  const many = (n: number, id: string) => Array<string>(n).fill(id);
  const playTurn = (preset: BotPreset, effort: number) => {
    const t = drive(cards, { me: { hand: ["PIECE", "PAYOFF"], deck: many(10, "BIG"), playPoints: 1, maxPlayPoints: 3 }, opp: { deck: many(10, "FILLER"), leaderDefense: 8 } });
    const bot = createPresetBot(cards, preset, "p", effort);
    const turn = t.game.state.turn;
    for (let i = 0; i < 20 && t.game.decision?.player === 0 && t.game.state.turn === turn && t.game.state.phase === "main"; i++) t.game.act(bot.decide(t.game));
    expect(bot.stats.fallbacks).toBe(0);
    return { field: t.zone("me", "field"), bot };
  };
  const fieldAfter = (preset: BotPreset, effort: number) => playTurn(preset, effort).field;

  it("look two turns ahead (Hard, the two-turn Medium) or one (Medium; any of them on a slower device, effort below 1)", () => {
    expect(fieldAfter("medium-v2", 1)).toEqual([]);
    expect(fieldAfter("hard-next", 1)).toEqual([]);
    expect(fieldAfter("medium-v2", 0.5)).toEqual(["PIECE"]);
    expect(fieldAfter("medium-next", 1)).toEqual(["PIECE"]);
  }, 60_000);

  // The candidates build and play as their bases look ahead; each searched its own turn by actions, on a slower device too
  // (presetAt keeps the two search options there, and the counts are scaled as the base's).
  it("build the candidates, which search their own turn by actions at every effort", () => {
    const cases = [
      ["hard-next-macro", 1, []],
      ["medium-next-macro", 1, ["PIECE"]],
      ["hard-next-macro", 0.5, ["PIECE"]],
      ["medium-next-macro", 0.5, ["PIECE"]],
    ] as const;
    for (const [preset, effort, field] of cases) {
      const played = playTurn(preset, effort);
      expect(played.field, `${preset} at ${effort}`).toEqual(field);
      expect(played.bot.macroStats.searches, `${preset} at ${effort}`).toBeGreaterThan(0);
    }
  }, 60_000);
});
