import { describe, expect, it } from "vitest";
import { drive, type Driver, type DriveSpec } from "../../../src/testing";
import { cardEngine } from "../../helpers";

// CP05 Dragoncraft (054–071). Pre-release cards with Japanese names (data/preview.ts), implemented from the Japanese text.
// Treasures (CR JP 14.6.1): CP05-T09 火晶 / T11 土晶 / T12 風晶 / T13 光晶 / T14 闇晶のエレメント (uncap, or final-uncap instead an
// uncapped follower with Final Uncap), T15 ヒヒイロカネ (uncap, and also final-uncap one with Final Uncap). Earth evolved
// followers for the evolve deck: CP05-032, 046, 092 (土属性), CP05-042 (土属性・光属性・闇属性) and CP05-109 (全属性, earth too:
// CR JP 14.6.2.2); CP05-108 is a 全属性 follower card, CP05-074 a 闇属性 follower of cost 3, CP05-079 a 闇属性 amulet of cost 1.
// V1 is 1c 2/2, V3 3c 3/4, V5 5c 5/5; BP02-065 Dragontamer (Fanfare: draw, then discard), BP06-118 (Fanfare: the opponent
// reveals their hand).
const E = cardEngine();
const d = (spec: DriveSpec) => drive(E, spec);
const SUPER = { superEvolutionPoints: 1, turnsPassed: 8 };
const def = (t: Driver, id: string) => t.game.state.cards[id]!.def;
/** The faceup cards of my evolve deck. */
const faceUp = (t: Driver) => t.game.reader().faceUpEvolveDeck(0).map((id) => def(t, id));
/** The candidates of the card selection asked now. */
const candidates = (t: Driver) => (t.decision?.type === "selectCards" ? t.decision.candidates.map((id) => def(t, id)) : null);
/** [the fewest, the most] cards the card selection asked now takes. */
const bounds = (t: Driver) => (t.decision?.type === "selectCards" ? [t.decision.min, t.decision.max] : null);
/** Every card revealed so far (CR 5.21). */
const revealed = (t: Driver) => t.events.flatMap((e) => (e.type === "cardsRevealed" ? e.cards.map((c) => c.def) : []));
/** Every card I have looked at so far (CR 5.11.1). */
const looked = (t: Driver) => t.events.flatMap((e) => (e.type === "cardsLookedAt" && e.player === 0 ? e.cards.map((c) => c.def) : []));
const maxPP = (t: Driver) => t.game.state.players[0].maxPlayPoints;
/** [attack, defense] of each of my cards matching a reference, in field order. */
const allStats = (t: Driver, ref: string) =>
  t.ids(ref).map((id) => {
    const i = t.game.reader().info(id);
    return [i.attack, i.defense];
  });
const EARTH4 = ["CP05-109", "CP05-092", "CP05-046", "CP05-032"];

describe("CP05 Dragoncraft", () => {
  it("054 怪力乱神・サラーサ — Final Uncap; uncapped: up to 2 facedown earth evolved followers faceup; final-uncapped: 1 damage per 2 faceup ones to each enemy; ヒヒイロカネ: both, in any order (Q2867, Q2868)", () => {
    // An earth element uncaps it: up to 2 of the facedown earth evolved followers (全属性 too) turn faceup, not the fire one.
    const up = d({ me: { field: ["CP05-054"], ex: ["CP05-T11"], evolveDeck: ["CP05-109", "CP05-092", "CP05-046", "CP05-057"] } });
    up.activate("CP05-T11");
    expect([candidates(up), bounds(up)]).toEqual([["CP05-109", "CP05-092", "CP05-046"], [0, 2]]);
    up.pick("CP05-109", "CP05-092");
    expect([faceUp(up), up.stats("CP05-054")]).toEqual([["CP05-109", "CP05-092"], [4, 3]]);
    // Another element final-uncaps it instead: 5 faceup earth evolved followers (the fire one doesn't count) deal 2 to each enemy.
    const final = d({
      me: {
        field: [{ card: "CP05-054", uncappedWith: [{ card: "CP05-T11", uncaps: ["uncap"] }] }],
        ex: ["CP05-T11"],
        faceUpEvolveDeck: [...EARTH4, "CP05-042", "CP05-057"],
      },
      opp: { field: ["V5", "V3"] },
    }).activate("CP05-T11");
    expect([final.leader("opp"), final.stats("opp:V5"), final.stats("opp:V3"), final.stats("CP05-054")]).toEqual([18, [5, 3], [3, 2], [5, 4]]);
    // ヒヒイロカネ: both trigger. The uncap one first turns a 4th faceup (2 damage); the other way round, 1 damage.
    const both = () =>
      d({ me: { field: ["CP05-054"], ex: ["CP05-T15"], evolveDeck: ["CP05-109"], faceUpEvolveDeck: EARTH4.slice(1) }, opp: { field: ["V5"] } }).activate("CP05-T15");
    const uncapFirst = both();
    expect(uncapFirst.decision?.type).toBe("selectPending");
    uncapFirst.pending().pick("CP05-109");
    expect([uncapFirst.leader("opp"), uncapFirst.stats("opp:V5"), uncapFirst.stats("CP05-054")]).toEqual([18, [5, 3], [5, 4]]);
    const finalFirst = both();
    const second = finalFirst.decision?.type === "selectPending" ? finalFirst.decision.options[1]! : "";
    finalFirst.answer({ type: "selectPending", id: second }).pick("CP05-109");
    expect([finalFirst.leader("opp"), finalFirst.stats("opp:V5"), faceUp(finalFirst).length]).toEqual([19, [5, 4], 4]);
  });

  it("055 大いなる調停者・ゾーイ — Final Uncap; uncapped: 5 damage to an enemy follower and +1 max PP (neither without one, Q2905); final-uncapped, pay 1: other Granblue followers of original cost 5 +2/+2; ヒヒイロカネ: both (Q2867, Q2868)", () => {
    const up = d({ me: { field: ["CP05-055"], ex: ["CP05-T13"], maxPlayPoints: 5 }, opp: { field: ["V5", "V3"] } });
    up.activate("CP05-T13").pick("opp:V5");
    expect([up.field("opp"), maxPP(up), up.stats("CP05-055")]).toEqual([["V3"], 6, [6, 5]]);
    const none = d({ me: { field: ["CP05-055"], ex: ["CP05-T13"], maxPlayPoints: 5 } }).activate("CP05-T13");
    expect([maxPP(none), none.stats("CP05-055")]).toEqual([5, [6, 5]]);
    // An element final-uncaps it instead (only that triggers: V3 is left alone). Paying 1, the other Granblue followers of original
    // cost 5 get +2/+2 — an evolved one too (its base card's cost) — not a 5-cost non-Granblue one, a 4-cost one, nor this one.
    const final = d({
      me: {
        field: [{ card: "CP05-055", uncappedWith: [{ card: "CP05-T13", uncaps: ["uncap"] }] }, "CP05-062", { card: "CP05-062", evolvedInto: "CP05-063" }, "V5", "CP05-064"],
        ex: ["CP05-T13"],
        playPoints: 3,
      },
      opp: { field: ["V3"], deck: ["V1"] },
    });
    final.activate("CP05-T13").pick("CP05-055").yes();
    expect([allStats(final, "CP05-062@field"), final.stats("V5"), final.stats("CP05-064"), final.stats("CP05-055"), final.pp(), final.field("opp")]).toEqual([
      [
        [7, 7],
        [8, 8],
      ],
      [5, 5],
      [3, 3],
      [7, 6],
      2,
      ["V3"],
    ]);
    // No duration (CR 10.2.1.2): still +2/+2 in the next turn.
    expect(allStats(final.end(), "CP05-062@field")).toEqual([
      [7, 7],
      [8, 8],
    ]);
    // The cost is optional: not paid, nothing.
    const declined = d({ me: { field: [{ card: "CP05-055", uncappedWith: [{ card: "CP05-T13", uncaps: ["uncap"] }] }, "CP05-062"], ex: ["CP05-T13"], playPoints: 3 } });
    declined.activate("CP05-T13").pick("CP05-055").no();
    expect([declined.stats("CP05-062"), declined.pp()]).toEqual([[5, 5], 3]);
    // ヒヒイロカネ: both trigger.
    const both = d({ me: { field: ["CP05-055", "CP05-062"], ex: ["CP05-T15"], playPoints: 3, maxPlayPoints: 5 }, opp: { field: ["V3"] } });
    both.activate("CP05-T15").pick("CP05-055");
    expect(both.decision?.type).toBe("selectPending");
    both.flush().yes();
    expect([both.field("opp"), maxPP(both), both.stats("CP05-062"), both.pp(), both.stats("CP05-055")]).toEqual([[], 6, [7, 7], 2, [7, 6]]);
  });

  it("056 炎の理・ウィルナス — Evolve (1); Fanfare: look at the top card, may reveal a fire card (全属性 too) and take it, else it stays on top unrevealed", () => {
    const t = d({ me: { hand: ["CP05-056"], deck: ["CP05-108", "V1"], playPoints: 4 } }).play("CP05-056").pick("CP05-108");
    expect([t.hand(), t.zone("me", "deck"), revealed(t)]).toEqual([["CP05-108"], ["V1"], ["CP05-108"]]);
    const kept = d({ me: { hand: ["CP05-056"], deck: ["CP05-066", "V1"], playPoints: 4 } }).play("CP05-056").none();
    expect([kept.hand(), kept.zone("me", "deck"), revealed(kept)]).toEqual([[], ["CP05-066", "V1"], []]);
    // A top card that can't be taken is still looked at, and stays on top unrevealed.
    const notFire = d({ me: { hand: ["CP05-056"], deck: ["CP05-058"], playPoints: 4 } }).play("CP05-056");
    expect([notFire.decision?.type, notFire.hand(), notFire.zone("me", "deck"), looked(notFire), revealed(notFire)]).toEqual([
      "mainPhase",
      [],
      ["CP05-058"],
      ["CP05-058"],
      [],
    ]);
    const e = d({ me: { field: ["CP05-056"], evolveDeck: ["CP05-057"], playPoints: 1 } }).evolve("CP05-056");
    expect([e.pp(), e.stats("CP05-056")]).toEqual([0, [5, 5]]);
  });

  it("057 炎の理・ウィルナス (evolved) — On Evolve, reveal X fire cards: X divided between up to 2 enemy followers (none selected: still played, Q2906); On Super-Evolve, reveal X: X to an enemy follower and its leader (not without one, Q2907); both, in any order (Q2871, Q2872)", () => {
    const spec = (opp: string[], hand: string[], extra = {}) =>
      d({ me: { field: ["CP05-056"], evolveDeck: ["CP05-057"], hand, playPoints: 1, ...extra }, opp: { field: opp } });
    // Two fire cards (one 全属性), two targets: X = 2, 1 each.
    const t = spec(["V5", "V3"], ["CP05-066", "CP05-108", "CP05-062"]);
    t.evolve("CP05-056").yes().pick("opp:V5", "opp:V3");
    expect([t.stats("opp:V5"), t.stats("opp:V3"), revealed(t)]).toEqual([[5, 4], [3, 3], ["CP05-066", "CP05-108"]]);
    // One target: X is chosen, from 1 up to the fire cards in the hand.
    const one = spec(["V5", "V3"], ["CP05-066", "CP05-108"]);
    one.evolve("CP05-056").yes().pick("opp:V5");
    expect(candidates(one)).toEqual(["CP05-066", "CP05-108"]);
    one.pick("CP05-066");
    expect([one.stats("opp:V5"), revealed(one)]).toEqual([[5, 4], ["CP05-066"]]);
    // At most 2 followers, and no more than the fire cards in the hand: each takes at least 1 (CR 10.6.2.4.2), so X is at least
    // the followers selected.
    const three = spec(["V5", "V3", "V1"], ["CP05-066", "CP05-108", "CP05-056"]).evolve("CP05-056").yes();
    const single = spec(["V5", "V3"], ["CP05-066", "V1"]).evolve("CP05-056").yes();
    expect([bounds(three), bounds(single)]).toEqual([
      [0, 2],
      [0, 1],
    ]);
    expect(bounds(three.pick("opp:V5", "opp:V3"))).toEqual([2, 3]);
    // Q2906: no enemy follower — played, selecting none: the revealed CP05-068 gives this Rush and Assail; no damage.
    const none = spec([], ["CP05-068"]);
    none.evolve("CP05-056").yes();
    expect([none.keywords("CP05-056"), revealed(none), none.leader("opp")]).toEqual([["rush", "assail"], ["CP05-068"], 20]);
    // Super-evolving: On Evolve first (X = 2 to V5), then On Super-Evolve revealing the same cards (2 to V5 and its leader).
    const s = spec(["V5"], ["CP05-066", "CP05-108"], SUPER);
    s.evolve("CP05-056", { sep: true });
    expect(s.decision?.type).toBe("selectPending");
    s.pending().yes().pick("opp:V5").pick("CP05-066", "CP05-108");
    expect(s.stats("opp:V5")).toEqual([5, 3]);
    s.yes().pick("CP05-066", "CP05-108");
    expect([s.stats("opp:V5"), s.leader("opp"), s.stats("CP05-056")]).toEqual([[5, 1], 18, [6, 6]]);
    // Q2907: without an enemy follower On Super-Evolve can't be played (nothing revealed, nothing to the leader).
    const q = spec([], ["CP05-066"], SUPER);
    q.evolve("CP05-056", { sep: true }).flush().no();
    expect([q.decision?.type, q.leader("opp"), revealed(q)]).toEqual(["mainPhase", 20, []]);
  });

  it("058 どこにでもいるフツーの女の子・メグ — Evolve (1); Fanfare, discard a dark card: draw (CP05-065 discarded so triggers)", () => {
    const t = d({ me: { hand: ["CP05-058", "CP05-065", "V1"], deck: ["V3", "V5"], playPoints: 2 } }).play("CP05-058").yes();
    expect([t.cemetery(), t.hand(), t.ex()]).toEqual([["CP05-065"], ["V1", "V3", "V5"], ["CP05-T14"]]);
    const declined = d({ me: { hand: ["CP05-058", "CP05-065"], deck: ["V3"], playPoints: 2 } }).play("CP05-058").no();
    expect([declined.hand(), declined.cemetery()]).toEqual([["CP05-065"], []]);
    // No dark card in the hand: nothing to ask.
    const none = d({ me: { hand: ["CP05-058", "CP05-066"], deck: ["V3"], playPoints: 2 } }).play("CP05-058");
    expect([none.decision?.type, none.hand()]).toEqual(["mainPhase", ["CP05-066"]]);
    const e = d({ me: { field: ["CP05-058"], evolveDeck: ["CP05-059"], playPoints: 1 } }).evolve("CP05-058");
    expect([e.pp(), e.stats("CP05-058")]).toEqual([0, [2, 2]]);
  });

  it("059 どこにでもいるフツーの女の子・メグ (evolved) — On Evolve: a dark follower (全属性 too) of original cost 2 or less, not named メグ, from your cemetery onto the field (with the field full, it stays there)", () => {
    // Left out: メグ (the name), fire ones, a dark follower of cost 3 (CP05-074), dark amulets (CP05-079 of cost 1, CP05-071).
    // In: CP05-065, and the 全属性 CP05-108 (CR JP 14.6.2.2).
    const cemetery = ["CP05-065", "CP05-058", "CP05-071", "CP05-074", "CP05-079", "CP05-066", "CP05-068", "CP05-108", "CP05-065"];
    const t = d({ me: { field: ["CP05-058"], evolveDeck: ["CP05-059"], cemetery, playPoints: 1 } });
    t.evolve("CP05-058");
    expect(candidates(t)).toEqual(["CP05-065", "CP05-108", "CP05-065"]);
    t.pick("CP05-065");
    // CP05-065's Fanfare (CR 12.4.3): an element, and leader +2 with メグ (this one, evolved) on the field.
    expect([t.field(), t.ex(), t.leader(), t.cemetery()]).toEqual([["CP05-058", "CP05-065"], ["CP05-T14"], 22, cemetery.slice(1)]);
    // A full field: still played, and the card selected stays in the cemetery (CR 4.4.4.2; BP03-024 ruling).
    const full = d({ me: { field: ["CP05-058", "V1", "V1", "V1", "V1"], evolveDeck: ["CP05-059"], cemetery: ["CP05-065", "CP05-108"], playPoints: 1 } });
    full.evolve("CP05-058").pick("CP05-108");
    expect([full.decision?.type, full.field(), full.cemetery()]).toEqual(["mainPhase", ["CP05-058", "V1", "V1", "V1", "V1"], ["CP05-065", "CP05-108"]]);
    // Nothing to select: not played.
    const none = d({ me: { field: ["CP05-058"], evolveDeck: ["CP05-059"], cemetery: ["CP05-058", "CP05-066"], playPoints: 1 } }).evolve("CP05-058");
    expect([none.decision?.type, none.field()]).toEqual(["mainPhase", ["CP05-058"]]);
  });

  it("060 天穿の銃槍騎・ラスティナ — uncapped: X damage to an enemy follower (X faceup earth evolved followers), 2 to its leader if X is 4 or more (not without a follower, Q2908); Fanfare: draw, may turn one faceup", () => {
    // X = 4 destroys V3, and its leader still takes 2: V3 is on the field until the rules are checked (CR 11.1.2).
    const t = d({ me: { field: ["CP05-060"], ex: ["CP05-T11"], faceUpEvolveDeck: EARTH4 }, opp: { field: ["V5", "V3"] } });
    t.activate("CP05-T11").pick("opp:V3");
    expect([t.field("opp"), t.leader("opp"), t.stats("CP05-060")]).toEqual([["V5"], 18, [2, 5]]);
    const three = d({ me: { field: ["CP05-060"], ex: ["CP05-T11"], faceUpEvolveDeck: EARTH4.slice(1) }, opp: { field: ["V5"] } }).activate("CP05-T11");
    expect([three.stats("opp:V5"), three.leader("opp")]).toEqual([[5, 2], 20]);
    expect(d({ me: { field: ["CP05-060"], ex: ["CP05-T11"], faceUpEvolveDeck: EARTH4 } }).activate("CP05-T11").leader("opp")).toBe(20);
    // No Final Uncap: once uncapped, an element does nothing more (it stays in the EX area).
    const again = d({ me: { field: [{ card: "CP05-060", uncappedWith: [{ card: "CP05-T11", uncaps: ["uncap"] }] }], ex: ["CP05-T11"], faceUpEvolveDeck: EARTH4 }, opp: { field: ["V5"] } });
    again.activate("CP05-T11");
    expect([again.ex(), again.stats("opp:V5"), again.stats("CP05-060")]).toEqual([["CP05-T11"], [5, 5], [2, 5]]);
    const f = d({ me: { hand: ["CP05-060"], deck: ["V1"], evolveDeck: ["CP05-109", "CP05-057", "CP05-092"], playPoints: 3 } }).play("CP05-060");
    expect([candidates(f), bounds(f)]).toEqual([["CP05-109", "CP05-092"], [0, 1]]);
    f.pick("CP05-092");
    expect([f.hand(), faceUp(f)]).toEqual([["V1"], ["CP05-092"]]);
  });

  it("061 ティアマト・マグナ — Fanfare: 2 wind elements; act, engage and bury this, with 3 uncaps this turn (ヒヒイロカネ counts 2, Q2909): may take a wind card from the top", () => {
    expect(d({ me: { hand: ["CP05-061"], playPoints: 1 } }).play("CP05-061").ex()).toEqual(["CP05-T12", "CP05-T12"]);
    const t = d({ me: { field: ["CP05-054", "CP05-064", "CP05-061"], ex: ["CP05-T15", "CP05-T12"], deck: ["CP05-064", "V1"] } });
    expect(t.canActivate("CP05-061")).toBe(false);
    t.activate("CP05-T15").pick("CP05-054").flush();
    expect([t.game.reader().uncapsThisTurn(0), t.canActivate("CP05-061")]).toEqual([2, false]);
    t.activate("CP05-T12");
    expect(t.canActivate("CP05-061")).toBe(true);
    t.activate("CP05-061").pick("CP05-064");
    expect([t.hand(), t.field(), t.cemetery()]).toEqual([["CP05-064"], ["CP05-054", "CP05-064"], ["CP05-061"]]);
  });

  it("062 / 063 純朴の鋼体・ムゲン — Evolve (1); evolved, On Evolve: destroy up to 2 enemy followers and a light element (selecting none too, Q2906)", () => {
    const t = d({ me: { field: ["CP05-062"], evolveDeck: ["CP05-063"], playPoints: 1 }, opp: { field: ["V5", "V3", "V1"] } });
    expect(bounds(t.evolve("CP05-062"))).toEqual([0, 2]);
    t.pick("opp:V5", "opp:V3");
    expect([t.field("opp"), t.ex(), t.pp(), t.stats("CP05-062")]).toEqual([["V1"], ["CP05-T13"], 0, [6, 6]]);
    const none = d({ me: { field: ["CP05-062"], evolveDeck: ["CP05-063"], playPoints: 1 } }).evolve("CP05-062");
    expect(none.ex()).toEqual(["CP05-T13"]);
  });

  it("064 護国真龍・スカーサハ — costs X less, X = uncaps this turn (ヒヒイロカネ counts 2, Q2910); Fanfare: a wind element, draw", () => {
    const t = d({ me: { hand: ["CP05-064"], field: ["CP05-054"], ex: ["CP05-T15"], deck: ["V1"], playPoints: 2 } });
    expect(t.canPlay("CP05-064")).toBe(false);
    t.activate("CP05-T15").flush().play("CP05-064");
    expect([t.pp(), t.ex(), t.hand(), t.field()]).toEqual([0, ["CP05-T12"], ["V1"], ["CP05-054", "CP05-064"]]);
  });

  it("065 メグの親友・まりっぺ — discarded from your hand by your dark (or 全属性) card's ability: a dark element, draw (not by another card's); Fanfare: a dark element, leader +2 with メグ on your field", () => {
    const dark = d({ me: { hand: ["CP05-058", "CP05-065"], deck: ["V1", "V3"], playPoints: 2 } }).play("CP05-058").yes();
    expect([dark.ex(), dark.hand(), dark.cemetery()]).toEqual([["CP05-T14"], ["V1", "V3"], ["CP05-065"]]);
    // A 全属性 card's ability is a dark card's (CR JP 14.6.2.2): CP05-107's Fanfare discards it (draw 2), then this draws 1.
    const all = d({ me: { hand: ["CP05-107", "CP05-065"], deck: ["V1", "V3", "V5"], playPoints: 2 } }).play("CP05-107").yes();
    expect([all.ex(), all.hand(), all.cemetery()]).toEqual([["CP05-T14"], ["V1", "V3", "V5"], ["CP05-065"]]);
    const other = d({ me: { hand: ["BP02-065", "CP05-065"], deck: ["V1", "V3"], playPoints: 2 } }).play("BP02-065").pick("CP05-065");
    expect([other.ex(), other.hand(), other.cemetery()]).toEqual([[], ["V1"], ["CP05-065"]]);
    const alone = d({ me: { hand: ["CP05-065"], playPoints: 2 }, opp: { field: ["CP05-058"] } }).play("CP05-065");
    expect([alone.ex(), alone.leader()]).toEqual([["CP05-T14"], 20]);
    const meg = d({ me: { hand: ["CP05-065"], field: ["CP05-058"], playPoints: 2 } }).play("CP05-065");
    expect([meg.ex(), meg.leader()]).toEqual([["CP05-T14"], 22]);
  });

  it("066 / 067 灼脚の麗姫・アリーザ — Evolve (1); Fanfare: may take a fire card from the top; evolved: Strike, a fire element; On Evolve, engage an enemy follower", () => {
    const t = d({ me: { hand: ["CP05-066"], deck: ["CP05-056", "V1"], playPoints: 2 } }).play("CP05-066").pick("CP05-056");
    expect([t.hand(), t.zone("me", "deck")]).toEqual([["CP05-056"], ["V1"]]);
    const e = d({ me: { field: ["CP05-066"], evolveDeck: ["CP05-067"], playPoints: 1 }, opp: { field: [{ card: "V5", engaged: true }, "V3", "V1"] } });
    e.evolve("CP05-066");
    expect(candidates(e)).toEqual(["V5", "V3", "V1"]); // an engaged one too
    e.pick("opp:V3");
    expect([e.engaged("opp:V3"), e.engaged("opp:V1"), e.pp(), e.stats("CP05-066")]).toEqual([true, false, 0, [3, 3]]);
    e.attack("CP05-066", "opp:V5");
    expect(e.ex()).toEqual(["CP05-T09"]);
  });

  it("068 古今独歩の大拳豪・ガンダゴウザ — Rush, Assail; revealed from your hand by an ability (not played: Q2893; in the opponent's turn too: Q2894): a fire follower of yours gets Rush and Assail; Strike, reveal 3 fire cards: 6 to an enemy follower and its leader (not without one, Q2911)", () => {
    const played = d({ me: { hand: ["CP05-068"], field: ["CP05-066"], playPoints: 7 } }).play("CP05-068");
    expect([played.keywords("CP05-068"), played.keywords("CP05-066")]).toEqual([["rush", "assail"], []]);
    // Its Strike reveals another CP05-068 from the hand, which triggers (Q2893).
    const t = d({ me: { field: ["CP05-068", "CP05-066"], hand: ["CP05-068", "CP05-056", "CP05-108", "V1"] }, opp: { field: ["V5"], deck: ["V1"] } });
    t.attack("CP05-068", "opp:leader").yes();
    expect(candidates(t)).toEqual(["CP05-068", "CP05-066"]);
    t.pick("CP05-066");
    expect([t.field("opp"), t.leader("opp"), t.keywords("CP05-066")]).toEqual([[], 8, ["rush", "assail"]]);
    expect(t.end().keywords("CP05-066")).toEqual(["rush", "assail"]); // no duration (CR 10.2.1.2)
    // Q2911: no enemy follower — not played, nothing revealed; only the attack's damage.
    const q = d({ me: { field: ["CP05-068"], hand: ["CP05-056", "CP05-066", "CP05-108"] } }).attack("CP05-068", "opp:leader");
    expect([q.leader("opp"), revealed(q)]).toEqual([14, []]);
    // Q2894: the opponent's BP06-118 reveals my hand in their turn.
    const theirs = d({ turn: 6, me: { hand: ["CP05-068"], field: ["CP05-066"] }, opp: { hand: ["BP06-118"], playPoints: 3 } }).play("opp:BP06-118");
    expect(theirs.keywords("CP05-066")).toEqual(["rush", "assail"]);
  });

  it("069 灰白の豹・アイル — Rush; Strike: draw; Fanfare: may turn a facedown earth evolved follower faceup, then with 4 or more faceup: +2/+0 and Assail", () => {
    const spec = { hand: ["CP05-069"], evolveDeck: ["CP05-109", "CP05-042"], faceUpEvolveDeck: EARTH4.slice(1), playPoints: 2 };
    const t = d({ me: spec, opp: { deck: ["V1"] } }).play("CP05-069");
    expect([candidates(t), bounds(t)]).toEqual([["CP05-109", "CP05-042"], [0, 1]]);
    t.pick("CP05-109");
    expect([t.stats("CP05-069"), t.keywords("CP05-069")]).toEqual([[5, 2], ["rush", "assail"]]);
    t.end(); // no duration (CR 10.2.1.2)
    expect([t.stats("CP05-069"), t.keywords("CP05-069")]).toEqual([[5, 2], ["rush", "assail"]]);
    const no = d({ me: spec }).play("CP05-069").none();
    expect([no.stats("CP05-069"), no.keywords("CP05-069")]).toEqual([[3, 2], ["rush"]]);
    const s = d({ me: { field: ["CP05-069"], deck: ["V1"] }, opp: { field: [{ card: "V5", engaged: true }] } }).attack("CP05-069", "opp:V5");
    expect(s.hand()).toEqual(["V1"]);
  });

  it("070 オンリー･ワン･ウィッシュ — reveal the top card; a light one: a light element and +1 max PP (not otherwise, Q2912); with 10 max PP, search for 大いなる調停者・ゾーイ (whatever was revealed, Q2913)", () => {
    const t = d({ me: { hand: ["CP05-070"], deck: ["CP05-062", "CP05-055", "V1"], playPoints: 2, maxPlayPoints: 9 } }).play("CP05-070").pick("CP05-055");
    expect([t.ex(), maxPP(t), t.hand(), t.zone("me", "deck").sort(), revealed(t).includes("CP05-062")]).toEqual([["CP05-T13"], 10, ["CP05-055"], ["CP05-062", "V1"], true]);
    const dark = d({ me: { hand: ["CP05-070"], deck: ["CP05-058"], playPoints: 2, maxPlayPoints: 5 } }).play("CP05-070");
    expect([dark.ex(), maxPP(dark), dark.zone("me", "deck")]).toEqual([[], 5, ["CP05-058"]]);
    const ten = d({ me: { hand: ["CP05-070"], deck: ["V1", "CP05-055"], playPoints: 2, maxPlayPoints: 10 } }).play("CP05-070").pick("CP05-055");
    expect([ten.ex(), maxPP(ten), ten.hand()]).toEqual([[], 10, ["CP05-055"]]);
  });

  it("071 アルバコア — Fanfare: destroy an enemy card on the field; act, engage and bury this, if you discarded a dark card from your hand this turn: a dark element, draw", () => {
    const t = d({ me: { hand: ["CP05-071"], playPoints: 4 }, opp: { field: ["V5", "AMULET"] } }).play("CP05-071").pick("opp:AMULET");
    expect(t.field("opp")).toEqual(["V5"]);
    const a = d({ me: { field: ["CP05-071"], hand: ["BP02-065", "CP05-058", "CP05-065", "V1"], deck: ["V1", "V3", "V5", "V1"], playPoints: 4 } });
    a.play("BP02-065").pick("V1");
    expect(a.canActivate("CP05-071")).toBe(false);
    a.play("CP05-058").yes();
    expect(a.canActivate("CP05-071")).toBe(true);
    a.activate("CP05-071");
    expect([a.ex(), a.field(), a.cemetery(), a.hand()]).toEqual([["CP05-T14", "CP05-T14"], ["BP02-065", "CP05-058"], ["V1", "CP05-065", "CP05-071"], ["V1", "V3", "V5", "V1"]]);
  });
});
