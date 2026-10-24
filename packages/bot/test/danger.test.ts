import { describe, expect, it } from "vitest";
import { createEngine, type CardView, type GameSession, type PlayerId, type PlayerView } from "../src/core";
import { ALL_CARDS, ALL_SCRIPTS } from "../../core/src/sets";
import { scenario, type ScenarioSide } from "../../core/src/testing/scenario";
import { DANGER_DEFAULTS, PlannerBot, danger, dangerIdentity, dangerProblems, dangerStartParams, dangerTerm, fastAnswer, leaderDamage, lookupFromReader, lossChance, pp1Evaluator, threats, type DangerParams, type Evaluator } from "../src";

// The danger transform (danger.ts): the visible damage that can reach a leader in the turn that comes next (CR 8.4.2,
// 8.4.2.1, 8.4.3.1, 12.8.2 (iii), 7.2.3), and W · the chance that it lands, taken from the defender and given to the
// attacker. Positions are real ones built by the core's scenario helper (player 0's main phase decision); other readings
// are those views with the phase, a card's state or keywords changed (the transform is a function of the view only).
// Values are worked out by hand from the defaults (penaltyAt below): W 30, chance (σ((1 − margin) / scale) − floor) / (1 − floor).
const engine = createEngine({ cards: ALL_CARDS, scripts: ALL_SCRIPTS });
const pp1 = pp1Evaluator();
const end = danger();
const start = danger(dangerStartParams(DANGER_DEFAULTS));
const DECK = Array.from({ length: 10 }, () => "SD04-003");
const WARRIOR = "SD04-003"; // Dragon Warrior 3/3
const GLINT = "SD04-011"; // Glint Dragon 5/3
const DRAGONGUARD = "SD04-006"; // Dragonguard 4/5, Ward
const me: PlayerId = 0;

/** A game at player 0's main phase (turn 5), with these sides (decks of 10 by default). */
function position(sides: [ScenarioSide, ScenarioSide]): GameSession {
  const withDeck = (s: ScenarioSide): ScenarioSide => ({ deck: DECK, leader: "SD04-LD01", ...s });
  return scenario(engine, { turn: 5, firstPlayer: 0, players: [withDeck(sides[0]), withDeck(sides[1])] });
}
const sigma = (x: number) => 1 / (1 + Math.exp(-x));
/** The defaults' penalty at a margin, worked out from the formula. */
const penaltyAt = (margin: number) => (30 * Math.max(0, sigma((1 - margin) / 1.5) - 0.001)) / 0.999;
/** A view with one side's field cards changed (a card's state the scenario doesn't set). */
function withField(view: PlayerView, side: PlayerId, change: (c: CardView, i: number) => Partial<CardView>): PlayerView {
  const players = view.players.map((s, p) => (p !== side ? s : { ...s, field: s.field.map((c, i) => (c.hidden ? c : { ...c, ...change(c, i) })) })) as PlayerView["players"];
  return { ...view, players };
}
/** What a transform adds to pp1 at a view, for `who`. */
const added = (transform: (base: Evaluator) => Evaluator, view: PlayerView, who: PlayerId = me) => transform(pp1)(view, who) - pp1(view, who);

describe("danger: parameters and identity", () => {
  it("names every parameter in its identity, and refuses wrong ones", () => {
    expect(dangerIdentity(DANGER_DEFAULTS)).toBe("danger:weight=30,offset=1,scale=1.5,floor=0.001,delayed=0,mainAsEnd=1");
    expect(dangerIdentity(dangerStartParams(DANGER_DEFAULTS))).toBe("danger:weight=30,offset=1,scale=1.5,floor=0.001,delayed=0,mainAsEnd=0");
    expect(dangerProblems({ ...DANGER_DEFAULTS, scale: 0, floor: 0.5, delayed: 2, mainAsEnd: 0.5 })).toHaveLength(4);
    expect(() => danger({ ...DANGER_DEFAULTS, weight: Number.NaN })).toThrow(/weight/);
  });

  it("gives a chance of one half at margin = offset without a floor, and none at or below the floor (continuous)", () => {
    const p: DangerParams = { ...DANGER_DEFAULTS, floor: 0 };
    expect(lossChance(1, p)).toBe(0.5);
    expect(lossChance(-8, DANGER_DEFAULTS)).toBeCloseTo((sigma(6) - 0.001) / 0.999, 12);
    expect(lossChance(11.36, DANGER_DEFAULTS)).toBeGreaterThan(0);
    expect(lossChance(11.37, DANGER_DEFAULTS)).toBe(0);
    for (let m = -10; m < 12; m++) expect(lossChance(m, DANGER_DEFAULTS)).toBeGreaterThan(lossChance(m + 1, DANGER_DEFAULTS));
  });
});

describe("danger: the damage that can reach the leader (CR 8.4.3.1, 8.4.9, 12.8.2 (iii), 12.14.2)", () => {
  const a = (...attacks: number[]) => attacks.map((attack, i) => ({ id: `a${i}`, attack, bane: false }));
  const w = (...defenses: number[]) => defenses.map((defense, i) => ({ id: `w${i}`, defense }));

  it("breaks the Ward followers with the attacks that cost the least, the rest reach the leader", () => {
    expect(leaderDamage(a(4, 3, 2), [])).toBe(9);
    expect(leaderDamage(a(4, 2, 1), w(3))).toBe(4);
    expect(leaderDamage(a(4, 2, 1), w(5))).toBe(2);
    expect(leaderDamage(a(5, 3, 1, 1), w(2, 4))).toBe(3);
  });

  it("is 0 while a Ward follower can't be broken; a Bane attacker breaks one whatever its attack (8.4.9.2)", () => {
    expect(leaderDamage(a(2, 2), w(5))).toBe(0);
    expect(leaderDamage(a(9), w(1, 1))).toBe(0);
    expect(leaderDamage([{ id: "b", attack: 0, bane: true }, ...a(3)], w(8))).toBe(3);
  });
});

describe("danger: threats in positions", () => {
  // Player 0 at 10, ending its turn (the planner's beam reading): player 1's three followers attack next turn, engaged
  // or not (its start phase refreshes them, 7.2.3): 3 + 3 + 5 = 11, margin −1.
  const sides = (mine: ScenarioSide, theirs: ScenarioSide = {}): [ScenarioSide, ScenarioSide] => [
    { leaderDefense: 10, ...mine },
    { field: [{ card: WARRIOR, engaged: true }, WARRIOR, { card: GLINT, engaged: true }], ...theirs },
  ];

  it("counts all of the next player's followers against the active player's leader (mainAsEnd 1)", () => {
    const view = position(sides({})).view(me);
    const [t] = threats(view);
    expect(t).toMatchObject({ attacker: 1, defender: 0, when: "next", potential: 11, defense: 10, margin: -1 });
    expect(t!.penalty).toBeCloseTo(penaltyAt(-1), 9);
    expect(added(end, view)).toBeCloseTo(-23.74, 2);
    expect(dangerTerm(view, 0) + dangerTerm(view, 1)).toBe(0);
  });

  it("counts our Ward followers as absorbing, reserved too (7.4.3); a damaged one less; one with Intimidate not (12.12.2)", () => {
    const view = position(sides({ field: [DRAGONGUARD] })).view(me);
    expect(threats(view)[0]).toMatchObject({ potential: 6, margin: 4 });
    expect(added(end, view)).toBeCloseTo(-penaltyAt(4), 9);
    const damaged = position(sides({ field: [{ card: DRAGONGUARD, damage: 2 }] })).view(me);
    expect(threats(damaged)[0]).toMatchObject({ potential: 8, margin: 2 });
    const intimidating = withField(view, 0, (c) => ({ keywords: [...c.keywords, "intimidate"] }));
    expect(threats(intimidating)[0]).toMatchObject({ potential: 11, wards: [] });
  });

  it("leaves out an engaged Boxed follower: it doesn't refresh (5.31.3), so it can't attack (8.4.2)", () => {
    const view = position(sides({})).view(me);
    expect(threats(withField(view, 1, (c) => (c.name === "Glint Dragon" ? { boxed: true } : {})))[0]).toMatchObject({ potential: 6 });
    expect(threats(withField(view, 1, (c, i) => (i === 1 ? { boxed: true } : {})))[0]).toMatchObject({ potential: 11 });
  });

  it("reads the main phase as its start or middle with mainAsEnd 0: the active player's reserved followers attack now", () => {
    const g = position([{ field: [WARRIOR, { card: GLINT, engaged: true }] }, { leaderDefense: 4, field: [DRAGONGUARD] }]);
    const view = g.view(me);
    expect(threats(view, dangerStartParams(DANGER_DEFAULTS))[0]).toMatchObject({ attacker: 0, defender: 1, when: "now", potential: 3, margin: 1 });
    expect(added(start, view)).toBeCloseTo((30 * 0.499) / 0.999, 9);
    const engaged = withField(view, 1, () => ({ engaged: true }));
    expect(threats(engaged, dangerStartParams(DANGER_DEFAULTS))[0]).toMatchObject({ potential: 0, margin: 4 });
    expect(added(end, view)).toBe(0);
  });

  it("counts the later threat only with delayed; nothing far from lethal, in a finished game or before the first turn", () => {
    const view = position(sides({ field: [WARRIOR, { card: GLINT, engaged: true }] }, { leaderDefense: 9 })).view(me);
    const half = { ...DANGER_DEFAULTS, delayed: 0.5 };
    const [now, later] = threats(view, half);
    expect(later).toMatchObject({ attacker: 0, when: "later", potential: 8, margin: 1, share: 0.5 });
    expect(dangerTerm(view, me, half)).toBeCloseTo(later!.penalty - now!.penalty, 9);
    const far = position([{ field: [WARRIOR] }, { field: [WARRIOR, GLINT] }]).view(me);
    expect(end(pp1)(far, me)).toBe(pp1(far, me));
    expect(start(pp1)(far, me)).toBe(pp1(far, me));
    const over: PlayerView = { ...view, result: { winner: 1, losses: [] } as unknown as PlayerView["result"] };
    expect(end(pp1)(over, me)).toBe(pp1(over, me));
    expect(threats({ ...view, phase: "setup" })).toEqual([]);
  });
});

/**
 * A board where clearing survives and the face loses: player 0 at 7 with 9 PP, Genesis Dragon and Romaronia in hand, two
 * Zanei Dragonewts; player 1 at 15 with 14 attack (an evolved Dragon Warrior and Glint Dragon engaged, Dragonewt Princess
 * and an evolved Dragonrider reserved), no hidden damage (Dragon Warriors in hand and deck, no evolve deck).
 */
function survive(): GameSession {
  return scenario(engine, {
    turn: 13,
    firstPlayer: 0,
    players: [
      { leader: "SD04-LD01", leaderDefense: 7, playPoints: 9, maxPlayPoints: 9, evolutionPoints: 0, hand: ["DSD01b-008", "DSD01b-001"], field: ["DSD01b-016", "DSD01b-016"], deck: DECK },
      {
        leader: "SD04-LD01",
        leaderDefense: 15,
        playPoints: 1,
        maxPlayPoints: 6,
        evolutionPoints: 2,
        hand: [WARRIOR, WARRIOR],
        deck: DECK,
        field: [{ card: WARRIOR, engaged: true, evolvedInto: "SD04-004" }, { card: GLINT, engaged: true }, "SD04-005", { card: "SD04-012", evolvedInto: "SD04-013" }],
      },
    ],
  });
}
const attackOf = (view: PlayerView, side: PlayerId) => view.players[side].field.reduce((s, c) => s + (!c.hidden && c.type === "follower" ? Math.max(0, c.attack ?? 0) : 0), 0);

/** Player 0's main phase played by the bot (player 1's quick windows passed); the board where it ends its main phase. */
function playMain(bot: PlannerBot, g: GameSession): PlayerView {
  for (let i = 0; i < 100; i++) {
    const d = g.decision!;
    if (g.state.turn !== 13 || g.state.phase !== "main") break;
    if (d.player !== 0) {
      g.act(fastAnswer(d, lookupFromReader(g.reader())));
      continue;
    }
    const answer = bot.decide(g);
    if (answer.type === "mainPhase" && answer.action.type === "endMainPhase") break;
    g.act(answer);
  }
  return g.view(0);
}

describe("danger: the clearing plan", () => {
  it("is the position described: 14 attack on a leader at 7", () => {
    expect(threats(survive().view(0))[0]).toMatchObject({ attacker: 1, potential: 14, margin: -7 });
  });

  it("becomes the beam's best plan (replyPlans 0: the plan carried out is the beam's first)", () => {
    const options = { beamWidth: 12, maxSimulations: 1200, replyPlans: 0, seed: "danger-test" };
    const plain = playMain(new PlannerBot(engine, { ...options, evaluator: pp1 }), survive());
    const withDanger = playMain(new PlannerBot(engine, { ...options, evaluator: end(pp1) }), survive());
    // pp1 alone goes for the face (15 → 1) and leaves the 14; with the danger term the board is cleared to 6 or less.
    expect(plain.players[1].leaderDefense).toBeLessThan(5);
    expect(attackOf(plain, 1)).toBe(14);
    expect(attackOf(withDanger, 1)).toBeLessThanOrEqual(6);
  });
});
