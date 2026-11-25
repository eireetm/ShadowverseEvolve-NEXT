import { describe, expect, it } from "vitest";
import { drive, type Driver, type DriveSpec } from "../../../src/testing";
import { cardEngine } from "../../helpers";

// CP05 Forestcraft (001–018, T01, T02). CP05 (Granblue Fantasy) is a pre-release set: its cards have their Japanese names.
// V1 is 1c 2/2, V3 3c 3/4, V5 5c 5/5 (Neutral). Treasures in the EX area (CR JP 14.6.4): T09 火晶, T10 水晶, T11 土晶, T12 風晶,
// T13 光晶, T14 闇晶 — an element uncaps a follower of its attribute, or final-uncaps instead one already uncapped with Final
// Uncap; T15 ヒヒイロカネ uncaps a Granblue follower and also final-uncaps one with Final Uncap. 001 ソーン has Final Uncap: it
// stands in for CP05-110 ルリア of the rulings. CP05-108 ビィ is 全属性 (every attribute, CR JP 14.6.2.2).
const E = cardEngine();
const d = (spec: DriveSpec) => drive(E, spec);
const n = (count: number, id: string) => Array<string>(count).fill(id);
const SUPER = { superEvolutionPoints: 1, turnsPassed: 8 };
/** Earth evolved followers (Swordcraft, Runecraft) for 015. */
const EARTH = ["CP05-032", "CP05-042", "CP05-046"];

/** Play first the pending ability that is ability `index` of its card's script (two abilities of one card: either order). */
function pendingAbility(t: Driver, index: number): Driver {
  const options = t.decision?.type === "selectPending" ? t.decision.options : [];
  const pending = t.game.state.pending.find((p) => p.ability === index && options.includes(p.id));
  if (!pending) throw new Error(`no pending ability #${index}`);
  return t.answer({ type: "selectPending", id: pending.id });
}

/** ヒヒイロカネ on 001 (not uncapped): it uncaps and final-uncaps it — 2 events; 001 draws 2 (V1, V3) and discards V1, gains Storm. */
function hihiirokaneOnThorn(t: Driver, target = false): Driver {
  t.activate("CP05-T15");
  if (target) t.pick("CP05-001");
  return t.flush().pick("V1");
}

describe("CP05 Forestcraft", () => {
  it("001 魔眼の狩人・ソーン — when playing it, engage 2 reserved Granblue followers of original cost 5 on your field: costs 5 less", () => {
    const t = d({ me: { hand: ["CP05-001"], field: ["CP05-001", "CP05-001"], playPoints: 0 } }).play("CP05-001");
    expect([t.field(), t.ids("CP05-001@field").map((id) => t.game.state.cards[id]!.engaged), t.pp()]).toEqual([
      n(3, "CP05-001"),
      [true, true, false],
      0,
    ]);
    // An engaged one, one that isn't Granblue, or a Granblue one of another original cost (011: 4) can't pay it.
    const others = d({ me: { hand: ["CP05-001"], field: ["CP05-001", { card: "CP05-001", engaged: true }, "V5", "CP05-011"], playPoints: 0 } });
    expect(others.canPlay("CP05-001")).toBe(false);
    const normal = d({ me: { hand: ["CP05-001"], field: ["CP05-001", "CP05-001"], playPoints: 5 } }).play("CP05-001").choose("normal");
    expect([normal.pp(), normal.engaged("CP05-001")]).toEqual([0, false]);
  });

  it("001 魔眼の狩人・ソーン — Final Uncap; uncapped: draw 2, discard 1; final-uncapped: Storm; ヒヒイロカネ does both, either first (Q2867, Q2868)", () => {
    const u = d({ me: { field: ["CP05-001"], ex: ["CP05-T13"], deck: ["V1", "V3"] } }).activate("CP05-T13");
    expect(u.decision).toMatchObject({ type: "selectCards", reason: "discard", min: 1, max: 1 }); // the discard isn't optional
    u.pick("V1");
    expect([u.hand(), u.cemetery(), u.stats("CP05-001"), u.keywords("CP05-001")]).toEqual([["V3"], ["V1"], [4, 3], ["finalUncap"]]);
    // An element on it once uncapped final-uncaps it instead: only the second triggers.
    const f = d({ me: { field: [{ card: "CP05-001", enteredThisTurn: true, uncappedWith: [{ card: "CP05-T13", uncaps: ["uncap"] }] }], ex: ["CP05-T13"], deck: ["V1"] } });
    expect(f.attackTargets("CP05-001")).toEqual([]);
    f.activate("CP05-T13");
    expect([f.hand(), f.stats("CP05-001"), f.keywords("CP05-001"), f.attackTargets("CP05-001")]).toEqual([[], [5, 4], ["finalUncap", "storm"], ["opp:leader"]]);
    // Q2867 / Q2868: ヒヒイロカネ triggers both; here the final uncap's resolves first.
    const h = d({ me: { field: ["CP05-001"], ex: ["CP05-T15"], deck: ["V1", "V3"] } }).activate("CP05-T15");
    pendingAbility(h, 1);
    expect(h.keywords("CP05-001")).toEqual(["finalUncap", "storm"]);
    h.pick("V3");
    expect([h.hand(), h.stats("CP05-001"), h.zone("me", "uncapZone")]).toEqual([["V1"], [5, 4], ["CP05-T15"]]);
    // On one already uncapped, ヒヒイロカネ only final-uncaps it (decided by the project owner): no draw.
    const o = d({ me: { field: [{ card: "CP05-001", uncappedWith: [{ card: "CP05-T13", uncaps: ["uncap"] }] }], ex: ["CP05-T15"], deck: ["V1"] } });
    o.activate("CP05-T15");
    expect([o.hand(), o.keywords("CP05-001"), o.game.reader().uncapsThisTurn(0)]).toEqual([[], ["finalUncap", "storm"], 1]);
  });

  it("002 調和の舞手・ユエル＆ソシエ — Fanfare, reveal 3 fire cards (全属性 too): 3 to an enemy follower and 3 to its leader, nothing without one (Q2870); quick act from the hand (Q2869), in either player's turn, after another quick activated ability", () => {
    const t = d({ me: { hand: ["CP05-002", "CP05-013", "CP05-013", "CP05-108", "V1"], playPoints: 3 }, opp: { field: ["V5", "V3"] } });
    t.play("CP05-002").yes().pick("opp:V5");
    expect([t.stats("opp:V5"), t.leader("opp"), t.hand()]).toEqual([[5, 2], 17, ["CP05-013", "CP05-013", "CP05-108", "V1"]]);
    const no = d({ me: { hand: ["CP05-002", "CP05-013", "CP05-013", "CP05-013"], playPoints: 3 }, opp: { field: ["V5"] } }).play("CP05-002").no();
    expect(no.leader("opp")).toBe(20);
    const none = d({ me: { hand: ["CP05-002", "CP05-013", "CP05-013", "CP05-013"], playPoints: 3 } }).play("CP05-002");
    expect([none.leader("opp"), none.decision?.type]).toEqual([20, "mainPhase"]);
    const q = d({ me: { hand: ["CP05-002", "CP05-009"], playPoints: 2 }, opp: { field: ["V5", "V3"] } });
    expect(q.canActivate("CP05-002")).toBe(false);
    q.activate("CP05-009");
    q.activate("CP05-002").pick("opp:V5");
    expect([q.stats("opp:V5"), q.leader("opp"), q.cemetery(), q.pp()]).toEqual([[5, 1], 18, ["CP05-009", "CP05-002"], 0]);
    // Quick: in the opponent's turn too, after their follower attacks (CR 12.3.4), once 009's was played in that window (CR 8.4.8).
    const o = d({ turn: 6, me: { hand: ["CP05-002", "CP05-009"], playPoints: 2 }, opp: { field: ["V5", "V1"] } }).attack("opp:V1", "leader");
    o.quick("CP05-009").quick("CP05-002").pick("opp:V5");
    expect([o.stats("opp:V5"), o.leader("opp"), o.cemetery(), o.leader()]).toEqual([[5, 1], 18, ["CP05-009", "CP05-002"], 18]);
  });

  it("003 / 004 風の理・イーウィヤ — Fanfare: a wind element (none into a full EX area); evolved: a wind element and a draw; super-evolved: a ヒヒイロカネ and a draw too, either first (Q2871, Q2872)", () => {
    expect(d({ me: { hand: ["CP05-003"], playPoints: 1 } }).play("CP05-003").ex()).toEqual(["CP05-T12"]);
    expect(d({ me: { hand: ["CP05-003"], ex: n(5, "V1"), playPoints: 1 } }).play("CP05-003").ex()).toEqual(n(5, "V1"));
    const e = d({ me: { field: ["CP05-003"], evolveDeck: ["CP05-004"], deck: ["V1", "V3"], playPoints: 1 } }).evolve("CP05-003");
    expect([e.ex(), e.hand(), e.stats("CP05-003")]).toEqual([["CP05-T12"], ["V1"], [2, 2]]);
    const s = d({ me: { field: ["CP05-003"], evolveDeck: ["CP05-004"], deck: ["V1", "V3"], ...SUPER } }).evolve("CP05-003", { sep: true });
    pendingAbility(s, 1);
    expect([s.ex(), s.hand(), s.stats("CP05-003")]).toEqual([["CP05-T15", "CP05-T12"], ["V1", "V3"], [3, 3]]);
  });

  it("005 / 006 絢爛の紡ぎ手・コルワ — Fanfare: a wind element; end phase: a フィル after 3 uncaps this turn, ヒヒイロカネ's two counting (Q2873); evolved: a 1-cost wind card from the deck", () => {
    expect(d({ me: { hand: ["CP05-005"], playPoints: 2 } }).play("CP05-005").ex()).toEqual(["CP05-T12"]);
    // Q2873 (ルリア in the ruling): ヒヒイロカネ on 001 counts 2, the wind element on this 1.
    const t = hihiirokaneOnThorn(d({ me: { field: ["CP05-005", "CP05-001"], ex: ["CP05-T15", "CP05-T12"], deck: ["V1", "V3"] }, opp: { deck: ["V1"] } }), true);
    expect(t.activate("CP05-T12").end().ex()).toEqual(["CP05-T02"]);
    const two = d({ me: { field: ["CP05-005", "CP05-013"], ex: ["CP05-T12", "CP05-T09"] }, opp: { deck: ["V1"] } });
    expect(two.activate("CP05-T12").activate("CP05-T09").end().ex()).toEqual([]);
    // The 1-cost wind cards: not the 2-cost one, and a 全属性 one too.
    const e = d({ me: { field: ["CP05-005"], evolveDeck: ["CP05-006"], deck: ["CP05-005", "CP05-003", "CP05-108", "V1"], playPoints: 1 } });
    expect(e.evolve("CP05-005").decision).toMatchObject({ type: "selectCards", candidateDefs: ["CP05-003", "CP05-108"] });
    expect(e.pick("CP05-108").hand()).toEqual(["CP05-108"]);
    const f = d({
      me: { field: [{ card: "CP05-005", evolvedInto: "CP05-006" }, "CP05-013", "CP05-009"], ex: ["CP05-T12", "CP05-T09", "CP05-T10"] },
      opp: { deck: ["V1"] },
    });
    expect(f.activate("CP05-T12").activate("CP05-T09").activate("CP05-T10").end().ex()).toEqual(["CP05-T02"]);
  });

  it("007 奮励の儁秀・シルヴァ — Storm; uncapped: up to 2 followers with a quick activated ability from the cemetery, original costs 6 or less in all; quick act from the hand: 4 damage (Q2874), in the opponent's turn too", () => {
    const t = d({ me: { field: ["CP05-007"], ex: ["CP05-T10"], cemetery: ["CP05-009", "CP05-007", "CP05-002", "CP05-008", "V1"] } });
    t.activate("CP05-T10");
    expect(t.decision).toMatchObject({ type: "selectCards", candidateDefs: ["CP05-009", "CP05-002", "CP05-008"] });
    t.pick("CP05-002");
    expect(t.decision).toMatchObject({ type: "selectCards", candidateDefs: ["CP05-009", "CP05-008"] });
    t.pick("CP05-008").flush();
    expect([t.field(), t.cemetery(), t.ex(), t.keywords("CP05-007")]).toEqual([
      ["CP05-007", "CP05-002", "CP05-008"],
      ["CP05-009", "CP05-007", "V1"],
      ["CP05-T10"],
      ["storm"],
    ]);
    const q = d({ me: { hand: ["CP05-007"], playPoints: 2 }, opp: { field: ["V5", "V3"] } }).activate("CP05-007").pick("opp:V5");
    expect([q.stats("opp:V5"), q.cemetery(), q.pp()]).toEqual([[5, 1], ["CP05-007"], 0]);
    // Quick: in the opponent's turn too, after their follower attacks (CR 12.3.4).
    const o = d({ turn: 6, me: { hand: ["CP05-007"], playPoints: 2 }, opp: { field: ["V5", "V1"] } }).attack("opp:V1", "leader");
    o.quick("CP05-007").pick("opp:V5");
    expect([o.stats("opp:V5"), o.cemetery(), o.pp(), o.leader()]).toEqual([[5, 1], ["CP05-007"], 0, 18]);
  });

  it("008 虹色の弓使い・クピタン — Fanfare: a water element; quick act, engage: 1 damage, or with 7 quick-activated followers in the cemetery 7 and 2 to its leader; not without an enemy follower (Q2875)", () => {
    expect(d({ me: { hand: ["CP05-008"], playPoints: 2 } }).play("CP05-008").ex()).toEqual(["CP05-T10"]);
    const six = d({ me: { field: ["CP05-008"], cemetery: n(6, "CP05-009") }, opp: { field: ["V5", "V3"] } }).activate("CP05-008").pick("opp:V5");
    expect([six.stats("opp:V5"), six.leader("opp"), six.engaged("CP05-008")]).toEqual([[5, 4], 20, true]);
    const seven = d({ me: { field: ["CP05-008"], cemetery: n(7, "CP05-009") }, opp: { field: ["V5", "V3"] } }).activate("CP05-008").pick("opp:V5");
    expect([seven.field("opp"), seven.leader("opp")]).toEqual([["V3"], 18]);
    expect(d({ me: { field: ["CP05-008"], cemetery: n(7, "CP05-009") } }).canActivate("CP05-008")).toBe(false);
    // In the opponent's turn, after their follower attacks (CR 12.3.4).
    const q = d({ turn: 6, me: { field: ["CP05-008"] }, opp: { field: ["V1"] } }).attack("opp:V1", "leader").quick("CP05-008");
    expect([q.stats("opp:V1"), q.engaged("CP05-008"), q.leader()]).toEqual([[2, 1], true, 18]);
  });

  it("009 / 010 清新なる銃設計士・ククル — Fanfare: a クムユ with 7 quick-activated followers in the cemetery; quick act from the hand: 2 to the enemy leader (Q2876); evolved: 2 damage", () => {
    expect(d({ me: { hand: ["CP05-009"], cemetery: n(7, "CP05-008"), playPoints: 2 } }).play("CP05-009").field()).toEqual(["CP05-009", "CP05-T01"]);
    expect(d({ me: { hand: ["CP05-009"], cemetery: n(6, "CP05-008"), playPoints: 2 } }).play("CP05-009").field()).toEqual(["CP05-009"]);
    const q = d({ me: { hand: ["CP05-009"], playPoints: 1 } }).activate("CP05-009");
    expect([q.leader("opp"), q.cemetery(), q.pp()]).toEqual([18, ["CP05-009"], 0]);
    const e = d({ me: { field: ["CP05-009"], evolveDeck: ["CP05-010"], playPoints: 1 }, opp: { field: ["V5", "V3"] } }).evolve("CP05-009").pick("opp:V3");
    expect([e.stats("opp:V3"), e.stats("CP05-009")]).toEqual([[3, 2], [3, 3]]);
    expect(d({ me: { field: ["CP05-009"], evolveDeck: ["CP05-010"], playPoints: 1 } }).evolve("CP05-009").decision?.type).toBe("mainPhase");
  });

  it("011 天禀の射手・メーテラ — uncapped: 5 damage to an enemy follower; end phase: 5 to the enemy leader after 3 uncaps this turn (Q2877)", () => {
    const t = d({ me: { field: ["CP05-011"], ex: ["CP05-T12"] }, opp: { field: ["V5", "V3"], deck: ["V1"] } }).activate("CP05-T12").pick("opp:V5");
    expect(t.field("opp")).toEqual(["V3"]);
    expect(t.end().leader("opp")).toBe(20);
    // Q2877 (ルリア in the ruling): ヒヒイロカネ on 001 counts 2, the wind element on this 1.
    const q = hihiirokaneOnThorn(d({ me: { field: ["CP05-011", "CP05-001"], ex: ["CP05-T15", "CP05-T12"], deck: ["V1", "V3"] }, opp: { field: ["V5"], deck: ["V1"] } }), true);
    q.activate("CP05-T12").end();
    expect([q.field("opp"), q.leader("opp")]).toEqual([[], 15]);
  });

  it("012 美粧の乙女・クロエ — Fanfare, discard a dark card: draw; act (not quick), engage: a dark card (全属性 too) from the cemetery to the bottom of the deck", () => {
    const t = d({ me: { hand: ["CP05-012", "CP05-017", "V1"], deck: ["V3"], playPoints: 1 } }).play("CP05-012").yes();
    expect([t.hand(), t.cemetery()]).toEqual([["V1", "V3"], ["CP05-017"]]);
    expect(d({ me: { hand: ["CP05-012", "CP05-017"], deck: ["V3"], playPoints: 1 } }).play("CP05-012").no().hand()).toEqual(["CP05-017"]);
    const a = d({ me: { field: ["CP05-012"], cemetery: ["CP05-017", "CP05-108", "V1"], deck: ["V3"] } }).activate("CP05-012").pick("CP05-108");
    expect([a.zone("me", "deck"), a.cemetery(), a.engaged("CP05-012")]).toEqual([["V3", "CP05-108"], ["CP05-017", "V1"], true]);
    expect(d({ me: { field: ["CP05-012"], cemetery: ["V1", "CP05-013"] } }).canActivate("CP05-012")).toBe(false);
    // No quick window for it in the opponent's turn.
    const opp = d({ turn: 6, me: { field: ["CP05-012"], cemetery: ["CP05-017"] }, opp: { field: ["V1"] } }).attack("opp:V1", "leader");
    expect([opp.decision?.type, opp.leader()]).toEqual(["mainPhase", 18]);
  });

  it("013 / 014 緋焔の踊り子・アンスリア — Fanfare, reveal 3 fire cards: a fire element and leader +2; evolved: 3 damage and a fire element, neither without an enemy follower (Q2878)", () => {
    const t = d({ me: { hand: ["CP05-013", "CP05-002", "CP05-013", "CP05-108"], leaderDefense: 10, playPoints: 3 } }).play("CP05-013").yes();
    expect([t.ex(), t.leader(), t.hand()]).toEqual([["CP05-T09"], 12, ["CP05-002", "CP05-013", "CP05-108"]]);
    const two = d({ me: { hand: ["CP05-013", "CP05-002", "CP05-013"], playPoints: 3 } }).play("CP05-013");
    expect([two.decision?.type, two.ex()]).toEqual(["mainPhase", []]);
    const e = d({ me: { field: ["CP05-013"], evolveDeck: ["CP05-014"], playPoints: 1 }, opp: { field: ["V5", "V3"] } }).evolve("CP05-013").pick("opp:V3");
    expect([e.stats("opp:V3"), e.ex()]).toEqual([[3, 1], ["CP05-T09"]]);
    expect(d({ me: { field: ["CP05-013"], evolveDeck: ["CP05-014"], playPoints: 1 } }).evolve("CP05-013").ex()).toEqual([]);
  });

  it("015 フォレストレンジャー・ウェルダー — with 4 faceup earth evolved followers (全属性 too): Rush and 'Strike: an earth element'; Fanfare: an earth element, and may turn one faceup", () => {
    const t = d({
      me: { hand: ["CP05-015"], faceUpEvolveDeck: EARTH, evolveDeck: ["CP05-109", "CP05-010"], playPoints: 1 },
      opp: { field: [{ card: "V5", engaged: true }] },
    });
    expect(t.keywords("CP05-015")).toEqual([]);
    // Up to 1 facedown earth evolved follower: the 全属性 109, not the water 010.
    expect(t.play("CP05-015").decision).toMatchObject({ type: "selectCards", candidateDefs: ["CP05-109"], min: 0, max: 1 });
    t.pick("CP05-109");
    expect([t.ex(), t.keywords("CP05-015"), t.attackTargets("CP05-015")]).toEqual([["CP05-T11"], ["rush"], ["V5"]]);
    expect(t.attack("CP05-015", "opp:V5").ex()).toEqual(["CP05-T11", "CP05-T11"]);
    // With 3 the Strike isn't there.
    const three = d({ me: { field: ["CP05-015"], faceUpEvolveDeck: EARTH }, opp: { field: [{ card: "V5", engaged: true }] } });
    expect(three.keywords("CP05-015")).toEqual([]);
    expect(three.attack("CP05-015", "opp:V5").ex()).toEqual([]);
    const declined = d({ me: { hand: ["CP05-015"], faceUpEvolveDeck: EARTH, evolveDeck: ["CP05-109"], playPoints: 1 } }).play("CP05-015").none();
    expect([declined.keywords("CP05-015"), declined.game.reader().faceDownEvolveDeck(0).length]).toEqual([[], 1]);
    // A passive of the field (CR 10.3.5): no Rush in the hand.
    expect(d({ me: { hand: ["CP05-015"], faceUpEvolveDeck: [...EARTH, "CP05-109"] } }).keywords("CP05-015")).toEqual([]);
  });

  it("016 愛憎の舞手・コウ＆ヨウ — Rush, Assail; Strike: reveal the top card, a 5-cost Granblue follower onto the field, anything else into the hand (not drawn)", () => {
    const t = d({ me: { field: ["CP05-016"], deck: ["CP05-001", "V1"] }, opp: { field: ["V3"] } }).attack("CP05-016", "opp:V3");
    expect([t.field(), t.zone("me", "deck"), t.keywords("CP05-016")]).toEqual([["CP05-016", "CP05-001"], ["V1"], ["rush", "assail"]]);
    // Into the hand, not drawn (CR 5.10): a 5-cost follower that isn't Granblue, a Granblue follower of another original cost,
    // a 5-cost Granblue spell (CP05-026).
    for (const top of ["V5", "CP05-003", "CP05-026"]) {
      const h = d({ me: { field: ["CP05-016"], deck: [top, "V1"] }, opp: { field: ["V3"] } }).attack("CP05-016", "opp:V3");
      const toHand = h.events.flatMap((e) => (e.type === "cardsMoved" ? e.moves : [])).filter((m) => m.to.zone === "hand");
      expect([h.hand(), h.zone("me", "deck"), h.field(), toHand.map((m) => m.reason)]).toEqual([[top], ["V1"], ["CP05-016"], ["effect"]]);
    }
    // A full field: it stays on top of the deck.
    const full = d({ me: { field: ["CP05-016", "V1", "V1", "V1", "V1"], deck: ["CP05-001"] }, opp: { field: ["V3"] } }).attack("CP05-016", "opp:V3");
    expect([full.hand(), full.zone("me", "deck")]).toEqual([[], ["CP05-001"]]);
  });

  it("017 カワイイ花マル・マナマル — uncapped, discard a dark card: draw; end phase: select an enemy follower, 2 to it and 1 to its leader if you discarded a dark card this turn; not without one (Q2879)", () => {
    const t = d({ me: { field: ["CP05-017"], hand: ["CP05-012", "V1"], ex: ["CP05-T14"], deck: ["V3"] }, opp: { field: ["V5", "V3"], deck: ["V1"] } });
    t.activate("CP05-T14").yes();
    expect([t.hand(), t.cemetery()]).toEqual([["V1", "V3"], ["CP05-012"]]);
    t.end().pick("opp:V3");
    expect([t.stats("opp:V3"), t.leader("opp")]).toEqual([[3, 2], 19]);
    // Nothing discarded: the follower is selected, nothing more.
    const none = d({ me: { field: ["CP05-017"] }, opp: { field: ["V3"], deck: ["V1"] } }).end();
    expect([none.stats("opp:V3"), none.leader("opp")]).toEqual([[3, 4], 20]);
    // Only a card that isn't dark discarded (009, water, discarding itself for its quick ability: 2 to the leader): nothing more.
    const water = d({ me: { field: ["CP05-017"], hand: ["CP05-009"], playPoints: 1 }, opp: { field: ["V3"], deck: ["V1"] } });
    water.activate("CP05-009").end();
    expect([water.stats("opp:V3"), water.leader("opp")]).toEqual([[3, 4], 18]);
    // A 全属性 card discarded by CP05-012's Fanfare counts.
    const all = d({ me: { field: ["CP05-017"], hand: ["CP05-012", "CP05-108"], deck: ["V1"], playPoints: 1 }, opp: { field: ["V3"], deck: ["V1"] } });
    all.play("CP05-012").yes().end();
    expect([all.stats("opp:V3"), all.leader("opp")]).toEqual([[3, 2], 19]);
    // Q2879: without an enemy follower, no leader damage either.
    const q = d({ me: { field: ["CP05-017"], hand: ["CP05-012", "CP05-017"], deck: ["V1"], playPoints: 1 }, opp: { deck: ["V1"] } });
    expect(q.play("CP05-012").yes().end().leader("opp")).toBe(20);
  });

  it("018 箒星 — X less, X = uncaps this turn (ヒヒイロカネ's both: 2, Q2880); 4 damage and a wind element, not playable without an enemy follower (Q2881)", () => {
    expect(d({ me: { hand: ["CP05-018"], playPoints: 2 }, opp: { field: ["V5"] } }).canPlay("CP05-018")).toBe(false);
    const t = hihiirokaneOnThorn(d({ me: { hand: ["CP05-018"], field: ["CP05-001"], ex: ["CP05-T15"], deck: ["V1", "V3"], playPoints: 1 }, opp: { field: ["V5", "V3"] } }));
    t.play("CP05-018").pick("opp:V5");
    expect([t.stats("opp:V5"), t.ex(), t.pp()]).toEqual([[5, 1], ["CP05-T12"], 0]);
    expect(d({ me: { hand: ["CP05-018"], playPoints: 3 } }).canPlay("CP05-018")).toBe(false);
  });

  it("T01 ガンパウダーミキサー・クムユ — Rush, Assail; Last Words: 2 damage to each enemy leader", () => {
    const t = d({ me: { field: [{ card: "CP05-T01", enteredThisTurn: true }], hand: ["QUICK-SAC"] }, opp: { field: ["V3"] } });
    expect([t.keywords("CP05-T01"), t.attackTargets("CP05-T01")]).toEqual([["rush", "assail"], ["V3"]]);
    t.play("QUICK-SAC");
    expect([t.field(), t.leader("opp")]).toEqual([[], 18]);
  });

  it("T02 フィル — played from the EX area: +2/+2 to a Granblue follower on your field; not without one", () => {
    const t = d({ me: { field: ["CP05-003", "V1"], ex: ["CP05-T02"] } }).play("CP05-T02@ex");
    expect([t.stats("CP05-003"), t.stats("V1"), t.ex(), t.cemetery()]).toEqual([[3, 3], [2, 2], [], []]);
    expect(d({ me: { field: ["V1"], ex: ["CP05-T02"] } }).canPlay("CP05-T02@ex")).toBe(false);
  });
});
