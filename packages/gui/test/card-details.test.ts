import { describe, expect, it } from "vitest";
import { createEngine, script, type GameSession } from "@sve/core";
import { ALL_CARDS, ALL_SCRIPTS } from "@sve/core/sets";
import { drive, testFollower, testSpell } from "@sve/core/testing";
import { cardRuntimeDetails } from "../src/engine/card-details";
import { findCard } from "../src/engine/view-utils";

const engine = createEngine({
  cards: [...ALL_CARDS, testFollower("V5", 5, 5, 5), testSpell("GIVE-WARD", 0), testSpell("SILENCE", 0)],
  scripts: {
    ...ALL_SCRIPTS,
    SILENCE: script.defineCard({ abilities: [script.spell({
      *resolve(fx) {
        for (const id of fx.game.followers(1)) yield* fx.loseAbilities(id, "endOfTurn");
      },
    })] }),
    "GIVE-WARD": script.defineCard({ abilities: [script.spell({
      *resolve(fx) {
        for (const id of fx.game.followers(1)) yield* fx.giveKeyword(id, "ward");
      },
    })] }),
  },
});
const details = (game: GameSession) => cardRuntimeDetails(game.reader(), game.view(0));

describe("visible runtime card details", () => {
  it("tracks entry only on the field, drops moved instances, and restores with the game", () => {
    const t = drive(engine, { me: { field: [{ card: "V5", enteredThisTurn: true }], deck: ["V5"] }, opp: { deck: ["V5"] }, config: { manualActions: true } });
    const id = t.id("V5");
    const snapshot = t.game.snapshot();
    const original = details(t.game);
    expect(original[id]?.enteredFieldThisTurn).toBe(true);
    expect(t.game.snapshot()).toEqual(snapshot); // Queries never change replay/fingerprint state.
    t.game.act({ type: "mainPhase", action: { type: "manual", op: { kind: "move", card: id, to: "hand" } } });
    expect(details(t.game)[id]).toBeUndefined();
    const hand = t.id("V5@hand");
    expect(hand).not.toBe(id);
    expect(details(t.game)[hand]?.enteredFieldThisTurn).toBe(false);
    expect(details(engine.restore(snapshot))).toEqual(original);
    t.end();
    expect(details(t.game)[hand]?.enteredFieldThisTurn).toBe(false);
  });

  it("shows Boxed and lost abilities together, preserves later keywords, and follows expiry", () => {
    const t = drive(engine, {
      me: { field: ["BP11-018"], hand: ["GIVE-WARD"], deck: ["V5", "V5"] },
      opp: { field: ["V5"], deck: ["V5", "V5"] },
    });
    const id = t.id("opp:V5");
    t.activate("BP11-018").play("GIVE-WARD");
    expect(details(t.game)[id]).toMatchObject({ boxed: true, abilitiesLost: true });
    expect(findCard(t.game.view(0), id)?.keywords).toContain("ward");
    t.end();
    expect(details(t.game)[id]).toMatchObject({ boxed: true, abilitiesLost: true });
    t.end();
    expect(details(t.game)[id]).toMatchObject({ boxed: false, abilitiesLost: false });
  });

  it("uses changeType results without restoring printed attack or defense", () => {
    const t = drive(engine, {
      me: { hand: ["BP05-001"], cemetery: ["BP05-004", "BP05-004", "BP05-004"], playPoints: 5 },
      opp: { field: ["V5"] },
    }).play("BP05-001");
    expect(findCard(t.game.view(0), t.id("opp:V5"))).toMatchObject({ type: "amulet", attack: null, defense: null });
    expect(details(t.game)[t.id("opp:V5")]?.abilitiesLost).toBe(false);
  });

  it("reports lost abilities without Boxed and does not interpret later keywords as restoring old abilities", () => {
    const t = drive(engine, { me: { hand: ["SILENCE", "GIVE-WARD"] }, opp: { field: ["V5"], deck: ["V5"] } });
    const id = t.id("opp:V5");
    t.play("SILENCE").play("GIVE-WARD");
    expect(details(t.game)[id]).toMatchObject({ boxed: false, abilitiesLost: true });
    expect(findCard(t.game.view(0), id)?.keywords).toContain("ward");
    t.end();
    expect(details(t.game)[id]).toMatchObject({ boxed: false, abilitiesLost: false });
  });

  it("supports the evolved ECP02-061 transformation", () => {
    const t = drive(engine, {
      me: { field: ["ECP02-060"], evolveDeck: ["ECP02-061"], playPoints: 1, superEvolutionPoints: 1, turnsPassed: 8 },
      opp: { field: ["V5"] },
    }).evolve("ECP02-060", { sep: true }).flush();
    expect(findCard(t.game.view(0), t.id("opp:V5"))).toMatchObject({ type: "amulet", attack: null, defense: null });
    expect(details(t.game)[t.id("opp:V5")]?.abilitiesLost).toBe(false);
  });

  it("publishes maneuver's duration alongside current numbers and clears it at end of turn", () => {
    const t = drive(engine, { me: { field: ["BP11-T01", "BP11-019"], deck: ["V5"] }, opp: { deck: ["V5"] } });
    const id = t.id("BP11-T01");
    expect(findCard(t.game.view(0), id)).toMatchObject({ type: "amulet", attack: null, defense: null });
    expect(details(t.game)[id]?.maneuveredThisTurn).toBe(false);
    t.activate("BP11-T01");
    expect(findCard(t.game.view(0), id)).toMatchObject({ type: "follower", attack: 3, defense: 3 });
    expect(details(t.game)[id]?.maneuveredThisTurn).toBe(true);
    t.end();
    expect(findCard(t.game.view(0), id)).toMatchObject({ type: "amulet", attack: null, defense: null });
    expect(details(t.game)[id]?.maneuveredThisTurn).toBe(false);
  });

  it("uses typeWhile with its condition both false and true", () => {
    for (const prayer of [3, 4]) {
      const t = drive(engine, { me: { field: [{ card: "BP16-093", counters: { prayer } }] } });
      expect(findCard(t.game.view(0), t.id("BP16-093"))).toMatchObject(prayer === 3
        ? { type: "amulet", attack: null, defense: null }
        : { type: "follower", attack: 5, defense: 5 });
      expect(details(t.game)[t.id("BP16-093")]?.maneuveredThisTurn).toBe(false);
    }
  });
});
