import { describe, expect, it } from "vitest";
import { createEngine, script, type Answer, type Decision } from "../src/core";
import { GreedyBot, HARD_OPTIONS, MEDIUM_OPTIONS, PlannerBot, fastAnswer, lethalFirstModel, lookupFromReader, positionKey, type CardLookup } from "../src";
import { drive, testFollower, testSpell, testToken, type DriveSpec } from "../../core/src/testing";

// The expert's blind spots fixed before training (the blind-spot audit): Ward followers, the opponent model, one position
// reached in two orders.

const { defineCard, activated, spell, lastWords, atStartOfYourEndPhase } = script;
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
    testFollower("BIG55", 5, 5, 5),
    testFollower("LWWARD", 1, 1, 1),
    testFollower("ENDWARD", 1, 1, 1),
    testToken("WARDTOK", 2, 4, 5, { name: "WardTok" }),
    testSpell("QWALL", 1),
    testSpell("QKILL", 1),
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
    WARDTOK: defineCard({ keywords: ["ward"] }),
    // Quick: summon a 4/5 Ward token.
    QWALL: defineCard({ keywords: ["quick"], abilities: [spell({ *resolve(fx) { yield* fx.summon(["WardTok"]); } })] }),
    // Quick: destroy an enemy follower.
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
    // Last Words: summon a 4/5 Ward token.
    LWWARD: defineCard({ abilities: [lastWords({ *resolve(fx) { yield* fx.summon(["WardTok"]); } })] }),
    // At the start of your end phase: summon a 4/5 Ward token.
    ENDWARD: defineCard({ abilities: [atStartOfYourEndPhase({ *resolve(fx) { yield* fx.summon(["WardTok"]); } })] }),
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

  it("the fast answer: reserved in its controller's own turn and the opponent's end phase, engaged in the opponent's main phase", () => {
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
    // The opponent's end phase: no attack follows (CR 7.3.3, 8.4) and our start phase refreshes it (7.2.3).
    const theirEnd: CardLookup = Object.assign(() => ({ def: "WALL", zone: "field", controller: 0 as const, cost: 2, keywords: ["ward" as const], value: 3 }), {
      turn: { active: 1 as const, phase: "end" },
    });
    expect(fastAnswer(d, theirEnd)).toEqual({ type: "selectCards", cards: [] });
  });

  /**
   * Our Quick spell summons a 4/5 Ward token while the opponent's 1/1 attacks our leader (CR 8.4.7), or at their end phase;
   * first they play the cards of `play` (seen by us).
   */
  function theirTurnWard(spec: { leaderDefense: number; field: string[]; hand: string[]; play?: string[] }, when: "attack" | "end") {
    const t = drive(cards, {
      me: { hand: ["QWALL"], deck: many(10, "FILLER"), leaderDefense: spec.leaderDefense, playPoints: 1, maxPlayPoints: 5 },
      opp: { field: ["FAIRY", ...spec.field], hand: spec.hand, deck: many(10, "FILLER"), playPoints: 3, maxPlayPoints: 2 },
    });
    const fast = () => t.answer(fastAnswer(t.game.decision!, lookupFromReader(t.game.reader())));
    t.end();
    for (let i = 0; i < 20 && !(t.game.decision?.type === "mainPhase" && t.game.decision.player === 1); i++) fast();
    for (const card of spec.play ?? []) {
      t.play(`opp:${card}`);
      for (let i = 0; i < 20 && !(t.game.decision?.type === "mainPhase" && t.game.decision.player === 1); i++) fast();
    }
    if (when === "attack") t.attack("opp:FAIRY", "me:leader");
    else {
      t.end();
      for (let i = 0; i < 20 && t.game.decision?.type !== "quick"; i++) fast();
    }
    t.quick("QWALL");
    const d = t.game.decision!;
    expect(d.type === "selectCards" && d.reason).toBe("wardEnterEngaged");
    return t;
  }
  const engaged = (a: Answer) => (a.type === "selectCards" ? a.cards.length > 0 : null);

  it("entering in the opponent's main phase: reserved when only a Rush follower could come at it, engaged when the leader needs it", () => {
    for (const options of [MEDIUM_OPTIONS, HARD_OPTIONS]) {
      // A Rush follower played this turn can only attack engaged followers (CR 12.10.2): reserved, the Ward survives their
      // turn. (One still in their hand a fair bot can't know of.)
      const rush = theirTurnWard({ leaderDefense: 20, field: [], hand: ["RUSHER"], play: ["RUSHER"] }, "attack");
      expect(engaged(new PlannerBot(cards, { seed: "r", ...options }).decide(rush.game))).toBe(false);
      // A 5/5 there since the start of their turn and our leader at 6: it must attack the engaged Ward (12.8.2 iii).
      const big = theirTurnWard({ leaderDefense: 6, field: ["BIG55"], hand: [] }, "attack");
      expect(engaged(new PlannerBot(cards, { seed: "b", ...options }).decide(big.game))).toBe(true);
    }
  });

  it("entering in the opponent's end phase stays reserved: no attack follows (CR 7.3.3, 8.4)", () => {
    for (const options of [MEDIUM_OPTIONS, HARD_OPTIONS]) {
      const t = theirTurnWard({ leaderDefense: 6, field: ["BIG55"], hand: [] }, "end");
      expect(engaged(new PlannerBot(cards, { seed: "e", ...options }).decide(t.game))).toBe(false);
    }
  });

  it("entering in our own end phase: reserved before its engaging (CR 7.4.3), engaged after it when the leader needs it", () => {
    for (const options of [MEDIUM_OPTIONS, HARD_OPTIONS]) {
      // A token made at the start of our end phase (7.4.1): 7.4.3 still asks, so it enters reserved.
      const early = drive(cards, { me: { field: ["ENDWARD"], deck: many(10, "FILLER") }, opp: { deck: many(10, "FILLER") } });
      const bot = new PlannerBot(cards, { seed: "s", ...options });
      early.end();
      for (let i = 0; i < 10 && !(early.game.decision?.type === "selectCards" && early.game.decision.reason === "wardEnterEngaged"); i++) early.answer(bot.decide(early.game));
      expect(engaged(bot.decide(early.game))).toBe(false);
      early.answer({ type: "selectCards", cards: [] });
      for (let i = 0; i < 10 && !(early.game.decision?.type === "selectCards" && early.game.decision.reason === "wardEngage"); i++) early.answer(bot.decide(early.game));
      expect(early.game.decision?.type === "selectCards" && early.game.decision.reason).toBe("wardEngage");

      // Their Quick removal at our end phase (7.4.5) destroys our Last Words follower: the Ward token comes after 7.4.3, and
      // their 5/5 would reach our leader at 5.
      const late = drive(cards, { me: { field: ["LWWARD"], deck: many(10, "FILLER"), leaderDefense: 5 }, opp: { field: ["BIG55"], hand: ["QKILL"], deck: many(10, "FILLER"), playPoints: 1 } });
      late.end();
      for (let i = 0; i < 20 && !(late.game.decision?.type === "quick" && late.game.decision.player === 1); i++) late.answer(fastAnswer(late.game.decision!, lookupFromReader(late.game.reader())));
      late.quick("opp:QKILL");
      for (let i = 0; i < 5 && late.game.decision?.type === "selectCards" && late.game.decision.reason !== "wardEnterEngaged"; i++) late.pick("LWWARD");
      const d = late.game.decision!;
      expect(d.type === "selectCards" && d.reason).toBe("wardEnterEngaged");
      expect(engaged(new PlannerBot(cards, { seed: "l", ...options }).decide(late.game))).toBe(true);
    }
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
