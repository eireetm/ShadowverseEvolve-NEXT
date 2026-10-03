import { describe, expect, it } from "vitest";
import { createEngine, script, type PlayerView } from "../src/core";
import { HARD_BETA_OPTIONS, HARD_OPTIONS, MEDIUM_BETA_OPTIONS, MEDIUM_OPTIONS, PlannerBot, exactResults, lethalWithinReach, type PlannerBotOptions } from "../src";
import { drive, testFollower, testSpell, type DriveSpec } from "../../core/src/testing";

// Sure lethal first (lethal.ts): a line that surely wins this turn is played before the turn is planned.

const { defineCard, spell } = script;
const cards = createEngine({
  cards: [
    testFollower("FAIRY", 1, 1, 1),
    testFollower("HITTER", 3, 4, 2),
    testFollower("WALL", 2, 1, 3),
    testFollower("WALL2", 2, 1, 2),
    testFollower("FILLER", 1, 1, 1),
    testFollower("STORMER", 0, 6, 1),
    testSpell("DRAW", 0, { text: "Draw a card." }),
    testSpell("FETCH", 0, { text: "Search your deck for a STORMER and put it into your hand." }),
  ],
  scripts: {
    WALL: defineCard({ keywords: ["ward"] }),
    WALL2: defineCard({ keywords: ["ward"] }),
    STORMER: defineCard({ keywords: ["storm"] }),
    DRAW: defineCard({
      abilities: [
        spell({
          *resolve(fx) {
            yield* fx.draw(1);
          },
        }),
      ],
    }),
    FETCH: defineCard({
      abilities: [
        spell({
          *resolve(fx) {
            yield* fx.search((id) => fx.game.card(id)?.def === "STORMER", { max: 1 });
          },
        }),
      ],
    }),
  },
});
const fillers = (n: number) => Array<string>(n).fill("FILLER");

/** Our turn played by a planner: did it win this turn, the opponent's defense, and its lethal counts after its first answer. */
function ourTurn(spec: DriveSpec, options: PlannerBotOptions) {
  const t = drive(cards, spec);
  const bot = new PlannerBot(cards, { seed: "s", ...options });
  const turn = t.game.state.turn;
  let first: typeof bot.lethalStats | null = null;
  for (let i = 0; i < 80 && t.game.decision?.player === 0 && t.game.state.turn === turn; i++) {
    t.game.act(bot.decide(t.game));
    first ??= { ...bot.lethalStats };
  }
  return { won: t.game.result?.winner === 0, opponent: t.game.state.players[1].leaderDefense, first: first!, stats: bot.lethalStats };
}

describe("sure lethal first", () => {
  /**
   * 8 defense behind an engaged 1/3 Ward: the only lethal is three 1/1s into the Ward, then both 4/2s at the leader. A 4/2
   * into the Ward looks better (it takes the Ward out and lives), and leaves the opponent at 1.
   */
  const wardAt8: DriveSpec = { me: { deck: fillers(10), field: ["FAIRY", "FAIRY", "FAIRY", "HITTER", "HITTER"] }, opp: { deck: fillers(10), field: [{ card: "WALL", engaged: true }], leaderDefense: 8 } };

  it("finds lethal that needs the Ward taken out by the small followers, where a narrow plan takes the trade that looks better", () => {
    expect(ourTurn(wardAt8, { beamWidth: 2 })).toMatchObject({ won: false, opponent: 1 });
    expect(ourTurn(wardAt8, { beamWidth: 2, lethalSearch: 300 })).toMatchObject({ won: true, opponent: 0 });
  });

  it("Medium and Hard play it, and so do the beta levels", () => {
    for (const options of [MEDIUM_OPTIONS, HARD_OPTIONS, MEDIUM_BETA_OPTIONS, HARD_BETA_OPTIONS]) expect(ourTurn(wardAt8, options).won).toBe(true);
  });

  it("looks for it behind a Ward at more than 10 defense: the attacks on the Ward count toward the reach", () => {
    // 12 behind an engaged 1/2 Ward: two 1/1s into the Ward, then three 4/2s at the leader (no attack on the leader is declarable yet).
    const spec: DriveSpec = { me: { deck: fillers(10), field: ["FAIRY", "FAIRY", "HITTER", "HITTER", "HITTER"] }, opp: { deck: fillers(10), field: [{ card: "WALL2", engaged: true }], leaderDefense: 12 } };
    const t = drive(cards, spec);
    expect(lethalWithinReach(t.game.view(0), t.game.decision!, 0)).toBe(true);
    const r = ourTurn(spec, { beamWidth: 2, lethalSearch: 800 });
    expect([r.won, r.first.played]).toEqual([true, 1]);
  });

  it("a fair bot doesn't count on a card it would draw; it plays the lethal once the card is in its hand. The cheating bot knows it", () => {
    // DRAW then the top card: a 6/1 Storm follower for 0, at 6 defense. Medium doesn't know the top card (1 in 10).
    const spec: DriveSpec = { me: { hand: ["DRAW"], deck: ["STORMER", ...fillers(9)], playPoints: 1 }, opp: { deck: fillers(10), leaderDefense: 6 } };
    const medium = ourTurn(spec, MEDIUM_OPTIONS);
    expect(medium.first.played).toBe(0);
    expect(medium.won).toBe(true);
    const hard = ourTurn(spec, HARD_OPTIONS);
    expect([hard.first.played, hard.won]).toEqual([1, true]);
  });

  it("a card searched from the deck is the same card in every sample: such a lethal is sure", () => {
    const spec: DriveSpec = { me: { hand: ["FETCH"], deck: [...fillers(9), "STORMER"], playPoints: 1 }, opp: { deck: fillers(10), leaderDefense: 6 } };
    const r = ourTurn(spec, MEDIUM_OPTIONS);
    expect([r.first.played, r.won]).toEqual([1, true]);
  });

  it("is off in a planner made without it (the opponent models)", () => {
    expect(ourTurn(wardAt8, { beamWidth: 2 }).stats.searches).toBe(0);
  });
});

describe("exact results", () => {
  it("a finished game is won, lost or drawn whatever the evaluation says", () => {
    const view = (winner: 0 | 1 | null) => ({ result: { winner } }) as unknown as PlayerView;
    const evaluator = exactResults(() => 42, 1000);
    expect([evaluator(view(0), 0), evaluator(view(1), 0), evaluator(view(null), 0)]).toEqual([1000, -1000, 0]);
    expect(evaluator({ result: null } as unknown as PlayerView, 0)).toBe(42);
  });
});
