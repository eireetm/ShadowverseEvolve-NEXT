import { describe, expect, it } from "vitest";
import { redactEvent, type GameEvent } from "../../src";
import { drive, type Driver, type DriveSpec } from "../../src/testing";
import { cardEngine } from "../helpers";

// A card put into a deck: its move says where (ZoneRef.position: the top or the bottom, CR 4.5.2.1, or its place counted
// from the top, CR 4.1.3.1). Both players see where it goes, also when they can't see the card: the log says it.
const E = cardEngine();
const d = (spec: DriveSpec) => drive(E, spec);

/** The cards an action put into a deck, as "<card> <where>"; told to a player, "" for a card they can't see. */
function placed(t: Driver, act: (t: Driver) => Driver, viewer?: 0 | 1): string[] {
  const from = t.events.length;
  const events: GameEvent[] = act(t).events.slice(from);
  return events
    .map((e) => (viewer === undefined ? e : redactEvent(e, viewer)))
    .flatMap((e) => (e.type === "cardsMoved" ? e.moves.filter((m) => m.to.zone === "deck").map((m) => `${m.def} ${String(m.to.position)}`) : []));
}

describe("a card put into a deck", () => {
  it("CP01-006's Fanfare: the top card to the bottom — each player is told where, not which card (a deck is hidden)", () => {
    const spec = { me: { hand: ["CP01-006"], deck: ["V1", "V3"], playPoints: 1 } };
    expect(placed(d(spec), (t) => t.play("CP01-006").yes())).toEqual(["V1 bottom"]);
    expect(placed(d(spec), (t) => t.play("CP01-006").yes(), 0)).toEqual([" bottom"]);
    expect(placed(d(spec), (t) => t.play("CP01-006").yes(), 1)).toEqual([" bottom"]);
  });

  it("BP07-093: 3rd from the top (2 counted from 0), or the bottom of a shorter deck (CR 4.1.3.1)", () => {
    expect(placed(d({ me: { hand: ["BP07-093"], deck: ["V1", "V2", "V3"] } }), (t) => t.activate("BP07-093"))).toEqual(["BP07-093 2"]);
    expect(placed(d({ me: { hand: ["BP07-093"], deck: ["V1"] } }), (t) => t.activate("BP07-093"))).toEqual(["BP07-093 1"]);
  });
});
