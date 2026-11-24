import { describe, expect, it } from "vitest";
import { createEngine, script, type CardDefinition, type CardScript } from "../../src";
import { isQuickActivatedFollower, yourFollower } from "../../src/script/targets";
import { drive, testFollower, testSpell, testTreasure, type DriveSpec } from "../../src/testing";
import { TEST_CARDS, TEST_SCRIPTS } from "../helpers";

// The other new mechanics of CP05's texts, with synthetic cards (each card's own tests are in test/cards/CP05).
const { activated, defineCard, spell, whenRevealedFromYourHand } = script;
const CARDS: CardDefinition[] = [
  testFollower("DARK", 1, 1, 1, { traits: ["闇属性"] }),
  testSpell("DISC", 0), // discard a card
  testFollower("QACT", 1, 1, 1), // {[q]} {[act]} (0): nothing
  testFollower("NEEDQ", 1, 1, 1), // {[q]} {[act]} (0): draw; only if you played another quick activated ability this turn
  testFollower("Q2", 1, 1, 1), // {[q]} {[act]} (2): draw
  testFollower("CHEAPER", 1, 1, 1), // your quick activated abilities cost 1 less
  testFollower("NEXT", 1, 1, 1), // {[q]} {[act]} (0): the next quick activated ability you play this turn costs 1 less; once per turn
  testTreasure("T-ACT", { name: "T-ACT" }), // {[act]} (0): nothing (not quick)
  testFollower("QUICK-ONLY", 1, 1, 1), // Quick (CR 12.3.2), no activated ability
  testFollower("HANDQ", 1, 1, 1), // {[q]} {[act]} (1), discard this from your hand: nothing (valid in the hand)
  testSpell("GIVE-BANISH", 0), // a follower on your field gets "at the start of your end phase, banish this"
  testSpell("GIVE-LW", 0), // a follower on your field gets "Last Words: summon this"
  testFollower("REV", 1, 1, 1), // when this is revealed from your hand, draw a card
  testSpell("SHOW-MINE", 0), // reveal your hand
  testSpell("SHOW-OPP", 0), // reveal the opponent's hand
  testSpell("SHOW-TOP", 0), // reveal the top card of your deck
];
const nothing = {
  *resolve() {
    // no effect
  },
};
const SCRIPTS: Record<string, CardScript> = {
  DISC: defineCard({ abilities: [spell({ *resolve(fx) { yield* fx.discard(fx.controller, 1, 1); } })] }),
  QACT: defineCard({ abilities: [activated({ playPoints: 0 }, { quick: true, ...nothing })] }),
  NEEDQ: defineCard({
    abilities: [
      activated({ playPoints: 0 }, { quick: true, condition: (g, p) => g.quickActivationsThisTurn(p) >= 1, *resolve(fx) { yield* fx.draw(1); } }),
    ],
  }),
  Q2: defineCard({ abilities: [activated({ playPoints: 2 }, { quick: true, *resolve(fx) { yield* fx.draw(1); } })] }),
  CHEAPER: defineCard({
    field: { activationCostOf: (g, self, _card, ability, player) => (ability.quick && player === g.card(self)!.controller ? -1 : 0) },
  }),
  NEXT: defineCard({
    abilities: [activated({ playPoints: 0 }, { quick: true, oncePerTurn: true, *resolve(fx) { yield* fx.nextQuickAbilityCostsLess(1); } })],
  }),
  "T-ACT": defineCard({ abilities: [activated({ playPoints: 0 }, nothing)] }),
  "QUICK-ONLY": defineCard({ keywords: ["quick"] }),
  HANDQ: defineCard({ abilities: [activated({ playPoints: 1 }, { quick: true, validIn: ["hand"], ...nothing })] }),
  "GIVE-BANISH": defineCard({
    abilities: [spell({ targets: [yourFollower()], *resolve(fx) { yield* fx.grant(fx.targets[0]![0]!, "banishAtEnd"); } })],
  }),
  "GIVE-LW": defineCard({
    abilities: [spell({ targets: [yourFollower()], *resolve(fx) { yield* fx.grant(fx.targets[0]![0]!, "lastWordsSummonSelf"); } })],
  }),
  REV: defineCard({ abilities: [whenRevealedFromYourHand({ *resolve(fx) { yield* fx.draw(1); } })] }),
  "SHOW-MINE": defineCard({ abilities: [spell({ *resolve(fx) { yield* fx.reveal(fx.game.cards(fx.controller, "hand")); } })] }),
  "SHOW-OPP": defineCard({ abilities: [spell({ *resolve(fx) { yield* fx.reveal(fx.game.cards(fx.game.opponent(fx.controller), "hand")); } })] }),
  "SHOW-TOP": defineCard({ abilities: [spell({ *resolve(fx) { yield* fx.reveal(fx.topCards(1)); } })] }),
};
const E = createEngine({ cards: [...TEST_CARDS, ...CARDS], scripts: { ...TEST_SCRIPTS, ...SCRIPTS } });
const d = (spec: DriveSpec) => drive(E, spec);

describe("CP05's other mechanics", () => {
  it("remembers the discarded cards as they were in the hand (CP05-017 'if you discarded a dark card this turn')", () => {
    const t = d({ me: { hand: ["DISC", "DARK"] } }).play("DISC");
    expect(t.game.reader().discardedCardsThisTurn(0)).toEqual([{ names: ["DARK"], type: "follower", traits: ["闇属性"] }]);
  });

  it("counts the quick activated abilities played this turn (CP05-002 'if you played another one this turn')", () => {
    const t = d({ me: { field: ["QACT", "NEEDQ"], deck: ["V1"] } });
    expect(t.canActivate("NEEDQ")).toBe(false);
    t.activate("QACT");
    expect([t.game.reader().quickActivationsThisTurn(0), t.canActivate("NEEDQ")]).toEqual([1, true]);
  });

  it("CR 10.4.4 / 10.6.2.5 — a passive makes quick activated abilities cheaper, not below 0 (CP05-040)", () => {
    expect(d({ me: { field: ["Q2"], playPoints: 1 } }).canActivate("Q2")).toBe(false);
    const t = d({ me: { field: ["Q2", "CHEAPER"], playPoints: 1, deck: ["V1"] } }).activate("Q2");
    expect([t.pp(), t.hand()]).toEqual([0, ["V1"]]);
    expect(d({ me: { field: ["Q2"], playPoints: 1 }, opp: { field: ["CHEAPER"] } }).canActivate("Q2")).toBe(false);
  });

  it("'the next quick activated ability you play costs 1 less' is used by the next one, even one played for 0 (CP05-047, BP03-038's ruling)", () => {
    const t = d({ me: { field: ["NEXT", "Q2"], playPoints: 1, deck: ["V1", "V1"] } }).activate("NEXT");
    expect(t.canActivate("Q2")).toBe(true);
    t.activate("Q2");
    expect([t.pp(), t.canActivate("Q2")]).toEqual([0, false]);
    const used = d({ me: { field: ["NEXT", "QACT", "Q2"], playPoints: 1 } }).activate("NEXT").activate("QACT");
    expect(used.canActivate("Q2")).toBe(false);
    // A treasure's activated ability is not quick: it doesn't use it up.
    const kept = d({ me: { field: ["NEXT", "Q2", "V1"], ex: ["T-ACT"], playPoints: 1 } }).activate("NEXT").activate("T-ACT");
    expect(kept.canActivate("Q2")).toBe(true);
  });

  it("a follower with a quick activated ability: printed outside the field, wherever it works; Quick alone isn't one", () => {
    const t = d({ me: { field: ["QACT", "QUICK-ONLY"], cemetery: ["HANDQ", "V1"] } });
    const r = t.game.reader();
    const ids = (zone: "field" | "cemetery") => t.game.state.players[0].zones[zone];
    expect(ids("field").map((id) => isQuickActivatedFollower(r, id))).toEqual([true, false]);
    expect(ids("cemetery").map((id) => isQuickActivatedFollower(r, id))).toEqual([true, false]);
  });

  it("CR 10.9.1.2 — given 'at the start of your end phase, banish this' (CP05-050)", () => {
    const t = d({ me: { field: ["V1"], hand: ["GIVE-BANISH"] } }).play("GIVE-BANISH").end();
    expect([t.field(), t.zone("me", "banished")]).toEqual([[], ["V1"]]);
  });

  it("CR 4.1.6 — given 'Last Words: summon this' (CP05-082): onto its owner's field, a new card without it", () => {
    const t = d({ me: { field: ["V1"], hand: ["GIVE-LW", "QUICK-SAC", "QUICK-SAC"] } }).play("GIVE-LW").play("QUICK-SAC").flush();
    expect(t.field()).toEqual(["V1"]);
    const again = t.play("QUICK-SAC");
    expect(again.field()).toEqual([]);
  });

  it("'when this is revealed from your hand' (CP05-037): by any ability, the opponent's too, not from a deck (Q2893, Q2894)", () => {
    const mine = d({ me: { hand: ["SHOW-MINE", "REV"], deck: ["V1"] } }).play("SHOW-MINE").flush();
    expect(mine.hand()).toEqual(["REV", "V1"]);
    const theirs = d({ me: { hand: ["SHOW-OPP"] }, opp: { hand: ["REV"], deck: ["V1"] } }).play("SHOW-OPP").flush();
    expect(theirs.hand("opp")).toEqual(["REV", "V1"]);
    const deck = d({ me: { hand: ["SHOW-TOP"], deck: ["REV", "V1"] } }).play("SHOW-TOP").flush();
    expect(deck.hand()).toEqual([]);
  });
});
