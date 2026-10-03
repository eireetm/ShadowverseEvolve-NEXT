import { describe, expect, it } from "vitest";
import { drive, type DriveSpec } from "../../../src/testing";
import { cardEngine } from "../../helpers";

// SD07 (Swordcraft deck; its other cards are reprints). V1 is 1c 2/2 (Neutral). BP02-025 Jeno, Levin Vanguard is a Levin card.
// BP02-054 Dragonsong Flute (act with Overflow: engage, discard a card) discards cards.
const E = cardEngine();
const d = (spec: DriveSpec) => drive(E, spec);
const n = (count: number, id: string) => Array<string>(count).fill(id);

describe("SD07", () => {
  it("012 レヴィオンアックス・ジェノ — discarded from your hand: may take a Levin card from the top; Storm with 5 Levin cards in the cemetery", () => {
    const t = d({ me: { field: ["BP02-054"], hand: ["SD07-012"], deck: ["BP02-025", "V1"], maxPlayPoints: 7 } }).activate("BP02-054").flush();
    const looked = (x: typeof t) => x.events.filter((e) => e.type === "cardsLookedAt");
    expect(looked(t)).toMatchObject([{ player: 0, cards: [{ def: "BP02-025" }] }]);
    expect(t.pick("BP02-025").hand()).toEqual(["BP02-025"]);
    // Not a Levin card: nothing to take, but the card was looked at all the same (CR 5.11.1); it stays on top.
    const miss = d({ me: { field: ["BP02-054"], hand: ["SD07-012"], deck: ["V1", "BP02-025"], maxPlayPoints: 7 } }).activate("BP02-054").flush();
    expect(looked(miss)).toMatchObject([{ player: 0, cards: [{ def: "V1" }] }]);
    expect([miss.hand(), miss.zone("me", "deck"), miss.game.decision?.type]).toEqual([[], ["V1", "BP02-025"], "mainPhase"]);
    const s = d({ me: { hand: ["SD07-012"], cemetery: n(5, "BP02-025"), playPoints: 2 } }).play("SD07-012");
    expect([s.keywords("SD07-012"), s.attackTargets("SD07-012")]).toEqual([["storm"], ["opp:leader"]]);
    expect(d({ me: { hand: ["SD07-012"], cemetery: n(4, "BP02-025"), playPoints: 2 } }).play("SD07-012").keywords("SD07-012")).toEqual([]);
  });
});
