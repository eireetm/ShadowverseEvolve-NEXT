import { createEngine } from "@sve/core";
import { ALL_CARDS, ALL_SCRIPTS } from "@sve/core/sets";
import { drive, testSpell } from "@sve/core/testing";
import { describe, expect, it } from "vitest";
import { playCostsOf } from "../src/engine/game-host";

// The card panel shows what playing one of the viewer's cards in their hand or EX area costs now (CR 10.4.4.1), as the core
// reckons it (its own engine/costs.ts, called by the engine worker): the GUI doesn't work out costs itself.

const engine = createEngine({ cards: [...ALL_CARDS, testSpell("S1", 1)], scripts: ALL_SCRIPTS });

describe("the play costs the card panel shows", () => {
  it("follows a card's own reduction and an opponent's increase, for the viewer's hand and EX area only", () => {
    // BP01-061 costs less for the spells in its owner's cemetery; BP05-071 makes the spells its opponent plays cost 1 more.
    const t = drive(engine, {
      me: { hand: ["BP01-061", "BP13-060", "BP15-041"], cemetery: Array(5).fill("S1"), ex: ["BP13-060"] },
      opp: { field: ["BP05-071"], hand: ["BP13-060"] },
    });
    const costs = playCostsOf(engine, t.game, 0, t.game.view(0));
    expect(costs).toEqual({ [t.id("BP01-061")]: 6, [t.id("BP13-060@hand")]: 3, [t.id("BP13-060@ex")]: 3 });
    // A card with an optional way to play (BP15-041) shows its normal cost; it is its printed one here, so nothing.
    expect(costs[t.id("BP15-041")]).toBeUndefined();
    // The opponent's cards are theirs to price: player 2's view of the same game.
    expect(playCostsOf(engine, t.game, 1, t.game.view(1))).toEqual({});
  });

  it("changes nothing in the game", () => {
    const t = drive(engine, { me: { hand: ["BP01-061"], cemetery: Array(10).fill("S1") } });
    const before = JSON.stringify(t.game.snapshot());
    expect(playCostsOf(engine, t.game, 0, t.game.view(0))).toEqual({ [t.id("BP01-061")]: 3 });
    expect(JSON.stringify(t.game.snapshot())).toBe(before);
  });
});
