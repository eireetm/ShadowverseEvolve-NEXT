import { describe, expect, it } from "vitest";
import { createEngine, type CardId, type GameSession, type HiddenCardView, type PlayerId } from "../../src";
import type { GameState } from "../../src/model/state";
import type { G } from "../../src/engine/runtime/context";
import { revealCards, shuffleDeck, stealCard } from "../../src/engine/actions/cards";
import { resampleHidden } from "../../src/engine/determinize";
import { seedRng } from "../../src/rng/rng";
import { moveCards } from "../../src/engine/state/zones";
import { ALL_CARDS, ALL_SCRIPTS } from "../../src/sets";
import { drive } from "../../src/testing";
import { cloneJson } from "../../src/util/json";

// What a player remembers of cards hidden from them again (CardInstance.knownBy, engine/state/knowledge.ts): set by what
// they were shown (a public zone, CR 4.1.2; a reveal, 5.21.1; a look, 5.11.1), kept through moves they can follow, forgotten
// whenever which card is which becomes unclear (a shuffle, 5.9.1; an order only the deck's owner sees, 4.1.5.1; a card
// leaving a hidden zone unseen). Shown by the view, kept by determinize().
const engine = createEngine({ cards: ALL_CARDS, scripts: ALL_SCRIPTS });

/** The engine's own procedures on a copy of a scenario's state (they don't decide anything here). */
function sandbox(game: GameSession): { g: G; state: GameState } {
  const state = cloneJson(game.state) as GameState;
  return { state, g: { state, db: engine.db, scripts: engine.scripts, emit: () => {} } };
}
const known = (state: GameState, id: CardId) => state.cards[id]!.knownBy ?? [];
const zone = (state: GameState, p: PlayerId, z: "hand" | "deck" | "field" | "cemetery") => state.players[p].zones[z];
const of = (state: GameState, p: PlayerId, z: "hand" | "deck" | "field" | "cemetery", def: string) => zone(state, p, z).find((id) => state.cards[id]!.def === def)!;

describe("cards a player was shown and can no longer see", () => {
  // SD08-001 / SD08-003 / SD08-005: three different followers; BP11-058: a cost 9 follower.
  const start = () =>
    drive(engine, {
      me: { hand: ["SD08-001", "SD08-003"], field: ["SD08-005"], deck: ["SD08-006", "SD08-007", "SD08-009", "SD08-010"], cemetery: ["SD08-011", "SD08-012"] },
      opp: { hand: ["SD08-001", "SD08-003", "SD08-014"], field: ["SD08-005", "SD08-001"], deck: ["SD08-006", "SD08-007", "SD08-009"] },
    });

  it("a follower returned to its owner's hand: the other player knows it there (it was on the field, CR 4.1.2, 4.7.2)", () => {
    const { g, state } = sandbox(start().game);
    const def = engine.db.ofPrinting("SD08-005").id;
    const [inHand] = moveCards(g, [{ card: of(state, 1, "field", def), to: "hand" }], "effect");
    expect(known(state, inHand!)).toEqual([0]);
  });

  it("a card leaving that hand unseen into another hidden zone: the other player can't tell which, so forgets the hand", () => {
    const { g, state } = sandbox(start().game);
    const def = engine.db.ofPrinting("SD08-005").id;
    const [bounced] = moveCards(g, [{ card: of(state, 1, "field", def), to: "hand" }], "effect");
    const other = zone(state, 1, "hand").find((id) => id !== bounced)!;
    const [inDeck] = moveCards(g, [{ card: other, to: "deck", position: "bottom" }], "effect");
    expect(known(state, bounced!)).toEqual([]);
    expect(known(state, inDeck!)).toEqual([1]); // its owner put it there
  });

  it("the known card itself put into the deck unseen: known nowhere", () => {
    const { g, state } = sandbox(start().game);
    const def = engine.db.ofPrinting("SD08-005").id;
    const [bounced] = moveCards(g, [{ card: of(state, 1, "field", def), to: "hand" }], "effect");
    const [inDeck] = moveCards(g, [{ card: bounced!, to: "deck", position: "top" }], "effect");
    expect(known(state, inDeck!)).toEqual([1]); // only its owner, who put it there
    expect(zone(state, 1, "hand").some((id) => known(state, id).length > 0)).toBe(false);
  });

  it("a card of that hand played (seen): the known one stays known unless the played one could be it (same definition)", () => {
    const { g, state } = sandbox(start().game);
    const def = engine.db.ofPrinting("SD08-001").id;
    // The opponent's field SD08-001 returned to their hand, which holds another SD08-001.
    const [bounced] = moveCards(g, [{ card: of(state, 1, "field", def), to: "hand" }], "effect");
    const different = zone(state, 1, "hand").find((id) => state.cards[id]!.def === engine.db.ofPrinting("SD08-014").id)!;
    moveCards(g, [{ card: different, to: "field" }], "effect");
    expect(known(state, bounced!)).toEqual([0]);
    const twin = zone(state, 1, "hand").find((id) => id !== bounced && state.cards[id]!.def === def)!;
    moveCards(g, [{ card: twin, to: "field" }], "effect");
    expect(known(state, bounced!)).toEqual([]);
  });

  it("a card put on top of a deck from the field: both know it; a draw keeps it known in the hand (it is the top card, CR 5.10.1)", () => {
    const { g, state } = sandbox(start().game);
    const def = engine.db.ofPrinting("SD08-005").id;
    const [onTop] = moveCards(g, [{ card: of(state, 0, "field", def), to: "deck", position: "top" }], "effect");
    expect(known(state, onTop!)).toEqual([0, 1]);
    const [drawn] = moveCards(g, [{ card: onTop!, to: "hand", player: 0 }], "draw");
    expect(known(state, drawn!)).toEqual([1]); // its owner sees it in their hand
  });

  it("a shuffle forgets every card of the deck (CR 5.9.1)", () => {
    const { g, state } = sandbox(start().game);
    const def = engine.db.ofPrinting("SD08-005").id;
    const [onTop] = moveCards(g, [{ card: of(state, 0, "field", def), to: "deck", position: "top" }], "effect");
    shuffleDeck(g, 0);
    expect(known(state, onTop!)).toEqual([]);
  });

  it("several cards put into a deck at once: only the deck's owner knows their order (CR 4.1.5, 4.1.5.1)", () => {
    const { g, state } = sandbox(start().game);
    const placed = moveCards(g, zone(state, 0, "cemetery").map((card) => ({ card, to: "deck" as const, position: "bottom" as const })), "effect");
    expect(placed.map((id) => known(state, id))).toEqual([[0], [0]]);
    // One card alone: everyone saw where it went.
    const [one] = moveCards(g, [{ card: of(state, 0, "field", engine.db.ofPrinting("SD08-005").id), to: "deck", position: "bottom" }], "effect");
    expect(known(state, one!)).toEqual([0, 1]);
  });

  it("several cards put into a deck at once by their controller, not its owner: only that controller knows the order (CR 4.1.5.1)", () => {
    const { g, state } = sandbox(start().game);
    // Two of my followers, taken by the opponent (CR 5.22), go back into my deck together in the order the opponent chooses.
    const [a] = [stealCard(g, of(state, 0, "field", engine.db.ofPrinting("SD08-005").id), 1)!];
    const b = moveCards(g, [{ card: zone(state, 0, "cemetery")[0]!, to: "field", player: 1 }], "effect")[0]!;
    const placed = moveCards(g, [a, b].map((card) => ({ card, to: "deck" as const, player: 0 as const, position: "top" as const })), "effect");
    expect(placed.map((id) => known(state, id))).toEqual([[1], [1]]);
    // Cards of both players in one batch: nobody keeps their order.
    const mixed = moveCards(g, [zone(state, 1, "field")[0]!, zone(state, 0, "field")[0] ?? zone(state, 0, "cemetery")[0]!].map((card) => ({ card, to: "deck" as const, player: 0 as const, position: "bottom" as const })), "effect");
    expect(mixed.map((id) => known(state, id))).toEqual([[], []]);
  });

  it("a shuffle ends the reveal of the deck's cards (CR 5.21.1.1), so a revealed card drawn after it is not remembered", () => {
    const { g, state } = sandbox(start().game);
    const card = zone(state, 0, "deck")[2]!;
    revealCards(g, 0, [card]);
    shuffleDeck(g, 0);
    expect(state.revealed).not.toContain(card);
    const top = zone(state, 0, "deck")[0]!;
    const [drawn] = moveCards(g, [{ card: top, to: "hand", player: 0 }], "draw");
    expect(known(state, drawn!)).toEqual([]);
  });

  it("dealing hidden cards again drops what the other player remembered of those slots (it was about the real cards)", () => {
    const { g, state } = sandbox(start().game);
    // The opponent puts two of their field cards on the bottom of their deck: they know the order, I don't.
    const placed = moveCards(g, zone(state, 1, "field").map((card) => ({ card, to: "deck" as const, position: "bottom" as const })), "effect");
    expect(placed.map((id) => known(state, id))).toEqual([[1], [1]]);
    resampleHidden(state, 0, seedRng("again"), new Set());
    expect(placed.map((id) => known(state, id))).toEqual([[], []]);
  });

  it("a card revealed from the hand and left there: the other player remembers it after the reveal (CR 5.21.1.1)", () => {
    const { g, state } = sandbox(start().game);
    const card = zone(state, 0, "hand")[0]!;
    revealCards(g, 0, [card]);
    state.revealed = []; // the effect is over
    expect(known(state, card)).toEqual([1]);
  });
});

describe("cards a decision shows its player", () => {
  it("are remembered: Maiden of Libra (CP03-111) arranges the top 5, and its player knows the cards kept on top", () => {
    const d = drive(engine, {
      me: { hand: ["CP03-111"], playPoints: 3, maxPlayPoints: 3, deck: ["SD08-001", "SD08-003", "SD08-005", "SD08-006", "SD08-007", "SD08-009", "SD08-010"] },
    });
    d.play("CP03-111");
    for (let d0 = d.decision; d0 && d0.type !== "mainPhase"; d0 = d.decision) {
      if (d0.type === "selectCards") d.answer({ type: "selectCards", cards: d0.candidates.slice(0, 2) });
      else if (d0.type === "orderCards") d.answer({ type: "orderCards", order: d0.cards.map((c) => c.id) });
      else throw new Error(`unexpected ${d0.type}`);
    }
    const s = d.game.state;
    const deck = s.players[0].zones.deck;
    expect(deck.slice(0, 2).map((id) => s.cards[id]!.knownBy ?? [])).toEqual([[0], [0]]); // kept on top, in my order
    expect(deck.slice(-3).map((id) => s.cards[id]!.knownBy ?? [])).toEqual([[0], [0], [0]]); // the rest on the bottom
    expect(deck.slice(2, -3).map((id) => s.cards[id]!.knownBy ?? [])).toEqual([[], []]); // never seen
  });
});

describe("in the view and in determinized copies", () => {
  /** Draconic Call (BP11-062): look at the top 5, reveal up to 2 Dragoncraft cards costing 7 or more into the hand, rest on the bottom in any order. */
  const cast = () => {
    const d = drive(engine, {
      me: {
        hand: ["BP11-062"],
        playPoints: 5,
        maxPlayPoints: 5,
        deck: ["BP11-058", "SD08-001", "SD08-003", "SD08-005", "SD08-006", "SD08-007", "SD08-009", "SD08-010", "SD08-011", "SD08-012"],
      },
      opp: { hand: ["SD08-014", "SD08-016"], deck: ["SD08-006", "SD08-007", "SD08-009", "SD08-010"] },
    });
    d.play("BP11-062");
    // Take what can be taken; the rest go to the bottom in the order offered.
    for (let d0 = d.decision; d0 && d0.type !== "mainPhase"; d0 = d.decision) {
      if (d0.type === "selectCards") d.answer({ type: "selectCards", cards: d0.candidates.slice(0, d0.max) });
      else if (d0.type === "orderCards") d.answer({ type: "orderCards", order: d0.cards.map((c) => c.id) });
      else throw new Error(`unexpected ${d0.type}`);
    }
    return d;
  };

  it("the opponent sees the revealed card in my hand as known; the rest on the bottom are known to me only", () => {
    const d = cast();
    const s = d.game.state;
    const big = s.players[0].zones.hand.find((id) => s.cards[id]!.def === "BP11-058");
    expect(big, "Draconic Call took BP11-058").toBeDefined();
    const theirView = d.game.view(1).players[0].hand.find((c) => c.id === big) as HiddenCardView;
    expect(theirView).toMatchObject({ hidden: true, known: { def: "BP11-058" } });
    // The 3 looked at and put on the bottom: their order is mine (CR 4.1.5); the opponent never saw them.
    const bottom = s.players[0].zones.deck.slice(-3);
    expect(bottom.map((id) => s.cards[id]!.knownBy ?? [])).toEqual([[0], [0], [0]]);
    expect(d.game.view(0).players[0].hand.every((c) => !c.hidden)).toBe(true);
  });

  it("determinized copies keep remembered cards and still show exactly the real view", () => {
    const d = cast();
    const s = d.game.state;
    const big = s.players[0].zones.hand.find((id) => s.cards[id]!.def === "BP11-058")!;
    const bottom = s.players[0].zones.deck.slice(-3);
    for (let k = 0; k < 20; k++) {
      const theirs = d.game.determinized(1, `known:${k}`, { checkpoints: false });
      expect(theirs.state.cards[big]!.def).toBe("BP11-058");
      expect(theirs.view(1)).toEqual(d.game.view(1));
      const mine = d.game.determinized(0, `known:${k}`, { checkpoints: false });
      expect(bottom.map((id) => mine.state.cards[id]!.def)).toEqual(bottom.map((id) => s.cards[id]!.def));
      expect(mine.view(0)).toEqual(d.game.view(0));
    }
  });
});
