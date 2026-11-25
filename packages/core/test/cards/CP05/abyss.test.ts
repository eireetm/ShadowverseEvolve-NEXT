import { describe, expect, it } from "vitest";
import { drive, type Driver, type DriveSpec } from "../../../src/testing";
import { cardEngine } from "../../helpers";

// CP05 Abysscraft (072–088), a pre-release set implemented from its Japanese text (Granblue Fantasy: CR JP 14.6). V1 is 1c 2/2, V3
// 3c 3/4, V5 5c 5/5; QUICK-SAC (0) destroys one of your followers. Dark (闇属性) cards to discard: CP05-076 / 072 / 082 / 087 / 088;
// CP05-107 is 全属性. BP08-045 (a Runecraft spell, not dark) draws 2 and discards a card. CP05-T12 is the wind element, T14 the dark
// one, T15 ヒヒイロカネ. CP05-062 is a plain cost-5 Granblue follower.
const E = cardEngine();
const d = (spec: DriveSpec) => drive(E, spec);
const n = (count: number, id: string) => Array<string>(count).fill(id);
const SUPER = { superEvolutionPoints: 1, turnsPassed: 8 };

/** The definitions of the cards the current selection offers. */
function offered(t: Driver): string[] {
  const decision = t.decision;
  if (decision?.type !== "selectCards") throw new Error(`expected a card selection, got ${decision?.type ?? "none"}`);
  return decision.candidates.map((id) => t.game.state.cards[id]!.def);
}

/** The attack of each card of a definition on my field, in field order. */
const attacks = (t: Driver, def: string): (number | null)[] => t.ids(`${def}@field`).map((id) => t.game.reader().info(id).attack);

/** Play the pending ability that is ability `index` of its card's script (one card's two pending abilities share a source). */
function pendingAbility(t: Driver, index: number): Driver {
  const decision = t.decision;
  if (decision?.type !== "selectPending") throw new Error(`expected pending abilities, got ${decision?.type ?? "none"}`);
  const id = decision.options.find((o) => t.game.state.pending.find((p) => p.id === o)?.ability === index);
  if (id === undefined) throw new Error(`no pending ability #${index}`);
  return t.answer({ type: "selectPending", id });
}

describe("CP05 Abysscraft", () => {
  it("072 神狼・シス — during your turn, discarded by the ability of your dark (or 全属性) card: (3) summon it; not by another card's", () => {
    const t = d({ me: { hand: ["CP05-087", "CP05-072"], deck: ["V1"], playPoints: 4 } }).play("CP05-087").yes().yes();
    expect([t.field(), t.pp(), t.cemetery()]).toEqual([["CP05-072"], 0, ["CP05-087"]]);
    // The cost may be left unpaid (CR 10.4.7.4).
    const no = d({ me: { hand: ["CP05-087", "CP05-072"], deck: ["V1"], playPoints: 4 } }).play("CP05-087").yes().no();
    expect([no.field(), no.cemetery(), no.pp()]).toEqual([[], ["CP05-072", "CP05-087"], 3]);
    // A 全属性 card is referenced as a dark one (CR JP 14.6.2.2): グラン＆ジータ's Fanfare discards it as its process.
    const all = d({ me: { hand: ["CP05-107", "CP05-072"], deck: ["V1", "V3"], playPoints: 5 } }).play("CP05-107").yes().yes();
    expect([all.field(), all.pp(), all.hand()]).toEqual([["CP05-107", "CP05-072"], 0, ["V1", "V3"]]);
    // Discarded by a card that isn't dark: no trigger (the 3 play points it would ask for are there).
    const other = d({ me: { hand: ["BP08-045", "CP05-072"], deck: ["V1", "V3"], playPoints: 5 } }).play("BP08-045").pick("CP05-072");
    expect([other.field(), other.pp(), other.decision?.type]).toEqual([[], 3, "mainPhase"]);
  });

  it("072 神狼・シス — Final Uncap; uncapped: Storm; final-uncapped, (2): another 神狼・シス from the deck; ヒヒイロカネ: both, in any order (Q2867, Q2868)", () => {
    const t = d({ me: { field: [{ card: "CP05-072", enteredThisTurn: true }], ex: ["CP05-T14", "CP05-T14"], deck: ["V1", "CP05-072"], playPoints: 2 } });
    expect(t.attackTargets("CP05-072")).toEqual([]);
    t.activate("CP05-T14");
    expect([t.keywords("CP05-072"), t.stats("CP05-072"), t.attackTargets("CP05-072")]).toEqual([["finalUncap", "storm"], [4, 2], ["opp:leader"]]);
    // An uncapped one final-uncaps instead (+1/+1 more); the one found is a new card, neither uncapped nor with Storm (CR 4.1.4).
    t.activate("CP05-T14").yes().pick("CP05-072");
    const [first, found] = t.ids("CP05-072@field");
    const r = t.game.reader();
    expect([r.info(first!).attack, r.info(first!).defense, r.info(found!).keywords, r.info(found!).attack, t.pp()]).toEqual([5, 3, ["finalUncap"], 3, 0]);
    const h = d({ me: { field: ["CP05-072"], ex: ["CP05-T15"], deck: ["CP05-072"], playPoints: 2 } }).activate("CP05-T15");
    expect(h.decision).toMatchObject({ type: "selectPending", options: [expect.any(String), expect.any(String)] });
    pendingAbility(h, 2).yes().pick("CP05-072"); // the final uncap's first, then the uncap's
    expect([h.keywords("CP05-072"), h.stats("CP05-072"), h.field()]).toEqual([["finalUncap", "storm"], [5, 3], ["CP05-072", "CP05-072"]]);
  });

  it("073 繊細の魔奏者・ニオ — Final Uncap; uncapped: an enemy follower -1/-1; final-uncapped: -2/-2; ヒヒイロカネ: both (Q2868); not the dark element's", () => {
    const t = d({ me: { field: ["CP05-073"], ex: ["CP05-T12", "CP05-T12"] }, opp: { field: ["V5", "V3"] } });
    t.activate("CP05-T12").pick("opp:V3");
    expect([t.stats("CP05-073"), t.stats("opp:V3")]).toEqual([[2, 1], [2, 3]]);
    t.activate("CP05-T12").pick("opp:V3");
    expect([t.stats("CP05-073"), t.stats("opp:V3")]).toEqual([[3, 2], [0, 1]]);
    // Each selects its target when it is played (CR 10.6.2.3), in the order chosen (Q2867).
    const h = d({ me: { field: ["CP05-073"], ex: ["CP05-T15"] }, opp: { field: ["V5", "V3"] } }).activate("CP05-T15");
    pendingAbility(h, 1).pick("opp:V5").pick("opp:V3");
    expect([h.stats("opp:V5"), h.stats("opp:V3"), h.stats("CP05-073")]).toEqual([[3, 3], [2, 3], [3, 2]]);
    // Without an enemy follower nothing is played (CR 10.6.2.3.3).
    const none = d({ me: { field: ["CP05-073"], ex: ["CP05-T12"] } }).activate("CP05-T12");
    expect([none.stats("CP05-073"), none.decision?.type]).toEqual([[2, 1], "mainPhase"]);
    // A wind follower: the dark element can't select it.
    expect(d({ me: { field: ["CP05-073"], ex: ["CP05-T14"] } }).canActivate("CP05-T14")).toBe(false);
  });

  it("074 闇の理・フェディエル — Evolve (1); whenever you discard a dark card (a process's discard too): 1 damage to each enemy leader and follower", () => {
    // 087's process discards 082: 1 damage each (082's own ability can't be paid: no play points left).
    const t = d({ me: { field: ["CP05-074"], hand: ["CP05-087", "CP05-082"], deck: ["V1"], playPoints: 1 }, opp: { field: ["V5", "V3"] } });
    t.play("CP05-087").yes().flush();
    expect([t.leader("opp"), t.stats("opp:V5"), t.stats("opp:V3")]).toEqual([19, [5, 4], [3, 3]]);
    // A card that isn't dark: nothing.
    const plain = d({ me: { field: ["CP05-074"], hand: ["BP08-045", "V1"], deck: ["V3", "V5"], playPoints: 2 } }).play("BP08-045").pick("V1");
    expect(plain.leader("opp")).toBe(20);
    // Evolve (1): no hand to discard, so On Evolve asks nothing.
    const e = d({ me: { field: ["CP05-074"], evolveDeck: ["CP05-075"], playPoints: 1 } }).evolve("CP05-074");
    expect([e.stats("CP05-074"), e.decision?.type]).toEqual([[4, 4], "mainPhase"]);
  });

  it("075 闇の理・フェディエル — On Evolve, discard 2: draw 2; On Super Evolve: up to 2 cards with different names but not its own from the cemetery, then discard a card (Q2871, Q2872)", () => {
    const t = d({
      me: { field: ["CP05-074"], evolveDeck: ["CP05-075"], hand: ["CP05-087", "CP05-088"], cemetery: ["CP05-074", "V1", "V1"], deck: ["V3", "V5"], playPoints: 1, ...SUPER },
      opp: { field: ["V5"] },
    });
    t.evolve("CP05-074", { sep: true });
    // Super-evolving triggers On Evolve too; they resolve in either order (Q2871, Q2872).
    expect(t.decision).toMatchObject({ type: "selectPending", options: [expect.any(String), expect.any(String)] });
    // On Evolve first: 087 and 088 discarded together — both dark, so its first ability triggers twice (Q2915).
    pendingAbility(t, 1).yes();
    expect([t.hand(), t.cemetery()]).toEqual([["V3", "V5"], ["CP05-074", "V1", "V1", "CP05-087", "CP05-088"]]);
    // On Super Evolve selects when it is played (CR 10.6.2.3): the cards just discarded, not the other 闇の理・フェディエル; one at
    // a time, a name already selected is not offered again.
    t.flush();
    expect(offered(t)).toEqual(["V1", "V1", "CP05-087", "CP05-088"]);
    t.pick("V1");
    expect(offered(t)).toEqual(["CP05-087", "CP05-088"]);
    t.pick("CP05-087").pick("V3").flush();
    expect([t.hand(), t.cemetery(), t.leader("opp"), t.stats("opp:V5"), t.stats("CP05-074")]).toEqual([
      ["V5", "V1", "CP05-087"],
      ["CP05-074", "V1", "CP05-088", "V3"],
      18,
      [5, 3],
      [5, 5],
    ]);
    // On Evolve with fewer than 2 cards in hand can't be paid (CR 10.4.2.2): nothing is asked.
    const one = d({ me: { field: ["CP05-074"], evolveDeck: ["CP05-075"], hand: ["V1"], deck: ["V3"], playPoints: 1 } }).evolve("CP05-074");
    expect([one.hand(), one.decision?.type]).toEqual([["V1"], "mainPhase"]);
    // Nothing to select (the only card is another 闇の理・フェディエル): a card is still discarded, its own sentence. On Evolve,
    // played after it, then can't be paid.
    const empty = d({ me: { field: ["CP05-074"], evolveDeck: ["CP05-075"], hand: ["V1", "V3"], cemetery: ["CP05-074"], playPoints: 1, ...SUPER } });
    pendingAbility(empty.evolve("CP05-074", { sep: true }), 2).pick("V1");
    expect([empty.hand(), empty.cemetery(), empty.decision?.type]).toEqual([["V3"], ["CP05-074", "V1"], "mainPhase"]);
  });

  it("074 / 075 / 079 / 084 / 085 — 2 dark cards discarded together: Fediel's and Lady Grey's abilities trigger twice (Q2915), セレスト・マグナ's once (CR 10.7.2.2)", () => {
    const t = d({
      me: {
        field: ["CP05-074", "CP05-079", "CP05-084", { card: "CP05-084", evolvedInto: "CP05-085" }],
        evolveDeck: ["CP05-075"],
        hand: ["CP05-087", "CP05-088"],
        deck: ["V3", "V5"],
        playPoints: 1,
      },
      opp: { field: ["V5", "V3"] },
    });
    t.evolve("CP05-074").yes().flush().pick("opp:V5").flush();
    // Lady Grey 0/2 and evolved 1/3: +2 attack each.
    expect([attacks(t, "CP05-084"), t.leader("opp"), t.stats("opp:V5"), t.stats("opp:V3"), t.decision?.type]).toEqual([[2, 3], 18, [5, 2], [3, 2], "mainPhase"]);
    // A card that isn't dark (V1, discarded by BP08-045) triggers none of them.
    const plain = d({
      me: { field: ["CP05-079", "CP05-084", { card: "CP05-084", evolvedInto: "CP05-085" }], hand: ["BP08-045"], deck: ["V1", "V3"], playPoints: 2 },
      opp: { field: ["V5", "V3"] },
    }).play("BP08-045").pick("V1");
    expect([attacks(plain, "CP05-084"), plain.stats("opp:V5"), plain.stats("opp:V3"), plain.decision?.type]).toEqual([[0, 1], [5, 5], [3, 4], "mainPhase"]);
  });

  it("076 幽想の少女・フェリ — during your turn, discarded by the ability of your dark card: summoned; not by the hand limit (CR 7.4.7), where 074 still triggers", () => {
    // セレスト・マグナ's cost discards it; its own trigger has no enemy follower to select.
    const t = d({ me: { field: ["CP05-079"], hand: ["CP05-076"], deck: ["V1", "V3"] } }).activate("CP05-079").no().flush();
    expect([t.field(), t.zone("me", "deck")]).toEqual([["CP05-079", "CP05-076"], ["V1", "V3"]]);
    const end = d({ me: { field: ["CP05-074"], hand: ["CP05-076", ...n(7, "V1")] }, opp: { deck: ["V1"] } }).end().pick("CP05-076");
    expect([end.field(), end.cemetery(), end.leader("opp")]).toEqual([["CP05-074"], ["CP05-076"], 19]);
  });

  it("076 / 077 幽想の少女・フェリ — Evolve (1), evolved: draw; Final Uncap; final-uncapped, (3): refresh up to 2 other dark followers", () => {
    // ヒヒイロカネ: uncapped and final-uncapped at once; it has only the final uncap's ability. Other dark followers, a reserved one
    // too (refreshing it does nothing, CR 1.3.2.1); not V1.
    const t = d({
      me: {
        field: ["CP05-076", { card: "CP05-084", engaged: true }, { card: "CP05-074", engaged: true }, { card: "V1", engaged: true }, "CP05-082"],
        ex: ["CP05-T15"],
        playPoints: 3,
      },
    });
    t.activate("CP05-T15").pick("CP05-076").yes();
    expect(offered(t)).toEqual(["CP05-084", "CP05-074", "CP05-082"]);
    t.pick("CP05-084", "CP05-074");
    expect([t.engaged("CP05-084"), t.engaged("CP05-074"), t.engaged("V1"), t.pp(), t.stats("CP05-076")]).toEqual([false, false, true, 0, [3, 2]]);
    // Uncapped, then evolved: it stays uncapped (CR 5.16.2), so the element final-uncaps it — the evolved card's ability.
    const e = d({
      me: { field: [{ card: "CP05-076", evolvedInto: "CP05-077", uncappedWith: [{ card: "CP05-T14", uncaps: ["uncap"] }] }, { card: "CP05-084", engaged: true }], ex: ["CP05-T14"], playPoints: 3 },
    });
    e.activate("CP05-T14").pick("CP05-076").yes().pick("CP05-084");
    expect([e.engaged("CP05-084"), e.stats("CP05-076"), e.pp()]).toEqual([false, [3, 2], 0]);
    const draw = d({ me: { field: ["CP05-076"], evolveDeck: ["CP05-077"], deck: ["V1"], playPoints: 1 } }).evolve("CP05-076");
    expect([draw.hand(), draw.stats("CP05-076"), draw.pp()]).toEqual([["V1"], [1, 1], 0]);
  });

  it("078 生滅の技巧・ネハン — Fanfare: top 5, may summon a Granblue follower of original cost 5 not named like this; the rest on the bottom in any order", () => {
    const t = d({ me: { hand: ["CP05-078"], deck: ["CP05-078", "V5", "CP05-083", "CP05-062", "CP05-072", "V1"], playPoints: 5 } }).play("CP05-078");
    expect(offered(t)).toEqual(["CP05-062"]);
    t.pick("CP05-062").order();
    expect([t.field(), t.zone("me", "deck")]).toEqual([["CP05-078", "CP05-062"], ["V1", "CP05-078", "V5", "CP05-083", "CP05-072"]]);
  });

  it("079 セレスト・マグナ — once per turn, when you discard a dark card: 1 damage to an enemy follower; act, engage, discard a dark card: look at the top card, may put it on the bottom", () => {
    const t = d({ me: { field: ["CP05-079"], hand: ["CP05-087", "CP05-082", "CP05-076"], deck: ["V1", "V3", "V5"], playPoints: 1 }, opp: { field: ["V5", "V3"] } });
    t.activate("CP05-079").pick("CP05-076").yes().flush().pick("opp:V5").flush();
    expect([t.zone("me", "deck"), t.engaged("CP05-079"), t.field(), t.stats("opp:V5")]).toEqual([["V3", "V5", "V1"], true, ["CP05-079", "CP05-076"], [5, 4]]);
    // The second dark card this turn (087 discards 082): no trigger.
    t.play("CP05-087").yes().flush();
    expect([t.stats("opp:V5"), t.stats("opp:V3"), t.ex(), t.decision?.type]).toEqual([[5, 4], [3, 4], ["CP05-T14", "CP05-T14"], "mainPhase"]);
    // Kept, the card stays on top, unrevealed (CR 5.11).
    const kept = d({ me: { field: ["CP05-079"], hand: ["CP05-082"], deck: ["V1", "V3"] } }).activate("CP05-079").no().flush();
    expect([kept.zone("me", "deck"), kept.events.some((e) => e.type === "cardsRevealed"), kept.decision?.type]).toEqual([["V1", "V3"], false, "mainPhase"]);
  });

  it("080 / 081 降魔の操者・ダヌア — Evolve (1); evolved: search your deck for a Granblue follower of original cost 5", () => {
    const t = d({ me: { field: ["CP05-080"], evolveDeck: ["CP05-081"], deck: ["V5", "CP05-083", "CP05-078", "CP05-062"], playPoints: 1 } }).evolve("CP05-080");
    expect(offered(t)).toEqual(["CP05-078", "CP05-062"]);
    t.pick("CP05-078");
    // A search with a condition: the card found is revealed (CR 5.8.1.2) ...
    const revealed = t.events.flatMap((e) => (e.type === "cardsRevealed" ? e.cards.map((c) => c.def) : []));
    expect([t.hand(), t.stats("CP05-080"), revealed]).toEqual([["CP05-078"], [2, 2], ["CP05-078"]]);
    // ... and may be left unfound (CR 4.1.2.2), even with a single candidate.
    const none = d({ me: { field: ["CP05-080"], evolveDeck: ["CP05-081"], deck: ["V5", "CP05-062"], playPoints: 1 } }).evolve("CP05-080").none();
    expect([none.hand(), none.zone("me", "deck").length, none.decision?.type]).toEqual([[], 2, "mainPhase"]);
  });

  it("082 冥闇の剛刃・バザラガ — discarded by the ability of your dark card, (1): 3 damage; uncapped: gains 'Last Words: summon this'; Fanfare: destroy", () => {
    const f = d({ me: { hand: ["CP05-082"], playPoints: 7 }, opp: { field: ["V5", "V3"] } }).play("CP05-082").pick("opp:V5");
    expect(f.field("opp")).toEqual(["V3"]);
    const t = d({ me: { hand: ["CP05-087", "CP05-082"], deck: ["V1"], playPoints: 2 }, opp: { field: ["V5", "V3"] } }).play("CP05-087").yes().yes().pick("opp:V3");
    expect([t.stats("opp:V3"), t.pp(), t.cemetery()]).toEqual([[3, 1], 0, ["CP05-082", "CP05-087"]]);
    // Without an enemy follower it isn't played, and its cost isn't asked (CR 10.6.2.3.3).
    const none = d({ me: { hand: ["CP05-087", "CP05-082"], deck: ["V1"], playPoints: 2 } }).play("CP05-087").yes();
    expect([none.pp(), none.decision?.type]).toEqual([1, "mainPhase"]);
    // Uncapped (5/7), destroyed: Last Words summons it back, a new card whose Fanfare destroys again (CR 12.4.3); the element is
    // eliminated (CR JP 11.12.1), and the new card has no Last Words (CR 4.1.4).
    const u = d({ me: { field: ["CP05-082"], ex: ["CP05-T14"], hand: ["QUICK-SAC", "QUICK-SAC"] }, opp: { field: ["V5", "V3"] } }).activate("CP05-T14");
    expect(u.stats("CP05-082")).toEqual([5, 7]);
    u.play("QUICK-SAC").pick("opp:V3");
    expect([u.field(), u.field("opp"), u.stats("CP05-082"), u.zone("me", "uncapZone")]).toEqual([["CP05-082"], ["V5"], [4, 7], []]);
    u.play("QUICK-SAC");
    expect([u.field(), u.cemetery().includes("CP05-082")]).toEqual([[], true]);
  });

  it("083 コラプション — additional cost: discard a dark card; 5 damage to each follower, then 2 to each enemy leader (Q2916)", () => {
    expect(d({ me: { hand: ["CP05-083", "V1"], playPoints: 5 } }).canPlay("CP05-083")).toBe(false);
    expect(d({ me: { hand: ["CP05-083", "CP05-107"], playPoints: 5 } }).canPlay("CP05-083")).toBe(true); // 全属性 (CR JP 14.6.2.2)
    // The cost discards 072: Fediel's and Lady Grey's abilities trigger; both die, and Fediel's still resolves (Q2916). 072 was
    // discarded by this dark card's ability: (3) summons it after the spell, unhurt.
    const t = d({ me: { field: ["CP05-074", "CP05-084"], hand: ["CP05-083", "CP05-072"], playPoints: 8 }, opp: { field: ["V5", "V3"] } });
    t.play("CP05-083").flush().yes().flush();
    expect([t.field(), t.field("opp"), t.leader("opp"), t.pp(), t.stats("CP05-072")]).toEqual([["CP05-072"], [], 17, 0, [3, 2]]);
  });

  it("084 心眼の双葬女・レディ・グレイ — Evolve (1); Drain; +1 attack for each dark card you discard; Fanfare: a 闇晶のエレメント into your EX area", () => {
    const t = d({ me: { hand: ["CP05-084", "CP05-087", "CP05-076"], deck: ["V1"], playPoints: 3 } }).play("CP05-084");
    expect([t.ex(), t.keywords("CP05-084"), t.stats("CP05-084")]).toEqual([["CP05-T14"], ["drain"], [0, 2]]);
    t.play("CP05-087").yes().flush();
    expect([t.stats("CP05-084"), t.ex(), t.field()]).toEqual([[1, 2], n(3, "CP05-T14"), ["CP05-084", "CP05-076"]]);
    // A full EX area takes no element (CR 4.8.3.2).
    expect(d({ me: { hand: ["CP05-084"], ex: n(5, "CP05-T14"), playPoints: 2 } }).play("CP05-084").ex()).toEqual(n(5, "CP05-T14"));
    expect(d({ me: { field: ["CP05-084"], evolveDeck: ["CP05-085"], playPoints: 1 } }).canEvolve("CP05-084")).toBe(true);
  });

  it("085 心眼の双葬女・レディ・グレイ — Drain; +1 attack per dark card discarded; On Evolve, discard a dark card: draw (its own +1 triggers)", () => {
    const t = d({ me: { field: ["CP05-084"], evolveDeck: ["CP05-085"], hand: ["CP05-076", "V1"], deck: ["V3"], playPoints: 1, leaderDefense: 10 } });
    t.evolve("CP05-084").yes().flush();
    expect([t.stats("CP05-084"), t.hand(), t.field(), t.keywords("CP05-084")]).toEqual([[2, 3], ["V1", "V3"], ["CP05-084", "CP05-076"], ["drain"]]);
    t.attack("CP05-084", "opp:leader");
    expect([t.leader("opp"), t.leader()]).toEqual([18, 12]);
  });

  it("086 自由を駆ける漢・スカル — Storm with 4 faceup earth (or 全属性) evolved followers in your evolve deck; Fanfare: may turn one faceup", () => {
    const t = d({
      me: { hand: ["CP05-086"], evolveDeck: ["CP05-032", "CP05-109", "CP05-075"], faceUpEvolveDeck: ["CP05-042", "CP05-046", "CP05-092"], playPoints: 1 },
    });
    t.play("CP05-086");
    // 3 on the field: no Storm yet; the Fanfare offers the facedown earth ones, not the dark CP05-075.
    expect([t.keywords("CP05-086"), offered(t)]).toEqual([[], ["CP05-032", "CP05-109"]]);
    t.pick("CP05-109"); // 全属性 counts as earth (CR JP 14.6.2.2)
    const faceUp = t.game.reader().faceUpEvolveDeck(0).map((id) => t.game.state.cards[id]!.def);
    expect([t.keywords("CP05-086"), t.attackTargets("CP05-086"), faceUp.includes("CP05-109")]).toEqual([["storm"], ["opp:leader"], true]);
    // Only earth ones count: with a faceup dark evolved follower (CP05-075) as the fourth, no Storm.
    expect(d({ me: { field: ["CP05-086"], faceUpEvolveDeck: ["CP05-042", "CP05-046", "CP05-092", "CP05-075"] } }).keywords("CP05-086")).toEqual([]);
    // The Fanfare may turn none faceup (てよい).
    const no = d({ me: { hand: ["CP05-086"], evolveDeck: ["CP05-032", "CP05-109"], faceUpEvolveDeck: ["CP05-042", "CP05-046", "CP05-092"], playPoints: 1 } });
    no.play("CP05-086").none();
    expect([no.keywords("CP05-086"), no.game.reader().faceUpEvolveDeck(0).length]).toEqual([[], 3]);
    // A follower's passive works on the field only (CR 10.3.5): in the hand it has no Storm.
    const hand = d({ me: { hand: ["CP05-086"], faceUpEvolveDeck: ["CP05-032", "CP05-042", "CP05-046", "CP05-092"] } });
    expect(hand.keywords("CP05-086")).toEqual([]);
  });

  it("087 エーヴィヒ・カメラート — Quick; discard a dark card: 2 闇晶のエレメント into your EX area and draw; without one, or declined, nothing", () => {
    const t = d({ me: { hand: ["CP05-087", "CP05-076", "V1"], deck: ["V3"], playPoints: 1 } }).play("CP05-087").yes();
    expect([t.ex(), t.hand(), t.field()]).toEqual([["CP05-T14", "CP05-T14"], ["V1", "V3"], ["CP05-076"]]);
    const none = d({ me: { hand: ["CP05-087", "V1"], deck: ["V3"], playPoints: 1 } }).play("CP05-087");
    expect([none.ex(), none.hand(), none.decision?.type]).toEqual([[], ["V1"], "mainPhase"]);
    const no = d({ me: { hand: ["CP05-087", "CP05-076"], deck: ["V3"], playPoints: 1 } }).play("CP05-087").no();
    expect([no.ex(), no.hand()]).toEqual([[], ["CP05-076"]]);
    // Room for 1: only 1 (CR 4.8.3.2); the draw still happens.
    const full = d({ me: { hand: ["CP05-087", "V1", "CP05-082"], ex: n(4, "CP05-T14"), deck: ["V3"], playPoints: 1 } }).play("CP05-087").yes();
    expect([full.ex(), full.hand()]).toEqual([n(5, "CP05-T14"), ["V1", "V3"]]);
  });

  it("088 ストーン・ブレイク — Quick; choose: 2 damage, or discard a dark card: 3 damage and 1 to its leader; without an enemy follower it can't be played (Q2917)", () => {
    const one = d({ me: { hand: ["CP05-088"], playPoints: 1 }, opp: { field: ["V3"] } }).play("CP05-088").choose("1");
    expect([one.stats("opp:V3"), one.leader("opp")]).toEqual([[3, 2], 20]);
    const two = d({ me: { hand: ["CP05-088", "CP05-076"], playPoints: 1 }, opp: { field: ["V5", "V3"] } }).play("CP05-088").choose("2").pick("opp:V5").yes();
    expect([two.stats("opp:V5"), two.leader("opp"), two.field()]).toEqual([[5, 2], 19, ["CP05-076"]]);
    // Chosen without executing the process: nothing (BP03-117 ruling).
    const unpaid = d({ me: { hand: ["CP05-088", "CP05-076"], playPoints: 1 }, opp: { field: ["V5"] } }).play("CP05-088").choose("2").no();
    expect([unpaid.stats("opp:V5"), unpaid.leader("opp"), unpaid.hand()]).toEqual([[5, 5], 20, ["CP05-076"]]);
    expect(d({ me: { hand: ["CP05-088", "CP05-076"], playPoints: 1 } }).canPlay("CP05-088")).toBe(false);
  });

  it("074 / 079 / 084 / 085 / 076 / 087 — in the opponent's turn the discard abilities trigger (Q2914); 幽想の少女・フェリ doesn't (during your turn)", () => {
    const t = d({
      turn: 6,
      me: { field: ["CP05-074", "CP05-079", "CP05-084", { card: "CP05-084", evolvedInto: "CP05-085" }], hand: ["CP05-087", "CP05-076"], deck: ["V1"], playPoints: 1 },
      opp: { field: ["V5", "V3"] },
    });
    t.attack("opp:V5", "leader").quick("CP05-087").yes().flush().pick("opp:V3").flush();
    expect([t.field(), t.cemetery(), t.ex(), t.leader("opp"), t.stats("opp:V5"), t.stats("opp:V3"), attacks(t, "CP05-084"), t.leader()]).toEqual([
      ["CP05-074", "CP05-079", "CP05-084", "CP05-084"],
      ["CP05-076", "CP05-087"],
      ["CP05-T14", "CP05-T14"],
      19,
      [5, 4],
      [3, 2],
      [1, 2],
      15,
    ]);
  });

  it("072 / 082 / 088 — in the opponent's turn 冥闇の剛刃・バザラガ discarded by your quick spell triggers, 神狼・シス doesn't (during your turn)", () => {
    // Enough play points for 神狼・シス's (3) after 087: it isn't asked.
    const t = d({ turn: 6, me: { hand: ["CP05-087", "CP05-088", "CP05-072", "CP05-082"], deck: ["V1"], playPoints: 5 }, opp: { field: ["V5", "V3"] } });
    t.attack("opp:V5", "leader").quick("CP05-087").yes().pick("CP05-072");
    t.quick("CP05-088").choose("2").pick("opp:V3").yes().yes().pick("opp:V5");
    expect([t.field(), t.cemetery(), t.stats("opp:V5"), t.stats("opp:V3"), t.leader("opp"), t.pp(), t.leader()]).toEqual([
      [],
      ["CP05-072", "CP05-087", "CP05-082", "CP05-088"],
      [5, 2],
      [3, 1],
      19,
      2,
      15,
    ]);
  });

  it("072 / 073 / 082 / 084 — what they gain or give has no duration: still there two turns later (CR 10.2.1.2, 10.9.2)", () => {
    const t = d({
      me: { field: ["CP05-072", "CP05-073", "CP05-082", "CP05-084"], ex: ["CP05-T14", "CP05-T14", "CP05-T12"], hand: ["CP05-087", "CP05-076", "QUICK-SAC"], deck: ["V1", "V3"], playPoints: 1 },
      opp: { field: ["V5", "V3"], deck: ["V1"] },
    });
    // 神狼・シス: Storm; 冥闇の剛刃・バザラガ: "Last Words: summon this"; ニオ (wind element): V5 -1/-1; 087's discard: Lady Grey +1.
    t.activate("CP05-T14").pick("CP05-072").activate("CP05-T14").pick("CP05-082").activate("CP05-T12").pick("opp:V5");
    t.play("CP05-087").yes().flush();
    expect([t.keywords("CP05-072"), t.stats("opp:V5"), attacks(t, "CP05-084")]).toEqual([["finalUncap", "storm"], [4, 4], [1]]);
    t.end().end().quick(); // the opponent's turn; QUICK-SAC isn't played in its end phase
    expect([t.game.state.turn, t.keywords("CP05-072"), t.stats("opp:V5"), attacks(t, "CP05-084")]).toEqual([7, ["finalUncap", "storm"], [4, 4], [1]]);
    t.play("QUICK-SAC").pick("CP05-082").pick("opp:V3");
    expect([t.field().filter((c) => c === "CP05-082"), t.field("opp")]).toEqual([["CP05-082"], ["V5"]]);
  });
});
