import { describe, expect, it } from "vitest";
import { createEngine, script, type CardDefinition, type CardScript } from "../../src";
import { enemyFollower, yourFollower } from "../../src/script/targets";
import { drive, testEvolved, testFollower, testSpell, testTreasure, type DriveSpec } from "../../src/testing";
import { TEST_CARDS, TEST_SCRIPTS } from "../helpers";

// Uncapping (Granblue Fantasy: CR JP 4.17, JP 11.12, JP 14.6 — the Japanese rules v1.29.0; the English ones don't have it yet),
// with synthetic cards. FIRE is a 2/2 fire follower, FIRE-F the same with Final Uncap (its evolved card FIRE-F-E is 4/4);
// WATER a water follower. T-FIRE is a fire element (uncap, or final uncap instead when uncapped), T-HIHI a ヒヒイロカネ (uncap,
// then also final uncap).
const { changeStatsTo, defineCard, evolveAbility, spell, uncapAbility, whenThisIsFinalUncapped, whenThisIsUncapped, whenYourCardsLeaveEx } = script;
const CARDS: CardDefinition[] = [
  testFollower("FIRE", 2, 2, 2, { traits: ["グラブル", "火属性"] }),
  testFollower("FIRE-F", 2, 2, 2, { traits: ["グラブル", "火属性"] }),
  testEvolved("FIRE-F-E", "FIRE-F", 4, 4, { traits: ["グラブル", "火属性"] }),
  testFollower("WATER", 2, 2, 2, { traits: ["グラブル", "水属性"] }),
  testFollower("WATCH", 2, 2, 2, { traits: ["グラブル", "火属性"] }), // Final Uncap; draws when it uncaps, leader +1 when final
  testFollower("EX-WATCH", 2, 1, 1), // whenever one of your cards leaves your EX area, leader +1 (BP22-017's kind)
  testTreasure("T-FIRE", { name: "火晶のエレメント", traits: ["グラブル", "火属性"] }),
  testTreasure("T-HIHI", { name: "ヒヒイロカネ", traits: ["グラブル"] }),
  testSpell("BOUNCE", 0), // return a follower on your field to your hand
  testSpell("STEAL", 0), // take control of an enemy follower
  testSpell("SILENCE", 0), // a follower on your field loses all abilities
  testSpell("SET5", 0), // a follower on your field: its attack becomes 5
  testSpell("COUNT", 0), // X damage to each enemy leader, X = your uncaps this turn
];
const SCRIPTS: Record<string, CardScript> = {
  "FIRE-F": defineCard({ keywords: ["finalUncap"], abilities: [evolveAbility(0)] }),
  "FIRE-F-E": defineCard({ keywords: ["finalUncap"] }),
  WATCH: defineCard({
    keywords: ["finalUncap"],
    abilities: [
      whenThisIsUncapped({ *resolve(fx) { yield* fx.draw(1); } }),
      whenThisIsFinalUncapped({ *resolve(fx) { yield* fx.giveLeaderDefense(fx.controller, 1); } }),
    ],
  }),
  "EX-WATCH": defineCard({ abilities: [whenYourCardsLeaveEx({ *resolve(fx) { yield* fx.giveLeaderDefense(fx.controller, 1); } })] }),
  "T-FIRE": defineCard({ abilities: [uncapAbility("火属性", "instead")] }),
  "T-HIHI": defineCard({ abilities: [uncapAbility("グラブル", "also")] }),
  BOUNCE: defineCard({ abilities: [spell({ targets: [yourFollower()], *resolve(fx) { yield* fx.returnToHand(fx.targets[0]!); } })] }),
  STEAL: defineCard({ abilities: [spell({ targets: [enemyFollower()], *resolve(fx) { yield* fx.steal(fx.targets[0]![0]!); } })] }),
  SILENCE: defineCard({ abilities: [spell({ targets: [yourFollower()], *resolve(fx) { yield* fx.loseAbilities(fx.targets[0]![0]!, null); } })] }),
  SET5: defineCard({ abilities: [spell({ targets: [yourFollower()], *resolve(fx) { yield* changeStatsTo(fx, fx.targets[0]![0]!, { attack: 5 }); } })] }),
  COUNT: defineCard({
    abilities: [spell({ *resolve(fx) { yield* fx.dealDamage(fx.game.leader(fx.game.opponent(fx.controller)), fx.game.uncapsThisTurn(fx.controller)); } })],
  }),
};
const E = createEngine({ cards: [...TEST_CARDS, ...CARDS], scripts: { ...TEST_SCRIPTS, ...SCRIPTS } });
const d = (spec: DriveSpec) => drive(E, spec);
const uncapZone = (t: ReturnType<typeof d>, who: "me" | "opp" = "me") => t.zone(who, "uncapZone");

describe("uncapping (CR JP 14.6.4)", () => {
  it("CR JP 14.6.4.1 / JP 14.6.4.1.1 — an element uncaps: it goes into the uncap zone linked to the follower, +1 attack", () => {
    const t = d({ me: { field: ["FIRE"], ex: ["T-FIRE"] } }).activate("T-FIRE");
    expect([t.ex(), uncapZone(t), t.stats("FIRE")]).toEqual([[], ["T-FIRE"], [3, 2]]);
    const r = t.game.reader();
    expect([r.isUncapped(t.id("FIRE")), r.isFinalUncapped(t.id("FIRE")), r.uncapsThisTurn(0)]).toEqual([true, false, 1]);
  });

  it("CR JP 14.6.4.1 — an uncapped follower isn't uncapped again: nothing happens, the element stays in the EX area", () => {
    const t = d({ me: { field: [{ card: "FIRE", uncappedWith: [{ card: "T-FIRE", uncaps: ["uncap"] }] }], ex: ["T-FIRE"] } });
    t.activate("T-FIRE");
    expect([t.ex(), uncapZone(t), t.stats("FIRE"), t.game.reader().uncapsThisTurn(0)]).toEqual([["T-FIRE"], ["T-FIRE"], [3, 2], 0]);
  });

  it("CR JP 14.6.4.2 — an element on an uncapped follower with Final Uncap final-uncaps instead: +2/+1 in all", () => {
    const t = d({ me: { field: [{ card: "WATCH", uncappedWith: [{ card: "T-FIRE", uncaps: ["uncap"] }] }], ex: ["T-FIRE"], deck: ["V1"] } });
    t.activate("T-FIRE");
    // Only the final uncap happened (CR 10.2.1.3.1): no draw, leader +1.
    expect([t.ex(), uncapZone(t), t.stats("WATCH"), t.hand(), t.leader()]).toEqual([[], ["T-FIRE", "T-FIRE"], [4, 3], [], 21]);
    expect(t.game.reader().isFinalUncapped(t.id("WATCH"))).toBe(true);
  });

  it("CR JP 14.6.4.1 / JP 14.6.4.2 — ヒヒイロカネ does both with one card, both trigger (in any order) and count 2 (Q2867, Q2868)", () => {
    const t = d({ me: { field: ["WATCH"], ex: ["T-HIHI"], hand: ["COUNT"], deck: ["V1"] } }).activate("T-HIHI");
    expect(t.decision).toMatchObject({ type: "selectPending" });
    t.flush();
    expect([t.ex(), uncapZone(t), t.stats("WATCH"), t.hand(), t.leader()]).toEqual([[], ["T-HIHI"], [4, 3], ["COUNT", "V1"], 21]);
    expect(t.play("COUNT").leader("opp")).toBe(18);
  });

  it("CR JP 14.6.4.2 — ヒヒイロカネ on a follower without Final Uncap only uncaps; on an uncapped one with it, only final-uncaps", () => {
    const plain = d({ me: { field: ["FIRE"], ex: ["T-HIHI"] } }).activate("T-HIHI");
    expect([uncapZone(plain), plain.stats("FIRE"), plain.game.reader().uncapsThisTurn(0)]).toEqual([["T-HIHI"], [3, 2], 1]);
    // An open question to the owner (reading A): the second sentence has its own condition only.
    const up = d({ me: { field: [{ card: "FIRE-F", uncappedWith: [{ card: "T-FIRE", uncaps: ["uncap"] }] }], ex: ["T-HIHI"] } });
    up.activate("T-HIHI");
    expect([up.ex(), uncapZone(up).sort(), up.stats("FIRE-F"), up.game.reader().uncapsThisTurn(0)]).toEqual([[], ["T-FIRE", "T-HIHI"], [4, 3], 1]);
  });

  it("an element needs a follower of its attribute on your field (CR 10.6.2.3.3); using it is a card leaving the EX area", () => {
    expect(d({ me: { field: ["WATER"], ex: ["T-FIRE"] } }).canActivate("T-FIRE")).toBe(false);
    const t = d({ me: { field: ["FIRE", "EX-WATCH"], ex: ["T-FIRE"] } }).activate("T-FIRE").flush();
    expect(t.leader()).toBe(21);
  });

  it("CR 5.16.2 — an evolved follower stays uncapped, its bonus counted once", () => {
    const t = d({ me: { field: [{ card: "FIRE-F", uncappedWith: [{ card: "T-HIHI", uncaps: ["uncap", "final"] }] }], evolveDeck: ["FIRE-F-E"], evolutionPoints: 2 } });
    expect(t.stats("FIRE-F")).toEqual([4, 3]);
    t.evolve("FIRE-F");
    expect([t.stats("FIRE-F"), uncapZone(t)]).toEqual([[6, 5], ["T-HIHI"]]);
  });

  it("CR JP 11.12.1 — a follower leaving the field (a new card, CR 4.1.4) loses its treasures: eliminated, not into a cemetery", () => {
    const t = d({ me: { field: [{ card: "FIRE", uncappedWith: [{ card: "T-FIRE", uncaps: ["uncap"] }] }], hand: ["BOUNCE"] } });
    t.play("BOUNCE");
    // The spell's only: the treasure went nowhere (CR 9.1.3).
    expect([t.hand(), uncapZone(t), t.cemetery(), t.ex()]).toEqual([["FIRE"], [], ["BOUNCE"], []]);
  });

  it("CR JP 11.12.2 — a treasure follows its follower's control; the state stays (CR 5.22)", () => {
    const t = d({ me: { hand: ["STEAL"], playPoints: 9 }, opp: { field: [{ card: "FIRE", uncappedWith: [{ card: "T-HIHI", uncaps: ["uncap", "final"] }] }] } });
    t.play("STEAL");
    expect([t.field(), uncapZone(t), uncapZone(t, "opp"), t.stats("FIRE")]).toEqual([["FIRE"], ["T-HIHI"], [], [4, 3]]);
  });

  it("Q2930 — after losing its abilities it keeps the state and bonus, but can't be final-uncapped (no Final Uncap)", () => {
    const t = d({ me: { field: [{ card: "FIRE-F", uncappedWith: [{ card: "T-FIRE", uncaps: ["uncap"] }] }], hand: ["SILENCE"], ex: ["T-FIRE"] } });
    t.play("SILENCE");
    expect(t.stats("FIRE-F")).toEqual([3, 2]);
    t.activate("T-FIRE");
    expect([t.ex(), t.stats("FIRE-F")]).toEqual([["T-FIRE"], [3, 2]]);
  });

  it("CR JP 14.6.1.1.2 / JP 14.6.1.1.3 — a treasure can't be played, and goes nowhere but the EX area and the uncap zone", () => {
    expect(d({ me: { field: ["FIRE"], ex: ["T-FIRE"], playPoints: 9 } }).canPlay("T-FIRE@ex")).toBe(false);
  });

  it("the bonus comes after the effects: an 'attack becomes 5' afterwards ends at 5, one before it at 6", () => {
    const after = d({ me: { field: [{ card: "FIRE", uncappedWith: [{ card: "T-FIRE", uncaps: ["uncap"] }] }], hand: ["SET5"] } });
    expect(after.play("SET5").stats("FIRE")).toEqual([5, 2]);
    const before = d({ me: { field: ["FIRE"], hand: ["SET5"], ex: ["T-FIRE"] } }).play("SET5");
    expect(before.activate("T-FIRE").stats("FIRE")).toEqual([6, 2]);
  });
});
