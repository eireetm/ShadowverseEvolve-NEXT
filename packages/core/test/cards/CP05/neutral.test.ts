import { describe, expect, it } from "vitest";
import { createEngine, script, type CardDefinition, type CardScript } from "../../../src";
import { traitMatches } from "../../../src/model/traits";
import { yourFollower } from "../../../src/script/targets";
import { ALL_CARDS, ALL_SCRIPTS } from "../../../src/sets";
import { drive, testFollower, testSpell, type DriveSpec } from "../../../src/testing";
import { TEST_CARDS, TEST_SCRIPTS } from "../../helpers";

// CP05 Neutral (105–111) and the treasures (T09–T15). A pre-release set implemented from the Japanese text (its card names are
// the Japanese ones); its rules are the Japanese ones (CR JP 14.6). V1 is 1c 2/2, V2 2c 2/3, V3 3c 3/4, V5 5c 5/5 (no traits).
// Synthetic cards: A-FIRE … A-DARK, 1c 1/1 Granblue followers of each attribute; QACT1, a 1c follower with a quick activated
// ability, QACT2 the same costing 2, ACT1 a 1c follower with an activated ability that isn't quick; BOTH, a 1c 1/1 Granblue
// 全属性 follower with Final Uncap that draws a card when it uncaps and gives its leader +1 defense when it final-uncaps;
// DARK-DISC, a Granblue card that draws a card when a dark card of yours discards it; SILENCE, a spell: a follower of yours
// loses all abilities.
const { activated, defineCard, spell, whenDiscardedByYourCard, whenThisIsFinalUncapped, whenThisIsUncapped } = script;
const nothing = {
  *resolve() {
    // no effect
  },
};
const ATTRIBUTES: Record<string, string> = { FIRE: "火属性", WATER: "水属性", EARTH: "土属性", WIND: "風属性", LIGHT: "光属性", DARK: "闇属性" };
const CARDS: CardDefinition[] = [
  ...Object.entries(ATTRIBUTES).map(([name, trait]) => testFollower(`A-${name}`, 1, 1, 1, { traits: ["グラブル", trait] })),
  testFollower("QACT1", 1, 1, 1),
  testFollower("QACT2", 2, 2, 2),
  testFollower("ACT1", 1, 1, 1),
  testFollower("BOTH", 1, 1, 1, { traits: ["グラブル", "全属性"] }),
  testFollower("DARK-DISC", 1, 1, 1, { traits: ["グラブル"] }),
  testSpell("SILENCE", 0),
];
const SCRIPTS: Record<string, CardScript> = {
  QACT1: defineCard({ abilities: [activated({ playPoints: 0 }, { quick: true, ...nothing })] }),
  QACT2: defineCard({ abilities: [activated({ playPoints: 0 }, { quick: true, ...nothing })] }),
  ACT1: defineCard({ abilities: [activated({ playPoints: 0 }, nothing)] }),
  BOTH: defineCard({
    keywords: ["finalUncap"],
    abilities: [
      whenThisIsUncapped({
        *resolve(fx) {
          yield* fx.draw(1);
        },
      }),
      whenThisIsFinalUncapped({
        *resolve(fx) {
          yield* fx.giveLeaderDefense(fx.controller, 1);
        },
      }),
    ],
  }),
  "DARK-DISC": defineCard({
    abilities: [
      whenDiscardedByYourCard(
        {
          *resolve(fx) {
            yield* fx.draw(1);
          },
        },
        (by) => traitMatches(by.traits, "闇属性"),
      ),
    ],
  }),
  SILENCE: defineCard({
    abilities: [
      spell({
        targets: [yourFollower()],
        *resolve(fx) {
          yield* fx.loseAbilities(fx.targets[0]![0]!, null);
        },
      }),
    ],
  }),
};
const E = createEngine({ cards: [...ALL_CARDS, ...TEST_CARDS, ...CARDS], scripts: { ...ALL_SCRIPTS, ...TEST_SCRIPTS, ...SCRIPTS } });
const d = (spec: DriveSpec) => drive(E, spec);
type T = ReturnType<typeof d>;

/** The definitions offered by the current card selection. */
function candidates(t: T): string[] {
  const dec = t.decision;
  if (dec?.type !== "selectCards") throw new Error(`expected a card selection, got ${dec?.type ?? "none"}`);
  return dec.candidates.map((id) => t.game.state.cards[id]!.def);
}
/** Back at the main phase: nothing more is asked. */
const main = (t: T) => t.decision?.type === "mainPhase";
const evolved = (t: T, ref: string) => t.game.reader().info(t.id(ref)).evolved;
const uncapped = (t: T, ref: string) => [t.game.reader().isUncapped(t.id(ref)), t.game.reader().isFinalUncapped(t.id(ref))];
const uncaps = (t: T) => t.game.reader().uncapsThisTurn(0);
const uncapZone = (t: T) => [...t.zone("me", "uncapZone")].sort();
const ELEMENTS: readonly (readonly [string, string, string])[] = [
  ["CP05-T09", "A-FIRE", "A-WATER"],
  ["CP05-T10", "A-WATER", "A-FIRE"],
  ["CP05-T11", "A-EARTH", "A-WIND"],
  ["CP05-T12", "A-WIND", "A-EARTH"],
  ["CP05-T13", "A-LIGHT", "A-DARK"],
  ["CP05-T14", "A-DARK", "A-LIGHT"],
];

describe("CP05 Neutral", () => {
  it("105 天司長の後継・サンダルフォン — Ward; Fanfare: up to 2 enemy followers and each enemy leader 2 damage; without SEP, evolve this and leader +2 (Q2923, Q2924)", () => {
    // With the super-evolution point every player starts with (CR 6.2.1.11): no evolving, no +2.
    const t = d({ me: { hand: ["CP05-105"], evolveDeck: ["CP05-106"], playPoints: 5 }, opp: { field: ["V5", "V3", "V1"] } });
    t.play("CP05-105").none();
    expect(t.decision).toMatchObject({ type: "selectCards", min: 0, max: 2 }); // up to 2 of the 3
    t.pick("opp:V5", "opp:V3");
    expect([t.stats("opp:V5"), t.stats("opp:V3"), t.stats("opp:V1"), t.leader("opp"), t.leader(), evolved(t, "CP05-105")]).toEqual([
      [5, 3],
      [3, 2],
      [2, 2],
      18,
      20,
      false,
    ]);
    expect(t.keywords("CP05-105")).toEqual(["ward"]);
    // Without one: it evolves (106's On Evolve follows) and the leader gets +2. Q2923: the turn's evolve is still there.
    const evo = d({
      me: { hand: ["CP05-105"], field: ["CP05-108"], evolveDeck: ["CP05-106", "CP05-109"], superEvolutionPoints: 0, playPoints: 6 },
      opp: { field: ["V5"] },
    });
    evo.play("CP05-105").none().pick("opp:V5").yes().pick("opp:V5");
    expect([evolved(evo, "CP05-105"), evo.stats("CP05-105"), evo.stats("opp:V5"), evo.leader("opp"), evo.leader()]).toEqual([true, [5, 5], [5, 1], 16, 22]);
    expect(evo.canEvolve("CP05-108")).toBe(true);
    // Q2923 the other way round: with the turn's evolve already used (on 108), the Fanfare still evolves it.
    const after = d({ me: { hand: ["CP05-105"], field: ["CP05-108"], evolveDeck: ["CP05-109", "CP05-106"], superEvolutionPoints: 0, playPoints: 6 } });
    after.evolve("CP05-108").play("CP05-105").none().yes();
    expect([evolved(after, "CP05-108"), evolved(after, "CP05-105"), after.leader("opp"), after.leader()]).toEqual([true, true, 16, 22]);
    // Q2924: with no enemy follower it is played, selecting none; the evolving declined, the +2 is given all the same — and
    // without an evolved card to evolve into (CR 5.16.1.1, 1.3.2).
    const declined = d({ me: { hand: ["CP05-105"], evolveDeck: ["CP05-106"], superEvolutionPoints: 0, playPoints: 5 } });
    declined.play("CP05-105").none().no();
    expect([evolved(declined, "CP05-105"), declined.leader("opp"), declined.leader()]).toEqual([false, 18, 22]);
    const cant = d({ me: { hand: ["CP05-105"], superEvolutionPoints: 0, playPoints: 5 } }).play("CP05-105").none();
    expect([main(cant), evolved(cant, "CP05-105"), cant.leader()]).toEqual([true, false, 22]);
  });

  it("106 天司長の後継・サンダルフォン (evolved) — Ward; On Evolve: up to 2 enemy followers and each enemy leader 2 damage; with 3 cost-5 Granblue followers (itself too), again (Q2906)", () => {
    // Itself and another 105: 2 — V5 costs 5 but isn't Granblue, CP05-107 is Granblue but costs 2 — 2 damage once.
    const two = d({
      me: { field: ["CP05-105", "CP05-105", "V5", "CP05-107"], evolveDeck: ["CP05-106"], playPoints: 1 },
      opp: { field: ["V5", "V3", "V1"] },
    });
    two.evolve("CP05-105");
    expect(two.decision).toMatchObject({ type: "selectCards", min: 0, max: 2 }); // up to 2 of the 3
    two.pick("opp:V5", "opp:V3");
    expect([two.stats("opp:V5"), two.stats("opp:V3"), two.leader("opp")]).toEqual([[5, 3], [3, 2], 18]);
    // Itself and two others: 3 — the selected followers again (V1, at 0 defense after the first hit, is still on the field until
    // the confirmation timing, CR 11.1.2: hit twice), each enemy leader again.
    const three = d({ me: { field: ["CP05-105", "CP05-105", "CP05-105"], evolveDeck: ["CP05-106"], playPoints: 1 }, opp: { field: ["V5", "V3", "V1"] } });
    const v1 = three.id("opp:V1");
    three.evolve("CP05-105").pick("opp:V3", "opp:V1");
    expect([three.field("opp"), three.stats("opp:V5"), three.leader("opp"), three.cemetery("opp")]).toEqual([["V5"], [5, 5], 16, ["V3", "V1"]]);
    expect(three.events.flatMap((e) => (e.type === "damageDealt" && e.target === v1 ? [e.amount] : []))).toEqual([2, 2]);
    const evolvedOne = three.ids("CP05-105@field").find((id) => three.game.reader().info(id).evolved)!;
    expect(three.game.reader().info(evolvedOne).keywords).toEqual(["ward"]);
    // Q2906: with no enemy follower it is played, selecting none. The SP02 / SSP02 printings are this card (CR 2.13).
    const none = d({ me: { field: ["CP05-105", "CP05-105", "CP05-105"], evolveDeck: ["CP05-SSP02b"], playPoints: 1 } });
    expect(none.evolve("CP05-105").leader("opp")).toBe(16);
  });

  it("107 グラン＆ジータ — when this uncaps, pay 3: an enemy follower 4 damage, its leader 2, a ヒヒイロカネ into the EX area (Q2925); Fanfare: discard a Granblue card: draw 2", () => {
    // Fanfare: only a Granblue card pays (an optional process, CR 10.4.7.4).
    const fan = d({ me: { hand: ["CP05-107", "CP05-110", "V1"], deck: ["V2", "V3"], playPoints: 2 } }).play("CP05-107").yes();
    expect([fan.hand(), fan.cemetery()]).toEqual([["V1", "V2", "V3"], ["CP05-110"]]);
    expect(d({ me: { hand: ["CP05-107", "CP05-110"], deck: ["V2", "V3"], playPoints: 2 } }).play("CP05-107").no().hand()).toEqual(["CP05-110"]);
    const cantPay = d({ me: { hand: ["CP05-107", "V1"], deck: ["V2"], playPoints: 2 } }).play("CP05-107");
    expect([main(cantPay), cantPay.hand()]).toEqual([true, ["V1"]]);
    // 全属性: a dark card's ability discards the card (CR JP 14.6.2.2).
    const dark = d({ me: { hand: ["CP05-107", "DARK-DISC"], deck: ["V1", "V2", "V3"], playPoints: 2 } }).play("CP05-107").yes();
    expect(dark.hand()).toEqual(["V1", "V2", "V3"]);

    // Uncapped by an element (全属性: any of them): pay 3.
    const t = d({ me: { field: ["CP05-107"], ex: ["CP05-T09"], playPoints: 3 }, opp: { field: ["V5", "V3"] } });
    t.activate("CP05-T09").yes().pick("opp:V5");
    expect([t.stats("CP05-107"), t.stats("opp:V5"), t.leader("opp"), t.pp(), t.ex(), uncapZone(t)]).toEqual([[3, 3], [5, 1], 18, 0, ["CP05-T15"], ["CP05-T09"]]);
    // The ヒヒイロカネ it puts can be used at once; on this capped follower (no Final Uncap) it does nothing and stays.
    t.activate("CP05-T15");
    expect([main(t), t.ex(), t.stats("CP05-107")]).toEqual([true, ["CP05-T15"], [3, 3]]);
    // Declined: no effect.
    const no = d({ me: { field: ["CP05-107"], ex: ["CP05-T14"], playPoints: 3 }, opp: { field: ["V5"] } }).activate("CP05-T14").no();
    expect([no.stats("opp:V5"), no.leader("opp"), no.pp(), no.ex()]).toEqual([[5, 5], 20, 3, []]);
    // Without 3 play points: nothing.
    const poor = d({ me: { field: ["CP05-107"], ex: ["CP05-T10"], playPoints: 2 }, opp: { field: ["V5"] } }).activate("CP05-T10");
    expect([main(poor), poor.stats("opp:V5"), poor.leader("opp"), poor.pp(), poor.ex()]).toEqual([true, [5, 5], 20, 2, []]);
    // Q2925: without an enemy follower it can't be played — no leader damage, no ヒヒイロカネ (and the 3 isn't asked for).
    const alone = d({ me: { field: ["CP05-107"], ex: ["CP05-T11"], playPoints: 3 } }).activate("CP05-T11");
    expect([main(alone), alone.leader("opp"), alone.pp(), alone.ex(), alone.stats("CP05-107")]).toEqual([true, 20, 3, [], [3, 3]]);
    // ヒヒイロカネ uncaps it (no Final Uncap): triggered once.
    const hihi = d({ me: { field: ["CP05-107"], ex: ["CP05-T15"], playPoints: 3 }, opp: { field: ["V5"] } }).activate("CP05-T15").yes();
    expect([hihi.stats("opp:V5"), hihi.leader("opp"), hihi.pp(), hihi.ex(), uncapZone(hihi)]).toEqual([[5, 1], 18, 0, ["CP05-T15"], ["CP05-T15"]]);
  });

  it("108 / 109 小さき赤き竜・ビィ — Evolve (1); Fanfare: with a グラン＆ジータ (its U11 printing too) on your field, evolve this (Q2923); evolved: a ヒヒイロカネ into the EX area", () => {
    const t = d({ me: { hand: ["CP05-108"], field: ["CP05-U11", "CP05-105"], evolveDeck: ["CP05-109", "CP05-106"], playPoints: 2 } });
    t.play("CP05-108").yes();
    expect([evolved(t, "CP05-108"), t.stats("CP05-108"), t.ex()]).toEqual([true, [2, 2], ["CP05-T15"]]);
    expect(t.canEvolve("CP05-105")).toBe(true); // Q2923: not the turn's evolve
    const declined = d({ me: { hand: ["CP05-108"], field: ["CP05-107"], evolveDeck: ["CP05-109"], playPoints: 1 } }).play("CP05-108").no();
    expect([evolved(declined, "CP05-108"), declined.ex()]).toEqual([false, []]);
    const without = d({ me: { hand: ["CP05-108"], field: ["V1"], evolveDeck: ["CP05-109"], playPoints: 1 } }).play("CP05-108");
    expect([main(without), evolved(without, "CP05-108"), without.ex()]).toEqual([true, false, []]);
    // Your own field only (自分の場に): the opponent's グラン＆ジータ doesn't count.
    const theirs = d({ me: { hand: ["CP05-108"], evolveDeck: ["CP05-109"], playPoints: 1 }, opp: { field: ["CP05-107"] } }).play("CP05-108");
    expect([main(theirs), evolved(theirs, "CP05-108"), theirs.ex()]).toEqual([true, false, []]);
    // 109 by the evolve ability; with a full EX area no ヒヒイロカネ (CR 4.8.3.2).
    expect(d({ me: { field: ["CP05-108"], evolveDeck: ["CP05-109"], playPoints: 1 } }).evolve("CP05-108").ex()).toEqual(["CP05-T15"]);
    const full = d({ me: { field: ["CP05-108"], ex: ["V1", "V1", "V1", "V1", "V1"], evolveDeck: ["CP05-109"], playPoints: 1 } }).evolve("CP05-108");
    expect([main(full), full.ex()]).toEqual([true, ["V1", "V1", "V1", "V1", "V1"]]);
  });

  it("110 蒼の少女・ルリア — Final Uncap: ヒヒイロカネ does both, counted as 2 (Q2873, Q2880); Fanfare: a Granblue card from the top 3, the rest to the bottom", () => {
    const t = d({ me: { hand: ["CP05-110"], deck: ["V1", "CP05-107", "V3", "V5"], playPoints: 1 } }).play("CP05-110");
    expect(candidates(t)).toEqual(["CP05-107"]); // only the Granblue card of the top 3
    t.pick("CP05-107").order("V3");
    expect([t.hand(), t.zone("me", "deck"), t.keywords("CP05-110")]).toEqual([["CP05-107"], ["V5", "V3", "V1"], ["finalUncap"]]);
    expect(t.events.some((e) => e.type === "cardsRevealed")).toBe(true);
    const none = d({ me: { hand: ["CP05-110"], deck: ["V1", "CP05-107", "V3", "V5"], playPoints: 1 } }).play("CP05-110").none().order();
    expect([none.hand(), none.zone("me", "deck").length]).toEqual([[], 4]);
    // ヒヒイロカネ on her: uncapped and final-uncapped at once, +2/+1, one card, 2 this turn.
    const hihi = d({ me: { field: ["CP05-110"], ex: ["CP05-T15"] } }).activate("CP05-T15");
    expect([hihi.stats("CP05-110"), uncapped(hihi, "CP05-110"), uncapZone(hihi), uncaps(hihi)]).toEqual([[3, 2], [true, true], ["CP05-T15"], 2]);
    // An element only uncaps her; a second one final-uncaps her instead.
    const steps = d({ me: { field: ["CP05-110"], ex: ["CP05-T12", "CP05-T09"] } }).activate("CP05-T12");
    expect([steps.stats("CP05-110"), uncapped(steps, "CP05-110")]).toEqual([[2, 1], [true, false]]);
    steps.activate("CP05-T09");
    expect([steps.stats("CP05-110"), uncapped(steps, "CP05-110"), uncaps(steps)]).toEqual([[3, 2], [true, true], 2]);
  });

  it("111 蒼天の守護騎士・カタリナ — Ward; Fanfare: a 1-cost follower with a quick activated ability from the deck onto the field, a 水晶のエレメント; Quick from the hand (1, discard it): a 水晶のエレメント, draw (Q2926)", () => {
    const t = d({ me: { hand: ["CP05-111"], deck: ["V1", "QACT2", "ACT1", "QACT1", "CP05-111"], playPoints: 3 } });
    t.play("CP05-111").none();
    expect(candidates(t)).toEqual(["QACT1"]);
    t.pick("QACT1");
    expect([t.field(), t.ex(), t.zone("me", "deck").length, t.keywords("CP05-111")]).toEqual([["CP05-111", "QACT1"], ["CP05-T10"], 4, ["ward"]]);
    // Not found (it need not be, CR 4.1.2.2): the element all the same.
    const none = d({ me: { hand: ["CP05-111"], deck: ["QACT1"], playPoints: 3 } }).play("CP05-111").none().none();
    expect([none.field(), none.ex()]).toEqual([["CP05-111"], ["CP05-T10"]]);
    // Q2926: valid in the hand — not on the field.
    const hand = d({ me: { hand: ["CP05-111"], deck: ["V1"], playPoints: 1 } }).activate("CP05-111");
    expect([hand.pp(), hand.cemetery(), hand.ex(), hand.hand()]).toEqual([0, ["CP05-111"], ["CP05-T10"], ["V1"]]);
    expect(d({ me: { field: ["CP05-111"], hand: ["V1"], playPoints: 1 } }).canActivate("CP05-111")).toBe(false);
    // Quick: in the opponent's turn too (CR 12.3.3).
    const quick = d({ turn: 6, me: { hand: ["CP05-111"], field: [{ card: "V3", engaged: true }], deck: ["V1"], playPoints: 1 }, opp: { field: ["V5"] } });
    quick.attack("opp:V5", "V3").quick("CP05-111");
    expect([quick.ex(), quick.hand(), quick.cemetery()]).toEqual([["CP05-T10"], ["V1"], ["CP05-111", "V3"]]);
  });

  it("T09 / T10 / T11 / T12 / T13 / T14 火晶・水晶・土晶・風晶・光晶・闇晶のエレメント — act 0: a follower of its attribute (or 全属性) uncaps; an uncapped one with Final Uncap final-uncaps instead (Q2930)", () => {
    for (const [element, own, other] of ELEMENTS) {
      const t = d({ me: { field: [own, "CP05-108", other], ex: [element], playPoints: 0 } }).activate(element); // {[cost00]}
      expect(candidates(t)).toEqual([own, "CP05-108"]); // CR JP 14.6.2.2
      t.pick(own);
      expect([t.ex(), uncapZone(t), t.stats(own), uncapped(t, own), uncaps(t)]).toEqual([[], [element], [2, 1], [true, false], 1]);
      expect(d({ me: { field: [other], ex: [element] } }).canActivate(element)).toBe(false); // CR 10.6.2.3.3
    }
    // BOTH: the first element uncaps it (it draws); the second final-uncaps it instead — only that triggers (leader +1, no draw),
    // and it counts once (CR 10.2.1.3.1); a third does nothing, staying in the EX area (CR JP 14.6.4.1 / JP 14.6.4.2).
    const t = d({ me: { field: ["BOTH"], ex: ["CP05-T11", "CP05-T14", "CP05-T10"], deck: ["V1", "V2"] } }).activate("CP05-T11");
    expect([t.stats("BOTH"), uncapped(t, "BOTH"), t.hand(), t.leader()]).toEqual([[2, 1], [true, false], ["V1"], 20]);
    t.activate("CP05-T14");
    expect([t.stats("BOTH"), uncapped(t, "BOTH"), t.hand(), t.leader(), uncaps(t)]).toEqual([[3, 2], [true, true], ["V1"], 21, 2]);
    t.activate("CP05-T10");
    expect([main(t), t.ex(), uncapZone(t), t.stats("BOTH"), uncaps(t)]).toEqual([true, ["CP05-T10"], ["CP05-T11", "CP05-T14"], [3, 2], 2]);
    // Not quick: only in your main phase (CR 8.3.1, 12.3.3) — no quick window for it in the opponent's turn.
    const theirs = d({ turn: 6, me: { field: [{ card: "A-FIRE", engaged: true }], ex: ["CP05-T09"] }, opp: { field: ["V5"] } }).attack("opp:V5", "A-FIRE");
    expect([theirs.decision?.type, theirs.ex(), theirs.field()]).toEqual(["mainPhase", ["CP05-T09"], []]);
    // An uncapped follower without Final Uncap: nothing.
    const plain = d({ me: { field: [{ card: "A-FIRE", uncappedWith: [{ card: "CP05-T09", uncaps: ["uncap"] }] }], ex: ["CP05-T09"] } }).activate("CP05-T09");
    expect([main(plain), plain.ex(), plain.stats("A-FIRE"), uncaps(plain)]).toEqual([true, ["CP05-T09"], [2, 1], 0]);
    // Q2930: having lost its abilities (Final Uncap with them), an uncapped follower can't be uncapped or final-uncapped again.
    const silenced = d({ me: { field: [{ card: "CP05-110", uncappedWith: [{ card: "CP05-T13", uncaps: ["uncap"] }] }], hand: ["SILENCE"], ex: ["CP05-T13"] } });
    silenced.play("SILENCE").activate("CP05-T13");
    expect([main(silenced), silenced.ex(), silenced.stats("CP05-110"), uncapped(silenced, "CP05-110")]).toEqual([true, ["CP05-T13"], [2, 1], [true, false]]);
  });

  it("T15 ヒヒイロカネ — act 0: a Granblue follower uncaps; with Final Uncap it also final-uncaps, both triggering, in any order (Q2867, Q2868); an uncapped one only final-uncaps (Q2930)", () => {
    expect(d({ me: { field: ["V1"], ex: ["CP05-T15"] } }).canActivate("CP05-T15")).toBe(false);
    // Without Final Uncap: only uncaps.
    const plain = d({ me: { field: ["CP05-108", "V1"], ex: ["CP05-T15"], playPoints: 0 } }).activate("CP05-T15");
    expect([plain.stats("CP05-108"), uncapped(plain, "CP05-108"), uncapZone(plain), uncaps(plain)]).toEqual([[2, 1], [true, false], ["CP05-T15"], 1]);
    // With it: both, by the one card; both trigger and either may resolve first — here the final uncap's.
    const both = d({ me: { field: ["BOTH"], ex: ["CP05-T15"], deck: ["V1"] } }).activate("CP05-T15");
    expect(both.decision).toMatchObject({ type: "selectPending" });
    expect(both.game.state.pending.map((p) => p.ability).sort()).toEqual([0, 1]);
    both.answer({ type: "selectPending", id: both.game.state.pending.find((p) => p.ability === 1)!.id });
    expect([both.leader(), both.hand()]).toEqual([21, ["V1"]]);
    expect([both.stats("BOTH"), uncapped(both, "BOTH"), uncapZone(both), uncaps(both)]).toEqual([[3, 2], [true, true], ["CP05-T15"], 2]);
    // Already uncapped: only the final uncap (and only its trigger), counted once.
    const up = d({ me: { field: [{ card: "BOTH", uncappedWith: [{ card: "CP05-T09", uncaps: ["uncap"] }] }], ex: ["CP05-T15"], deck: ["V1"] } }).activate("CP05-T15");
    expect([up.stats("BOTH"), up.hand(), up.leader(), uncaps(up), uncapZone(up)]).toEqual([[3, 2], [], 21, 1, ["CP05-T09", "CP05-T15"]]);
    // Both done: nothing, it stays.
    const top = d({ me: { field: [{ card: "BOTH", uncappedWith: [{ card: "CP05-T15", uncaps: ["uncap", "final"] }] }], ex: ["CP05-T15"] } }).activate("CP05-T15");
    expect([main(top), top.ex(), top.stats("BOTH"), uncaps(top)]).toEqual([true, ["CP05-T15"], [3, 2], 0]);
    // Q2930: an uncapped follower that has lost its abilities (Final Uncap with them) isn't final-uncapped either: nothing, it stays.
    const silenced = d({ me: { field: [{ card: "CP05-110", uncappedWith: [{ card: "CP05-T13", uncaps: ["uncap"] }] }], hand: ["SILENCE"], ex: ["CP05-T15"] } });
    silenced.play("SILENCE").activate("CP05-T15");
    expect([main(silenced), silenced.ex(), silenced.stats("CP05-110"), uncapped(silenced, "CP05-110"), uncaps(silenced)]).toEqual([
      true,
      ["CP05-T15"],
      [2, 1],
      [true, false],
      0,
    ]);
  });

  it("T09 / T10 / T11 / T12 / T13 / T14 / T15 treasures — cards of the EX area: selected, transformed, banished (Q2931, Q2932); no original cost (Q2933); can't be played", () => {
    // Q2932: BP02-061 "select a card in an EX area" offers them; Q2931: it transforms one.
    const t = d({ me: { hand: ["BP02-061"], ex: ["CP05-T09"], playPoints: 4 }, opp: { ex: ["CP05-T15"] } }).play("BP02-061");
    expect(candidates(t)).toEqual(["CP05-T09", "CP05-T15"]);
    t.pick("opp:CP05-T15");
    expect([t.ex(), t.ex("opp")]).toEqual([["CP05-T09"], ["BP01-T11"]]);
    // Q2931: BP01-156's On Evolve banishes one (a token, it goes nowhere).
    const banished = d({ me: { field: ["BP01-155"], evolveDeck: ["BP01-156"], playPoints: 1 }, opp: { ex: ["CP05-T13"] } }).evolve("BP01-155");
    expect([banished.ex("opp"), banished.zone("opp", "banished")]).toEqual([[], []]);
    // Q2933: BP10-003 needs 5 EX-area cards of different original costs: a treasure has none (CR 1.3.6.1).
    expect(d({ me: { field: ["BP10-003"], ex: ["CP05-T12", "V1", "V2", "V3", "V5"] } }).canActivate("BP10-003")).toBe(false);
    expect(d({ me: { field: ["BP10-003"], ex: ["BP02-061", "V1", "V2", "V3", "V5"] } }).canActivate("BP10-003")).toBe(true);
    // No cost: not a card that can be played (CR 8.2.1).
    expect(d({ me: { field: ["CP05-108"], ex: ["CP05-T15", "CP05-T14"], playPoints: 9 } }).canPlay("CP05-T15@ex")).toBe(false);
  });
});
