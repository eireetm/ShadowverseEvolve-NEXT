import { describe, expect, it } from "vitest";
import { createEngine, script, validateAnswer, type Answer, type GameSession } from "../src/core";
import { ALL_CARDS, ALL_SCRIPTS } from "../../core/src/sets";
import { GreedyBot, MACRO_DEFAULTS, MEDIUM_OPTIONS, PlannerBot, actionsOf, completionKey, keptCompletions, macroIdentity, macroInnerIdentity, macroProblems, type MacroNode, type MacroOptions, type PlannerBotOptions } from "../src";
import { deckPool, drive, randomAgent, randomDeck, testFollower, testSpell } from "../../core/src/testing";

// Macro steps (PlannerBotOptions.macro, macroInner, macro-steps.ts): the root search and the two-turn search's inner ones by
// actions — a main phase answer with every decision inside its action is one step of the beam.

const { defineCard, fanfare, spell } = script;
const cards = createEngine({
  cards: [
    testFollower("PAYER", 1, 1, 1, { text: "Fanfare: discard a card, three times. Then deal 6 damage to the enemy leader." }),
    testFollower("DOUBLE", 1, 1, 1, { text: "Fanfare: draw a card. Fanfare: deal X damage to the enemy leader, X the cards in your hand." }),
    testFollower("HITTER", 3, 3, 3),
    testFollower("CARD_A", 5, 2, 2),
    testFollower("CARD_B", 6, 3, 3),
    testFollower("CARD_C", 7, 4, 4),
    testFollower("FILLER", 1, 1, 1),
    testSpell("QZAP", 1, { text: "Quick. Destroy an enemy follower." }),
  ],
  scripts: {
    QZAP: defineCard({
      keywords: ["quick"],
      abilities: [
        spell({
          *resolve(fx) {
            const [target] = yield* fx.selectCards(fx.game.followers(fx.game.opponent(fx.controller)), 1, 1);
            if (target !== undefined) yield* fx.destroy([target]);
          },
        }),
      ],
    }),
    // Pays first (three decisions), gets afterwards: the shape of BP08-037's -10 in small.
    PAYER: defineCard({
      abilities: [
        fanfare({
          *resolve(fx) {
            for (let i = 0; i < 3; i++) yield* fx.discard(fx.controller, 1, 1);
            yield* fx.dealDamage(fx.game.leader(fx.game.opponent(fx.controller)), 6);
          },
        }),
      ],
    }),
    // Two Fanfares pending at once (CR 10.5.2.2: their controller picks the order); the order changes the damage.
    DOUBLE: defineCard({
      abilities: [
        fanfare({
          *resolve(fx) {
            yield* fx.draw(1);
          },
        }),
        fanfare({
          *resolve(fx) {
            const x = fx.game.cards(fx.controller, "hand").length;
            if (x > 0) yield* fx.dealDamage(fx.game.leader(fx.game.opponent(fx.controller)), x);
          },
        }),
      ],
    }),
  },
});
const many = (n: number, id: string) => Array<string>(n).fill(id);

interface PNode {
  session: GameSession;
  parent: PNode | null;
  answer: Answer | null;
  depth: number;
  value: number;
  done: boolean;
  key: string;
}
interface Internals {
  node(session: GameSession, parent: null, answer: null, me: number, turn: number, stop: "decide"): PNode;
  beam(root: PNode, actor: number, turn: number, world: () => GameSession, budget: number, width: number, score?: undefined, inner?: boolean): PNode[];
  completeAction(...a: unknown[]): PNode[];
  expand(...a: unknown[]): PNode | null;
}

/**
 * The root search (`inner`: an inner search of the two-turn search, as turnValue calls it) of a bot with these options at a
 * position: the finished plans, every action's completions returned, and what every expansion was told about being inner.
 */
function search(options: PlannerBotOptions, hand: string[], budget = 600, width = 6, inner = false) {
  const t = drive(cards, { me: { hand, field: ["HITTER"], deck: many(10, "FILLER"), playPoints: 3, maxPlayPoints: 3 }, opp: { deck: many(10, "FILLER"), leaderDefense: 20 } });
  const bot = new PlannerBot(cards, { ...MEDIUM_OPTIONS, lethalSearch: 0, seed: "m", ...options });
  const b = bot as unknown as Internals;
  const completed: PNode[][] = [];
  const complete = b.completeAction;
  b.completeAction = function (this: unknown, ...a: unknown[]) {
    const out = complete.apply(this, a);
    completed.push(out);
    return out;
  };
  const flags: unknown[] = [];
  const expand = b.expand;
  b.expand = function (this: unknown, ...a: unknown[]) {
    flags.push(a[6]);
    return expand.apply(this, a);
  };
  const game = t.game;
  const turn = game.state.turn;
  const world = () => game.determinized(0, "macro-test");
  const root = b.node(world(), null, null, 0, turn, "decide");
  const finished = b.beam(root, 0, turn, world, budget, width, undefined, inner);
  const opp = (n: PNode) => n.session.state.players[1].leaderDefense;
  const steps = (n: PNode) => {
    const out: string[] = [];
    for (let x: PNode | null = n; x && x.parent; x = x.parent) {
      const a = x.answer!;
      const def = (id: string) => x!.parent!.session.reader().card(id)?.def ?? "?";
      out.unshift(a.type === "mainPhase" ? (a.action.type === "play" ? `play ${def(a.action.card)}` : a.action.type) : a.type);
    }
    return out;
  };
  return { bot, finished, completed, flags, opp, steps };
}

describe("macro steps: the parameters and the helpers", () => {
  it("names its parameters and refuses bad ones", () => {
    expect(MACRO_DEFAULTS).toEqual({ actions: 12, keep: 2, sub: 4, dec: 40, share: 0.25 });
    expect(macroIdentity(MACRO_DEFAULTS)).toBe("macro=12:keep=2,sub=4,dec=40,share=0.25");
    expect(macroProblems(MACRO_DEFAULTS)).toEqual([]);
    expect(macroProblems({ ...MACRO_DEFAULTS, actions: 0, share: 0 })).toEqual(["actions=0: a whole number from 1 to 40", "share=0: a number above 0, at most 1"]);
    expect(() => new PlannerBot(cards, { macro: { ...MACRO_DEFAULTS, keep: 1.5 } })).toThrow(/macro: keep=1.5/);
    expect(macroInnerIdentity(MACRO_DEFAULTS)).toBe("macroInner=12:keep=2,sub=4,dec=40,share=0.25");
    expect(() => new PlannerBot(cards, { macroInner: { ...MACRO_DEFAULTS, keep: 1.5 } })).toThrow(/macroInner: keep=1.5/);
  });

  it("counts a plan's actions, reads a completion without the order of pending abilities, keeps the better of those", () => {
    const d = (type: string) => ({ decision: { type } as never });
    const root: MacroNode & { value: number; key: string } = { parent: null, answer: null, depth: 0, session: d("mainPhase"), value: 0, key: "r" };
    const play = { parent: root, answer: { type: "mainPhase", action: { type: "play", card: "c1" } } as Answer, depth: 1, session: d("selectPending"), value: 0, key: "p" };
    const order = (id: string, value: number, key: string) => ({ parent: play, answer: { type: "selectPending", id } as Answer, depth: 2, session: d("mainPhase"), value, key });
    const first = order("p1", 3, "k1");
    const second = order("p2", 5, "k2");
    expect(actionsOf(first)).toBe(1);
    expect(actionsOf(root)).toBe(0);
    expect(completionKey(first, play)).toBe(completionKey(second, play));
    expect(keptCompletions([first, second], play, 2)).toEqual([second]);
    // Different choices are different completions, best first, one per position.
    const target = { ...play, session: d("selectCards") };
    const pick = (cards: string[], value: number, key: string) => ({ parent: target, answer: { type: "selectCards", cards } as Answer, depth: 2, session: d("mainPhase"), value, key });
    const a = pick(["x"], 1, "ka");
    const b = pick(["y"], 4, "kb");
    const c = pick(["z"], 2, "kb");
    expect(keptCompletions([a, b, c], target, 2)).toEqual([b, a]);
    expect(keptCompletions([a, b, c], target, 1)).toEqual([b]);
  });
});

describe("macro steps: the root search by actions", () => {
  it("a card whose Fanfare asks three times is one step: every completion is at a main phase decision, its plan one action", () => {
    // Four cards in hand after PAYER: three discards to choose (the last card would be forced).
    const { finished, completed, opp, steps, bot } = search({ macro: { ...MACRO_DEFAULTS }, choiceDedupe: true }, ["PAYER", "CARD_A", "CARD_B", "CARD_C", "FILLER"]);
    expect(completed.length).toBeGreaterThan(0);
    for (const out of completed) for (const n of out) expect(n.done || n.session.decision?.type === "mainPhase").toBe(true);
    const paid = finished.filter((n) => opp(n) <= 14);
    expect(paid.length).toBeGreaterThan(0);
    const one = paid.find((n) => actionsOf(n) === 1)!;
    expect(steps(one)).toEqual(["play PAYER", "selectCards", "selectCards", "selectCards"]);
    // Every expansion counted: the actions' main phase answers and the decisions inside them.
    expect(bot.macroStats.searches).toBe(1);
    expect(bot.macroStats.subExpansions).toBeGreaterThan(0);
    expect(bot.stats.simulations).toBeGreaterThanOrEqual(bot.macroStats.actions + bot.macroStats.subExpansions);
  });

  it("depth by actions: two actions take PAYER's whole play and an attack; two decisions by the beam don't finish PAYER", () => {
    const macro = search({ macro: { ...MACRO_DEFAULTS, actions: 2 }, choiceDedupe: true }, ["PAYER", "CARD_A", "CARD_B", "CARD_C", "FILLER"]);
    const both = macro.finished.find((n) => macro.opp(n) === 11);
    expect(both && macro.steps(both)).toEqual(expect.arrayContaining(["play PAYER", "attack"]));
    expect(Math.max(...macro.finished.map((n) => actionsOf(n)))).toBe(2);
    const shallow = search({ maxDepth: 2 }, ["PAYER", "CARD_A", "CARD_B", "CARD_C", "FILLER"]);
    expect(shallow.finished.some((n) => shallow.opp(n) <= 14)).toBe(false);
  });

  it("an allowance spent before the action ends: the best position left is finished by the fast answers, not dropped", () => {
    const { finished, opp, bot } = search({ macro: { ...MACRO_DEFAULTS, share: 0.01, sub: 1 }, maxBranches: 2, choiceDedupe: true }, ["PAYER", "CARD_A", "CARD_B", "CARD_C", "FILLER"], 40);
    expect(bot.macroStats.finishedFast).toBeGreaterThan(0);
    expect(finished.some((n) => opp(n) <= 14)).toBe(true);
  });

  it("two orders of DOUBLE's pending Fanfares: the better one kept (CR 10.5.2.2), one plan of that action", () => {
    const { finished, opp, steps } = search({ macro: { ...MACRO_DEFAULTS }, choiceDedupe: true }, ["DOUBLE", "CARD_A", "CARD_B"]);
    const alone = finished.filter((n) => actionsOf(n) === 1 && steps(n)[0] === "play DOUBLE");
    expect(alone).toHaveLength(1);
    // Draw first: 3 cards in hand when the damage is dealt (CARD_A, CARD_B and the card drawn), not 2.
    expect(opp(alone[0]!)).toBe(17);
    // The beam by decisions keeps both orders (two positions).
    const plain = search({}, ["DOUBLE", "CARD_A", "CARD_B"]);
    expect(plain.finished.filter((n) => plain.steps(n).length === 2 && plain.steps(n)[0] === "play DOUBLE")).toHaveLength(2);
  });

  it("in whole games: legal and clean, the same game again; the two-turn bot with it too", () => {
    const engine = createEngine({ cards: ALL_CARDS, scripts: ALL_SCRIPTS });
    const pool = deckPool(engine);
    const small: PlannerBotOptions = { ...MEDIUM_OPTIONS, lookahead: 2, samples: 2, beamWidth: 4, maxSimulations: 200, innerSimulations: 100, choiceDedupe: true, macro: { ...MACRO_DEFAULTS, actions: 6 } };
    const play = (options: PlannerBotOptions) => {
      const g = engine.newGame({ seed: "macro", players: [randomDeck(pool, "macro/0"), randomDeck(pool, "macro/1")], config: { deckRestrictions: false } });
      const bot = new PlannerBot(engine, { seed: "mx", ...options });
      const other = new GreedyBot(engine, { seed: "g" });
      const answers: Answer[] = [];
      while (g.decision && answers.length < 20_000) {
        const d = g.decision;
        const answer = d.player === 0 ? bot.decide(g) : other.decide(g);
        expect(validateAnswer(d, answer)).toBeNull();
        g.act(answer);
        answers.push(answer);
      }
      expect(g.result).not.toBeNull();
      expect([bot.stats.fallbacks, bot.stats.simulationFailures]).toEqual([0, 0]);
      expect(bot.macroStats.searches).toBeGreaterThan(0);
      return answers;
    };
    expect(play(small)).toEqual(play(small));
  }, 600_000);
});

// The two-turn search's inner searches (the opponent's turn, our next one: planner.ts turnValue). Most of these call beam() as
// turnValue does, `inner` true, at the root tests' position.
describe("macro steps: the inner searches by actions (macroInner)", () => {
  const HAND = ["PAYER", "CARD_A", "CARD_B", "CARD_C", "FILLER"];
  const ON = { macroInner: { ...MACRO_DEFAULTS }, choiceDedupe: true } satisfies PlannerBotOptions;

  it("a card whose Fanfare asks three times is one step of an inner search, which two decisions by the beam don't finish", () => {
    const by = search({ ...ON, maxDepth: 2 }, HAND, 300, 4, true);
    const paid = by.finished.filter((n) => by.opp(n) <= 14);
    expect(paid.length).toBeGreaterThan(0);
    expect(by.steps(paid.find((n) => actionsOf(n) === 1)!)).toEqual(["play PAYER", "selectCards", "selectCards", "selectCards"]);
    // By decisions (macro alone leaves the inner searches so), maxDepth stops it half-paid.
    for (const options of [{ choiceDedupe: true }, { choiceDedupe: true, macro: { ...MACRO_DEFAULTS } }]) {
      const plain = search({ ...options, maxDepth: 2 }, HAND, 300, 4, true);
      expect(plain.finished.some((n) => plain.opp(n) <= 14)).toBe(false);
      expect([plain.bot.macroStats.searches, plain.bot.macroInnerStats.searches, plain.bot.innerStats.searches]).toEqual([0, 0, 1]);
      expect(plain.bot.innerStats.expansions).toBe(plain.flags.length);
    }
  });

  it("every expansion is told it is inner, its counts are apart from the root's, and the budget holds but for the last action's end", () => {
    const { bot, flags, finished } = search(ON, HAND, 300, 4, true);
    expect(finished.length).toBeGreaterThan(0);
    expect(new Set(flags)).toEqual(new Set([true]));
    expect(bot.macroStats).toEqual({ searches: 0, layers: 0, actions: 0, subExpansions: 0, finishedFast: 0, actionCut: 0, budgetOut: 0, decisionCut: 0 });
    expect(bot.macroInnerStats.searches).toBe(1);
    expect(bot.macroInnerStats.subExpansions).toBeGreaterThan(0);
    expect(bot.innerStats.searches).toBe(1);
    expect(bot.innerStats.expansions).toBe(flags.length);
    const small = search(ON, HAND, 40, 4, true);
    expect(small.bot.innerStats.expansions).toBeLessThanOrEqual(40 + MACRO_DEFAULTS.dec + 1);
    expect(small.bot.innerStats.capped).toBe(1);
    expect(small.bot.macroInnerStats.budgetOut).toBe(1);
    // A root search of the bot leaves the inner counts alone.
    const root = search({ ...ON, macro: { ...MACRO_DEFAULTS } }, HAND, 300, 4);
    expect(new Set(root.flags)).toEqual(new Set([false]));
    expect(root.bot.macroInnerStats.searches).toBe(0);
    expect(root.bot.innerStats).toEqual({ searches: 0, expansions: 0, capped: 0, noPlan: 0 });
    expect(root.bot.macroStats.searches).toBe(1);
  });

  it("an allowance spent before the action ends is finished by the fast answers, told it is inner: no conditional charge there", () => {
    const small = { macroInner: { ...MACRO_DEFAULTS, share: 0.01, sub: 1 }, maxBranches: 2, choiceDedupe: true, conditional: { scope: "declared" } } satisfies PlannerBotOptions;
    const { bot, flags, finished, opp } = search(small, HAND, 40, 6, true);
    expect(bot.macroInnerStats.finishedFast).toBeGreaterThan(0);
    expect(finished.some((n) => opp(n) <= 14)).toBe(true);
    expect(new Set(flags)).toEqual(new Set([true]));
    expect(bot.condStats!.windows).toBe(0);
    // The same search at the root is followed by the charges (so the 0 above isn't for want of plays).
    const root = search({ ...small, macro: small.macroInner }, HAND, 40, 6);
    expect(root.bot.macroStats.finishedFast).toBeGreaterThan(0);
    expect(root.bot.condStats!.windows).toBeGreaterThan(0);
  });

  it("the budget of one still gives a plan where the turn can end, and an action started is finished", () => {
    const { bot, finished } = search(ON, HAND, 1, 4, true);
    expect(finished.length).toBeGreaterThan(0);
    expect(bot.innerStats.capped).toBe(1);
    expect(bot.innerStats.expansions).toBeLessThanOrEqual(1 + MACRO_DEFAULTS.dec + 1);
  });

  it("the other side's answers there are the later turns' cheaper model: 4 candidates, at quick windows with something to play", () => {
    const sizes = (options: PlannerBotOptions, inner: boolean) => {
      const t = drive(cards, {
        me: { field: ["HITTER", "HITTER"], hand: ["FILLER"], deck: many(10, "FILLER"), playPoints: 1, maxPlayPoints: 1 },
        // Every card of theirs a QZAP: a sample of what we know gives them one whatever it deals.
        opp: { hand: ["QZAP"], field: ["FILLER"], deck: many(10, "QZAP"), playPoints: 2, maxPlayPoints: 2 },
      });
      const bot = new PlannerBot(cards, { ...MEDIUM_OPTIONS, lethalSearch: 0, seed: "m", ...options });
      const b = bot as unknown as Internals & { model(kind: unknown, seed: unknown, most: number): unknown };
      const seen: number[] = [];
      const model = b.model;
      b.model = function (this: unknown, kind: unknown, seed: unknown, most: number) {
        seen.push(most);
        return model.call(this, kind, seed, most);
      };
      const game = t.game;
      const turn = game.state.turn;
      const world = () => game.determinized(0, "macro-test");
      b.beam(b.node(world(), null, null, 0, turn, "decide"), 0, turn, world, 100, 4, undefined, inner);
      return seen;
    };
    const inner = sizes(ON, true);
    expect(inner.length).toBeGreaterThan(0);
    expect(new Set(inner)).toEqual(new Set([4]));
    expect(new Set(sizes({ ...ON, macro: { ...MACRO_DEFAULTS } }, false))).toEqual(new Set([12]));
  });

  it("two turns ahead: the bot's inner searches go by actions with it, by decisions without it, and its root's counts don't move", () => {
    const decide = (options: PlannerBotOptions) => {
      const t = drive(cards, {
        me: { hand: ["PAYER", "CARD_A", "CARD_B", "CARD_C"], field: ["HITTER"], deck: many(10, "FILLER"), playPoints: 3, maxPlayPoints: 3 },
        opp: { hand: ["PAYER", "CARD_A", "CARD_B", "CARD_C"], field: ["HITTER"], deck: many(10, "FILLER"), maxPlayPoints: 3, leaderDefense: 20 },
      });
      const bot = new PlannerBot(cards, { ...MEDIUM_OPTIONS, lethalSearch: 0, lookahead: 2, samples: 2, innerSimulations: 100, seed: "m", choiceDedupe: true, macro: { ...MACRO_DEFAULTS }, ...options });
      const answer = bot.decide(t.game);
      expect(validateAnswer(t.game.decision!, answer)).toBeNull();
      expect([bot.stats.fallbacks, bot.stats.simulationFailures]).toEqual([0, 0]);
      return bot;
    };
    const on = decide({ macroInner: { ...MACRO_DEFAULTS } });
    const off = decide({});
    expect(on.innerStats.searches).toBeGreaterThan(0);
    expect(on.macroInnerStats.searches).toBe(on.innerStats.searches);
    expect(on.macroInnerStats.subExpansions).toBeGreaterThan(0);
    expect(off.innerStats.searches).toBeGreaterThan(0);
    expect(off.macroInnerStats.searches).toBe(0);
    // One root search each, the same root plans: the inner option doesn't reach it.
    expect(on.macroStats).toEqual(off.macroStats);
  }, 120_000);

  it("it moves the two-turn comparison: the opponent's three-decision payment, cut half-paid by the beam, is played out by actions", () => {
    /** The values plan() compares the same root plans by (cheating: the opponent's hand is the real one, PAYER in it). */
    const compared = (options: PlannerBotOptions) => {
      const t = drive(cards, {
        me: { hand: ["FILLER", "HITTER"], field: ["HITTER"], deck: many(10, "FILLER"), playPoints: 3, maxPlayPoints: 3 },
        opp: { hand: ["PAYER", "CARD_A", "CARD_B", "CARD_C", "FILLER"], deck: many(10, "FILLER"), maxPlayPoints: 3, leaderDefense: 20 },
      });
      const bot = new PlannerBot(cards, { ...MEDIUM_OPTIONS, cheat: true, lethalSearch: 0, replyLethal: 0, lookahead: 2, maxDepth: 2, innerSimulations: 100, seed: "m", choiceDedupe: true, macro: { ...MACRO_DEFAULTS }, ...options });
      const b = bot as unknown as { pick(candidates: unknown[], values: number[], turn: number): unknown };
      const seen: number[][] = [];
      const pick = b.pick;
      b.pick = function (this: unknown, candidates: unknown[], values: number[], turn: number) {
        seen.push([...values]);
        return pick.call(this, candidates, values, turn);
      };
      bot.decide(t.game);
      expect([bot.stats.fallbacks, bot.stats.simulationFailures]).toEqual([0, 0]);
      return seen;
    };
    const on = compared({ macroInner: { ...MACRO_DEFAULTS } });
    const off = compared({});
    expect(on.length).toBe(1);
    expect(on[0]!.length).toBeGreaterThan(1);
    expect(on[0]!.length).toBe(off[0]!.length);
    expect(on[0]).not.toEqual(off[0]);
  }, 120_000);

  it("looking one turn ahead no inner search runs: the option changes nothing", () => {
    const answers = (options: PlannerBotOptions) => {
      const t = drive(cards, { me: { hand: ["PAYER", "CARD_A", "CARD_B", "CARD_C"], field: ["HITTER"], deck: many(10, "FILLER"), playPoints: 3, maxPlayPoints: 3 }, opp: { deck: many(10, "FILLER"), leaderDefense: 20 } });
      const bot = new PlannerBot(cards, { ...MEDIUM_OPTIONS, lethalSearch: 0, seed: "m", choiceDedupe: true, macro: { ...MACRO_DEFAULTS }, ...options });
      const given: Answer[] = [];
      const turn = t.game.state.turn;
      for (let i = 0; i < 20 && t.game.decision?.player === 0 && t.game.state.turn === turn && t.game.state.phase === "main"; i++) {
        given.push(bot.decide(t.game));
        t.game.act(given[given.length - 1]!);
      }
      return { given, bot };
    };
    const on = answers({ macroInner: { ...MACRO_DEFAULTS } });
    expect(on.given).toEqual(answers({}).given);
    expect(on.bot.innerStats.searches).toBe(0);
    expect(on.bot.macroInnerStats.searches).toBe(0);
  }, 60_000);

  const engine = createEngine({ cards: ALL_CARDS, scripts: ALL_SCRIPTS });
  const pool = deckPool(engine);
  const SMALL: PlannerBotOptions = { ...MEDIUM_OPTIONS, lookahead: 2, samples: 2, beamWidth: 4, maxSimulations: 200, innerSimulations: 100, choiceDedupe: true, macro: { ...MACRO_DEFAULTS, actions: 6 }, macroInner: { ...MACRO_DEFAULTS, actions: 6 } };

  it("in whole games: legal and clean, the same game again", () => {
    const play = () => {
      const g = engine.newGame({ seed: "macro-in", players: [randomDeck(pool, "macro-in/0"), randomDeck(pool, "macro-in/1")], config: { deckRestrictions: false } });
      const bot = new PlannerBot(engine, { seed: "mx", ...SMALL });
      const other = new GreedyBot(engine, { seed: "g" });
      const answers: Answer[] = [];
      while (g.decision && answers.length < 20_000) {
        const d = g.decision;
        const answer = d.player === 0 ? bot.decide(g) : other.decide(g);
        expect(validateAnswer(d, answer)).toBeNull();
        g.act(answer);
        answers.push(answer);
      }
      expect(g.result).not.toBeNull();
      expect([bot.stats.fallbacks, bot.stats.simulationFailures]).toEqual([0, 0]);
      expect(bot.macroInnerStats.searches).toBeGreaterThan(0);
      expect(bot.macroInnerStats.searches).toBe(bot.innerStats.searches);
      return answers;
    };
    expect(play()).toEqual(play());
  }, 600_000);

  // A fair bot's inner searches read its sample (the world they start from), as its root's does, never the real game.
  it("a fair bot decides on what its player can see only: other hidden cards, same decision", () => {
    let compared = 0;
    for (let i = 0; i < 3 && compared < 8; i++) {
      const seed = `macro-in-fair-${i}`;
      const g = engine.newGame({ seed, players: [randomDeck(pool, `${seed}/0`), randomDeck(pool, `${seed}/1`)], config: { deckRestrictions: false } });
      const random = randomAgent(`mf${i}`);
      for (let step = 0; g.decision && step < 400 && compared < 8; step++) {
        const d = g.decision;
        if (d.type === "mainPhase" && g.state.turn >= 3 && step % 3 === 0) {
          const answer = new PlannerBot(engine, { seed: "fair", ...SMALL }).decide(g);
          expect(new PlannerBot(engine, { seed: "fair", ...SMALL }).decide(g.determinized(d.player, `other hidden cards ${step}`)), `game ${i} step ${step}`).toEqual(answer);
          compared += 1;
        }
        g.act(random(d, g));
      }
    }
    expect(compared).toBe(8);
  }, 600_000);
});

/** A MacroOptions literal type check (the defaults are one). */
const typed: MacroOptions = MACRO_DEFAULTS;
void typed;
