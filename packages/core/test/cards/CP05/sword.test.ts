import { describe, expect, it } from "vitest";
import { createEngine, script } from "../../../src";
import { ALL_CARDS, ALL_SCRIPTS } from "../../../src/sets";
import { drive, testFollower, type Driver, type DriveSpec } from "../../../src/testing";
import { TEST_CARDS, TEST_SCRIPTS } from "../../helpers";

// CP05 Swordcraft (019–036, tokens T03–T06). Pre-release cards with Japanese names (data/preview.ts); the treasures CP05-T09 …
// T15 uncap them (CR JP 14.6.4) — a scenario's `uncappedWith` sets the state only, so the "when this uncaps" abilities are tested
// with real activations. V1 is 1c 2/2, V2 2c 2/3, V3 3c 3/4, V5 5c 5/5 (Neutral), STORM a 2/1 with Storm, AMULET a 1c amulet;
// QUICK-SAC (0) destroys one of your followers; BP01-144 a 2/2 with Aura; BP13-114 has a quick activated ability valid in the
// hand, BP02-027 one on the field. Earth evolved followers: CP05-032, 046, 092, and CP05-109 (全属性). EVO-BOUNCE, a synthetic
// 1c 1/1 follower: whenever a follower on your field evolves, it returns that follower to your hand (so CP05-028 can leave the
// field before its On Evolve resolves).
const { defineCard, whenYourFollowerEvolves } = script;
const E = createEngine({
  cards: [...ALL_CARDS, ...TEST_CARDS, testFollower("EVO-BOUNCE", 1, 1, 1)],
  scripts: {
    ...ALL_SCRIPTS,
    ...TEST_SCRIPTS,
    "EVO-BOUNCE": defineCard({
      abilities: [
        whenYourFollowerEvolves({
          *resolve(fx) {
            const card = fx.data?.card;
            if (card !== undefined && fx.game.card(card)?.zone === "field") yield* fx.returnToHand([card]);
          },
        }),
      ],
    }),
  },
});
const d = (spec: DriveSpec) => drive(E, spec);
const SUPER = { superEvolutionPoints: 1, turnsPassed: 8 };
const FIRE = "CP05-T09";
const WATER = "CP05-T10";
const EARTH = "CP05-T11";
const WIND = "CP05-T12";
const LIGHT = "CP05-T13";
const DARK = "CP05-T14";
const HIHI = "CP05-T15";
/** A follower an element already uncapped. */
const uncapped = (card: string, element: string) => ({ card, uncappedWith: [{ card: element, uncaps: ["uncap" as const] }] });

/** Play the pending ability that is ability `index` of `def`'s script (two of one card share their source). */
function pendingNo(t: Driver, def: string, index: number): Driver {
  const p = t.game.state.pending.find((x) => x.sourceDef === def && x.ability === index);
  if (!p) throw new Error(`no pending ability #${index} of ${def}`);
  return t.answer({ type: "selectPending", id: p.id });
}

const faceUp = (t: Driver) => t.game.reader().faceUpEvolveDeck(0).map((id) => t.game.state.cards[id]!.def);

describe("CP05 Swordcraft", () => {
  it("019 天星剣王・シエテ — Final Uncap; uncapped: draw 2, one to the bottom; final-uncapped: up to 2 followers (2 or less, other names) from the deck; ヒヒイロカネ: both, in any order (Q2867, Q2868)", () => {
    const t = d({ me: { field: ["CP05-019"], ex: [WIND], hand: ["V5"], deck: ["V1", "V3", "V2"] } }).activate(WIND).pick("V5");
    expect([t.stats("CP05-019"), t.hand(), t.zone("me", "deck"), t.keywords("CP05-019")]).toEqual([[4, 3], ["V1", "V3"], ["V2", "V5"], ["finalUncap"]]);
    // Uncapped, a wind element final-uncaps it instead: only the final trigger (no draw). The search offers followers that cost
    // 2 or less (not V3, not the amulet), one at a time, without a name already found (not the other 033).
    const f = d({ me: { field: [uncapped("CP05-019", WIND)], ex: [WIND], deck: ["CP05-033", "CP05-034", "CP05-033", "V3", "AMULET", "CP05-034"] } });
    expect(f.activate(WIND).decision).toMatchObject({ type: "selectCards", reason: "search", candidateDefs: ["CP05-033", "CP05-034", "CP05-033", "CP05-034"] });
    expect(f.pick("CP05-033").decision).toMatchObject({ type: "selectCards", reason: "search", candidateDefs: ["CP05-034", "CP05-034"] });
    // Found together, both Fanfares trigger and each sees the other on the field: neither searches (Q2889, Q2891).
    expect(f.pick("CP05-034").decision?.type).toBe("selectPending");
    expect([f.flush().decision?.type, f.stats("CP05-019"), f.field(), f.zone("me", "deck").sort(), f.hand()]).toEqual([
      "mainPhase",
      [5, 4],
      ["CP05-019", "CP05-033", "CP05-034"],
      ["AMULET", "CP05-033", "CP05-034", "V3"],
      [],
    ]);
    // ヒヒイロカネ: both trigger; the final one first, then the draw (Q2867).
    const h = d({ me: { field: ["CP05-019"], ex: [HIHI], deck: ["V1", "V3", "V2"] } }).activate(HIHI);
    expect(h.decision?.type).toBe("selectPending");
    pendingNo(h, "CP05-019", 1).pick("V1").none().pick("V3");
    expect([h.stats("CP05-019"), h.field(), h.hand(), h.zone("me", "deck")]).toEqual([[5, 4], ["CP05-019", "V1"], ["V2"], ["V3"]]);
  });

  it("020 刀神・オクトー — 2 less per 2 faceup earth evolved followers (全属性 too); uncapped: Rush, Assail; final-uncapped: pay 1, destroy an enemy follower, 3 to its leader — not without a target (Q2882)", () => {
    const can = (faceUpCards: string[], pp: number) => d({ me: { hand: ["CP05-020"], faceUpEvolveDeck: faceUpCards, playPoints: pp } }).canPlay("CP05-020");
    expect([can(["CP05-032", "CP05-109", "CP05-046"], 6), can(["CP05-032", "CP05-109", "CP05-046"], 5)]).toEqual([true, false]);
    expect([can(["CP05-032", "CP05-109", "CP05-046", "CP05-092"], 4), can(["CP05-032", "CP05-022", "CP05-024"], 7)]).toEqual([true, false]);
    const t = d({ me: { field: ["CP05-020"], ex: [EARTH, EARTH], deck: ["V1"], playPoints: 1 }, opp: { field: ["V5", "V3"], deck: ["V1"] } });
    t.activate(EARTH);
    expect([t.stats("CP05-020"), t.keywords("CP05-020")]).toEqual([[6, 5], ["finalUncap", "rush", "assail"]]);
    t.activate(EARTH).yes().pick("opp:V3");
    expect([t.stats("CP05-020"), t.field("opp"), t.leader("opp"), t.pp()]).toEqual([[7, 6], ["V5"], 17, 0]);
    // Rush and Assail have no duration (CR 10.2.1.2): still there in a later turn.
    expect(t.end().end().keywords("CP05-020")).toEqual(["finalUncap", "rush", "assail"]);
    // Not paid: nothing; no enemy follower: not played, no damage (Q2882).
    const no = d({ me: { field: [uncapped("CP05-020", EARTH)], ex: [EARTH], playPoints: 1 }, opp: { field: ["V5"] } }).activate(EARTH).no();
    expect([no.field("opp"), no.leader("opp"), no.pp()]).toEqual([["V5"], 20, 1]);
    const q = d({ me: { field: [uncapped("CP05-020", EARTH)], ex: [EARTH], playPoints: 1 } }).activate(EARTH);
    expect([q.decision?.type, q.leader("opp"), q.pp(), q.stats("CP05-020")]).toEqual(["mainPhase", 20, 1, [7, 6]]);
    // ヒヒイロカネ: both trigger, the final one played first (Q2867, Q2868).
    const h = d({ me: { field: ["CP05-020"], ex: [HIHI], playPoints: 1 }, opp: { field: ["V3"] } }).activate(HIHI);
    pendingNo(h, "CP05-020", 1).yes();
    expect([h.field("opp"), h.leader("opp"), h.stats("CP05-020"), h.keywords("CP05-020")]).toEqual([[], 17, [7, 6], ["finalUncap", "rush", "assail"]]);
  });

  it("021 / 022 光の理・ル・オー — Fanfare: a 光晶のエレメント; evolved: a Granblue follower that costs 5 from the cemetery onto the field; super-evolved (both in any order, Q2871, Q2872): Aura, enemy Storm attackers get -5", () => {
    expect(d({ me: { hand: ["CP05-021"], playPoints: 5 } }).play("CP05-021").ex()).toEqual([LIGHT]);
    // On Evolve offers only Granblue followers that originally cost 5: not V5 (no Granblue), not CP05-036 (4).
    const e = d({
      me: { field: ["CP05-021"], evolveDeck: ["CP05-022"], cemetery: ["CP05-025", "CP05-019", "V5", "CP05-036"], playPoints: 1 },
      opp: { field: ["STORM"], deck: ["V1"] },
    });
    expect(e.evolve("CP05-021").decision).toMatchObject({ type: "selectCards", candidateDefs: ["CP05-025", "CP05-019"] });
    e.pick("CP05-025");
    expect([e.field(), e.cemetery()]).toEqual([["CP05-021", "CP05-025"], ["CP05-019", "V5", "CP05-036"]]);
    // Evolved without super-evolving, it hasn't the text: an enemy Storm follower attacks as it is.
    e.end().attack("opp:STORM", "leader");
    expect([e.stats("opp:STORM"), e.leader()]).toEqual([[2, 1], 18]);
    const s = d({
      me: { field: ["CP05-021", "STORM"], evolveDeck: ["CP05-022"], cemetery: ["CP05-019"], deck: ["V1"], playPoints: 1, ...SUPER },
      opp: { field: ["STORM", "V5"], deck: ["V1"] },
    });
    s.evolve("CP05-021", { sep: true });
    expect(s.decision?.type).toBe("selectPending");
    pendingNo(s, "CP05-022", 1); // On Super-Evolve first; then On Evolve
    expect([s.keywords("CP05-021"), s.field()]).toEqual([["aura"], ["CP05-021", "STORM", "CP05-019"]]);
    // Only the opponent's followers: a Storm follower of its own controller attacks as it is.
    s.attack("STORM", "opp:leader");
    expect([s.stats("STORM"), s.leader("opp")]).toEqual([[2, 1], 18]);
    // The opponent's turn: a Storm follower attacking gets -5 before it deals damage; another doesn't.
    s.end().attack("opp:STORM", "leader");
    expect([s.stats("opp:STORM"), s.leader()]).toEqual([[-3, 1], 20]);
    s.attack("opp:V5", "leader");
    expect([s.stats("opp:V5"), s.leader()]).toEqual([[5, 5], 15]);
    // The -5 has no duration (CR 10.2.1.2): still there in the next turn.
    expect(s.end().stats("opp:STORM")).toEqual([-3, 1]);
    // The attacker's Strike resolves first (CR 10.5.2.2) and destroys it: the pending -5 still resolves (CR 10.6.2.8.2.1).
    const g = d({
      me: { field: ["CP05-021"], evolveDeck: ["CP05-022"], playPoints: 1, ...SUPER },
      opp: { field: [{ card: "V3", engaged: true }, uncapped("CP05-025", FIRE)], ex: [FIRE], deck: ["V1"] },
    });
    g.evolve("CP05-021", { sep: true }).flush().attack("CP05-021", "opp:V3").end().activate(`opp:${FIRE}`).attack("opp:CP05-025", "leader");
    expect([g.field(), g.stats("opp:CP05-025"), g.leader()]).toEqual([[], [1, 5], 19]);
  });

  it("023 / 024 揺らぎの斬姫・ナルメア — Bane; Fanfare, discard a Granblue card: a wind or dark element, draw; evolved: 4 damage and a ヒヒイロカネ, not without a target (Q2883)", () => {
    const t = d({ me: { hand: ["CP05-023", "CP05-036", "V1"], deck: ["V3"], playPoints: 3 } }).play("CP05-023").yes().choose("dark");
    expect([t.ex(), t.hand(), t.cemetery(), t.keywords("CP05-023")]).toEqual([[DARK], ["V1", "V3"], ["CP05-036"], ["bane"]]);
    const w = d({ me: { hand: ["CP05-023", "CP05-036"], deck: ["V3"], playPoints: 3 } }).play("CP05-023").yes().choose("wind");
    expect([w.ex(), w.hand()]).toEqual([[WIND], ["V3"]]);
    const no = d({ me: { hand: ["CP05-023", "CP05-036"], deck: ["V3"], playPoints: 3 } }).play("CP05-023").no();
    expect([no.ex(), no.hand()]).toEqual([[], ["CP05-036"]]);
    // Without a Granblue card in the hand nothing is asked, and nothing happens.
    const none = d({ me: { hand: ["CP05-023", "V1"], deck: ["V3"], playPoints: 3 } }).play("CP05-023");
    expect([none.decision?.type, none.hand(), none.ex(), none.zone("me", "deck")]).toEqual(["mainPhase", ["V1"], [], ["V3"]]);
    const e = d({ me: { field: ["CP05-023"], evolveDeck: ["CP05-024"], playPoints: 1 }, opp: { field: ["V5", "V3"] } }).evolve("CP05-023").pick("opp:V5");
    expect([e.stats("opp:V5"), e.ex(), e.keywords("CP05-023")]).toEqual([[5, 1], [HIHI], ["bane"]]);
    expect(d({ me: { field: ["CP05-023"], evolveDeck: ["CP05-024"], playPoints: 1 } }).evolve("CP05-023").ex()).toEqual([]);
  });

  it("025 真紅の穿光・ゼタ — Storm, Final Uncap; uncapped: 'Strike: 5 damage to an enemy follower'; final-uncapped: 'Strike: 2 to each enemy follower'; in any order, the second without a target for the first (Q2884)", () => {
    const t = d({ me: { field: ["CP05-025"], ex: [FIRE] }, opp: { field: ["V5", "V3"] } }).activate(FIRE);
    t.attack("CP05-025", "opp:leader").pick("opp:V3");
    expect([t.field("opp"), t.stats("opp:V5"), t.leader("opp"), t.keywords("CP05-025")]).toEqual([["V5"], [5, 5], 15, ["storm", "finalUncap"]]);
    // Uncapped, a fire element final-uncaps it instead: only the second Strike.
    const f = d({ me: { field: [uncapped("CP05-025", FIRE)], ex: [FIRE] }, opp: { field: ["V5", "V3"] } }).activate(FIRE);
    f.attack("CP05-025", "opp:leader");
    expect([f.stats("opp:V5"), f.stats("opp:V3"), f.leader("opp")]).toEqual([[5, 3], [3, 2], 14]);
    // ヒヒイロカネ gives both; 2 to each first, then 5.
    const h = d({ me: { field: ["CP05-025"], ex: [HIHI], deck: ["V1"] }, opp: { field: ["V5", "V3"], deck: ["V1"] } }).activate(HIHI).flush();
    h.attack("CP05-025", "opp:leader");
    pendingNo(h, "CP05-025", 3).pick("opp:V5");
    expect([h.field("opp"), h.stats("opp:V3"), h.leader("opp")]).toEqual([["V3"], [3, 2], 14]);
    // The gained texts have no duration (CR 10.2.1.2): in a later turn both Strikes trigger again.
    expect(h.end().end().attack("CP05-025", "opp:leader").decision?.type).toBe("selectPending");
    expect([h.flush().field("opp"), h.leader("opp")]).toEqual([[], 8]);
    // Q2884: an Aura follower can't be selected for the 5; the 2 still resolves.
    const a = d({ me: { field: ["CP05-025"], ex: [HIHI] }, opp: { field: ["BP01-144"] } }).activate(HIHI).flush();
    a.attack("CP05-025", "opp:leader").flush();
    expect([a.field("opp"), a.leader("opp")]).toEqual([[], 14]);
  });

  it("026 / T03 / T04 / T05 / T06 ドラゴンナイツ — up to 2 knights, up to 4 played for 2 more, each once (Q2885); their Fanfares: an element and more, Siegfried's and Percival's not without a target (Q2927, Q2928)", () => {
    const t = d({ me: { hand: ["CP05-026"], playPoints: 5 }, opp: { field: [{ card: "V5", engaged: true }, "V3"] } }).play("CP05-026");
    expect(t.decision).toMatchObject({ type: "choose", min: 1, max: 2, options: [{ id: "lancelot" }, { id: "vane" }, { id: "siegfried" }, { id: "percival" }] });
    t.choose("siegfried", "percival").none().pending("CP05-T05");
    expect([t.field(), t.field("opp"), t.ex(), t.keywords("CP05-T05")]).toEqual([["CP05-T05", "CP05-T06"], [], [EARTH, FIRE], ["ward"]]);
    const all = d({ me: { hand: ["CP05-026", "V1"], deck: ["V3"], playPoints: 7, leaderDefense: 10 } }).play("CP05-026").choose("plus2");
    expect(all.decision).toMatchObject({ type: "choose", min: 1, max: 4 });
    all.choose("lancelot", "vane", "siegfried", "percival").none().pending("CP05-T03").pick("V1").flush();
    expect([all.field(), all.ex(), all.hand(), all.cemetery(), all.leader(), all.pp(), all.keywords("CP05-T03")]).toEqual([
      ["CP05-T03", "CP05-T04", "CP05-T05", "CP05-T06"],
      [WATER, WIND],
      ["V3"],
      ["CP05-026", "V1"],
      13,
      0,
      ["storm"],
    ]);
  });

  it("027 / 028 サムライドリーマー・ミリン — at the start of your end phase, with 3 uncaps this turn (ヒヒイロカネ's two count, Q2886): 2 to the enemy leader; evolved: 2 damage, 4 if uncapped", () => {
    const t = d({ me: { field: ["CP05-027", "CP05-025"], ex: [HIHI, WIND] }, opp: { deck: ["V1"] } });
    t.activate(HIHI).pick("CP05-025").flush().activate(WIND);
    expect([t.game.reader().uncapsThisTurn(0), t.stats("CP05-027")]).toEqual([3, [3, 2]]);
    expect(t.end().leader("opp")).toBe(18);
    const two = d({ me: { field: ["CP05-027", "CP05-025"], ex: [HIHI] }, opp: { deck: ["V1"] } }).activate(HIHI).pick("CP05-025").flush().end();
    expect(two.leader("opp")).toBe(20);
    // Evolved, it still does it, once (CR 5.16.2.2).
    const ev = d({ me: { field: [{ card: "CP05-027", evolvedInto: "CP05-028" }, "CP05-025"], ex: [HIHI, WIND] }, opp: { deck: ["V1"] } });
    expect(ev.activate(HIHI).pick("CP05-025").flush().activate(WIND).end().leader("opp")).toBe(18);
    const e = d({ me: { field: [uncapped("CP05-027", WIND)], evolveDeck: ["CP05-028"], playPoints: 1 }, opp: { field: ["V5", "V3"] } });
    e.evolve("CP05-027").pick("opp:V5");
    expect([e.stats("opp:V5"), e.stats("CP05-027")]).toEqual([[5, 1], [4, 3]]);
    const plain = d({ me: { field: ["CP05-027"], evolveDeck: ["CP05-028"], playPoints: 1 }, opp: { field: ["V5", "V3"] } });
    expect(plain.evolve("CP05-027").pick("opp:V5").stats("opp:V5")).toEqual([5, 3]);
    // Gone from the field before its On Evolve resolves (EVO-BOUNCE's ability played first): whether it was uncapped when it
    // evolved decides (CR 10.11.1; the project owner's reading).
    for (const [base, defense] of [
      [uncapped("CP05-027", WIND), 1],
      ["CP05-027", 3],
    ] as const) {
      const b = d({ me: { field: [base, "EVO-BOUNCE"], evolveDeck: ["CP05-028"], playPoints: 1 }, opp: { field: ["V5", "V3"] } });
      b.evolve("CP05-027").pending("EVO-BOUNCE").pick("opp:V5");
      expect([b.field(), b.hand(), b.stats("opp:V5")]).toEqual([["EVO-BOUNCE"], ["CP05-027"], [5, defense]]);
    }
  });

  it("029 不滅の群青・ベアトリクス — Storm; uncapped: choose a 真紅の穿光・ゼタ from the deck onto the field, or recover 4 play points; uncapped, it isn't again", () => {
    const t = d({ me: { field: ["CP05-029"], ex: [EARTH], deck: ["V1", "CP05-025"] } }).activate(EARTH).choose("zeta").pick("CP05-025");
    expect([t.field(), t.keywords("CP05-029"), t.stats("CP05-029")]).toEqual([["CP05-029", "CP05-025"], ["storm"], [3, 2]]);
    const p = d({ me: { field: ["CP05-029"], ex: [EARTH], playPoints: 2, maxPlayPoints: 9 } }).activate(EARTH).choose("pp");
    expect(p.pp()).toBe(6);
    // No Final Uncap: ヒヒイロカネ only uncaps it, and an element does nothing to it once uncapped (CR JP 14.6.4.1).
    const h = d({ me: { field: ["CP05-029"], ex: [HIHI, EARTH], playPoints: 2, maxPlayPoints: 9 } }).activate(HIHI).choose("pp");
    expect([h.stats("CP05-029"), h.pp(), h.game.reader().uncapsThisTurn(0)]).toEqual([[3, 2], 6, 1]);
    h.activate(EARTH);
    expect([h.ex(), h.decision?.type, h.game.reader().uncapsThisTurn(0)]).toEqual([[EARTH], "mainPhase", 1]);
  });

  it("030 氷心の覇王・アグロヴァル — Fanfare: X to each enemy follower, X = followers with a quick activated ability in your cemetery; {q} act 3, discard this from the hand: destroy an enemy follower (Q2887)", () => {
    const t = d({ me: { hand: ["CP05-030"], cemetery: ["BP13-114", "BP02-027", "V1", "QUICK-SAC"], playPoints: 6 }, opp: { field: ["V5", "V3"] } });
    t.play("CP05-030");
    expect([t.stats("opp:V5"), t.stats("opp:V3")]).toEqual([
      [5, 3],
      [3, 2],
    ]);
    expect(d({ me: { hand: ["CP05-030"], cemetery: ["V1"], playPoints: 6 }, opp: { field: ["V3"] } }).play("CP05-030").stats("opp:V3")).toEqual([3, 4]);
    const q = d({ me: { hand: ["CP05-030"], playPoints: 3 }, opp: { field: ["V5", "V3"] } }).activate("CP05-030").pick("opp:V5");
    expect([q.field("opp"), q.cemetery(), q.pp()]).toEqual([["V3"], ["CP05-030"], 0]);
    // In the opponent's turn, at Quick timing after an attack is declared (CR 12.3.3).
    const o = d({ turn: 6, me: { hand: ["CP05-030"], playPoints: 3 }, opp: { field: ["V5"] } }).attack("opp:V5", "leader").quick("CP05-030");
    expect([o.field("opp"), o.leader(), o.cemetery()]).toEqual([[], 20, ["CP05-030"]]);
  });

  it("031 / 032 花開く筋肉・フィオリト — Ward; Fanfare: an earth element, may turn a facedown earth evolved follower faceup; evolves for 0 with 4 faceup earth ones (全属性 too); evolved: Assail, Bane, Ward", () => {
    // Only a facedown earth (or 全属性) evolved follower may be turned faceup: not the light CP05-022.
    const t = d({ me: { hand: ["CP05-031"], evolveDeck: ["CP05-022", "CP05-032", "CP05-109"], playPoints: 2 } }).play("CP05-031").none();
    expect(t.decision).toMatchObject({ type: "selectCards", min: 0, max: 1, candidateDefs: ["CP05-032", "CP05-109"] });
    t.pick("CP05-032");
    expect([t.ex(), faceUp(t), t.keywords("CP05-031")]).toEqual([[EARTH], ["CP05-032"], ["ward"]]);
    const kept = d({ me: { hand: ["CP05-031"], evolveDeck: ["CP05-032"], playPoints: 2 } }).play("CP05-031").none().none();
    expect([kept.ex(), faceUp(kept)]).toEqual([[EARTH], []]);
    const four = ["CP05-032", "CP05-109", "CP05-046", "CP05-092"];
    expect(d({ me: { field: ["CP05-031"], evolveDeck: ["CP05-032"], faceUpEvolveDeck: four.slice(0, 3) } }).canEvolve("CP05-031")).toBe(false);
    const e = d({ me: { field: ["CP05-031"], evolveDeck: ["CP05-032"], faceUpEvolveDeck: four, playPoints: 0 } }).evolve("CP05-031");
    expect([e.stats("CP05-031"), e.keywords("CP05-031")]).toEqual([[4, 6], ["assail", "bane", "ward"]]);
  });

  it("033 / 034 眠れる輝竜・アーサー / 眠れる獅子・モルドレッド — with 3 uncaps this turn (Q2888, Q2890): Rush, Assail, Bane / Storm, until the turn ends; Fanfare: the other from the deck unless one is on your field (Q2889, Q2891)", () => {
    const t = d({
      me: { field: ["CP05-033", { card: "CP05-034", enteredThisTurn: true }, "CP05-025"], hand: ["CP05-033", "CP05-034"], ex: [HIHI, WIND] },
      opp: { deck: ["V1"] },
    });
    t.activate(HIHI).pick("CP05-025").flush();
    expect([t.keywords("CP05-033"), t.keywords("CP05-034"), t.attackTargets("CP05-034")]).toEqual([[], [], []]);
    t.activate(WIND).pick("CP05-034");
    expect([t.keywords("CP05-033"), t.keywords("CP05-034"), t.attackTargets("CP05-034")]).toEqual([["rush", "assail", "bane"], ["storm"], ["opp:leader"]]);
    // Passives work on the field only (CR 10.3.5): the copies in the hand have no keywords.
    expect([t.keywords("CP05-033@hand"), t.keywords("CP05-034@hand")]).toEqual([[], []]);
    t.end();
    expect([t.keywords("CP05-033"), t.keywords("CP05-034")]).toEqual([[], []]);
    const f = d({ me: { hand: ["CP05-033"], deck: ["CP05-034", "V1"], playPoints: 2 } }).play("CP05-033").pick("CP05-034");
    expect([f.field(), f.zone("me", "deck")]).toEqual([["CP05-033", "CP05-034"], ["V1"]]);
    const on = d({ me: { hand: ["CP05-034"], field: ["CP05-033"], deck: ["CP05-033"], playPoints: 2 } }).play("CP05-034");
    expect([on.field(), on.decision?.type]).toEqual([["CP05-033", "CP05-034"], "mainPhase"]);
    // Two entering together (BP08-026 summons them): the first finds the other, the second doesn't (Q2889, Q2891).
    for (const [two, other] of [
      ["CP05-033", "CP05-034"],
      ["CP05-034", "CP05-033"],
    ] as const) {
      const s = d({ me: { field: ["BP08-025"], evolveDeck: ["BP08-026"], cemetery: [two, two], deck: [other, other], playPoints: 3 } });
      s.evolve("BP08-025").pick(two, two).pending().pick(other).flush();
      expect([s.field(), s.zone("me", "deck")]).toEqual([["BP08-025", two, two, other], [other]]);
    }
  });

  it("035 燃え滾る闘志・フェザー — Rush, Ward; Fanfare: a 光晶のエレメント, none into a full EX area", () => {
    const t = d({ me: { hand: ["CP05-035"], playPoints: 3 } }).play("CP05-035").none();
    expect([t.ex(), t.keywords("CP05-035")]).toEqual([[LIGHT], ["rush", "ward"]]);
    const full = d({ me: { hand: ["CP05-035"], ex: ["V1", "V1", "V1", "V1", "V1"], playPoints: 3 } }).play("CP05-035").none();
    expect(full.ex()).toEqual(["V1", "V1", "V1", "V1", "V1"]);
  });

  it("036 信念の蹴撃・ランドル — X less, X = uncaps this turn (ヒヒイロカネ's two count, Q2892); Storm; back to the hand at the start of your end phase", () => {
    const t = d({ me: { hand: ["CP05-036"], field: ["CP05-025"], ex: [HIHI], playPoints: 2 }, opp: { deck: ["V1"] } });
    expect(t.canPlay("CP05-036")).toBe(false);
    t.activate(HIHI).flush();
    expect(t.canPlay("CP05-036")).toBe(true);
    t.play("CP05-036").attack("CP05-036", "opp:leader");
    expect([t.pp(), t.leader("opp"), t.keywords("CP05-036")]).toEqual([0, 18, ["storm"]]);
    t.end();
    expect([t.hand(), t.field()]).toEqual([["CP05-036"], ["CP05-025"]]);
  });
});
