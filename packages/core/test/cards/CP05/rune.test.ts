import { describe, expect, it } from "vitest";
import { createEngine, script } from "../../../src";
import { ALL_CARDS, ALL_SCRIPTS } from "../../../src/sets";
import { HIHIIROKANE } from "../../../src/script/CP05/shared";
import { drive, testFollower, type Driver, type DriveSpec } from "../../../src/testing";
import { TEST_CARDS, TEST_SCRIPTS } from "../../helpers";

// CP05 Runecraft (ウィッチ, 037–053, T07, T08). Pre-release cards with Japanese names (data/preview.ts); their rules are in the
// Japanese rules v1.29.0 (CR JP 14.6). V1 is 1c 2/2, V3 3c 3/4, V5 5c 5/5 (Neutral); QUICK-KILL a 1c spell with Quick (destroy an
// enemy follower), QUICK-SAC a 0c one (destroy one of your followers). Treasures: CP05-T09 火晶, T10 水晶, T11 土晶, T14 闇晶の
// エレメント, T15 ヒヒイロカネ. CP05-110 is a 全属性 follower, CP05-109 a 全属性 evolved one. GBF-END: a Granblue follower "at the
// start of your end phase, give your leader +1" (CP05-050 ruling Q2903's kind of card).
const { atStartOfYourEndPhase, defineCard } = script;
const E = createEngine({
  cards: [...ALL_CARDS, ...TEST_CARDS, testFollower("GBF-END", 1, 1, 1, { traits: ["グラブル", "水属性"] })],
  scripts: {
    ...ALL_SCRIPTS,
    ...TEST_SCRIPTS,
    "GBF-END": defineCard({
      abilities: [
        atStartOfYourEndPhase({
          *resolve(fx) {
            yield* fx.giveLeaderDefense(fx.controller, 1);
          },
        }),
      ],
    }),
  },
});
const d = (spec: DriveSpec) => drive(E, spec);
const n = (count: number, id: string) => Array<string>(count).fill(id);
const SUPER = { superEvolutionPoints: 1, turnsPassed: 8 };
/** Resolve first the pending ability of `def` that is its script's `ability`-th (an order the player chooses). */
const first = (t: Driver, def: string, ability = 0) =>
  t.answer({ type: "selectPending", id: t.game.state.pending.find((p) => p.sourceDef === def && p.ability === ability)!.id });
const candidates = (t: Driver) => (t.decision?.type === "selectCards" ? t.decision.candidateDefs : []);
const faceUp = (t: Driver) => t.game.reader().faceUpEvolveDeck(0).map((id) => t.game.state.cards[id]!.def);

describe("CP05 Runecraft", () => {
  it("037 魔弾の射手・エッセル — revealed from the hand by an ability, either turn (Q2893, Q2894), even if it has left the hand since: 1 damage; uncapped: 4 damage; final-uncapped: Storm to a follower of original cost 3 or less; ヒヒイロカネ: both, either order (Q2867, Q2868), on an uncapped one the final only", () => {
    // CP05-044's Fanfare reveals it with CP05-048 and 051: both "revealed" abilities trigger.
    const t = d({ me: { hand: ["CP05-044", "CP05-037", "CP05-048", "CP05-051"], playPoints: 1 }, opp: { field: ["V5"] } });
    t.play("CP05-044").yes().flush();
    expect([t.stats("opp:V5"), t.ex()]).toEqual([[5, 2], ["CP05-T09"]]);
    // Q2894: the opponent's ability, in the opponent's turn (BP06-118: "an opponent reveals their hand").
    const o = d({ turn: 6, me: { hand: ["CP05-037"], playPoints: 0 }, opp: { hand: ["BP06-118"], field: ["V3"] } }).play("opp:BP06-118");
    o.pick("opp:V3");
    expect([o.stats("opp:V3"), o.hand()]).toEqual([[3, 3], ["CP05-037"]]);
    // BP01-111 reveals the hand and has it discarded: its ability resolves all the same (CR 10.7.7).
    const x = d({ turn: 6, me: { hand: ["CP05-037", "V1"], playPoints: 0 }, opp: { field: ["BP01-110", "V3"], evolveDeck: ["BP01-111"], evolutionPoints: 1, playPoints: 1 } });
    x.evolve("opp:BP01-110").pick("CP05-037").pick("opp:V3");
    expect([x.stats("opp:V3"), x.hand(), x.cemetery()]).toEqual([[3, 3], ["V1"], ["CP05-037"]]);
    // Q2893: playing it is no reveal by an ability.
    expect(d({ me: { hand: ["CP05-037"] }, opp: { field: ["V5"] } }).play("CP05-037").stats("opp:V5")).toEqual([5, 5]);
    const u = d({ me: { field: ["CP05-037"], ex: ["CP05-T09"] }, opp: { field: ["V5"] } }).activate("CP05-T09");
    expect([u.stats("CP05-037"), u.stats("opp:V5")]).toEqual([[3, 4], [5, 1]]);
    const f = d({ me: { field: [{ card: "CP05-037", uncappedWith: [{ card: "CP05-T09", uncaps: ["uncap"] }] }, "V1"], ex: ["CP05-T09"] } });
    f.activate("CP05-T09").pick("V1");
    expect([f.stats("CP05-037"), f.keywords("V1")]).toEqual([[4, 5], ["storm"]]);
    // ヒヒイロカネ on an uncapped one only final-uncaps it: the uncap's 4 damage doesn't trigger.
    const hu = d({ me: { field: [{ card: "CP05-037", uncappedWith: [{ card: "CP05-T09", uncaps: ["uncap"] }] }, "V1"], ex: ["CP05-T15"] }, opp: { field: ["V5"] } });
    hu.activate("CP05-T15").pick("V1");
    expect([hu.stats("CP05-037"), hu.keywords("V1"), hu.stats("opp:V5"), hu.ex()]).toEqual([[4, 5], ["storm"], [5, 5], []]);
    // ヒヒイロカネ: both trigger (Q2868); the final uncap's first (Q2867): original cost 3 or less — not V5; an evolved follower by its
    // base card's cost (CR 5.16.1.2), CP05-039's 3 — Storm for itself (3), then the 4 damage.
    const h = d({ me: { field: ["CP05-037", "V1", "V5", { card: "CP05-039", evolvedInto: "CP05-040" }], ex: ["CP05-T15"] }, opp: { field: ["V5"] } });
    h.activate("CP05-T15").pick("CP05-037");
    expect(h.decision?.type).toBe("selectPending");
    first(h, "CP05-037", 2);
    expect([candidates(h), h.stats("opp:V5")]).toEqual([["CP05-037", "V1", "CP05-039"], [5, 5]]);
    h.pick("CP05-037");
    expect([h.stats("CP05-037"), h.keywords("CP05-037").includes("storm"), h.stats("opp:V5")]).toEqual([[4, 5], true, [5, 1]]);
  });

  it("038 閃耀の双剣・カトル — uncapped: 4 damage; final-uncapped: 4 to each enemy leader; ヒヒイロカネ: both (Q2867, Q2868); Q act (3) discarding it from the hand: 4 damage and draw — not without a target (Q2895, Q2896)", () => {
    const u = d({ me: { field: ["CP05-038"], ex: ["CP05-T10"] }, opp: { field: ["V5"] } }).activate("CP05-T10");
    expect([u.stats("CP05-038"), u.stats("opp:V5")]).toEqual([[5, 2], [5, 1]]);
    const f = d({ me: { field: [{ card: "CP05-038", uncappedWith: [{ card: "CP05-T10", uncaps: ["uncap"] }] }], ex: ["CP05-T10"] } }).activate("CP05-T10");
    expect([f.stats("CP05-038"), f.leader("opp")]).toEqual([[6, 3], 16]);
    const h = d({ me: { field: ["CP05-038"], ex: ["CP05-T15"] }, opp: { field: ["V5"] } }).activate("CP05-T15").flush();
    expect([h.stats("CP05-038"), h.stats("opp:V5"), h.leader("opp")]).toEqual([[6, 3], [5, 1], 16]);
    const q = d({ me: { hand: ["CP05-038"], deck: ["V1"], playPoints: 3 }, opp: { field: ["V5"] } }).activate("CP05-038@hand");
    expect([q.stats("opp:V5"), q.hand(), q.cemetery(), q.pp()]).toEqual([[5, 1], ["V1"], ["CP05-038"], 0]);
    expect(d({ me: { hand: ["CP05-038"], deck: ["V1"], playPoints: 3 } }).canActivate("CP05-038")).toBe(false);
  });

  it("039 水の理・ワムデュス — Fanfare: up to 2 spells with Quick printed and followers with a Q act among the top 3, the rest to the cemetery; Q act (1) from the hand: 2 damage (Q2897)", () => {
    // BP12-058 has Quick only under Overflow (max 7 here): not in the deck (CR 12.3.6).
    const t = d({ me: { hand: ["CP05-039"], deck: ["QUICK-KILL", "BP12-058", "CP05-052", "V1"], maxPlayPoints: 7, playPoints: 3 } }).play("CP05-039");
    expect(candidates(t)).toEqual(["QUICK-KILL", "CP05-052"]);
    t.pick("QUICK-KILL", "CP05-052");
    expect([t.hand(), t.cemetery(), t.zone("me", "deck")]).toEqual([["QUICK-KILL", "CP05-052"], ["BP12-058"], ["V1"]]);
    const q = d({ me: { hand: ["CP05-039"], playPoints: 1 }, opp: { field: ["V3"] } }).activate("CP05-039@hand");
    expect([q.stats("opp:V3"), q.cemetery(), q.pp()]).toEqual([[3, 2], ["CP05-039"], 0]);
    expect(d({ me: { hand: ["CP05-039"], playPoints: 1 } }).canActivate("CP05-039")).toBe(false);
  });

  it("040 水の理・ワムデュス (evolved) — end phase: recover 3; super-evolved: Quick spells (BP12-058 under Overflow too), followers with a Q act and Q acts you play cost 1 less, nothing else, while it is on the field (Q2898)", () => {
    const t = d({
      me: { field: ["CP05-039"], evolveDeck: ["CP05-040"], hand: ["QUICK-KILL", "CP05-038", "CP05-039"], ...SUPER, playPoints: 4 },
      opp: { field: ["V5", "V3"], hand: ["QUICK-KILL"], deck: ["V1"], playPoints: 0 },
    });
    t.evolve("CP05-039", { sep: true }).play("QUICK-KILL").pick("opp:V5");
    expect([t.stats("CP05-039"), t.pp()]).toEqual([[3, 5], 3]);
    t.play("CP05-038"); // a follower with a Q act: 2
    t.activate("CP05-039@hand"); // its Q act: 0
    expect([t.pp(), t.stats("opp:V3")]).toEqual([1, [3, 2]]);
    expect(t.end().pp()).toBe(4);
    // Only what its controller plays: the opponent's spell with Quick costs 1 (3 play points in their turn).
    t.play("opp:QUICK-KILL").pick("CP05-038");
    expect([t.pp("opp"), t.field()]).toEqual([2, ["CP05-039"]]);
    // Not evolved by super-evolving: no text. Gone from the field: no reduction.
    expect(d({ me: { field: [{ card: "CP05-039", evolvedInto: "CP05-040" }], hand: ["QUICK-KILL"], playPoints: 1 }, opp: { field: ["V5"] } }).play("QUICK-KILL").pp()).toBe(0);
    const gone = d({ me: { field: ["CP05-039"], evolveDeck: ["CP05-040"], hand: ["QUICK-SAC", "QUICK-KILL"], ...SUPER, playPoints: 2 }, opp: { field: ["V5"] } });
    gone.evolve("CP05-039", { sep: true }).play("QUICK-SAC").play("QUICK-KILL");
    expect([gone.field(), gone.pp()]).toEqual([[], 0]);
    // Paid in full: a spell without Quick, a follower without a Q act, an act that isn't quick (CP05-044's). BP12-058 has Quick
    // where it is played while Overflow is active (max 7): 1 less; at max 6 it has none: its 2.
    const x = d({
      me: { field: ["CP05-039", "CP05-044"], evolveDeck: ["CP05-040"], hand: ["KILL", "V1", "CP05-051", "BP12-058"], ...SUPER, maxPlayPoints: 7, playPoints: 7 },
      opp: { field: ["V5", "V3"] },
    });
    x.evolve("CP05-039", { sep: true }).play("KILL").pick("opp:V5").play("V1").activate("CP05-044");
    expect([x.pp(), x.stats("opp:V3")]).toEqual([3, [3, 3]]);
    expect(x.play("BP12-058").pp()).toBe(2);
    const six = d({ me: { field: ["CP05-039"], evolveDeck: ["CP05-040"], hand: ["BP12-058"], ...SUPER, maxPlayPoints: 6, playPoints: 3 }, opp: { field: ["V5"] } });
    expect(six.evolve("CP05-039", { sep: true }).play("BP12-058").pp()).toBe(0);
  });

  it("041 / 042 開闢の錬金術師・カリオストロ — Fanfare with max PP 7+: an アルス・マグナ and a ヒヒイロカネ (one slot: choose, Q2899); act, engage, discard a Granblue card: 2 damage; evolved: On Evolve 2 damage, the same act", () => {
    expect(d({ me: { hand: ["CP05-041"], maxPlayPoints: 7, playPoints: 2 } }).play("CP05-041").ex()).toEqual(["CP05-T08", "CP05-T15"]);
    expect(d({ me: { hand: ["CP05-041"], maxPlayPoints: 6, playPoints: 2 } }).play("CP05-041").ex()).toEqual([]);
    const one = d({ me: { hand: ["CP05-041"], ex: n(4, "V1"), maxPlayPoints: 7, playPoints: 2 } }).play("CP05-041").choose(HIHIIROKANE);
    expect(one.ex()).toEqual([...n(4, "V1"), "CP05-T15"]);
    const a = d({ me: { field: ["CP05-041"], hand: ["CP05-052", "V1"] }, opp: { field: ["V3"] } }).activate("CP05-041");
    expect([a.stats("opp:V3"), a.hand(), a.cemetery(), a.engaged("CP05-041")]).toEqual([[3, 2], ["V1"], ["CP05-052"], true]);
    expect(d({ me: { field: ["CP05-041"], hand: ["V1"] }, opp: { field: ["V3"] } }).canActivate("CP05-041")).toBe(false);
    const e = d({ me: { field: ["CP05-041"], evolveDeck: ["CP05-042"], hand: ["CP05-052"], playPoints: 1 }, opp: { field: ["V5"] } });
    e.evolve("CP05-041").activate("CP05-041");
    expect([e.stats("CP05-041"), e.stats("opp:V5"), e.engaged("CP05-041"), e.cemetery()]).toEqual([[3, 3], [5, 1], true, ["CP05-052"]]);
  });

  it("043 空慕う帰還者・カシウス — Fanfare: draw, then with 7 followers with a Q act in the cemetery (valid only in the hand too) recover 3; Q act (1) from the hand, also at quick timing: a follower with a Q act among the top 3 (Q2900)", () => {
    const t = d({ me: { hand: ["CP05-043"], cemetery: n(7, "CP05-038"), deck: ["V1"], playPoints: 4 } }).play("CP05-043");
    expect([t.hand(), t.pp()]).toEqual([["V1"], 3]);
    const six = d({ me: { hand: ["CP05-043"], cemetery: [...n(6, "CP05-038"), "QUICK-KILL"], deck: ["V1"], playPoints: 4 } }).play("CP05-043");
    expect([six.hand(), six.pp()]).toEqual([["V1"], 0]);
    // Neither a spell with Quick nor a follower without a Q act.
    const q = d({ me: { hand: ["CP05-043"], deck: ["QUICK-KILL", "CP05-047", "V3", "V5"], playPoints: 1 } }).activate("CP05-043@hand");
    expect(candidates(q)).toEqual(["CP05-047"]);
    q.pick("CP05-047").order();
    expect([q.hand(), q.zone("me", "deck")[0], q.zone("me", "deck").length, q.cemetery(), q.pp()]).toEqual([["CP05-047"], "V5", 3, ["CP05-043"], 0]);
    // Quick (CR 12.3.3): in the opponent's turn too, once an attack is declared.
    const o = d({ turn: 6, me: { hand: ["CP05-043"], deck: ["V1", "CP05-052", "V3"], playPoints: 1 }, opp: { field: ["V1"] } }).attack("opp:V1", "leader");
    o.quick("CP05-043").pick("CP05-052").order();
    expect([o.hand(), o.cemetery(), o.pp()]).toEqual([["CP05-052"], ["CP05-043"], 0]);
  });

  it("044 コロッサス・マグナ — Fanfare, reveal 3 fire cards (全属性 too): 2 damage, not asked without a target; act (1), engage, reveal a fire card: 1 damage; each reveal triggers CP05-048", () => {
    const t = d({ me: { hand: ["CP05-044", "CP05-051", "CP05-110", "CP05-048", "V1"], playPoints: 2 }, opp: { field: ["V5"] } });
    t.play("CP05-044").yes();
    expect([t.stats("opp:V5"), t.ex()]).toEqual([[5, 3], ["CP05-T09"]]);
    t.activate("CP05-044").pick("CP05-048");
    expect([t.stats("opp:V5"), t.ex(), t.engaged("CP05-044"), t.pp(), t.canActivate("CP05-044")]).toEqual([[5, 2], ["CP05-T09", "CP05-T09"], true, 0, false]);
    const none = d({ me: { hand: ["CP05-044", "CP05-051", "CP05-110", "CP05-048"], playPoints: 1 } }).play("CP05-044");
    expect([none.decision?.type, none.ex()]).toEqual(["mainPhase", []]);
  });

  it("045 / 046 神託の妖童・アルルメイヤ — Fanfare: a 土晶のエレメント, leader +2, may turn a facedown earth evolved follower faceup; evolved: damage equal to the faceup earth evolved followers (全属性 too), then a 土晶のエレメント — not without a target (Q2901)", () => {
    const t = d({ me: { hand: ["CP05-045"], evolveDeck: ["CP05-046", "CP05-040"], playPoints: 4 } }).play("CP05-045");
    expect(candidates(t)).toEqual(["CP05-046"]);
    t.pick("CP05-046");
    // Its own evolved card, faceup, is no longer in the evolve deck to evolve with (CR 4.6.3).
    expect([t.ex(), t.leader(), faceUp(t), t.canEvolve("CP05-045")]).toEqual([["CP05-T11"], 22, ["CP05-046"], false]);
    const keep = d({ me: { hand: ["CP05-045"], evolveDeck: ["CP05-046"], playPoints: 4 } }).play("CP05-045").none();
    expect([faceUp(keep), keep.canEvolve("CP05-045")]).toEqual([[], true]);
    const e = d({ me: { field: ["CP05-045"], evolveDeck: ["CP05-046"], faceUpEvolveDeck: ["CP05-042", "CP05-109", "CP05-040"], playPoints: 1 }, opp: { field: ["V5"] } });
    e.evolve("CP05-045");
    expect([e.stats("opp:V5"), e.ex()]).toEqual([[5, 3], ["CP05-T11"]]);
    expect(d({ me: { field: ["CP05-045"], evolveDeck: ["CP05-046"], faceUpEvolveDeck: ["CP05-042"], playPoints: 1 } }).evolve("CP05-045").ex()).toEqual([]);
  });

  it("047 楽隠居の元国王・フォリア — Fanfare with 7 followers with a Q act in the cemetery: a ハクタク; Q act (0) once per turn: the next Q act this turn costs 1 less, used up even by one costing 0 (not by a treasure's act or a spell with Quick), two of them −1, with CP05-040 −2", () => {
    const t = d({ me: { hand: ["CP05-047"], cemetery: n(7, "CP05-039"), playPoints: 4 } }).play("CP05-047").none();
    expect(t.field()).toEqual(["CP05-047", "CP05-T07"]);
    expect(d({ me: { hand: ["CP05-047"], cemetery: n(6, "CP05-039"), playPoints: 4 } }).play("CP05-047").field()).toEqual(["CP05-047"]);
    const q = d({ me: { field: ["CP05-047"], hand: ["CP05-039"], playPoints: 0 }, opp: { field: ["V3"] } });
    expect(q.canActivate("CP05-039")).toBe(false);
    q.activate("CP05-047");
    expect(q.canActivate("CP05-047")).toBe(false);
    q.activate("CP05-039@hand");
    expect([q.stats("opp:V3"), q.pp()]).toEqual([[3, 2], 0]);
    // A Q act played for 0 uses it up (CP05-052).
    const used = d({ me: { field: ["CP05-047", "CP05-052"], hand: ["CP05-039"], deck: ["V1"], playPoints: 0 }, opp: { field: ["V3"] } });
    used.activate("CP05-047").activate("CP05-052").no();
    expect(used.canActivate("CP05-039")).toBe(false);
    // A treasure's act isn't quick: the −1 stays for the next Q act.
    const kept = d({ me: { field: ["CP05-047"], ex: ["CP05-T10"], hand: ["CP05-039"], playPoints: 0 }, opp: { field: ["V3"] } });
    kept.activate("CP05-047").activate("CP05-T10").activate("CP05-039@hand");
    expect([kept.stats("CP05-047"), kept.stats("opp:V3")]).toEqual([[4, 5], [3, 2]]);
    // Two of them make one −1: the second one's act, quick, uses up the first one's. A spell with Quick neither gets it nor uses it.
    const two = d({ me: { field: ["CP05-047", "CP05-047"], hand: ["QUICK-KILL", "CP05-038"], deck: ["V1"], playPoints: 3 }, opp: { field: ["V5", "V3"] } });
    two.activate("CP05-047").activate("CP05-047").play("QUICK-KILL").pick("opp:V5");
    expect(two.pp()).toBe(2);
    two.activate("CP05-038@hand");
    expect([two.pp(), two.field("opp"), two.hand()]).toEqual([0, [], ["V1"]]);
    const both = d({ me: { field: ["CP05-047", "CP05-039"], evolveDeck: ["CP05-040"], hand: ["CP05-038"], deck: ["V1"], ...SUPER, playPoints: 2 }, opp: { field: ["V5"] } });
    both.evolve("CP05-039", { sep: true }).activate("CP05-047").activate("CP05-038@hand");
    expect([both.pp(), both.stats("opp:V5"), both.hand()]).toEqual([0, [5, 1], ["V1"]]);
  });

  it("048 アルケミック・フレア — revealed from the hand: a 火晶のエレメント, also in the opponent's turn (Q2894) and once it has left the hand, not by playing it (Q2893); 4 damage and a 火晶のエレメント, not without a target (Q2902)", () => {
    const t = d({ me: { hand: ["CP05-048"], playPoints: 2 }, opp: { field: ["V5"] } }).play("CP05-048");
    expect([t.stats("opp:V5"), t.ex(), t.cemetery()]).toEqual([[5, 1], ["CP05-T09"], ["CP05-048"]]);
    expect(d({ me: { hand: ["CP05-048"], playPoints: 2 } }).canPlay("CP05-048")).toBe(false);
    // The opponent's BP01-111 reveals the hand and has it discarded: the ability resolves all the same (CR 10.7.7).
    const o = d({ turn: 6, me: { hand: ["CP05-048", "V1"], playPoints: 0 }, opp: { field: ["BP01-110"], evolveDeck: ["BP01-111"], evolutionPoints: 1, playPoints: 1 } });
    o.evolve("opp:BP01-110").pick("CP05-048");
    expect([o.ex(), o.hand(), o.cemetery()]).toEqual([["CP05-T09"], ["V1"], ["CP05-048"]]);
  });

  it("049 / 050 妄想少女A・ルナール — uncapped: a Granblue follower from the cemetery to the hand; evolved: On Evolve, another Granblue follower: one of its name from the deck onto the field, banished at your end phase (Q2903, Q2904)", () => {
    const t = d({ me: { field: ["CP05-049"], ex: ["CP05-T14"], cemetery: ["CP05-052", "CP05-048", "V1"] } }).activate("CP05-T14");
    expect([t.stats("CP05-049"), t.hand(), t.cemetery()]).toEqual([[3, 2], ["CP05-052"], ["CP05-048", "V1"]]);
    const e = d({ me: { field: [{ card: "CP05-049", evolvedInto: "CP05-050" }], ex: ["CP05-T15"], cemetery: ["CP05-052"] } }).activate("CP05-T15");
    expect([e.stats("CP05-049"), e.hand()]).toEqual([[4, 3], ["CP05-052"]]);
    // V1 isn't a Granblue follower: CP05-052 is the one to select; the search offers only a card of its name.
    const s = d({ me: { field: ["CP05-049", "CP05-052", "V1"], evolveDeck: ["CP05-050"], deck: ["CP05-052", "V1"], playPoints: 2 }, opp: { deck: ["V1"] } });
    s.evolve("CP05-049");
    expect(candidates(s)).toEqual(["CP05-052"]);
    s.pick("CP05-052");
    expect([s.field(), s.ex(), s.zone("me", "deck")]).toEqual([["CP05-049", "CP05-052", "V1", "CP05-052"], ["CP05-T10"], ["V1"]]);
    s.end();
    expect([s.field(), s.zone("me", "banished")]).toEqual([["CP05-049", "CP05-052", "V1"], ["CP05-052"]]);
    // Q2904: Runaar has left the field; the given ability stays.
    const q = d({ me: { field: ["CP05-049", "CP05-052"], evolveDeck: ["CP05-050"], hand: ["QUICK-SAC"], deck: ["CP05-052"], playPoints: 2 }, opp: { deck: ["V1"] } });
    q.evolve("CP05-049").pick("CP05-052").play("QUICK-SAC").pick("CP05-049").end();
    expect([q.field(), q.zone("me", "banished")]).toEqual([["CP05-052"], ["CP05-052"]]);
    // Q2903: with its own end-phase ability, the banish first: the other still resolves.
    const g = d({ me: { field: ["CP05-049", "GBF-END"], evolveDeck: ["CP05-050"], deck: ["GBF-END"], playPoints: 2 }, opp: { deck: ["V1"] } });
    g.evolve("CP05-049").pick("GBF-END").end();
    first(g, "grant:banishAtEnd").flush();
    expect([g.field(), g.zone("me", "banished"), g.leader()]).toEqual([["CP05-049", "GBF-END"], ["GBF-END"], 22]);
  });

  it("051 炎獄の葬送者・エルモート — uncapped: 1 damage to each enemy leader; Fanfare, reveal 3 fire cards from the hand: 3 damage (optional)", () => {
    const u = d({ me: { field: ["CP05-051"], ex: ["CP05-T09"] } }).activate("CP05-T09");
    expect([u.stats("CP05-051"), u.leader("opp")]).toEqual([[3, 2], 19]);
    const t = d({ me: { hand: ["CP05-051", "CP05-037", "CP05-044", "CP05-110", "CP05-048"], playPoints: 2 }, opp: { field: ["V5", "V3"] } });
    t.play("CP05-051").yes().pick("opp:V3").pick("CP05-044", "CP05-110", "CP05-048");
    expect([t.stats("opp:V3"), t.ex()]).toEqual([[3, 1], ["CP05-T09"]]);
    const no = d({ me: { hand: ["CP05-051", "CP05-037", "CP05-044", "CP05-110"], playPoints: 2 }, opp: { field: ["V3"] } }).play("CP05-051").no();
    expect([no.stats("opp:V3"), no.decision?.type]).toEqual([[3, 4], "mainPhase"]);
  });

  it("052 報恩の技師・アイザック — Fanfare: a 水晶のエレメント; Q act, engage: look at the top card, may put it into the cemetery (also at quick timing)", () => {
    const t = d({ me: { hand: ["CP05-052"], deck: ["V1", "V3"], playPoints: 1 } }).play("CP05-052");
    expect(t.ex()).toEqual(["CP05-T10"]);
    t.activate("CP05-052").yes();
    expect([t.cemetery(), t.zone("me", "deck"), t.engaged("CP05-052")]).toEqual([["V1"], ["V3"], true]);
    const keep = d({ me: { field: ["CP05-052"], deck: ["V1", "V3"] } }).activate("CP05-052").no();
    expect([keep.cemetery(), keep.zone("me", "deck")]).toEqual([[], ["V1", "V3"]]);
    const quick = d({ turn: 6, me: { field: ["CP05-052"], deck: ["V1", "V3"] }, opp: { field: ["V1"] } }).attack("opp:V1", "leader");
    quick.quick("CP05-052").yes();
    expect([quick.cemetery(), quick.leader()]).toEqual([["V1"], 18]);
  });

  it("053 アルス･グローリア — the top 4: an earth, light or dark card (全属性 too) to the hand, the rest on the bottom in any order", () => {
    const t = d({ me: { hand: ["CP05-053"], deck: ["CP05-048", "CP05-110", "CP05-049", "V1", "V3"], playPoints: 1 } }).play("CP05-053");
    expect(candidates(t)).toEqual(["CP05-110", "CP05-049"]);
    t.pick("CP05-110").order();
    expect([t.hand(), t.zone("me", "deck")[0], t.zone("me", "deck").length]).toEqual([["CP05-110"], "V3", 4]);
  });

  it("T07 ハクタク — Rush, Assail, Ward; Q act (1) once per turn, also at quick timing: leader +2", () => {
    const t = d({ me: { field: [{ card: "CP05-T07", enteredThisTurn: true }], playPoints: 2 }, opp: { field: ["V3"] } });
    expect([[...t.keywords("CP05-T07")].sort(), t.attackTargets("CP05-T07")]).toEqual([["assail", "rush", "ward"], ["V3"]]);
    t.activate("CP05-T07");
    expect([t.leader(), t.pp(), t.canActivate("CP05-T07")]).toEqual([22, 1, false]);
    // Engaged, it is the one to attack (Ward, CR 12.8.2); quick (CR 12.3.3): in the opponent's turn too, once the attack is declared.
    const q = d({ turn: 6, me: { field: [{ card: "CP05-T07", engaged: true }], playPoints: 1 }, opp: { field: ["V1"] } });
    expect(q.attackTargets("opp:V1")).toEqual(["CP05-T07"]);
    q.attack("opp:V1", "CP05-T07").quick("CP05-T07");
    expect([q.leader(), q.pp(), q.stats("CP05-T07"), q.field("opp")]).toEqual([22, 0, [4, 4], []]);
  });

  it("T08 アルス・マグナ — 2 damage to an enemy follower and its leader, your leader +2; not playable without a target (Q2929)", () => {
    const t = d({ me: { ex: ["CP05-T08"], playPoints: 1 }, opp: { field: ["V3"] } }).play("CP05-T08");
    expect([t.stats("opp:V3"), t.leader("opp"), t.leader(), t.ex()]).toEqual([[3, 2], 18, 22, []]);
    expect(d({ me: { ex: ["CP05-T08"], playPoints: 1 } }).canPlay("CP05-T08")).toBe(false);
  });
});
