import { describe, expect, it } from "vitest";
import { createEngine, type GameSession, type GameState, type PersistentEffect, type PlayerId } from "@sve/core";
import { ALL_CARDS, ALL_SCRIPTS } from "@sve/core/sets";
import { drive, Driver, testFollower, testSpell, testCrest } from "@sve/core/testing";
// Oracle only: production GUI must not import core internals or change its exports.
import { playCost as corePlayCost } from "../../core/src/engine/costs";
import { cardRuntimeDetails } from "../src/presentation/card-details";
import { createPlayCostQuery } from "../src/presentation/play-cost";
import { withoutMemory } from "../src/engine/view-utils";
import { costArrow, normalPlayCost } from "../src/game/card/play-cost";
import type { GameUpdate } from "../src/presentation/protocol";

const engine = createEngine({ cards: [...ALL_CARDS, testFollower("V1", 1, 1, 1), testFollower("V3", 3, 3, 3), testFollower("V5", 5, 5, 10), testSpell("S1", 1), { ...testSpell("GOLEM-SPELL", 8), traits: ["ゴーレム"] }], scripts: ALL_SCRIPTS });
const costs = (game: GameSession, seat: PlayerId = 0) => {
  const before = game.snapshot();
  const runtime = cardRuntimeDetails(game.reader(), engine.scripts, withoutMemory(game.view(seat)));
  for (const side of game.view(seat).players) {
    for (const card of [...side.hand, ...side.ex]) {
      if (!card.hidden && card.cost !== null) {
        expect(runtime[card.id]?.normalPlayCost, card.def).toBe(corePlayCost({ state: game.state, scripts: engine.scripts, db: engine.db }, card.id, side.id));
      }
    }
  }
  expect(game.snapshot()).toEqual(before);
  return runtime;
};
function edited(t: Driver, edit: (state: GameState) => void): Driver {
  const snapshot = t.game.snapshot();
  edit(snapshot.checkpoint);
  return new Driver(engine, engine.restore(snapshot));
}
function effect(state: GameState, target: string, change: PersistentEffect["change"], extra: Partial<PersistentEffect> = {}) {
  const seq = ++state.seq;
  state.effects.push({ id: `preview:${seq}`, seq, target, change, source: null, controller: 0, createdTurn: state.turn, until: "endOfTurn", ...extra });
}

describe("normal play cost presentation", () => {
  it.each([0, 1, 2])("excludes optional costs but includes %i opposing spell taxes", (taxes) => {
    const t = drive(engine, { me: { hand: ["BP15-041", "BP13-060"], playPoints: 0 }, opp: { field: Array(taxes).fill("BP05-071") } });
    const runtime = costs(t.game);
    expect(runtime[t.id("BP15-041")]?.normalPlayCost).toBe(5);
    expect(runtime[t.id("BP13-060")]?.normalPlayCost).toBe(2 + taxes);
    expect(t.canPlay("BP13-060")).toBe(false);
  });
  it("retains other normal reductions on a card with an optional play mode", () => {
    const t = drive(engine, { me: { hand: ["BP15-041"] } });
    const u = edited(t, state => effect(state, t.id("BP15-041"), { kind: "playCost", amount: -1 }));
    expect(costs(u.game)[u.id("BP15-041")]?.normalPlayCost).toBe(4);
  });
  it.each([[0, 9], [5, 6], [10, 3], [15, 0]])("follows Spellchain %i -> %i without requiring legal play", (count, expected) => {
    const t = drive(engine, { me: { hand: ["BP01-061"], cemetery: Array(count).fill("S1"), playPoints: 0 } });
    expect(costs(t.game)[t.id("BP01-061")]?.normalPlayCost).toBe(expected);
  });
  it("uses active passive sources and preserves core's own-hook ability-loss semantics", () => {
    const t = drive(engine, { me: { hand: ["BP01-061"], cemetery: Array(5).fill("S1") }, opp: { field: ["BP05-071"] } });
    const u = edited(t, state => {
      effect(state, t.id("opp:BP05-071"), { kind: "loseAbilities" });
      effect(state, t.id("BP01-061"), { kind: "loseAbilities" });
    });
    expect(costs(u.game)[u.id("BP01-061")]?.normalPlayCost).toBe(6);
  });
  it("applies BP06-074's Yokai discount to every matching hand/EX instance", () => {
    const yokai = ALL_CARDS.find(c => !c.evolved && c.type === "follower" && c.traits.includes("妖怪") && (c.cost ?? 0) >= 2)!;
    const t = drive(engine, { me: { field: ["BP06-074"], hand: [yokai.id], ex: [yokai.id] } });
    for (const id of t.ids(yokai.id)) expect(costs(t.game)[id]?.normalPlayCost).toBe(Math.max(0, yokai.cost! - 2));
  });
  it("previews every ordinary next-card candidate and refreshes hand and EX after one matching play", () => {
    const t = drive(engine, { me: { universe: "princessConnect", field: ["CP04-039"], hand: ["CP04-105", "CP04-105", "CP04-053", "V1"], ex: ["CP04-053"], deck: ["V1", "V1"], playPoints: 10 }, opp: { field: ["V5"] }, config: { manualActions: true } });
    t.play("CP04-105").play("CP04-105");
    expect(t.game.state.nextPlay).toHaveLength(2);
    const hand = t.id("CP04-053@hand"), ex = t.id("CP04-053@ex");
    expect([costs(t.game)[hand]?.normalPlayCost, costs(t.game)[ex]?.normalPlayCost]).toEqual([0, 0]);
    t.play("V1@hand");
    expect(t.game.state.nextPlay).toHaveLength(2);
    t.answer({ type: "mainPhase", action: { type: "manual", op: { kind: "move", card: t.id("CP04-039"), to: "cemetery" } } });
    expect(costs(t.game)[hand]?.normalPlayCost).toBe(0); // Already-created offers survive their source.
    const pp = t.pp();
    const saved = t.game.snapshot();
    t.play("CP04-053@ex");
    expect(t.pp()).toBe(pp);
    expect(t.game.state.nextPlay).toHaveLength(0);
    expect(costs(t.game)[hand]?.normalPlayCost).toBe(2);
    expect(costs(engine.restore(saved))[hand]?.normalPlayCost).toBe(0);
  });
  it("only discounts CP04-039's searched instances, independently", () => {
    const t = drive(engine, { me: { universe: "princessConnect", hand: ["CP04-039", "CP04-053"], deck: ["CP04-047", "CP04-053", "V1"], playPoints: 5 }, opp: { field: ["V5"] } });
    t.play("CP04-039").pick("CP04-047").pick("CP04-053");
    const ex = t.id("CP04-053@ex"), hand = t.id("CP04-053@hand");
    expect([costs(t.game)[ex]?.normalPlayCost, costs(t.game)[hand]?.normalPlayCost]).toEqual([0, 2]);
    t.play("CP04-047@ex");
    expect(costs(t.game)[ex]?.normalPlayCost).toBe(0);
  });
  it("refreshes a BP14-046 shared group after a successful member play, preserving independent effects", () => {
    const t = drive(engine, { me: { hand: ["BP14-046"], ex: ["V1"], deck: ["V3", "V5", "V1", "V1", "V3"], playPoints: 10 } });
    t.play("BP14-046");
    const first = t.id("V1@ex"), other = t.id("V3@ex"), member = t.id("V5@ex");
    expect([costs(t.game)[first]?.normalPlayCost, costs(t.game)[other]?.normalPlayCost]).toEqual([1, 0]);
    t.play("V1@ex"); // A pre-existing, nonmember card does not consume the group.
    expect(costs(t.game)[other]?.normalPlayCost).toBe(0);
    t.play("V5@ex");
    expect(costs(t.game)[other]?.normalPlayCost).toBe(3);
    expect(costs(t.game)[member]?.normalPlayCost).toBeUndefined();
  });
  it("keeps separate groups and independent effects when a shared offer is consumed", () => {
    const t = drive(engine, { me: { ex: ["V1", "V3", "V5"] } });
    const one = t.id("V1"), three = t.id("V3"), five = t.id("V5");
    const u = edited(t, state => {
      effect(state, one, { kind: "playCostSet", value: 0, group: "group-a" });
      effect(state, three, { kind: "playCostSet", value: 0, group: "group-a" });
      effect(state, three, { kind: "playCost", amount: -1 });
      effect(state, five, { kind: "playCostSet", value: 0, group: "group-b" });
    });
    u.play("V1");
    expect([costs(u.game)[three]?.normalPlayCost, costs(u.game)[five]?.normalPlayCost]).toEqual([2, 0]);
  });
  it("stacks two CP01-029 on the same first Umamusume spell, then refreshes all candidates", () => {
    const t = drive(engine, { me: { field: ["CP01-029", "CP01-029"], hand: ["CP01-031"], ex: ["CP01-031"], playPoints: 2 }, opp: { field: ["V5"] }, config: { manualActions: true } });
    const hand = t.id("CP01-031@hand"), ex = t.id("CP01-031@ex");
    expect([costs(t.game)[hand]?.normalPlayCost, costs(t.game)[ex]?.normalPlayCost]).toEqual([0, 0]);
    t.play("CP01-031@ex");
    expect(t.pp()).toBe(2);
    expect(costs(t.game)[hand]?.normalPlayCost).toBe(2);
    t.answer({ type: "mainPhase", action: { type: "manual", op: { kind: "move", card: t.id("CP01-029@field"), to: "hand" } } });
    t.answer({ type: "mainPhase", action: { type: "manual", op: { kind: "move", card: t.id("CP01-029@hand"), to: "field" } } });
    expect(costs(t.game)[hand]?.normalPlayCost).toBe(2);
  });
  it("does not reset first-spell history when CP01-029 enters later", () => {
    const t = drive(engine, { me: { hand: ["CP01-031", "CP01-029"], ex: ["CP01-031"], playPoints: 10 }, opp: { field: ["V5"] } });
    t.play("CP01-031@hand").play("CP01-029");
    expect(costs(t.game)[t.id("CP01-031@ex")]?.normalPlayCost).toBe(2);
  });
  it("retains allThisTurn across plays, discounts later EX cards and expires at turn end", () => {
    const golem = ALL_CARDS.find(c => c.name === "Strikeform Golem")!.id;
    const t = drive(engine, { me: { field: ["BP22-049"], ex: [golem, golem], hand: [golem], playPoints: 10, deck: ["V1"] }, opp: { deck: ["V1"] }, config: { manualActions: true } });
    t.activate("BP22-049").activate("BP22-049");
    const ids = t.ids(`${golem}@ex`);
    expect(ids.map(id => costs(t.game)[id]?.normalPlayCost)).toEqual([0, 0]);
    expect(costs(t.game)[t.id(`${golem}@hand`)]?.normalPlayCost).toBe(2);
    t.answer({ type: "mainPhase", action: { type: "manual", op: { kind: "move", card: t.id(`${golem}@hand`), to: "ex" } } });
    expect(t.ids(`${golem}@ex`).map(id => costs(t.game)[id]?.normalPlayCost)).toEqual([0, 0, 0]);
    t.play(`${golem}@ex`);
    expect(t.game.state.nextPlay).toHaveLength(2);
    expect(costs(t.game)[ids[1]!]!.normalPlayCost).toBe(0);
    t.end();
    expect(costs(t.game)[ids[1]!]!.normalPlayCost).toBe(2);
  });
  it("sets the base before summing and clamps only once, with latest valid set winning", () => {
    const t = drive(engine, { me: { hand: ["BP13-060"] }, opp: { field: ["BP05-071"] } });
    const id = t.id("BP13-060");
    const u = edited(t, state => {
      effect(state, id, { kind: "playCostSet", value: 7 });
      effect(state, id, { kind: "playCostSet", value: 0 });
    });
    expect(costs(u.game)[id]?.normalPlayCost).toBe(1);
    const v = edited(u, state => effect(state, id, { kind: "playCost", amount: -2 }));
    expect(costs(v.game)[id]?.normalPlayCost).toBe(0);
  });
  it("consumes ordinary next-play records while retaining overlapping allThisTurn records", () => {
    const t = drive(engine, { me: { ex: ["GOLEM-SPELL", "GOLEM-SPELL"], playPoints: 10, deck: ["V1"] }, opp: { deck: ["V1"] } });
    const u = edited(t, state => {
      for (const [sourceDef, key, costDelta, allThisTurn] of [["BP03-038", "spell", -4, false], ["BP22-049", "exGolem", -3, true]] as const) {
        const seq = ++state.seq;
        state.nextPlay.push({ id: `next:${seq}`, seq, sourceDef, key, costDelta, player: 0, createdTurn: state.turn, ...(allThisTurn ? { allThisTurn: true } : {}) });
      }
    });
    const remaining = u.ids("GOLEM-SPELL")[1]!;
    expect(costs(u.game)[remaining]?.normalPlayCost).toBe(1);
    u.play("GOLEM-SPELL");
    expect(u.pp()).toBe(9);
    expect(costs(u.game)[remaining]?.normalPlayCost).toBe(5);
    expect(u.game.state.nextPlay).toHaveLength(1);
    u.end();
    expect(costs(u.game)[remaining]?.normalPlayCost).toBe(8);
  });
  it("distinguishes given-before-loss, direct and later-given effects, and duration", () => {
    const t = drive(engine, { me: { hand: ["V5"] } });
    const id = t.id("V5");
    const u = edited(t, state => {
      effect(state, id, { kind: "playCost", amount: -3 }, { givenBy: "BP12-005" });
      effect(state, id, { kind: "loseAbilities" });
      effect(state, id, { kind: "playCost", amount: -1 });
      effect(state, id, { kind: "playCost", amount: -1 }, { givenBy: "BP12-005", until: null });
      effect(state, id, { kind: "playCostSet", value: 0 }, { until: "endOfOpponentsNextTurn", createdTurn: state.turn - 2 });
    });
    expect(costs(u.game)[id]?.normalPlayCost).toBe(3);
  });
  it("uses BP18-004's resolved X without reevaluating it after more plays", () => {
    const eve = ALL_CARDS.find(c => c.name === "Crystalia Eve")!.id;
    const t = drive(engine, { me: { field: ["BP18-004"], ex: [eve], hand: ["V1"], playedThisTurn: 1, playPoints: 10 } });
    t.activate("BP18-004");
    const id = t.id(eve), initial = costs(t.game)[id]?.normalPlayCost;
    t.play("V1");
    expect(costs(t.game)[id]?.normalPlayCost).toBe(initial);
  });
  it("limits player taxes to their later active turn, including stacked restrictions", () => {
    const t = drive(engine, { me: { hand: ["V3"], deck: ["V1"] }, opp: { hand: ["V5"], deck: ["V1"] } });
    const u = edited(t, state => {
      for (const [player, createdTurn] of [[0, state.turn - 1], [0, state.turn - 1], [0, state.turn], [1, state.turn - 1]] as const) {
        const seq = ++state.seq;
        state.restrictions.push({ id: `tax:${seq}`, seq, player, kind: "playCostPlus1", createdTurn });
      }
    });
    expect(costs(u.game)[u.id("V3")]?.normalPlayCost).toBe(5);
    expect(costs(u.game, 1)[u.id("opp:V5")]?.normalPlayCost).toBe(5);
    u.end();
    expect(costs(u.game, 1)[u.id("opp:V5")]?.normalPlayCost).toBe(6);
  });
  it("publishes only visible hand/EX costs, supports zero and rejects stale/other-zone data", () => {
    const t = drive(engine, { me: { hand: ["V1"], ex: ["V3"], field: ["V5"] }, opp: { hand: ["V1"] } });
    const runtime = costs(t.game);
    expect(runtime[t.id("opp:V1")]).toBeUndefined();
    expect(runtime[t.id("V5")]?.normalPlayCost).toBeUndefined();
    const update = { view: t.game.view(0), cardDetails: runtime } as GameUpdate;
    const card = update.view.players[0].hand[0]!;
    if (card.hidden) throw new Error("own hand hidden");
    expect(normalPlayCost(update, card)).toBe(1);
    runtime[card.id]!.normalPlayCost = 0;
    expect(normalPlayCost(update, card)).toBe(0);
    update.view.players[0].hand = [];
    expect(normalPlayCost(update, card)).toBeUndefined();
    expect([costArrow(0, 1), costArrow(3, 2), costArrow(2, 2), costArrow(undefined, 2), costArrow(0, null)]).toEqual(["↓", "↑", "", "", ""]);
  });
  it("queries crest/equipment passives but ignores an ordinary EX source and null costs", () => {
    const custom = createEngine({ cards: [testFollower("PLAIN", 5, 1, 1), testFollower("PASSIVE", 1, 1, 1), testCrest("CREST"), { ...testFollower("EQUIP", 0, 0, 0), type: "equipment", token: true }],
      scripts: { CREST: { field: { playCostOf: () => -1 } }, EQUIP: { field: { playCostOf: () => -1 } }, PASSIVE: { field: { playCostOf: () => -9 } } } });
    const t = drive(custom, { me: { hand: ["PLAIN"], ex: ["CREST", "PASSIVE"], field: [{ card: "PLAIN", equipped: ["EQUIP"] }] } });
    const query = createPlayCostQuery(t.game.reader(), custom.scripts);
    expect(query(t.id("PLAIN@hand"), 0)).toBe(3);
    expect(query(t.id("leader"), 0)).toBeUndefined();
  });
});
