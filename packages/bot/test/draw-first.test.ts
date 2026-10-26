import { describe, expect, it } from "vitest";
import { createEngine, script, validateAnswer, type Answer, type GameSession, type MainAction } from "../src/core";
import { ALL_CARDS, ALL_SCRIPTS } from "../../core/src/sets";
import { GreedyBot, MEDIUM_OPTIONS, PlannerBot, positionKey, type PlannerBotOptions } from "../src";
import { actionSegments, drawToFront, drewCards } from "../src/plan-lines";
import { deckPool, drive, randomDeck, testFollower, testSpell } from "../../core/src/testing";

// Information first (PlannerBotOptions.drawFirst, plan-lines.ts): before a plan is carried out, an action that draws (CR
// 5.10) is moved to its front when the plan still ends in the same position with the same value in its own sample.

const { defineCard, fanfare, spell } = script;
const cards = createEngine({
  cards: [
    testFollower("HITTER", 3, 4, 2),
    testFollower("FILLER", 1, 1, 1),
    testFollower("COUNT", 1, 1, 1, { text: "Fanfare: deal X damage to the enemy leader. X equals the cards in your cemetery." }),
    testSpell("DRAW1", 1, { text: "Draw a card." }),
  ],
  scripts: {
    DRAW1: defineCard({ abilities: [spell({ *resolve(fx) { yield* fx.draw(1); } })] }),
    // An order that matters: a spell played before it is in the cemetery (CR 10.6.2.8).
    COUNT: defineCard({
      abilities: [
        fanfare({
          *resolve(fx) {
            const x = fx.game.cards(fx.controller, "cemetery").length;
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
  key: string;
  value: number;
  done: boolean;
}
interface Internals {
  models: number;
  rng: unknown;
  current: { path: { answer: Answer }[] } | null;
  node(session: GameSession, parent: null, answer: null, me: number, turn: number, stop: "decide"): PNode;
  expand(node: PNode, answer: Answer, me: number, turn: number, world: () => GameSession): PNode | null;
  carryOut(choice: PNode, turn: number, me: number): Answer;
}

/** The action at `node`'s main phase decision that `pick` finds (by the cards' definitions). */
function action(node: PNode, pick: (a: MainAction, def: (id: string) => string) => boolean): Answer {
  const d = node.session.decision!;
  if (d.type !== "mainPhase") throw new Error(`not a main phase decision: ${d.type}`);
  const def = (id: string) => node.session.reader().card(id)?.def ?? "?";
  const found = d.actions.find((a) => pick(a, def));
  if (!found) throw new Error("no such action");
  return { type: "mainPhase", action: found };
}
const plays = (card: string) => (a: MainAction, def: (id: string) => string) => a.type === "play" && def(a.card) === card;
const attacksLeader = (a: MainAction, def: (id: string) => string) => a.type === "attack" && def(a.attacker) === "HITTER" && def(a.target) !== "HITTER";

/** A plan made of these actions in this order (each picked at its decision), carried out by a bot with these options. */
function carry(options: PlannerBotOptions, hand: string[], picks: ((a: MainAction, def: (id: string) => string) => boolean)[]) {
  const t = drive(cards, { me: { hand, field: ["HITTER"], deck: many(10, "FILLER"), playPoints: 3, maxPlayPoints: 3 }, opp: { deck: many(10, "FILLER"), leaderDefense: 20 } });
  const bot = new PlannerBot(cards, { ...MEDIUM_OPTIONS, lethalSearch: 0, seed: "d", ...options });
  const b = bot as unknown as Internals;
  const game = t.game;
  const turn = game.state.turn;
  const world = () => game.determinized(0, "draw-test");
  let node = b.node(world(), null, null, 0, turn, "decide");
  for (const pick of picks) node = b.expand(node, action(node, pick), 0, turn, world)!;
  const models = b.models;
  const rng = JSON.stringify(b.rng);
  const first = b.carryOut(node, turn, 0);
  const def = (id: string) => game.reader().card(id)?.def ?? "?";
  const firstCard = first.type === "mainPhase" && first.action.type === "play" ? def(first.action.card) : first.type === "mainPhase" ? first.action.type : first.type;
  return { bot, b, end: node, first, firstCard, models, rng };
}

describe("information first: a drawing action moved to the plan's front", () => {
  it("reads a plan's actions and its draws", () => {
    expect(actionSegments([true, false, false, true, true, false])).toEqual([[0, 1, 2], [3], [4, 5]]);
    expect(actionSegments([false, true])).toBeNull();
    expect(actionSegments([])).toBeNull();
    expect(drawToFront(4, 2)).toEqual([2, 0, 1, 3]);
    const move = (reason: string, player: number, zone: string) => ({ type: "cardsMoved", moves: [{ card: "a", newCard: "b", def: "X", printing: "X", owner: player, from: null, to: { player, zone, faceUp: false }, reason, before: null }] });
    expect(drewCards([move("draw", 0, "hand")] as never, 0)).toBe(true);
    expect(drewCards([move("draw", 1, "hand")] as never, 0)).toBe(false);
    expect(drewCards([move("effect", 0, "hand")] as never, 0)).toBe(false);
  });

  it("[attack the leader, draw a card] ends the same either way: the draw is played first, the planner's counts untouched", () => {
    const { bot, b, end, firstCard, models, rng } = carry({ drawFirst: true }, ["DRAW1"], [attacksLeader, plays("DRAW1")]);
    expect(firstCard).toBe("DRAW1");
    expect(bot.drawFirstStats).toEqual({ plans: 1, drawPlans: 1, tried: 1, moved: 1, mismatch: 0, failed: 0 });
    // The plan carried out is the moved one, and it ends where the plan did.
    const path = b.current!.path as unknown as PNode[];
    expect(path).toHaveLength(2);
    expect(positionKey(path[1]!.session.view(0))).toBe(end.key);
    expect(b.models).toBe(models);
    expect(JSON.stringify(b.rng)).toBe(rng);
    // Off: the plan as it is.
    const off = carry({}, ["DRAW1"], [attacksLeader, plays("DRAW1")]);
    expect(off.firstCard).toBe("attack");
    expect(off.bot.drawFirstStats.plans).toBe(0);
  });

  it("[COUNT, draw a card]: COUNT would see the spell in the cemetery, so the plan stays as it is", () => {
    const { bot, firstCard, end } = carry({ drawFirst: true }, ["DRAW1", "COUNT"], [plays("COUNT"), plays("DRAW1")]);
    expect(end.session.state.players[1].leaderDefense).toBe(20);
    expect(firstCard).toBe("COUNT");
    expect(bot.drawFirstStats).toEqual({ plans: 1, drawPlans: 1, tried: 1, moved: 0, mismatch: 0, failed: 0 });
  });

  it("a plan whose first action draws, or that draws nothing, is left as it is", () => {
    const first = carry({ drawFirst: true }, ["DRAW1"], [plays("DRAW1"), attacksLeader]);
    expect(first.firstCard).toBe("DRAW1");
    expect(first.bot.drawFirstStats).toMatchObject({ plans: 1, drawPlans: 0, moved: 0 });
    const none = carry({ drawFirst: true }, ["FILLER"], [attacksLeader, plays("FILLER")]);
    expect(none.firstCard).toBe("attack");
    expect(none.bot.drawFirstStats).toMatchObject({ plans: 1, drawPlans: 0, moved: 0 });
  });

  it("in whole games: legal and clean, the same game again, and the same answers as without it until a plan is moved", () => {
    const engine = createEngine({ cards: ALL_CARDS, scripts: ALL_SCRIPTS });
    const pool = deckPool(engine);
    const small: PlannerBotOptions = { ...MEDIUM_OPTIONS, lookahead: 2, samples: 2, beamWidth: 4, maxSimulations: 200, innerSimulations: 100 };
    const play = (options: PlannerBotOptions) => {
      const g = engine.newGame({ seed: "draw-first", players: [randomDeck(pool, "draw-first/0"), randomDeck(pool, "draw-first/1")], config: { deckRestrictions: false } });
      const bot = new PlannerBot(engine, { seed: "df", ...small, ...options });
      const other = new GreedyBot(engine, { seed: "g" });
      const answers: Answer[] = [];
      /** The answers given before the first move. */
      let before: number | null = null;
      while (g.decision && answers.length < 20_000) {
        const d = g.decision;
        const answer = d.player === 0 ? bot.decide(g) : other.decide(g);
        if (before === null && bot.drawFirstStats.moved > 0) before = answers.length;
        expect(validateAnswer(d, answer)).toBeNull();
        g.act(answer);
        answers.push(answer);
      }
      expect([bot.stats.fallbacks, bot.stats.simulationFailures]).toEqual([0, 0]);
      return { answers, before: before ?? answers.length, stats: { ...bot.drawFirstStats } };
    };
    const on = play({ drawFirst: true });
    expect(play({ drawFirst: true }).answers).toEqual(on.answers);
    const off = play({});
    expect(on.answers.slice(0, on.before)).toEqual(off.answers.slice(0, on.before));
    expect(on.stats.plans).toBeGreaterThan(0);
    expect(on.stats.moved).toBeLessThanOrEqual(on.stats.tried);
    expect(on.stats.failed).toBe(0);
  }, 600_000);
});
