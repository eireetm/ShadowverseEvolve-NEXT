import { describe, expect, it } from "vitest";
import { createEngine, script, validateAnswer, type Answer, type GameSession } from "../src/core";
import { ALL_CARDS, ALL_SCRIPTS } from "../../core/src/sets";
import { GreedyBot, MACRO_DEFAULTS, MEDIUM_OPTIONS, PlannerBot, actionsOf, completionKey, keptCompletions, macroIdentity, macroProblems, type MacroNode, type MacroOptions, type PlannerBotOptions } from "../src";
import { deckPool, drive, randomDeck, testFollower } from "../../core/src/testing";

// Macro steps (PlannerBotOptions.macro, macro-steps.ts): the root search by actions — a main phase answer with every decision
// inside its action is one step of the beam.

const { defineCard, fanfare } = script;
const cards = createEngine({
  cards: [
    testFollower("PAYER", 1, 1, 1, { text: "Fanfare: discard a card, three times. Then deal 6 damage to the enemy leader." }),
    testFollower("DOUBLE", 1, 1, 1, { text: "Fanfare: draw a card. Fanfare: deal X damage to the enemy leader, X the cards in your hand." }),
    testFollower("HITTER", 3, 3, 3),
    testFollower("CARD_A", 5, 2, 2),
    testFollower("CARD_B", 6, 3, 3),
    testFollower("CARD_C", 7, 4, 4),
    testFollower("FILLER", 1, 1, 1),
  ],
  scripts: {
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
  beam(root: PNode, actor: number, turn: number, world: () => GameSession, budget: number, width: number): PNode[];
  completeAction(...a: unknown[]): PNode[];
}

/** The root search of a bot with these options at a position: the finished plans, and every action's completions returned. */
function search(options: PlannerBotOptions, hand: string[], budget = 600, width = 6) {
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
  const game = t.game;
  const turn = game.state.turn;
  const world = () => game.determinized(0, "macro-test");
  const root = b.node(world(), null, null, 0, turn, "decide");
  const finished = b.beam(root, 0, turn, world, budget, width);
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
  return { bot, finished, completed, opp, steps };
}

describe("macro steps: the parameters and the helpers", () => {
  it("names its parameters and refuses bad ones", () => {
    expect(MACRO_DEFAULTS).toEqual({ actions: 12, keep: 2, sub: 4, dec: 40, share: 0.25 });
    expect(macroIdentity(MACRO_DEFAULTS)).toBe("macro=12:keep=2,sub=4,dec=40,share=0.25");
    expect(macroProblems(MACRO_DEFAULTS)).toEqual([]);
    expect(macroProblems({ ...MACRO_DEFAULTS, actions: 0, share: 0 })).toEqual(["actions=0: a whole number from 1 to 40", "share=0: a number above 0, at most 1"]);
    expect(() => new PlannerBot(cards, { macro: { ...MACRO_DEFAULTS, keep: 1.5 } })).toThrow(/macro: keep=1.5/);
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

/** A MacroOptions literal type check (the defaults are one). */
const typed: MacroOptions = MACRO_DEFAULTS;
void typed;
