import { describe, expect, it } from "vitest";
import { createEngine, script } from "../src/core";
import { HARD_OPTIONS, MEDIUM_OPTIONS, PlannerBot, type PlannerBotOptions } from "../src";
import { drive, testFollower, testSpell, type DriveSpec } from "../../core/src/testing";

// Two turns ahead (PlannerBotOptions.lookahead 2): a whole turn's plans compared by the opponent's next turn and our turn
// after, not only by the position each leaves.

const { defineCard, fanfare, spell } = script;
const cards = createEngine({
  cards: [
    testFollower("PIECE", 1, 1, 1),
    testFollower("PAYOFF", 3, 2, 2),
    testFollower("BIG", 5, 5, 5),
    testFollower("FILLER", 1, 1, 1),
    testFollower("BODY", 2, 2, 2),
    testFollower("STORM44", 2, 4, 4),
    testSpell("QKILL", 2, { text: "Quick. Destroy an enemy follower." }),
  ],
  scripts: {
    STORM44: defineCard({ keywords: ["storm"] }),
    QKILL: defineCard({
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
    // Combo 2 (CR 13.2.1.2: this card and another played this turn): 8 damage to the enemy leader.
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

/**
 * This turn 1 play point and PIECE (1) and PAYOFF (3) in hand; next turn 4, and nothing else cheap to come (the deck is 5s).
 * PIECE now adds a little to the board, and next turn PAYOFF alone has no Combo. Held, next turn PIECE then PAYOFF is lethal
 * (the opponent is at 8).
 */
const combo: DriveSpec = {
  me: { hand: ["PIECE", "PAYOFF"], deck: many(10, "BIG"), playPoints: 1, maxPlayPoints: 3 },
  opp: { deck: many(10, "FILLER"), leaderDefense: 8 },
};

/** What the bot does with this turn: the cards it plays. */
function played(options: PlannerBotOptions, spec: DriveSpec = combo): string[] {
  const t = drive(cards, spec);
  const bot = new PlannerBot(cards, { seed: "l", ...options });
  const turn = t.game.state.turn;
  for (let i = 0; i < 20 && t.game.decision?.player === 0 && t.game.state.turn === turn && t.game.state.phase === "main"; i++) t.game.act(bot.decide(t.game));
  expect(bot.stats.fallbacks).toBe(0);
  return t.zone("me", "field");
}

describe("two turns ahead", () => {
  it("keeps a combo piece for next turn's lethal, where one turn's plans play it now", () => {
    for (const options of [MEDIUM_OPTIONS, HARD_OPTIONS]) {
      expect(played({ ...options, lethalSearch: 0 })).toEqual(["PIECE"]);
      expect(played({ ...options, lethalSearch: 0, lookahead: 2, samples: 2 })).toEqual([]);
    }
  });

  it("keeps the play points for a Quick removal when the opponent's Storm follower would be lethal (the defender answers)", () => {
    // At 4 defense with 2 play points: QKILL (2, Quick) or BODY (2, 2/2). Next turn the opponent plays a 2-cost 4/4 Storm
    // follower and attacks: with the points kept, QKILL destroys it when it attacks (CR 8.4.7).
    const spec: DriveSpec = {
      me: { hand: ["QKILL", "BODY"], deck: many(10, "FILLER"), playPoints: 2, maxPlayPoints: 2, leaderDefense: 4 },
      opp: { hand: ["STORM44"], deck: many(10, "STORM44"), maxPlayPoints: 1 },
    };
    for (const options of [MEDIUM_OPTIONS, HARD_OPTIONS]) {
      expect(played(options, spec)).toEqual([]);
      expect(played({ ...options, lookahead: 2, samples: 2, planKinds: 6 }, spec)).toEqual([]);
    }
  });
});
