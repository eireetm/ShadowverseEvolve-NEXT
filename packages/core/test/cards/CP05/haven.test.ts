import { describe, expect, it } from "vitest";
import { drive, type DriveSpec, type Driver, type FieldCardSpec } from "../../../src/testing";
import { cardEngine } from "../../helpers";

// CP05 Havencraft (089–104). A pre-release set with Japanese names (data/preview.ts); its rules (uncapping, treasures, 全属性)
// are the Japanese rules v1.29.0 only (CR JP 14.6). T10 / T11 / T12 / T13 are the water / earth / wind / light elements, T15
// ヒヒイロカネ. V1 is 1c 2/2, V3 3c 3/4, V5 5c 5/5 (Neutral). CP05-107 … 110 are 全属性; CP05-090, 095, 099 are this class's
// Granblue followers of original cost 5.
const E = cardEngine();
const d = (spec: DriveSpec) => drive(E, spec);
const SUPER = { superEvolutionPoints: 1, turnsPassed: 8 };

/** The definitions of the current card selection's candidates. */
function candidates(t: Driver): string[] {
  const dec = t.decision;
  if (dec?.type !== "selectCards") throw new Error(`expected a card selection, got ${dec?.type ?? "none"}`);
  return dec.candidates.map((id) => t.game.state.cards[id]!.def);
}

/** Play the pending ability that is ability `index` of its card's script (two of one card are told apart by it). */
function pendingAbility(t: Driver, index: number): Driver {
  const p = t.game.state.pending.find((x) => x.ability === index);
  if (!p) throw new Error(`no pending ability #${index}`);
  return t.answer({ type: "selectPending", id: p.id });
}

describe("CP05 Havencraft", () => {
  it("089 開眼者・ウーノ — Ward, Final Uncap; uncapped: draw, discard; final-uncapped: 4 damage; Q act (1), engage: leader +1", () => {
    // A water element uncaps it; a second one final-uncaps it instead (CR JP 14.6.4).
    const t = d({ me: { field: ["CP05-089"], ex: ["CP05-T10", "CP05-T10"], hand: ["V1"], deck: ["V3"] }, opp: { field: ["V5", "V3"] } });
    expect(t.keywords("CP05-089")).toEqual(["ward", "finalUncap"]);
    t.activate("CP05-T10").pick("V1");
    expect([t.hand(), t.cemetery(), t.stats("CP05-089")]).toEqual([["V3"], ["V1"], [2, 1]]);
    t.activate("CP05-T10").pick("opp:V5");
    expect([t.stats("opp:V5"), t.stats("CP05-089"), t.hand()]).toEqual([[5, 1], [3, 2], ["V3"]]);
    t.activate("CP05-089");
    expect([t.leader(), t.engaged("CP05-089"), t.pp()]).toEqual([21, true, 2]);
    // Q2867 / Q2868: ヒヒイロカネ does both, both trigger, in either order — here the final uncap's first.
    const h = d({ me: { field: ["CP05-089"], ex: ["CP05-T15"], deck: ["V3"] }, opp: { field: ["V5", "V3"] } }).activate("CP05-T15");
    expect(h.decision?.type).toBe("selectPending");
    pendingAbility(h, 1).pick("opp:V3").flush();
    expect([h.field("opp"), h.hand(), h.cemetery(), h.stats("CP05-089")]).toEqual([["V5"], [], ["V3"], [3, 2]]);
    // Without an enemy follower the final uncap's ability isn't played (CR 10.6.2.3.3).
    const none = d({ me: { field: [{ card: "CP05-089", uncappedWith: [{ card: "CP05-T10", uncaps: ["uncap"] }] }], ex: ["CP05-T10"] } });
    expect([none.activate("CP05-T10").decision?.type, none.stats("CP05-089")]).toEqual(["mainPhase", [3, 2]]);
    // The Q act at Quick timing, in the opponent's turn (CR 12.3.3).
    const q = d({ turn: 6, me: { field: ["CP05-089", { card: "V5", engaged: true }], playPoints: 1 }, opp: { field: ["V1"] } });
    q.attack("opp:V1", "V5").quick("CP05-089");
    expect([q.leader(), q.engaged("CP05-089"), q.pp()]).toEqual([21, true, 0]);
  });

  it("090 魔導の申し子・フュンフ — Final Uncap; uncapped: a 5-cost Granblue follower from the hand; final-uncapped, pay 2: one from the top 5", () => {
    const t = d({
      me: {
        field: ["CP05-090"],
        ex: ["CP05-T15"],
        hand: ["CP05-090", "V5", "CP05-097"],
        deck: ["CP05-090", "V5", "CP05-099", "V1", "V3"],
        playPoints: 2,
      },
    });
    // Q2868: ヒヒイロカネ triggers both; the uncap's first. Another フュンフ may come from the hand (no name excluded there);
    // V5 isn't Granblue, CP05-097 costs 1, and putting one is optional ("てよい").
    t.activate("CP05-T15");
    expect(t.decision?.type).toBe("selectPending");
    pendingAbility(t, 0);
    expect(candidates(t)).toEqual(["CP05-090"]);
    expect(t.decision).toMatchObject({ min: 0, max: 1 });
    t.pick("CP05-090");
    // The final uncap's: pay 2 (CR 10.4.7.4), then not one with this card's name.
    t.yes();
    expect(candidates(t)).toEqual(["CP05-099"]);
    t.pick("CP05-099").none().order();
    // CP05-099's Fanfare: +3/+3 (max PP 3). The first フュンフ: +1 and +1/+1 (CR JP 14.6.4.1.1, JP 14.6.4.2.1).
    expect([t.field(), t.pp(), t.stats("CP05-090"), t.stats("CP05-099"), t.hand()]).toEqual([
      ["CP05-090", "CP05-090", "CP05-099"],
      0,
      [4, 4],
      [4, 4],
      ["V5", "CP05-097"],
    ]);
    expect(t.zone("me", "deck")).toEqual(["CP05-090", "V5", "V1", "V3"]);
    // An element final-uncaps an uncapped one instead: only that ability, and its cost may go unpaid (nothing then).
    const no = d({ me: { field: [{ card: "CP05-090", uncappedWith: [{ card: "CP05-T13", uncaps: ["uncap"] }] }], ex: ["CP05-T13"], deck: ["CP05-099"] } });
    no.activate("CP05-T13").no();
    expect([no.field(), no.pp(), no.stats("CP05-090"), no.zone("me", "deck")]).toEqual([["CP05-090"], 3, [4, 4], ["CP05-099"]]);
  });

  it("091 土の理・ガレヲン — Fanfare: may turn a facedown earth evolved follower faceup; with 4 faceup ones, draw", () => {
    // CP05-109 is 全属性, an earth one too (CR JP 14.6.2.2); CP05-040 is water, neither turned nor counted; CP05-092 / 046 /
    // 032 are faceup earth ones.
    const me = {
      hand: ["CP05-091"],
      evolveDeck: ["CP05-109", "CP05-040"],
      faceUpEvolveDeck: ["CP05-092", "CP05-046", "CP05-032", "CP05-040"],
      deck: ["V1"],
      playPoints: 2,
    };
    const t = d({ me }).play("CP05-091");
    expect(candidates(t)).toEqual(["CP05-109"]);
    t.pick("CP05-109");
    expect([t.hand(), t.zone("me", "evolveDeck"), t.game.reader().faceDownEvolveDeck(0).length]).toEqual([
      ["V1"],
      ["CP05-109", "CP05-040", "CP05-092", "CP05-046", "CP05-032", "CP05-040"],
      1,
    ]);
    // Not turned: 3 faceup earth ones (and a water one), no draw.
    expect(d({ me }).play("CP05-091").none().hand()).toEqual([]);
  });

  it("091 / 092 土の理・ガレヲン — Evolve (1); On Evolve: may take a Granblue card from the top 4; On Super-Evolve: X 土晶のエレメント, leader +X", () => {
    const t = d({ me: { field: ["CP05-091"], evolveDeck: ["CP05-092"], deck: ["CP05-093", "V1", "CP05-097", "V3", "V5"], playPoints: 1 } });
    t.evolve("CP05-091");
    expect(candidates(t)).toEqual(["CP05-093", "CP05-097"]);
    t.pick("CP05-097").order();
    expect([t.stats("CP05-091"), t.hand(), t.zone("me", "deck")]).toEqual([[3, 3], ["CP05-097"], ["V5", "CP05-093", "V1", "V3"]]);
    // Q2871 / Q2872: super-evolving triggers both, in either order. X = half of 2 (this card isn't in the evolve deck any more;
    // the faceup water CP05-040 isn't counted).
    const superEvolve = (faceUpEvolveDeck: string[], ex: string[] = []) =>
      d({ me: { field: ["CP05-091"], evolveDeck: ["CP05-092"], faceUpEvolveDeck, ex, leaderDefense: 10, ...SUPER } }).evolve("CP05-091", { sep: true });
    const s = superEvolve(["CP05-046", "CP05-109", "CP05-040"]);
    expect(s.decision?.type).toBe("selectPending");
    pendingAbility(s, 1).flush();
    expect([s.ex(), s.leader()]).toEqual([["CP05-T11"], 11]);
    // X = 2 (3 rounded up); with room for one in the EX area (CR 4.8.3.2): one element, the leader still +2.
    const two = superEvolve(["CP05-046", "CP05-032", "CP05-109"]).flush();
    expect([two.ex(), two.leader()]).toEqual([["CP05-T11", "CP05-T11"], 12]);
    const full = superEvolve(["CP05-046", "CP05-032", "CP05-109"], ["V1", "V1", "V1", "V1"]).flush();
    expect([full.ex(), full.leader()]).toEqual([["V1", "V1", "V1", "V1", "CP05-T11"], 12]);
  });

  it("093 狂恋の華鎧・ヴィーラ — Ward; 1 less damage with 7 max play points; Fanfare: a 光晶のエレメント", () => {
    const t = d({ me: { hand: ["CP05-093"], playPoints: 3 } }).play("CP05-093").none();
    expect([t.ex(), t.keywords("CP05-093")]).toEqual([["CP05-T13"], ["ward"]]);
    const fight = (maxPlayPoints: number) =>
      d({ me: { field: ["CP05-093"], maxPlayPoints }, opp: { field: [{ card: "V3", engaged: true }] } }).attack("CP05-093", "opp:V3");
    expect(fight(7).stats("CP05-093")).toEqual([3, 1]);
    expect(fight(6).field()).toEqual([]);
  });

  it("093 / 094 狂恋の華鎧・ヴィーラ — Evolve (1); evolved: Ward, 1 less damage; On Evolve: damage = light cards of the top 3, one to the hand", () => {
    const t = d({
      me: { field: ["CP05-093"], evolveDeck: ["CP05-094"], deck: ["CP05-097", "CP05-108", "V1", "V5"], playPoints: 1 },
      opp: { field: ["V5", "V3"] },
    });
    t.evolve("CP05-093").pick("opp:V5");
    // CP05-097 is light, CP05-108 全属性 (CR JP 14.6.2.2): 2 damage. One of the three must go to the hand (no "てよい"), any one.
    expect(candidates(t)).toEqual(["CP05-097", "CP05-108", "V1"]);
    expect(t.decision).toMatchObject({ min: 1, max: 1 });
    t.pick("V1").order();
    expect([t.stats("opp:V5"), t.hand(), t.zone("me", "deck"), t.keywords("CP05-093")]).toEqual([
      [5, 3],
      ["V1"],
      ["V5", "CP05-097", "CP05-108"],
      ["ward"],
    ]);
    // Q2921: without an enemy follower it isn't played, nothing is revealed.
    const none = d({ me: { field: ["CP05-093"], evolveDeck: ["CP05-094"], deck: ["CP05-097", "V1"], playPoints: 1 } }).evolve("CP05-093");
    expect([none.decision?.type, none.hand(), none.events.some((e) => e.type === "cardsRevealed")]).toEqual(["mainPhase", [], false]);
    const fight = d({ me: { field: [{ card: "CP05-093", evolvedInto: "CP05-094" }], maxPlayPoints: 7 }, opp: { field: [{ card: "V3", engaged: true }] } });
    expect([fight.attack("CP05-093", "opp:V3").stats("CP05-093"), fight.field("opp")]).toEqual([[4, 2], []]);
  });

  it("095 七宝石の姫・レ・フィーエ — Ward; your end phase: leader +1, or +3 with three 5-cost Granblue followers; Fanfare: banish, a 光晶のエレメント", () => {
    const t = d({ me: { hand: ["CP05-095"], playPoints: 5 }, opp: { field: ["V5", "V3"] } }).play("CP05-095").none().pick("opp:V5");
    expect([t.field("opp"), t.zone("opp", "banished"), t.ex(), t.keywords("CP05-095")]).toEqual([["V3"], ["V5"], ["CP05-T13"], ["ward"]]);
    // Q2918: without an enemy follower the Fanfare isn't played: no element.
    expect(d({ me: { hand: ["CP05-095"], playPoints: 5 } }).play("CP05-095").none().ex()).toEqual([]);
    // It counts itself; an evolved one by its base card's cost (CR 5.16.1.2: CP05-062 evolved into 063); CP05-097 costs 1.
    const end = (field: (string | FieldCardSpec)[]) => d({ me: { field, leaderDefense: 10 }, opp: { deck: ["V1"] } }).end().none().leader();
    expect(end(["CP05-095", "CP05-090", "CP05-099"])).toBe(13);
    expect(end(["CP05-095", "CP05-099", { card: "CP05-062", evolvedInto: "CP05-063" }])).toBe(13);
    expect(end(["CP05-095", "CP05-090", "CP05-097"])).toBe(11);
  });

  it("096 シュヴァリエ・マグナ — Fanfare: reveal the top card, a light one: max PP +1; act with three 5-cost Granblue followers: an element, draw", () => {
    // CP05-110 is 全属性: light too (CR JP 14.6.2.2). The revealed card stays on top (CR 5.21.1).
    const maxPP = (t: Driver) => t.game.state.players[0].maxPlayPoints;
    const t = d({ me: { hand: ["CP05-096"], deck: ["CP05-110", "V1"], playPoints: 3 } }).play("CP05-096");
    expect([maxPP(t), t.zone("me", "deck"), t.events.some((e) => e.type === "cardsRevealed")]).toEqual([4, ["CP05-110", "V1"], true]);
    // Q2912: not a light card, no +1.
    expect(maxPP(d({ me: { hand: ["CP05-096"], deck: ["V1"], playPoints: 3 } }).play("CP05-096"))).toBe(3);
    const act = d({ me: { field: ["CP05-096", "CP05-090", "CP05-095", "CP05-099"], deck: ["V1"] } }).activate("CP05-096");
    expect([act.field(), act.cemetery(), act.ex(), act.hand()]).toEqual([["CP05-090", "CP05-095", "CP05-099"], ["CP05-096"], ["CP05-T13"], ["V1"]]);
    expect(d({ me: { field: ["CP05-096", "CP05-090", "CP05-095", "CP05-097"] } }).canActivate("CP05-096")).toBe(false);
    // The cost engages it too (CR 10.4.6): an engaged one can't pay it.
    expect(d({ me: { field: [{ card: "CP05-096", engaged: true }, "CP05-090", "CP05-095", "CP05-099"] } }).canActivate("CP05-096")).toBe(false);
  });

  it("097 / 098 魔杖の外科医・ティコ — Evolve (1); Fanfare and On Evolve: a 光晶のエレメント; with a 5-cost Granblue follower, leader +2", () => {
    const t = d({ me: { hand: ["CP05-097"], field: ["CP05-099"], playPoints: 1 } }).play("CP05-097");
    expect([t.ex(), t.leader()]).toEqual([["CP05-T13"], 22]);
    const alone = d({ me: { hand: ["CP05-097"], playPoints: 1 } }).play("CP05-097");
    expect([alone.ex(), alone.leader()]).toEqual([["CP05-T13"], 20]);
    const e = d({ me: { field: ["CP05-097", "CP05-095"], evolveDeck: ["CP05-098"], playPoints: 1 } }).evolve("CP05-097");
    expect([e.ex(), e.leader(), e.stats("CP05-097")]).toEqual([["CP05-T13"], 22, [2, 2]]);
    // Evolved, it still costs 1 (CR 5.16.1.2): it doesn't count itself.
    const ev = d({ me: { field: ["CP05-097"], evolveDeck: ["CP05-098"], playPoints: 1 } }).evolve("CP05-097");
    expect([ev.ex(), ev.leader()]).toEqual([["CP05-T13"], 20]);
  });

  it("099 星界の艇人・ノア — Ward; Fanfare: +X/+X, X = your max play points", () => {
    const t = d({ me: { hand: ["CP05-099"], playPoints: 5, maxPlayPoints: 6 } }).play("CP05-099").none();
    expect([t.stats("CP05-099"), t.keywords("CP05-099")]).toEqual([[7, 7], ["ward"]]);
  });

  it("100 天象の風・ペトラ — Fanfare: an enemy follower doesn't refresh in its next start phase; a 風晶のエレメント", () => {
    const t = d({
      me: { hand: ["CP05-100"], playPoints: 1 },
      opp: { field: [{ card: "V5", engaged: true }, { card: "V3", engaged: true }], deck: ["V1"] },
    });
    t.play("CP05-100").pick("opp:V5");
    expect(t.ex()).toEqual(["CP05-T12"]);
    t.end();
    expect([t.engaged("opp:V5"), t.engaged("opp:V3")]).toEqual([true, false]);
    // Q2919: without an enemy follower the Fanfare isn't played: no element.
    expect(d({ me: { hand: ["CP05-100"], playPoints: 1 } }).play("CP05-100").ex()).toEqual([]);
  });

  it("101 星跡の巡礼者・ソフィア — Ward; Fanfare: a 水晶のエレメント; Q act (3), discard this from your hand: draw 2", () => {
    const t = d({ me: { hand: ["CP05-101"], playPoints: 4 } }).play("CP05-101").none();
    expect([t.ex(), t.keywords("CP05-101")]).toEqual([["CP05-T10"], ["ward"]]);
    // Q2920: the Q act works in the hand (CR 10.3.5), not on the field.
    const h = d({ me: { hand: ["CP05-101"], deck: ["V1", "V3"], playPoints: 3 } }).activate("CP05-101");
    expect([h.cemetery(), h.hand(), h.pp()]).toEqual([["CP05-101"], ["V1", "V3"], 0]);
    expect(d({ me: { field: ["CP05-101"], playPoints: 3 } }).canActivate("CP05-101")).toBe(false);
    // At Quick timing, in the opponent's turn (CR 12.3.3).
    const q = d({ turn: 6, me: { hand: ["CP05-101"], deck: ["V1", "V3"], playPoints: 3 }, opp: { field: ["V1"] } });
    expect(q.attack("opp:V1", "leader").quick("CP05-101").hand()).toEqual(["V1", "V3"]);
  });

  it("101 / 102 星跡の巡礼者・ソフィア — Evolve (1); evolved: Ward; On Evolve: a follower of cost 3 or less with a Q act from the deck", () => {
    // CP05-101 costs 4, CP05-097 has no Q act; BP02-027 (2-cost, a Q act) is one too, and so is CP05-111, whose Q act works
    // only in the hand: the printed ability counts, wherever it works (CR 10.3.5).
    const deck = ["CP05-089", "CP05-101", "CP05-111", "CP05-103", "CP05-097", "BP02-027"];
    const t = d({ me: { field: ["CP05-101"], evolveDeck: ["CP05-102"], deck, playPoints: 1 } });
    t.evolve("CP05-101");
    expect(candidates(t)).toEqual(["CP05-089", "CP05-111", "CP05-103", "BP02-027"]);
    t.pick("CP05-089").none();
    expect([t.field(), t.stats("CP05-101"), t.keywords("CP05-101")]).toEqual([["CP05-101", "CP05-089"], [4, 4], ["ward"]]);
  });

  it("103 英雄幻視・トルー — Ward; Fanfare: a 水晶のエレメント, draw; Q act, engage: a 水晶のエレメント", () => {
    const t = d({ me: { hand: ["CP05-103"], deck: ["V1"], playPoints: 2 } }).play("CP05-103").none();
    expect([t.ex(), t.hand(), t.keywords("CP05-103")]).toEqual([["CP05-T10"], ["V1"], ["ward"]]);
    // It may engage the turn it came in (CR 10.4.6.1), not again once engaged.
    t.activate("CP05-103");
    expect([t.ex(), t.engaged("CP05-103"), t.canActivate("CP05-103")]).toEqual([["CP05-T10", "CP05-T10"], true, false]);
    // The Q act at Quick timing, in the opponent's turn (CR 12.3.3).
    const q = d({ turn: 6, me: { field: ["CP05-103"] }, opp: { field: ["V1"] } });
    q.attack("opp:V1", "leader").quick("CP05-103");
    expect([q.ex(), q.engaged("CP05-103")]).toEqual([["CP05-T10"], true]);
  });

  it("104 アフェクション・オース — Quick; 2 damage, a 光晶のエレメント; may discard a 5-cost Granblue follower: search a 狂恋の華鎧・ヴィーラ", () => {
    const t = d({ me: { hand: ["CP05-104", "CP05-099", "CP05-095", "V5"], deck: ["V1", "CP05-093"], playPoints: 1 }, opp: { field: ["V5", "V3"] } });
    t.play("CP05-104").pick("opp:V3").yes();
    // Only Granblue followers of original cost 5: not V5.
    expect(candidates(t)).toEqual(["CP05-099", "CP05-095"]);
    t.pick("CP05-095").pick("CP05-093");
    expect([t.stats("opp:V3"), t.ex(), t.cemetery(), t.hand()]).toEqual([
      [3, 2],
      ["CP05-T13"],
      ["CP05-095", "CP05-104"],
      ["CP05-099", "V5", "CP05-093"],
    ]);
    const no = d({ me: { hand: ["CP05-104", "CP05-099"], deck: ["CP05-093"], playPoints: 1 }, opp: { field: ["V5"] } }).play("CP05-104").no();
    expect([no.hand(), no.zone("me", "deck"), no.ex()]).toEqual([["CP05-099"], ["CP05-093"], ["CP05-T13"]]);
    // Q2922: without an enemy follower it can't be played.
    expect(d({ me: { hand: ["CP05-104"], playPoints: 1 } }).canPlay("CP05-104")).toBe(false);
    // Quick: in the opponent's turn.
    const q = d({ turn: 6, me: { hand: ["CP05-104"], playPoints: 1 }, opp: { field: ["V1"] } });
    expect(q.attack("opp:V1", "leader").quick("CP05-104").field("opp")).toEqual([]);
  });
});
