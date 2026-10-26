import { describe, expect, it } from "vitest";
import { createEngine, type GameSession } from "../src/core";
import { ALL_CARDS, ALL_SCRIPTS } from "../../core/src/sets";
import { PlannerBot, setupSample } from "../src";
import { deckOverlap, fixedTurnOrder, ownDeckList, turnOrderFor, turnOrderIdentity, turnOrderProblems, type TurnOrderTable } from "../src/turn-order";
import { ARENA_CONFIG, sampleDeck } from "./samples";

// The turn order by the bot's own deck (PlannerBotOptions.turnOrder, turn-order.ts; CR 6.2.1.6).
const engine = createEngine({ cards: ALL_CARDS, scripts: ALL_SCRIPTS });

/** A game of two sample decks at its turn order decision. */
function setup(seed: string, decks: [string, string] = ["sd01", "sd02"]): GameSession {
  const g = engine.newGame({ seed, players: [sampleDeck(decks[0]), sampleDeck(decks[1])], config: ARENA_CONFIG });
  expect(g.decision?.type).toBe("chooseTurnOrder");
  return g;
}
/** A sample deck's main + evolve deck by definition. */
function listOf(name: string): Record<string, number> {
  const d = sampleDeck(name);
  const out: Record<string, number> = {};
  for (const p of [...d.main, ...d.evolve]) {
    const def = engine.db.ofPrinting(p).id;
    out[def] = (out[def] ?? 0) + 1;
  }
  return out;
}
const table = (entries: TurnOrderTable["entries"], goFirst = true): TurnOrderTable => ({ id: "t", hash: "0123456789abcdef", threshold: 0.8, goFirst, entries });

describe("turn order by deck", () => {
  it("matches the closest entry at or above the threshold, else the default", () => {
    const a = new Map([["X", 30], ["Y", 10]]);
    expect(deckOverlap(a, new Map([["X", 30], ["Y", 10]]))).toBe(1);
    expect(deckOverlap(a, new Map([["X", 30], ["Z", 10]]))).toBe(0.75);
    expect(deckOverlap(a, new Map([["X", 30], ["Y", 10], ["Z", 10]]))).toBe(0.8);
    const t = table([
      { name: "near", goFirst: false, cards: { X: 30, Z: 10 } },
      { name: "close", goFirst: false, cards: { X: 30, Y: 8, Z: 2 } },
      { name: "same", goFirst: true, cards: { X: 30, Y: 10 } },
    ]);
    expect(turnOrderFor(t, a)).toEqual({ goFirst: true, entry: "same", overlap: 1 });
    expect(turnOrderFor({ ...t, entries: t.entries.slice(0, 2) }, a)).toEqual({ goFirst: false, entry: "close", overlap: 0.95 });
    expect(turnOrderFor({ ...t, entries: t.entries.slice(0, 1) }, a)).toEqual({ goFirst: true, entry: null, overlap: 0 });
    expect(turnOrderFor(fixedTurnOrder(false), a)).toEqual({ goFirst: false, entry: null, overlap: 0 });
  });

  it("writes its identity and refuses a malformed table", () => {
    expect(turnOrderIdentity(fixedTurnOrder(false))).toBe("order=second");
    expect(turnOrderIdentity(fixedTurnOrder(true))).toBe("order=first");
    expect(turnOrderIdentity(table([{ name: "a", goFirst: false, cards: { X: 1 } }]))).toBe("order=t:table=0123456789abcdef");
    expect(turnOrderProblems(fixedTurnOrder(false))).toEqual([]);
    expect(turnOrderProblems({ ...table([{ name: "a", goFirst: false, cards: { X: 0 } }]), threshold: 0, hash: "x" })).toEqual([
      "threshold 0: above 0, at most 1",
      "hash: 16 hex digits (the table's content)",
      "entry 0 (a): cards are copies (whole numbers from 1) by definition",
    ]);
    expect(() => new PlannerBot(engine, { turnOrder: { ...fixedTurnOrder(false), threshold: 2 } })).toThrow(/threshold 2/);
  });

  it("reads the bot's own deck list at the turn order decision: main and evolve deck, by definition", () => {
    const g = setup("order:list");
    const me = g.decision!.player;
    const mine = me === 0 ? "sd01" : "sd02";
    expect(Object.fromEntries([...ownDeckList(g, me)].sort())).toEqual(Object.fromEntries(Object.entries(listOf(mine)).sort()));
  });

  it("answers by the table on the planner; without one, it goes first as before", () => {
    const g = setup("order:planner");
    const me = g.decision!.player;
    const mine = me === 0 ? "sd01" : "sd02";
    const other = me === 0 ? "sd02" : "sd01";
    const second = new PlannerBot(engine, { seed: "o", turnOrder: table([{ name: other, goFirst: true, cards: listOf(other) }, { name: mine, goFirst: false, cards: listOf(mine) }]) });
    expect(second.decide(g)).toEqual({ type: "chooseTurnOrder", goFirst: false });
    expect(second.turnOrderStats).toEqual({ choices: 1, second: 1, last: { goFirst: false, entry: mine, overlap: 1 } });
    const unmatched = new PlannerBot(engine, { seed: "o", turnOrder: table([{ name: other, goFirst: false, cards: listOf(other) }]) });
    expect(unmatched.decide(g)).toEqual({ type: "chooseTurnOrder", goFirst: true });
    expect(new PlannerBot(engine, { seed: "o", turnOrder: fixedTurnOrder(false) }).decide(g)).toEqual({ type: "chooseTurnOrder", goFirst: false });
    const plain = new PlannerBot(engine, { seed: "o" });
    expect(plain.decide(g)).toEqual({ type: "chooseTurnOrder", goFirst: true });
    expect(plain.turnOrderStats.choices).toBe(0);
  });

  it("is fair: the answer depends on the bot's own deck list only, not its order nor the opponent's deck", () => {
    // Nothing can be sampled before the turn order is answered (setup-sample.ts needs that answer), so the games differ
    // instead: other shuffles of the same decks (other seeds), and another opponent deck.
    const t = table([{ name: "sd03", goFirst: false, cards: listOf("sd03") }]);
    const lists = new Set<string>();
    const orders = new Set<string>();
    let chose = 0;
    for (const [seed, other] of [["order:fair:1", "sd04"], ["order:fair:2", "sd04"], ["order:fair:3", "sd05"], ["order:fair:4", "csd02b"]] as const) {
      // Both seatings: the seed picks the same seat to choose, so in one of them the chooser has sd03.
      for (const decks of [["sd03", other], [other, "sd03"]] as [string, string][]) {
        const g = setup(seed, decks);
        const me = g.decision!.player;
        const answer = new PlannerBot(engine, { seed: "o", turnOrder: t }).decide(g);
        expect(answer).toEqual({ type: "chooseTurnOrder", goFirst: decks[me] !== "sd03" });
        if (decks[me] !== "sd03") continue;
        chose += 1;
        lists.add(JSON.stringify([...ownDeckList(g, me)].sort()));
        orders.add(JSON.stringify(g.reader().cards(me, "deck").map((id) => g.reader().card(id)!.def)));
      }
    }
    // sd03 chose in several games: the same list each time, in other orders, and the same answer.
    expect(chose).toBeGreaterThanOrEqual(3);
    expect(lists.size).toBe(1);
    expect(orders.size).toBeGreaterThan(1);
  });

  it("can't be sampled at the turn order decision: a setup sample needs the turn order answered (so the real deck list is read)", () => {
    const g = setup("order:sample");
    expect(() => setupSample(engine, g, g.decision!.player, "s")).toThrow(/turn order/);
  });
});
