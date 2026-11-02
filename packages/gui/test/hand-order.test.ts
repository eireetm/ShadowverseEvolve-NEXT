import type { CardView, HiddenCardView } from "@sve/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GameUpdate } from "../src/engine/protocol";
import { arranged, arrangedIds, arrangeHand, byCost, otherHandMoved, shownHand, shuffled } from "../src/game/hand-order";
import { setLink } from "../src/net/state";

// How a hand is drawn on this screen (game/hand-order.ts): never the game's own order, and online only "the hand was moved".

const card = (id: string, cost: number | null, def = id): CardView => ({ id, hidden: false, def, cost }) as unknown as CardView;
const back = (id: string): HiddenCardView => ({ id, hidden: true });

function update(hand: (CardView | HiddenCardView)[], seed: string, online = false): GameUpdate {
  return { seed, online: online ? { seat: 0 } : null, view: { players: [{ hand }, { hand: [back("x"), back("y"), back("z")] }] } } as unknown as GameUpdate;
}

/** The ids of a hand as this screen draws it. */
const shown = (u: GameUpdate, player: 0 | 1 = 0) => arranged(u.view.players[player].hand, shownHand(u.seed, player).order).map((c) => c.id);

beforeEach(() => {
  vi.useFakeTimers();
  vi.advanceTimersByTime(1000);
});

afterEach(() => {
  setLink(null);
  vi.useRealTimers();
});

describe("the order a hand is drawn in", () => {
  it("cards it doesn't list come after, on the right, as the game has them; cards gone are gone", () => {
    expect(arrangedIds(["a", "b", "c", "d"], ["c", "a"])).toEqual(["c", "a", "b", "d"]);
    expect(arrangedIds(["a", "b"], ["z", "b", "a"])).toEqual(["b", "a"]);
    expect(arrangedIds(["a", "b"], [])).toEqual(["a", "b"]);
  });

  it("by cost: the lowest on the left, the same card together, no cost and hidden cards last", () => {
    const hand = [card("a", 3, "X"), card("n", null), card("b", 1), card("c", 3, "A"), card("d", 3, "X"), back("h"), card("e", 2)];
    const sorted = byCost(hand).map((c) => c.id);
    expect(sorted.slice(0, 5)).toEqual(["b", "e", "c", "a", "d"]);
    expect(sorted.slice(5).sort()).toEqual(["h", "n"]);
  });

  it("shuffled: the same cards in another order, even when the draw would leave them as they were", () => {
    const items = ["a", "b", "c", "d"];
    expect([...shuffled(items)].sort()).toEqual(items);
    // Math.random() near 1 leaves every card where it is.
    const same = shuffled(items, () => 0.999);
    expect(same).not.toEqual(items);
    expect([...same].sort()).toEqual(items);
    expect(shuffled(["a"], () => 0.999)).toEqual(["a"]);
    expect(shuffled([])).toEqual([]);
  });
});

describe("the button", () => {
  it("by cost; when it is, shuffled; then by cost again", () => {
    const u = update([card("a", 3), card("b", 1), card("c", 2), card("d", 4)], "alternate");
    expect(shown(u)).toEqual(["a", "b", "c", "d"]);
    arrangeHand(u, 0);
    expect(shown(u)).toEqual(["b", "c", "a", "d"]);
    arrangeHand(u, 0);
    expect(shown(u)).not.toEqual(["b", "c", "a", "d"]);
    expect([...shown(u)].sort()).toEqual(["a", "b", "c", "d"]);
    arrangeHand(u, 0);
    expect(shown(u)).toEqual(["b", "c", "a", "d"]);
  });

  it("a hand already by cost is shuffled at the first press", () => {
    const u = update([card("a", 1), card("b", 2)], "sorted");
    arrangeHand(u, 0);
    expect(shown(u)).toEqual(["b", "a"]);
  });

  it("a card drawn goes on the right; the next press sorts again, without a shuffle in between", () => {
    const hand = [card("a", 3), card("b", 1)];
    arrangeHand(update(hand, "draw"), 0);
    const drawn = update([...hand, card("c", 2)], "draw");
    expect(shown(drawn)).toEqual(["b", "a", "c"]);
    arrangeHand(drawn, 0);
    expect(shown(drawn)).toEqual(["b", "c", "a"]);
    // A card played just leaves.
    expect(shown(update([card("b", 1), card("a", 3)], "draw"))).toEqual(["b", "a"]);
  });

  it("the cards are moving for a moment", () => {
    const u = update([card("a", 3), card("b", 1)], "moving");
    expect(shownHand("moving", 0).arranging).toBe(false);
    arrangeHand(u, 0);
    expect(shownHand("moving", 0).arranging).toBe(true);
    vi.advanceTimersByTime(300);
    expect(shownHand("moving", 0)).toEqual({ order: ["b", "a"], arranging: false });
  });

  it("each game starts as the game has its hands; a replay being watched draws them so", () => {
    const u = update([card("a", 3), card("b", 1)], "one");
    arrangeHand(u, 0);
    expect(shown(u)).toEqual(["b", "a"]);
    expect(shownHand(null, 0).order).toEqual([]);
    const other = update([card("a", 3), card("b", 1)], "two");
    expect(shown(other)).toEqual(["a", "b"]);
    arrangeHand(other, 0);
    // That game is over for this store: back in it, its order is gone.
    expect(shownHand("one", 0).order).toEqual([]);
  });

  it("each player's hand has its own order (two people at one screen)", () => {
    const u = { ...update([card("a", 3), card("b", 1)], "seats") };
    (u.view.players[1] as { hand: unknown[] }).hand = [card("c", 5), card("d", 2)];
    arrangeHand(u, 1);
    expect(shown(u, 1)).toEqual(["d", "c"]);
    expect(shown(u, 0)).toEqual(["a", "b"]);
  });
});

describe("online", () => {
  const listen = () => {
    const sent: unknown[] = [];
    setLink({ send: (message: unknown) => sent.push(message) } as never);
    return sent;
  };

  it("a game against a bot says nothing", () => {
    const sent = listen();
    arrangeHand(update([card("a", 3), card("b", 1)], "bot"), 0);
    vi.advanceTimersByTime(1000);
    expect(sent).toEqual([]);
  });

  it("the other programs are told the hand moved, nothing of it; at most twice a second, the last press never lost", () => {
    const sent = listen();
    const u = update([card("a", 3), card("b", 1), card("c", 2)], "told", true);
    arrangeHand(u, 0);
    expect(sent).toEqual([{ t: "handMoved" }]);
    arrangeHand(u, 0);
    arrangeHand(u, 0);
    expect(sent).toHaveLength(1);
    vi.advanceTimersByTime(500);
    expect(sent).toEqual([{ t: "handMoved" }, { t: "handMoved" }]);
    vi.advanceTimersByTime(2000);
    expect(sent).toHaveLength(2);
  });

  it("told, this program draws the other player's backs in another order of its own, and says nothing back", () => {
    const sent = listen();
    const u = update([card("a", 3), card("b", 1)], "backs", true);
    expect(shown(u, 1)).toEqual(["x", "y", "z"]);
    otherHandMoved(u, 1);
    expect(shown(u, 1)).not.toEqual(["x", "y", "z"]);
    expect([...shown(u, 1)].sort()).toEqual(["x", "y", "z"]);
    expect(shown(u, 0)).toEqual(["a", "b"]);
    vi.advanceTimersByTime(1000);
    expect(sent).toEqual([]);
  });
});
