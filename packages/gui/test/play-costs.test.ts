import { createEngine, randomAnswer, randomInt, seedRng, type CardId, type GameSession, type PlayerId } from "@sve/core";
import { ALL_CARDS, ALL_SCRIPTS } from "@sve/core/sets";
import { deckPool, drive, testSpell } from "@sve/core/testing";
import { describe, expect, it } from "vitest";
import { normalPlayCost } from "../src/engine/core-internals";
import { playCostsOf } from "../src/engine/game-host";

// The card panel shows what playing a card the viewer sees costs now (CR 10.4.4.1), where it may be played from (CR 8.2.1):
// the viewer's hand and EX area, the other player's EX area (a public zone, CR 4.8.2; never their hand, 4.7.2), as the core
// reckons it (its own engine/costs.ts and its list of the cards a player may play, called by the engine worker): the GUI
// doesn't work out costs itself.

const engine = createEngine({ cards: [...ALL_CARDS, testSpell("S1", 1)], scripts: ALL_SCRIPTS });

/** BP01-061 costs less for the spells in its owner's cemetery; BP05-071 makes the spells its opponent plays cost 1 more. */
const setup = () =>
  drive(engine, {
    me: { hand: ["BP01-061", "BP13-060", "BP15-041"], cemetery: [...Array<string>(5).fill("S1"), "BP01-061"], ex: ["BP13-060"] },
    opp: { field: ["BP05-071"], hand: ["BP13-060"] },
  });

describe("the play costs the card panel shows", () => {
  it("follows a card's own reduction and an opponent's increase, in the viewer's hand and EX area", () => {
    const t = setup();
    const costs = playCostsOf(engine, t.game, 0, t.game.view(0));
    expect(costs).toEqual({ [t.id("BP01-061@hand")]: 6, [t.id("BP13-060@hand")]: 3, [t.id("BP13-060@ex")]: 3 });
    // A card with an optional way to play (BP15-041) shows its normal cost; it is its printed one here, so nothing.
    expect(costs[t.id("BP15-041")]).toBeUndefined();
    // A card in the cemetery isn't played from there (no effect lets it): its reduction isn't shown.
    expect(costs[t.id("BP01-061@cemetery")]).toBeUndefined();
  });

  it("shows the other player's cards in their EX area (a public zone), never in their hand", () => {
    // Player 2's view of the same game: player 1's spell in their EX area costs them 1 more; their hand is hidden.
    const t = setup();
    expect(playCostsOf(engine, t.game, 1, t.game.view(1))).toEqual({ [t.id("BP13-060@ex")]: 3 });
  });

  it("changes nothing in the game", () => {
    const t = drive(engine, { me: { hand: ["BP01-061"], cemetery: Array(10).fill("S1") } });
    const before = JSON.stringify(t.game.snapshot());
    expect(playCostsOf(engine, t.game, 0, t.game.view(0))).toEqual({ [t.id("BP01-061")]: 3 });
    expect(JSON.stringify(t.game.snapshot())).toBe(before);
  });

  it("tells nothing a player can't see: the same in copies of random games whose hidden cards are dealt again", () => {
    // Random games, half of each deck the cards that change play costs (their own, other cards' or the next card's). At every
    // other decision, the play cost of each card a player sees face up (for its player), in the real game and in copies
    // whose cards hidden from that player are dealt again (GameSession.determinized) and which show that player the same: a
    // cost that read a hand, a deck or a facedown card would differ. (A new card whose cost does is found here.)
    const pool = deckPool(engine);
    const changesCosts = (id: string) => {
      const script = engine.scripts[id];
      return !!(script?.playCost || script?.field?.playCostOf || script?.nextPlay);
    };
    const changing = { main: pool.main.filter((c) => changesCosts(c.id)), evolve: pool.evolve.filter((c) => changesCosts(c.id)) };
    const deck = (seed: string) => {
      const rng = seedRng(`deck:${seed}`);
      const pick = (cards: readonly { id: string }[]) => cards[randomInt(rng, cards.length)]!.id;
      return {
        main: Array.from({ length: 40 }, (_, i) => pick(i % 2 === 0 ? changing.main : pool.main)),
        evolve: Array.from({ length: 10 }, (_, i) => pick(i % 2 === 0 ? changing.evolve : pool.evolve)),
      };
    };
    const seenBy = (g: GameSession, viewer: PlayerId, player: PlayerId): CardId[] => {
      const side = g.view(viewer).players[player];
      return [side.hand, side.field, side.ex, side.cemetery, side.banished, side.evolveDeck].flat().flatMap((c) => (c.hidden ? [] : [c.id]));
    };
    const costs = (g: GameSession, cards: CardId[], player: PlayerId) =>
      cards.map((id) => {
        try {
          return normalPlayCost(engine, g, id, player);
        } catch {
          return null;
        }
      });
    let compared = 0;
    const differences: string[] = [];
    for (let i = 0; i < 12; i++) {
      const g = engine.newGame({ seed: `costs-${i}`, players: [deck(`a${i}`), deck(`b${i}`)], config: { deckRestrictions: false } });
      const rng = seedRng(`costs-play-${i}`);
      for (let step = 0; g.decision && step < 1000; step++) {
        if (g.state.turn >= 2 && step % 2 === 0) {
          for (const viewer of [0, 1] as const) {
            // One at the other player's main phase may have gone on (a hand with nothing to play ends it): not the same game.
            const copy = g.determinized(viewer, `${i}:${step}:${viewer}`, { checkpoints: false });
            if (JSON.stringify(copy.view(viewer)) !== JSON.stringify(g.view(viewer))) continue;
            expect(playCostsOf(engine, copy, viewer, copy.view(viewer))).toEqual(playCostsOf(engine, g, viewer, g.view(viewer)));
            for (const player of [0, 1] as const) {
              const cards = seenBy(g, viewer, player);
              const [real, dealt] = [costs(g, cards, player), costs(copy, cards, player)];
              compared += cards.length;
              cards.forEach((id, k) => {
                if (real[k] !== dealt[k]) differences.push(`${g.state.cards[id]!.def}: ${real[k]} / ${dealt[k]}`);
              });
            }
          }
        }
        g.act(randomAnswer(rng, g.decision));
      }
    }
    expect(differences).toEqual([]);
    expect(compared).toBeGreaterThan(10_000);
  }, 120_000);
});
