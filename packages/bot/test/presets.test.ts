import { describe, expect, it } from "vitest";
import { createEngine, script } from "../src/core";
import { BOT_PRESETS, bundledCardTable, createPresetBot, FIX_DEFAULTS, fixIdentities, fixOptions, HARD_NEXT, HARD_OPTIONS, MEDIUM_NEXT, MEDIUM_OPTIONS, MEDIUM_V2, presetIdentities, type BotPreset, type PlannerBotOptions } from "../src";
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
  const fieldAfter = (preset: BotPreset, effort: number) => {
    const t = drive(cards, { me: { hand: ["PIECE", "PAYOFF"], deck: many(10, "BIG"), playPoints: 1, maxPlayPoints: 3 }, opp: { deck: many(10, "FILLER"), leaderDefense: 8 } });
    const bot = createPresetBot(cards, preset, "p", effort);
    const turn = t.game.state.turn;
    for (let i = 0; i < 20 && t.game.decision?.player === 0 && t.game.state.turn === turn && t.game.state.phase === "main"; i++) t.game.act(bot.decide(t.game));
    expect(bot.stats.fallbacks).toBe(0);
    return t.zone("me", "field");
  };

  it("look two turns ahead (Hard, the two-turn Medium) or one (Medium; any of them on a slower device, effort below 1)", () => {
    expect(fieldAfter("medium-v2", 1)).toEqual([]);
    expect(fieldAfter("hard-next", 1)).toEqual([]);
    expect(fieldAfter("medium-v2", 0.5)).toEqual(["PIECE"]);
    expect(fieldAfter("medium-next", 1)).toEqual(["PIECE"]);
  }, 60_000);
});
