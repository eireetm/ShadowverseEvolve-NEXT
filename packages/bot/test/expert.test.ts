import { describe, expect, it } from "vitest";
import { createEngine, script, type Decision } from "../src/core";
import { GreedyBot, HARD_OPTIONS, MEDIUM_OPTIONS, PlannerBot, fastAnswer, lethalFirstModel, positionKey, type CardLookup } from "../src";
import { drive, testFollower, type DriveSpec } from "../../core/src/testing";

// The expert's blind spots fixed before training (the blind-spot audit): Ward followers, the opponent model, one position
// reached in two orders.

const { defineCard, activated } = script;
const cards = createEngine({
  cards: [
    testFollower("PINGWARD", 1, 1, 3),
    testFollower("WALL45", 2, 4, 5),
    testFollower("RUSHER", 2, 5, 5),
    testFollower("STORMY", 1, 4, 1),
    testFollower("FAIRY", 1, 1, 1),
    testFollower("HITTER", 3, 4, 2),
    testFollower("WALL", 2, 1, 3),
    testFollower("FILLER", 1, 1, 1),
  ],
  scripts: {
    // Ward; Activate [engage]: 2 damage to the enemy leader.
    PINGWARD: defineCard({
      keywords: ["ward"],
      abilities: [
        activated(
          { engageSelf: true },
          {
            *resolve(fx) {
              yield* fx.dealDamage(fx.game.leader(fx.game.opponent(fx.controller)), 2);
            },
          },
        ),
      ],
    }),
    WALL45: defineCard({ keywords: ["ward"] }),
    WALL: defineCard({ keywords: ["ward"] }),
    RUSHER: defineCard({ keywords: ["rush"] }),
    STORMY: defineCard({ keywords: ["storm"] }),
  },
});
const many = (n: number, id: string) => Array<string>(n).fill(id);

/** Our turn played by a planner until it ends (or the game does). */
function ourTurn(t: ReturnType<typeof drive>, bot: PlannerBot) {
  const turn = t.game.state.turn;
  for (let i = 0; i < 80 && t.game.decision?.player === 0 && t.game.state.turn === turn && t.game.state.phase === "main"; i++) t.game.act(bot.decide(t.game));
}

describe("Ward followers", () => {
  it("enter reserved in their controller's main phase, so an [engage] ability can be used at once (CR 12.8.2 i, ii)", () => {
    for (const options of [MEDIUM_OPTIONS, HARD_OPTIONS]) {
      const t = drive(cards, { me: { hand: ["PINGWARD"], deck: many(10, "FILLER"), playPoints: 1 }, opp: { deck: many(10, "FILLER"), leaderDefense: 20 } });
      ourTurn(t, new PlannerBot(cards, { seed: "w", ...options }));
      expect(t.game.state.players[1].leaderDefense).toBe(18);
    }
  });

  it("the fast answer: reserved in its controller's own turn, engaged in the opponent's turn (a Quick one, one brought back by Last Words)", () => {
    const d: Decision = { type: "selectCards", player: 0, reason: "wardEnterEngaged", candidates: ["c1"], candidateDefs: ["WALL"], min: 0, max: 1, source: null };
    const lookup = (active: 0 | 1): CardLookup =>
      Object.assign(() => ({ def: "WALL", zone: "field", controller: 0 as const, cost: 2, keywords: ["ward" as const], value: 3 }), { turn: { active, phase: "main" } });
    expect(fastAnswer(d, lookup(0))).toEqual({ type: "selectCards", cards: [] });
    expect(fastAnswer(d, lookup(1))).toEqual({ type: "selectCards", cards: ["c1"] });
    // A token made at the start of our end phase is still in time for the end phase's engaging (CR 7.4.1, 7.4.3).
    const endPhase: CardLookup = Object.assign(() => ({ def: "WALL", zone: "field", controller: 0 as const, cost: 2, keywords: ["ward" as const], value: 3 }), {
      turn: { active: 0 as const, phase: "end" },
    });
    expect(fastAnswer(d, endPhase)).toEqual({ type: "selectCards", cards: [] });
    // Rush or Storm makes no difference in the opponent's turn: it can't attack there.
    const storm: CardLookup = Object.assign(() => ({ def: "WALL", zone: "field", controller: 0 as const, cost: 2, keywords: ["ward" as const, "storm" as const], value: 3 }), {
      turn: { active: 1 as const, phase: "main" },
    });
    expect(fastAnswer(d, storm)).toEqual({ type: "selectCards", cards: ["c1"] });
  });

  /** Our main phase over with a reserved 4/5 Ward on the field: the end phase asks which Ward followers to engage (CR 7.4.3). */
  function endPhaseWard(opp: DriveSpec["opp"], leaderDefense: number, options: typeof MEDIUM_OPTIONS) {
    const t = drive(cards, { me: { field: ["WALL45"], deck: many(10, "FILLER"), leaderDefense }, opp });
    const bot = new PlannerBot(cards, { seed: "e", ...options });
    t.game.act({ type: "mainPhase", action: { type: "endMainPhase" } });
    for (let i = 0; i < 10 && t.game.decision && !(t.game.decision.type === "selectCards" && t.game.decision.reason === "wardEngage"); i++) t.game.act(bot.decide(t.game));
    const d = t.game.decision!;
    expect(d.type === "selectCards" && d.reason).toBe("wardEngage");
    const answer = bot.decide(t.game);
    return answer.type === "selectCards" ? answer.cards.length : -1;
  }

  it("at the end phase stays reserved when only a Rush follower could come at it (it can't attack the leader)", () => {
    const opp = { hand: ["RUSHER", "RUSHER"], deck: many(10, "RUSHER"), playPoints: 2, maxPlayPoints: 2 };
    for (const options of [MEDIUM_OPTIONS, HARD_OPTIONS]) expect(endPhaseWard(opp, 20, options)).toBe(0);
  });

  it("at the end phase is engaged when the opponent's Storm followers would otherwise reach a low leader", () => {
    const opp = { hand: ["STORMY", "STORMY"], deck: many(10, "STORMY"), playPoints: 2, maxPlayPoints: 2 };
    for (const options of [MEDIUM_OPTIONS, HARD_OPTIONS]) expect(endPhaseWard(opp, 6, options)).toBe(1);
  });
});

describe("the opponent model", () => {
  it("plays a lethal it finds before answering as its model (a narrow greedy bot alone misses the one through the Ward)", () => {
    const spec: DriveSpec = { me: { deck: many(10, "FILLER"), field: ["FAIRY", "FAIRY", "FAIRY", "HITTER", "HITTER"] }, opp: { deck: many(10, "FILLER"), field: [{ card: "WALL", engaged: true }], leaderDefense: 8 } };
    const play = (model: { decide: GreedyBot["decide"] }) => {
      const t = drive(cards, spec);
      const turn = t.game.state.turn;
      for (let i = 0; i < 60 && t.game.decision?.player === 0 && t.game.state.turn === turn; i++) t.game.act(model.decide(t.game));
      return t.game.result?.winner === 0;
    };
    const greedy = () => new GreedyBot(cards, { seed: "g", maxCandidates: 3 });
    expect(play(greedy())).toBe(false);
    expect(play(lethalFirstModel(greedy(), 300, 16, "m"))).toBe(true);
  });
});

describe("one position reached in two orders", () => {
  it("has one key (card ids are new on every move, CR 4.1.4)", () => {
    const spec: DriveSpec = { me: { hand: ["FAIRY", "FILLER"], deck: many(10, "FILLER"), playPoints: 2 }, opp: { deck: many(10, "FILLER") } };
    const a = drive(cards, spec).play("FAIRY").play("FILLER");
    const b = drive(cards, spec).play("FILLER").play("FAIRY");
    expect(JSON.stringify(a.game.view(0))).not.toBe(JSON.stringify(b.game.view(0)));
    expect(positionKey(a.game.view(0))).toBe(positionKey(b.game.view(0)));
    const c = drive(cards, spec).play("FAIRY");
    expect(positionKey(c.game.view(0))).not.toBe(positionKey(a.game.view(0)));
  });

  it("keeps apart an attack on the damaged one of two copies and one on the other, but not the same cards under other ids", () => {
    const y = (id: string, damage: number) => ({ id, hidden: false, def: "Y", attack: 2, defense: 3 - damage, damage });
    const view = (field: object[], target: string) =>
      ({ players: [{ field: [{ id: "c9", hidden: false, def: "X", attack: 3, defense: 3, damage: 0 }] }, { field }], resolution: [], attack: { attacker: "c9", target }, decision: null }) as never;
    const damagedOne = positionKey(view([y("c1", 1), y("c2", 0)], "c1"));
    expect(positionKey(view([y("c1", 1), y("c2", 0)], "c2"))).not.toBe(damagedOne);
    expect(positionKey(view([y("c2", 0), y("c7", 1)], "c7"))).toBe(damagedOne);
  });
});
