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
  HARD_NEXT_MACRO_IN,
  HARD_OPTIONS,
  MACRO_DEFAULTS,
  macroProblems,
  MEDIUM_NEXT,
  MEDIUM_NEXT_MACRO,
  MEDIUM_OPTIONS,
  MEDIUM_V2,
  MEDIUM_V2_MACRO,
  MEDIUM_V2_MACRO_IN,
  levelPreset,
  presetIdentities,
  presetSearchIdentity,
  searchIdentityOf,
  type BotPreset,
  type PlannerBotOptions,
} from "../src";
import { ALL_CARDS, ALL_SCRIPTS } from "../../core/src/sets";
import { deckPool, drive, randomAgent, randomDeck, scenario, testFollower } from "../../core/src/testing";

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

  // The presets a computer's levels play: the older ones with their own turn searched by actions (macro-steps.ts) and the
  // choices told apart, everything else their bases'. The two search options are recorded on their own.
  it("add the three searching by actions: their bases with exactly the root search by actions and the choices told apart", () => {
    const withoutSearch = (o: PlannerBotOptions) => {
      const { choiceDedupe: _d, macro: _m, ...rest } = o;
      return rest;
    };
    const candidates = [
      [HARD_NEXT_MACRO, HARD_NEXT],
      [MEDIUM_NEXT_MACRO, MEDIUM_NEXT],
      [MEDIUM_V2_MACRO, MEDIUM_V2],
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
    expect(MEDIUM_V2_MACRO.macro).not.toBe(HARD_NEXT_MACRO.macro);
    expect(MEDIUM_NEXT_MACRO.cheat).toBeUndefined();
    expect(MEDIUM_V2_MACRO.cheat).toBeUndefined();
    expect(BOT_PRESETS).toEqual(["medium-next", "hard-next", "medium-v2", "hard-next-macro", "medium-next-macro", "medium-v2-macro", "medium-v2-macro-in", "hard-next-macro-in"]);
    const search = "dedupe=1+macro=12:keep=2,sub=4,dec=40,share=0.25";
    const inner = `${search}+macroInner=12:keep=2,sub=4,dec=40,share=0.25+inner=300x4`;
    expect(BOT_PRESETS.map((p) => presetSearchIdentity(p))).toEqual([null, null, null, search, search, search, inner, inner]);
  });

  // The two with the later turns of the two-turn search by actions too: not levels of the interface.
  it("add the two with the inner searches by actions: their bases with exactly that, on the budget and width of the searches they replace", () => {
    const withoutInner = (o: PlannerBotOptions) => {
      const { macroInner: _m, innerSimulations: _s, innerBeam: _b, ...rest } = o;
      return rest;
    };
    const macros: unknown[] = [];
    for (const [candidate, base] of [[MEDIUM_V2_MACRO_IN, MEDIUM_V2_MACRO], [HARD_NEXT_MACRO_IN, HARD_NEXT_MACRO]] as const) {
      // toStrictEqual compares functions by reference: the same evaluations, the same reader of the charge's table.
      expect(withoutInner(candidate)).toStrictEqual(base);
      expect([base.macroInner, base.innerSimulations, base.innerBeam, base.innerPlans, base.maxDepth]).toEqual([undefined, undefined, undefined, undefined, undefined]);
      // Written out in levels.ts; today's defaults with 12 actions, and the planner's own inner budget and width.
      expect(candidate.macroInner).toEqual({ ...MACRO_DEFAULTS, actions: 12 });
      expect(macroProblems(candidate.macroInner!)).toEqual([]);
      expect([candidate.innerSimulations, candidate.innerBeam]).toEqual([300, 4]);
      macros.push(candidate.macro, candidate.macroInner, base.macro);
    }
    // Each preset's own objects: a tool that turns one off on the object doesn't touch another.
    expect(new Set(macros).size).toBe(macros.length);
    expect(HARD_NEXT_MACRO_IN.cheat).toBe(true);
    expect(MEDIUM_V2_MACRO_IN.cheat).toBeUndefined();
    // Hard on a computer plays the cheating one (it beat hard-next-macro in paired games); the fair one is no level, and no
    // level plays one on a slower device.
    for (const effort of [1, 0.5]) for (const level of ["medium", "medium-v2", "hard"] as const) {
      if (level === "hard" && effort === 1) expect(levelPreset(level, effort)).toBe("hard-next-macro-in");
      else expect(levelPreset(level, effort)).not.toMatch(/-in$/);
    }
    expect(searchIdentityOf({})).toBeNull();
    expect(searchIdentityOf({ innerSimulations: 450, innerBeam: 6, maxDepth: 14 })).toBe("inner=450x6+depth=14");
    expect(searchIdentityOf({ innerBeam: 6 })).toBe("inner=300x6");
  });

  // No verdict covers a preset on a slower device: a level changes there on its own measurement.
  // The levels called fair: searching by actions reads the samples (world) as the other searches do, never the real game.
  it("searching by actions, the fair presets decide on what their player can see only: other hidden cards, same decision", () => {
    const engine = createEngine({ cards: ALL_CARDS, scripts: ALL_SCRIPTS });
    const pool = deckPool(engine);
    const compared = { "medium-next-macro": 0, "medium-v2-macro": 0, "medium-v2-macro-in": 0 };
    let innerByActions = 0;
    for (const [preset, games, most] of [["medium-next-macro", 3, 6], ["medium-v2-macro", 1, 2], ["medium-v2-macro-in", 1, 2]] as const) {
      for (let i = 0; i < games; i++) {
        const seed = `preset-fair-${preset}-${i}`;
        const g = engine.newGame({ seed, players: [randomDeck(pool, `${seed}/0`), randomDeck(pool, `${seed}/1`)], config: { deckRestrictions: false } });
        const random = randomAgent(`pf${i}`);
        for (let step = 0; g.decision && step < 300 && compared[preset] < most * (i + 1); step++) {
          const d = g.decision;
          if (d.type === "mainPhase" && g.state.turn >= 3 && step % 4 === 0) {
            const other = g.determinized(d.player, `other hidden cards ${step}`);
            const bot = createPresetBot(engine, preset, "fair");
            expect(createPresetBot(engine, preset, "fair").decide(other), `${preset} step ${step}`).toEqual(bot.decide(g));
            innerByActions += bot.macroInnerStats.searches;
            compared[preset] += 1;
          }
          g.act(random(d, g));
        }
      }
      expect(compared[preset], preset).toBeGreaterThanOrEqual(most);
    }
    // medium-v2-macro-in's decisions did reach its inner searches: with one plan to compare they run none, and proving nothing.
    expect(innerByActions).toBeGreaterThan(0);
  }, 600_000);

  it("give each interface level its preset by effort: by actions on a computer, the older ones on a slower device", () => {
    expect((["medium", "medium-v2", "hard"] as const).map((level) => levelPreset(level, 1))).toEqual(["medium-next-macro", "medium-v2-macro", "hard-next-macro-in"]);
    for (const effort of [0.5, 0.99]) expect((["medium", "medium-v2", "hard"] as const).map((level) => levelPreset(level, effort))).toEqual(["medium-next", "medium-v2", "hard-next"]);
  });

  // presetSearchIdentity records the search options searchIdentityOf writes: a preset setting another one would be recorded as
  // its base is. Every preset leaves the others off; a preset that needs one adds it to searchIdentityOf first.
  it("set no search option presetSearchIdentity doesn't record", () => {
    const options: Record<BotPreset, PlannerBotOptions> = { "medium-next": MEDIUM_NEXT, "hard-next": HARD_NEXT, "medium-v2": MEDIUM_V2, "hard-next-macro": HARD_NEXT_MACRO, "medium-next-macro": MEDIUM_NEXT_MACRO, "medium-v2-macro": MEDIUM_V2_MACRO, "medium-v2-macro-in": MEDIUM_V2_MACRO_IN, "hard-next-macro-in": HARD_NEXT_MACRO_IN };
    expect(Object.keys(options).sort()).toEqual([...BOT_PRESETS].sort());
    const unrecorded = ["commonRandom", "lineSlots", "tieKeepHand", "drawFirst", "turnOrder", "replyLethalOpp", "replyLethalKey", "closeSamples", "explore", "innerPlans"] as const;
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
    // The presets searching by actions record their bases' (their own search options apart: presetSearchIdentity).
    expect(presetIdentities("hard-next-macro")).toEqual(twoTurns);
    expect(presetIdentities("medium-next-macro")).toEqual(oneTurn);
    expect(presetIdentities("medium-v2-macro")).toEqual(twoTurns);
    expect(presetIdentities("hard-next-macro-in")).toEqual(twoTurns);
    expect(presetIdentities("medium-v2-macro-in")).toEqual(twoTurns);
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

  // The presets searching by actions build and play as their bases look ahead; each searched its own turn by actions, on a
  // slower device too, should a level play one there (presetAt keeps the two search options, and the counts are scaled as
  // the base's).
  it("build the presets searching by actions, which do so at every effort", () => {
    const cases = [
      ["hard-next-macro", 1, []],
      ["medium-next-macro", 1, ["PIECE"]],
      ["medium-v2-macro", 1, []],
      ["hard-next-macro", 0.5, ["PIECE"]],
      ["medium-next-macro", 0.5, ["PIECE"]],
      ["medium-v2-macro", 0.5, ["PIECE"]],
    ] as const;
    for (const [preset, effort, field] of cases) {
      const played = playTurn(preset, effort);
      expect(played.field, `${preset} at ${effort}`).toEqual(field);
      expect(played.bot.macroStats.searches, `${preset} at ${effort}`).toBeGreaterThan(0);
    }
  }, 60_000);

  // The inner searches are the two-turn search's: on a computer by actions; on a slower device (one turn ahead, presetAt) there
  // are none, so the two play there as their bases do.
  it("build the presets with the inner searches by actions, which have none below effort 1", () => {
    for (const [preset, base] of [["medium-v2-macro-in", "medium-v2-macro"], ["hard-next-macro-in", "hard-next-macro"]] as const) {
      const played = playTurn(preset, 1);
      expect(played.field, preset).toEqual([]);
      expect(played.bot.macroInnerStats.searches, preset).toBeGreaterThan(0);
      expect(played.bot.macroInnerStats.searches, preset).toBe(played.bot.innerStats.searches);
      expect(playTurn(base, 1).bot.macroInnerStats.searches, base).toBe(0);
      const slower = playTurn(preset, 0.5);
      expect(slower.field, preset).toEqual(playTurn(base, 0.5).field);
      expect(slower.bot.innerStats, preset).toEqual({ searches: 0, expansions: 0, capped: 0, noPlan: 0 });
      expect(slower.bot.macroInnerStats.searches, preset).toBe(0);
    }
  }, 120_000);
});
