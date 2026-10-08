import { describe, expect, it } from "vitest";
import { createEngine, script, type GameSession } from "@sve/core";
import { ALL_CARDS, ALL_SCRIPTS } from "@sve/core/sets";
import { drive, testFollower, testSpell } from "@sve/core/testing";
import { cardRuntimeDetails } from "../src/engine/card-details";
import { findCard } from "../src/engine/view-utils";

const engine = createEngine({
  cards: [...ALL_CARDS, testFollower("V5", 5, 5, 5), testFollower("V1", 1, 2, 2), testFollower("RUSH", 1, 2, 2), testSpell("GIVE-WARD", 0), testSpell("SILENCE", 0), testSpell("LOCK", 0)],
  scripts: {
    ...ALL_SCRIPTS,
    RUSH: script.defineCard({ keywords: ["rush"] }),
    LOCK: script.defineCard({ abilities: [script.spell({
      *resolve(fx) {
        for (const id of fx.game.followers(1)) {
          yield* fx.cannotAttack(id, "endOfTurn");
          yield* fx.cannotAttackLeader(id, "endOfTurn");
          yield* fx.cannotDealDamage(id, "endOfTurn");
        }
      },
    })] }),
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

describe("effect restrictions in card details", () => {
  it("does not mistake engagement, entry, ordinary Rush or Ward targeting for an effect restriction", () => {
    const t = drive(engine, {
      me: { field: [{ card: "V5", engaged: true }, { card: "V1", enteredThisTurn: true }, { card: "RUSH", enteredThisTurn: true }] },
      opp: { field: [{ card: "BP03-110", engaged: true }] },
    });
    for (const card of ["V5", "V1", "RUSH"]) {
      expect(details(t.game)[t.id(card)]).toMatchObject({ cannotAttack: false, cannotAttackLeader: false, cannotDealDamage: false });
    }
  });

  it("reads printed and conditional abilities, the active evolved definition, and ignores cards outside the field", () => {
    const t = drive(engine, {
      me: {
        field: ["BP01-088", "BP03-110", { card: "BP02-107", evolvedInto: "BP02-108" }],
        hand: ["BP01-088"],
      },
      opp: { field: ["V1", "V5"] },
      config: { manualActions: true },
    });
    const rapunzel = t.id("BP03-110");
    expect(details(t.game)[t.id("BP01-088@field")]?.cannotAttack).toBe(true);
    expect(details(t.game)[t.id("BP01-088@hand")]?.cannotAttack).toBe(false);
    expect(details(t.game)[rapunzel]?.cannotAttack).toBe(true);
    expect(details(t.game)[t.id("BP02-107")]?.cannotAttackLeader).toBe(true);
    t.game.act({ type: "mainPhase", action: { type: "manual", op: { kind: "counters", card: rapunzel, counter: "fable", amount: 1 } } });
    expect(details(t.game)[rapunzel]?.cannotAttack).toBe(false);
    t.game.act({ type: "mainPhase", action: { type: "manual", op: { kind: "move", card: t.id("opp:V1"), to: "hand" } } });
    expect(details(t.game)[t.id("BP02-107")]?.cannotAttackLeader).toBe(false);
  });

  it("reevaluates cemetery conditions instead of recognizing card numbers", () => {
    for (const count of [9, 10]) {
      const t = drive(engine, { me: { field: ["BP22-074"], cemetery: Array<string>(count).fill("BP22-074") } });
      expect(details(t.game)[t.id("BP22-074@field")]?.cannotAttack).toBe(count === 9);
    }
  });

  it("suppresses printed restrictions after ability loss while independent applied effects remain", () => {
    const t = drive(engine, {
      me: { hand: ["LOCK", "SILENCE"], deck: ["V5"] },
      opp: { field: ["BP01-088", "BP05-057"], deck: ["V5"] },
    });
    const attack = t.id("opp:BP01-088");
    const leader = t.id("opp:BP05-057");
    expect(details(t.game)[attack]?.cannotAttack).toBe(true);
    expect(details(t.game)[leader]?.cannotAttackLeader).toBe(true);
    t.play("SILENCE");
    expect(details(t.game)[attack]).toMatchObject({ abilitiesLost: true, cannotAttack: false });
    expect(details(t.game)[leader]).toMatchObject({ abilitiesLost: true, cannotAttackLeader: false });
    t.play("LOCK");
    expect(details(t.game)[attack]).toMatchObject({ abilitiesLost: true, cannotAttack: true, cannotAttackLeader: true, cannotDealDamage: true });
    t.end();
    expect(details(t.game)[attack]).toMatchObject({ abilitiesLost: false, cannotAttack: true, cannotAttackLeader: false, cannotDealDamage: false });
  });

  it("keeps applied restrictions through later ability loss, removes them on zone changes and restores snapshots", () => {
    const t = drive(engine, { me: { hand: ["LOCK", "SILENCE"] }, opp: { field: ["V5"] }, config: { manualActions: true } });
    t.play("LOCK").play("SILENCE");
    const id = t.id("opp:V5");
    const snapshot = t.game.snapshot();
    expect(details(t.game)[id]).toMatchObject({ abilitiesLost: true, cannotAttack: true, cannotAttackLeader: true, cannotDealDamage: true });
    expect(t.game.snapshot()).toEqual(snapshot);
    t.game.act({ type: "mainPhase", action: { type: "manual", op: { kind: "move", card: id, to: "hand" } } });
    expect(details(t.game)[id]).toBeUndefined();
    const hand = t.id("opp:V5@hand");
    expect(cardRuntimeDetails(t.game.reader(), t.game.view(1))[hand]).toMatchObject({ cannotAttack: false, cannotAttackLeader: false, cannotDealDamage: false });
    expect(details(engine.restore(snapshot))[id]).toMatchObject({ cannotAttack: true, cannotAttackLeader: true, cannotDealDamage: true });
  });

  it("tracks restrictions from either field and stops them when their source loses abilities or leaves", () => {
    const t = drive(engine, { me: { field: ["V1"], hand: ["SILENCE"] }, opp: { field: ["BP09-040"] }, config: { manualActions: true } });
    const id = t.id("V1");
    expect(details(t.game)[id]?.cannotAttack).toBe(true);
    t.play("SILENCE");
    expect(details(t.game)[id]?.cannotAttack).toBe(false);
    const other = drive(engine, { me: { field: ["V1", "BP09-040"] }, config: { manualActions: true } });
    expect(details(other.game)[other.id("V1")]?.cannotAttack).toBe(true);
    other.game.act({ type: "mainPhase", action: { type: "manual", op: { kind: "move", card: other.id("BP09-040"), to: "hand" } } });
    expect(details(other.game)[other.id("V1")]?.cannotAttack).toBe(false);
  });

  it("includes an effect requiring follower targets first only while a follower can be targeted", () => {
    const t = drive(engine, { me: { field: ["V5", "BP06-113"] }, opp: { field: [{ card: "V1", engaged: true }] }, config: { manualActions: true } });
    expect(details(t.game)[t.id("V5")]?.cannotAttackLeader).toBe(true);
    t.game.act({ type: "mainPhase", action: { type: "manual", op: { kind: "engage", card: t.id("opp:V1"), engaged: false } } });
    expect(details(t.game)[t.id("V5")]?.cannotAttackLeader).toBe(false);
  });

  it("applies the duration rule for an opponent's next turn, including an intervening extra own turn", () => {
    const t = drive(engine, { me: { hand: ["BP03-013"], playPoints: 3, deck: ["V5"] }, opp: { field: ["V5"], deck: ["V5", "V5"] } }).play("BP03-013");
    const id = t.id("opp:V5");
    expect(details(t.game)[id]?.cannotAttack).toBe(true);
    const extraTurn = t.game.snapshot();
    extraTurn.checkpoint.turn += 2;
    expect(details(engine.restore(extraTurn))[id]?.cannotAttack).toBe(false);
    t.end();
    expect(details(t.game)[id]?.cannotAttack).toBe(true);
    t.end();
    expect(details(t.game)[id]?.cannotAttack).toBe(false);
  });

  it("shows a Stand Trigger's explicit leader restriction even after it refreshes the follower", () => {
    const t = drive(engine, { me: { hand: ["CP03-120"], playPoints: 1 }, opp: { deck: ["V5"] } }).play("CP03-120");
    const id = t.id("CP03-120");
    expect(details(t.game)[id]).toMatchObject({ cannotAttack: false, cannotAttackLeader: true });
    expect(findCard(t.game.view(0), id)?.engaged).toBe(false);
    t.end();
    expect(details(t.game)[id]?.cannotAttackLeader).toBe(false);
  });

  it("shows damage prohibition from BP01-024 and BP12-109 and clears it at the end of the turn", () => {
    const curse = drive(engine, { me: { hand: ["BP01-024"], playPoints: 2 }, opp: { field: ["V5"], deck: ["V1"] } }).play("BP01-024");
    const id = curse.id("opp:V5");
    expect(details(curse.game)[id]).toMatchObject({ cannotAttack: false, cannotDealDamage: true });
    curse.end();
    expect(details(curse.game)[id]?.cannotDealDamage).toBe(false);
    const evolved = drive(engine, { me: { field: ["BP12-108"], evolveDeck: ["BP12-109"], playPoints: 2 }, opp: { field: ["V1", "V5"] } }).evolve("BP12-108");
    for (const card of ["opp:V1", "opp:V5"]) expect(details(evolved.game)[evolved.id(card)]?.cannotDealDamage).toBe(true);
  });
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
