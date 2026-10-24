import { describe, expect, it } from "vitest";
import { createEngine, type Answer, type GameEvent, type GameSession, type PlayerId } from "../src/core";
import { ALL_CARDS, ALL_SCRIPTS } from "../../core/src/sets";
import { scenario, type ScenarioSide } from "../../core/src/testing/scenario";
import { GreedyBot, PP1_DEFAULTS, PlannerBot, PpLine, fastAnswer, lookupFromReader, pp1Evaluator, pp1GreedyParams, quickIdentity } from "../src";
import { ARENA_CONFIG, sampleDeck } from "./samples";

// The end-phase Quick window's bonus (quick-window.ts, GreedyBotOptions endPhaseQuickBonus): at the opponent's end-phase
// window (CR 7.4.5) the greedy bot adds the bonus per play point an answer uses (they would be lost at our refill, CR 7.2.2).
const engine = createEngine({ cards: ALL_CARDS, scripts: ALL_SCRIPTS });
const greedyForm = pp1Evaluator(pp1GreedyParams(PP1_DEFAULTS));
const DECK = Array.from({ length: 10 }, () => "SD04-003");
const FILLER = ["SD04-003", "SD04-005", "SD04-006", "SD04-009"];
const INSIGHT = "SD03-005"; // Insight: 1 PP, Quick, draw a card

/** Player 1 (active, turn 6) ends its main phase; the game is played on to player 0's first decision: its CR 7.4.5 window. */
function endWindow(ours: ScenarioSide, theirs: ScenarioSide = { hand: FILLER }): GameSession {
  const withDeck = (s: ScenarioSide): ScenarioSide => ({ deck: DECK, ...s });
  const g = scenario(engine, { turn: 6, firstPlayer: 0, players: [withDeck({ leader: "SD03-LD01", ...ours }), withDeck({ leader: "SD04-LD01", ...theirs })] });
  g.act({ type: "mainPhase", action: { type: "endMainPhase" } } as Answer);
  for (let i = 0; i < 50 && g.decision && g.decision.player !== 0; i++) g.act(fastAnswer(g.decision, lookupFromReader(g.reader())));
  return g;
}
const played = (g: GameSession, a: Answer): string | null => (a.type === "quick" && a.action.type === "play" ? g.reader().card(a.action.card)!.def : null);

describe("the end-phase window's bonus", () => {
  it("casts Insight with 2 PP left where the greedy form alone passes (a tie at our next main phase, after the refill)", () => {
    const g = endWindow({ hand: [INSIGHT, ...FILLER], playPoints: 2, maxPlayPoints: 2 });
    expect(g.decision).toMatchObject({ type: "quick", timing: "endPhase", player: 0 });
    const plain = new GreedyBot(engine, { seed: "qw", evaluator: greedyForm });
    const bonus = new GreedyBot(engine, { seed: "qw", evaluator: greedyForm, endPhaseQuickBonus: PP1_DEFAULTS.ppWaste });
    expect(plain.decide(g.clone())).toEqual({ type: "quick", action: { type: "pass" } });
    expect(played(g, bonus.decide(g.clone()))).toBe(INSIGHT);
    expect(bonus.quickStats!.windows).toBe(1);
    expect(bonus.quickStats!.bonused).toBeGreaterThan(0);
    expect(plain.quickStats).toBeNull();
    // The planner's own greedy gets it from quickEndBonus (and its evaluation from greedyEvaluator).
    const planner = new PlannerBot(engine, { seed: "qw", evaluator: pp1Evaluator(), greedyEvaluator: greedyForm, quickEndBonus: PP1_DEFAULTS.ppWaste });
    expect(played(g, planner.decide(g.clone()))).toBe(INSIGHT);
    expect(planner.quickStats).toMatchObject({ windows: 1 });
  });

  it("arms nowhere without points left, and only at the opponent's end phase", () => {
    const g = endWindow({ hand: [INSIGHT, ...FILLER], playPoints: 0, maxPlayPoints: 2 });
    const bot = new GreedyBot(engine, { seed: "qw", evaluator: greedyForm, endPhaseQuickBonus: 0.25 });
    if (g.decision) bot.decide(g.clone());
    expect(bot.quickStats!.windows).toBe(0);
    expect(() => new GreedyBot(engine, { endPhaseQuickBonus: -1 })).toThrow(/from 0 to 10/);
    expect(quickIdentity(0.25)).toBe("quick=end:ppWaste=0.25");
  });

  it("gives a greedy bot the same answers at every other decision of a game", () => {
    // Two greedy bots with the same seed see the same decisions (seat 0's of a game played on by the plain one): their
    // random streams stay the same, so any difference is the bonus's, and only at the windows.
    const g = engine.newGame({ seed: "qw-game", players: [sampleDeck("sd03"), sampleDeck("sd01")], config: ARENA_CONFIG });
    const plain = new GreedyBot(engine, { seed: "qw-game", evaluator: greedyForm });
    const bonus = new GreedyBot(engine, { seed: "qw-game", evaluator: greedyForm, endPhaseQuickBonus: 0.25 });
    const other = new GreedyBot(engine, { seed: "qw-other" });
    let windows = 0;
    let others = 0;
    for (let i = 0; i < 600 && g.decision && g.state.turn <= 12; i++) {
      const d = g.decision;
      if (d.player !== 0) {
        g.act(other.decide(g));
        continue;
      }
      const before = bonus.quickStats!.windows;
      const a = plain.decide(g.clone());
      const b = bonus.decide(g.clone());
      if (bonus.quickStats!.windows > before) windows += 1;
      else {
        others += 1;
        expect(b, `input ${i}`).toEqual(a);
      }
      g.act(a);
    }
    expect(others).toBeGreaterThan(20);
    expect(windows).toBeGreaterThan(0);
  });
});

describe("the points a line uses", () => {
  const me: PlayerId = 0;
  const pp = (player: PlayerId, playPoints: number): GameEvent => ({ type: "playPointsChanged", player, playPoints, maxPlayPoints: 5 });
  const turn = (player: PlayerId): GameEvent => ({ type: "turnStarted", turn: 7, player });
  const line = (start: number, ...batches: GameEvent[][]) => {
    const l = new PpLine(me, start);
    for (const b of batches) l.see(b);
    return l.spent();
  };

  it("counts the points paid before our next turn starts, not the refill after it (CR 7.2.2)", () => {
    expect(line(3, [pp(0, 1)], [turn(0), pp(0, 5)])).toBe(2);
    expect(line(3, [pp(0, 2), pp(1, 0), turn(0), pp(0, 6)])).toBe(1);
    expect(line(3, [turn(0), pp(0, 5)])).toBe(0);
    expect(line(3, [pp(1, 0)], [turn(0)])).toBe(0);
    expect(line(2, [pp(0, 1), pp(0, 3)], [turn(0)])).toBe(0);
  });

  it("gives nothing when another turn comes first (an extra turn, CR 5.28) or the game ends", () => {
    expect(line(3, [pp(0, 1)], [turn(1)], [turn(0)])).toBe(0);
    expect(line(3, [pp(0, 1), { type: "gameEnded", result: { winner: 0, losses: [{ player: 1, reason: "leaderDefense" }] } }])).toBe(0);
    expect(line(3, [pp(0, 1)])).toBe(0);
  });
});
