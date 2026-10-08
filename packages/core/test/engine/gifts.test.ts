import { describe, expect, it } from "vitest";
import type { CardView } from "../../src";
import { drive, type Driver, type DriveSpec } from "../../src/testing";
import { cardEngine } from "../helpers";

// The player view shows the abilities given to a card (CR 10.9.1.2; CardView.gifts, view/gifts.ts), each with the card whose
// text quotes it, and whether the card lost all its abilities. V1 is 1c 2/2, V5 5c 5/5 (Neutral). BP08-025 is Azord, Duke of
// the Mists; CP04-018 Aurora Healing a PriConne spell.
const E = cardEngine();
const d = (spec: DriveSpec) => drive(E, spec);
const PC = { universe: "princessConnect" as const };
const n = (count: number, id = "V1") => Array<string>(count).fill(id);

/** A card as player `viewer` sees it. */
function seen(t: Driver, ref: string, viewer: 0 | 1 = 0): CardView {
  const id = t.id(ref);
  const view = t.game.view(viewer);
  const cards = view.players.flatMap((p) => [p.leader, ...p.hand, ...p.field, ...p.ex, ...p.cemetery, ...p.banished, ...p.equipmentZone]);
  const card = cards.find((c) => c !== null && c.id === id);
  if (!card || card.hidden) throw new Error(`${ref} isn't seen`);
  return card;
}

/** What the view says was given to a card: "<giving card> <ability>" each. */
const gifts = (t: Driver, ref: string, viewer: 0 | 1 = 0) => seen(t, ref, viewer).gifts.map((g) => `${g.by} ${g.ability}`);

describe("the abilities given to a card, in the player view", () => {
  it("BP12-071 summoned from the cemetery has the Last Words its text gives it; both players see it; played from the hand it has none", () => {
    const t = d({ me: { cemetery: ["BP12-071", ...n(9)], playPoints: 1 } }).activate("BP12-071").none();
    expect([gifts(t, "BP12-071"), gifts(t, "BP12-071", 1), seen(t, "BP12-071").abilitiesLost]).toEqual([
      ["BP12-071 lastWordsBanishSelf"],
      ["BP12-071 lastWordsBanishSelf"],
      false,
    ]);
    expect(gifts(d({ me: { hand: ["BP12-071"], deck: n(2), playPoints: 2 } }).play("BP12-071").none(), "BP12-071")).toEqual([]);
  });

  it("an effect the giving card's text quotes as an ability (BP20-036 'This doesn't take damage'), for the rest of the turn", () => {
    const t = d({ me: { hand: ["BP20-036"], field: ["V1"], playPoints: 1 } }).play("BP20-036");
    expect([gifts(t, "V1"), t.keywords("V1")]).toEqual([["BP20-036 preventDamage"], ["assail"]]);
    t.end();
    expect(gifts(t, "V1")).toEqual([]);
  });

  it("two abilities one card gives, in the order of its text (ECP02-061)", () => {
    const s = d({
      me: { field: ["ECP02-060"], evolveDeck: ["ECP02-061"], playPoints: 1, superEvolutionPoints: 1, turnsPassed: 8 },
      opp: { field: ["V5"], deck: ["V1", "V1"] },
    });
    s.evolve("ECP02-060", { sep: true }).flush();
    expect(gifts(s, "opp:V5")).toEqual(["ECP02-061 mainPhaseDamageYourLeader2", "ECP02-061 activateDiscard2Bury"]);
  });

  it("a passive ability of another card on the field (Lilje gives each Azord 'Strike - +2/+2'); losing all abilities loses it", () => {
    expect(gifts(d({ me: { field: ["BP12-029", "BP08-025"] } }), "BP08-025")).toEqual(["BP12-029 strikePlus2"]);
    const t = d({ me: { hand: ["BP11-041"] }, opp: { field: ["BP12-029", "BP08-025"] } }).play("BP11-041").pick("opp:BP08-025");
    expect([gifts(t, "opp:BP08-025"), seen(t, "opp:BP08-025").abilitiesLost, seen(t, "opp:BP12-029").abilitiesLost]).toEqual([[], true, false]);
  });

  it("the equipment token it equips (CP04-001's Ameth Amulet)", () => {
    const t = d({ me: { ...PC, hand: ["CP04-001"], field: ["V1"], playPoints: 3 }, opp: PC }).play("CP04-001").flush().yes();
    expect(gifts(t, "CP04-001")).toEqual(["CP04-T01 equipment"]);
  });

  it("its own text's ability while the condition holds (BP09-049 with 5 Onion Patrols in the cemetery)", () => {
    expect(gifts(d({ me: { field: ["BP09-049"], cemetery: n(5, "BP09-049") } }), "BP09-049@field")).toEqual(["BP09-049 quoted"]);
    expect(gifts(d({ me: { field: ["BP09-049"], cemetery: n(4, "BP09-049") } }), "BP09-049@field")).toEqual([]);
  });

  it("a delayed trigger that is the ability its card gives (CP04-045: the spell in the EX area is buried at your end phase)", () => {
    const t = d({ me: { ...PC, hand: ["CP04-045"], cemetery: ["CP04-018"], playPoints: 2 }, opp: { ...PC, deck: ["V1"] } }).play("CP04-045");
    expect(gifts(t, "CP04-018@ex")).toEqual(["CP04-045 delayed:2"]);
  });
});
