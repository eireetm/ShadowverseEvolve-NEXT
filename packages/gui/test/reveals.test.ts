import { createEngine, type GameEvent } from "@sve/core";
import { ALL_CARDS, ALL_SCRIPTS } from "@sve/core/sets";
import { drive, testFollower, type DriveSpec } from "@sve/core/testing";
import { describe, expect, it } from "vitest";
import { revealedToHand, type Revealing } from "../src/engine/reveals";

// The cards that went into a hand in public (CR 5.8.1.2, 5.21.1, 4.9.2), as the engine worker finds them in the core's events
// to show them on the table (engine/reveals.ts).

const engine = createEngine({
  cards: [...ALL_CARDS, testFollower("V1", 1, 1, 1), testFollower("V2", 2, 2, 2), testFollower("V3", 3, 3, 3), testFollower("V5", 5, 5, 5)],
  scripts: ALL_SCRIPTS,
});

/** A game driven by the test; `shown()`: the cards put into a hand in public since it was last asked, checked to be there. */
function follow(spec: DriveSpec) {
  const t = drive(engine, spec);
  const revealing: Revealing = new Map();
  let seen = t.events.length;
  const shown = (events: readonly GameEvent[] = t.events.slice(seen)) => {
    seen = t.events.length;
    return revealedToHand(events, revealing).map((c) => {
      const card = t.game.state.cards[c.id];
      expect([card?.zone, card?.controller, card?.def]).toEqual(["hand", c.player, c.card.def]);
      return c.card.def;
    });
  };
  return { t, shown };
}

describe("cards put into a hand in public", () => {
  it("searched and revealed (CR 5.21.1); searched without being revealed is not", () => {
    const ninja = follow({ me: { hand: ["BP01-040"], deck: ["V1", "BP01-042"], playPoints: 4 } });
    ninja.t.play("BP01-040").pick("BP01-042");
    expect(ninja.shown()).toEqual(["BP01-042"]);
    // BP08-108: "Search your deck for any card, add it to your hand".
    const any = follow({ me: { hand: ["BP08-108"], deck: ["V1", "V3"], playPoints: 4 } });
    any.t.play("BP08-108").pick("V3");
    expect(any.t.hand()).toEqual(["V3"]);
    expect(any.shown()).toEqual([]);
  });

  it("only the revealed card that goes to the hand: not to the field, not buried", () => {
    // BP03-002: a Beast costing 2 or less may go onto the field instead.
    const field = follow({ me: { hand: ["BP03-002"], deck: ["BP03-009", "V5"], playPoints: 5 } });
    field.t.play("BP03-002").pick("BP03-009").yes();
    expect(field.shown()).toEqual([]);
    const hand = follow({ me: { hand: ["BP03-002"], deck: ["BP03-009", "V5"], playPoints: 5 } });
    hand.t.play("BP03-002").pick("BP03-009").no();
    expect(hand.shown()).toEqual(["BP03-009"]);
    // CP03-024: two revealed, one to the hand, the other buried, then the deck is shuffled.
    const two = follow({ me: { hand: ["CP03-024"], deck: ["CP03-086", "V1", "CP03-095"], playPoints: 4 } });
    two.t.play("CP03-024").pick("CP03-086", "CP03-095").pick("CP03-086");
    expect(two.shown()).toEqual(["CP03-086"]);
  });

  it("a revealed card drawn (the top card, CR 5.10.1); the cards drawn after it are not", () => {
    // BP21-066: not a Dragoncraft follower, the revealed card is drawn.
    const drawn = follow({ me: { hand: ["BP21-066"], deck: ["V1"], playPoints: 10 } });
    drawn.t.play("BP21-066").none();
    expect(drawn.shown()).toEqual(["V1"]);
    // BP12-115: the declared name, two cards drawn: the revealed one is known.
    const two = follow({ me: { hand: ["BP12-115"], deck: ["BP12-001", "V1"], playPoints: 2 } });
    two.t.play("BP12-115").choose("Awakened Gaia");
    expect(two.t.hand()).toEqual(["BP12-001", "V1"]);
    expect(two.shown()).toEqual(["BP12-001"]);
  });

  it("a card looked at and revealed into the hand (BP01-072)", () => {
    const look = follow({ me: { hand: ["BP01-072"], deck: ["BP01-071", "V1", "BP01-064", "V2", "V3"], playPoints: 2 } });
    look.t.play("BP01-072").pick("BP01-064").pick("BP01-071").order("V2", "V1");
    expect(look.shown()).toEqual(["BP01-064"]);
  });

  it("taken from a cemetery, a public zone (CR 4.9.2)", () => {
    const back = follow({ me: { hand: ["BP01-124"], cemetery: ["V1", "V2", "V3"], playPoints: 6 } });
    back.t.play("BP01-124").pick("V1", "V3");
    expect(back.shown()).toEqual(["V1", "V3"]);
  });

  it("a deck shuffled after the reveal: a draw is a random card (CR 5.21.1.1)", () => {
    const drawn = follow({ me: { hand: ["BP21-066"], deck: ["V1"], playPoints: 10 } });
    drawn.t.play("BP21-066").none();
    const events = drawn.t.events.slice();
    const move = events.findLastIndex((e) => e.type === "cardsMoved" && e.moves.some((m) => m.to.zone === "hand"));
    expect(move).toBeGreaterThan(0);
    events.splice(move, 0, { type: "deckShuffled", player: 0 });
    expect(drawn.shown(events)).toEqual([]);
  });

  it("a reveal ends with its effect: a card played next starts afresh", () => {
    const drawn = follow({ me: { hand: ["BP21-066"], deck: ["V1"], playPoints: 10 } });
    drawn.t.play("BP21-066").none();
    const events = drawn.t.events.slice();
    const move = events.findLastIndex((e) => e.type === "cardsMoved" && e.moves.some((m) => m.to.zone === "hand"));
    const played = events.find((e) => e.type === "cardPlayed")!;
    events.splice(move, 0, played);
    expect(drawn.shown(events)).toEqual([]);
  });
});
