import { describe, expect, it } from "vitest";
import { createEngine, script, type PlayerView } from "../src/core";
import { GreedyBot, HARD_OPTIONS, MEDIUM_BETA_OPTIONS, MEDIUM_OPTIONS, PlannerBot, exactResults, lethalWithinReach, type PlannerBotOptions } from "../src";
import { lineWins, lineWinsAgainstAll, stepOf } from "../src/lethal";
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
    testSpell("SEEK", 1, { text: "Search your deck for a follower and put it into your hand." }),
    testFollower("STORM1", 1, 6, 1),
    testFollower("BIG", 2, 5, 5),
    testSpell("QBURN", 1, { text: "Quick. Deal 2 damage to an enemy follower." }),
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
    SEEK: defineCard({
      abilities: [
        spell({
          *resolve(fx) {
            yield* fx.search((id) => fx.game.info(id).type === "follower", { max: 1 });
          },
        }),
      ],
    }),
    STORM1: defineCard({ keywords: ["storm"] }),
    QBURN: defineCard({
      keywords: ["quick"],
      abilities: [
        spell({
          *resolve(fx) {
            const [target] = yield* fx.selectCards(fx.game.followers(fx.game.opponent(fx.controller)), 1, 1);
            if (target !== undefined) yield* fx.dealDamage(target, 2);
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

  it("Medium and Hard play it, and so does the beta level", () => {
    for (const options of [MEDIUM_OPTIONS, HARD_OPTIONS, MEDIUM_BETA_OPTIONS]) expect(ourTurn(wardAt8, options).won).toBe(true);
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

  it("a search that can take any follower: in another sample the card picked must be the same card, not the same id", () => {
    // SEEK (1) takes the 1-cost 6/1 Storm follower from a deck of nine others, at 6 defense, with 2 play points; BIG (2) is
    // the other way to spend them. The id the search picked holds another card in the other samples (determinize deals the
    // hidden cards again): matched by what the card is, the line is sure.
    const spec: DriveSpec = { me: { hand: ["SEEK", "BIG"], deck: ["STORM1", ...fillers(9)], playPoints: 2 }, opp: { deck: fillers(10), leaderDefense: 6 } };
    for (const seed of ["a", "b", "c"]) expect(ourTurn(spec, { ...MEDIUM_OPTIONS, seed }).won).toBe(true);
  });

  /**
   * 5 defense; our 1/1 and 4/2 at the leader is lethal, unless their Quick spell (2 damage) hits the 4/2 when it attacks
   * (CR 8.4.7: before the damage). Our engaged 5/5 can't attack, but a model aims the spell at it (the most valuable).
   */
  const decoy = (card: string): DriveSpec => ({
    me: { deck: fillers(10), field: ["FAIRY", "HITTER", { card: "BIG", engaged: true }] },
    opp: { deck: Array<string>(10).fill(card), hand: [card], leaderDefense: 5, playPoints: 1 },
  });

  it("is sure only if it wins whatever the opponent answers: a model can be led to aim its Quick spell at a decoy", () => {
    const t = drive(cards, decoy("QBURN"));
    const line = [];
    const s = t.game.clone();
    for (const [attacker, target] of [["FAIRY", "opp:leader"], ["HITTER", "opp:leader"]] as const) {
      const d = s.decision!;
      const action = d.type === "mainPhase" ? d.actions.find((a) => a.type === "attack" && s.state.cards[a.attacker]!.def === attacker && s.state.cards[a.target]!.zone === "leader") : undefined;
      expect(action, `${attacker} -> ${target}`).toBeDefined();
      line.push(stepOf(s, { type: "mainPhase", action: action! }));
      s.act({ type: "mainPhase", action: action! });
      for (let i = 0; i < 10 && s.decision && s.decision.player === 1; i++) s.act({ type: "quick", action: { type: "pass" } });
    }
    const model = new GreedyBot(cards, { seed: "m" });
    expect(lineWins(t.game.clone(), line, 0, (session) => model.decide(session))).toBe(true);
    const check = lineWinsAgainstAll(() => t.game.clone(), line, 0, { cap: 50, maxAnswers: 8, seed: "x" });
    expect(check.won).toBe(false);
    // Without the spell in their hand it is sure.
    const safe = drive(cards, decoy("FILLER"));
    expect(lineWinsAgainstAll(() => safe.game.clone(), line, 0, { cap: 50, maxAnswers: 8, seed: "x" }).won).toBe(true);
    // The bots don't take it as sure (Hard sees the spell; Medium's samples deal it from their deck: every card of it is one);
    // they do without it.
    for (const options of [MEDIUM_OPTIONS, HARD_OPTIONS]) {
      const risky = ourTurn(decoy("QBURN"), options);
      expect(risky.first.played).toBe(0);
      expect(risky.stats.unsurePlans).toBeGreaterThan(0);
    }
    expect(ourTurn(decoy("FILLER"), HARD_OPTIONS)).toMatchObject({ won: true, first: { played: 1 } });
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
