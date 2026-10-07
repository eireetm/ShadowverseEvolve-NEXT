import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { cardFeatureTable, type CardFeatureFile } from "../../packages/bot/src";
import { createEngine, randomAnswer, seedRng, type AbilityDef, type GameSession } from "../../packages/core/src";
import { correspondingEvolveCards } from "../../packages/core/src/engine/abilities/evolve";
import type { G } from "../../packages/core/src/engine/runtime/context";
import { characteristics } from "../../packages/core/src/engine/state/characteristics";
import type { GameState } from "../../packages/core/src/model/state";
import { ALL_CARDS, ALL_SCRIPTS } from "../../packages/core/src/sets";
import { deckPool, randomDeck } from "../../packages/core/src/testing";
import { DECK_SETS, sampleDeck } from "../rl/series";

// The card feature table's static data checked against the engine: a follower's evolve cards (evolvePartners) are the ones
// Core's correspondingEvolveCards offers on the field (CR 5.16.1.1.1, 4.6.4), and every trait of the card data is listed.
const engine = createEngine({ cards: ALL_CARDS, scripts: ALL_SCRIPTS });
const table = cardFeatureTable(JSON.parse(readFileSync(join(__dirname, "..", "..", "packages", "bot", "src", "card-features.json"), "utf8")) as CardFeatureFile);

describe("card-features.json, against the card data and the engine", () => {
  it("lists every definition's traits", () => {
    for (const def of ALL_CARDS) expect(table.traitsOf(def.id).map((i) => table.file.traits[i]).sort(), def.id).toEqual([...new Set(def.traits)].sort());
  });

  it("gives each follower on the field exactly the facedown evolve cards the engine would let it evolve with", () => {
    let followers = 0;
    let withOptions = 0;
    const pool = deckPool(engine);
    // Every sample deck (their evolve decks go with their followers), and two decks of the whole pool.
    const names = [...DECK_SETS.train, ...DECK_SETS.holdout];
    const games = names.map((name, i) => ({ seed: `partners-${name}`, decks: [sampleDeck(name)!.deck, sampleDeck(names[(i + 7) % names.length]!)!.deck] }));
    games.push({ seed: "partners-pool", decks: [randomDeck(pool, "partners/0"), randomDeck(pool, "partners/1")] });
    for (const { seed, decks } of games) {
      const game: GameSession = engine.newGame({ seed, players: [decks[0]!, decks[1]!], config: { deckRestrictions: false } });
      const rng = seedRng(`${seed}:answers`);
      for (let step = 0; game.decision && step < 3000; step++) {
        if (game.decision.type === "mainPhase") {
          const state = JSON.parse(JSON.stringify(game.state)) as GameState;
          const g: G = { state, db: engine.db, scripts: engine.scripts, emit: () => {} };
          for (const p of [0, 1] as const) {
            for (const id of state.players[p].zones.field) {
              const card = state.cards[id]!;
              const def = engine.db.get(card.def);
              // A renamed card (an effect) is matched by its current name, which the table can't know.
              if (def.type !== "follower" || def.evolved || characteristics(g, id).name !== def.name) continue;
              followers += 1;
              // The engine's options: by name, and by each of its evolve abilities' own rule.
              const specs = ((ALL_SCRIPTS[card.def]?.abilities ?? []) as readonly AbilityDef[]).flatMap((a) =>
                a.kind === "activated" && a.evolve ? [{ nameIncludes: a.evolveNameIncludes, into: a.evolveInto }] : [],
              );
              const offered = new Set([{}, ...specs].flatMap((spec) => correspondingEvolveCards(g, id, spec).map((o) => state.cards[o.card]!.def)));
              const partners = new Set(table.partnersOf(card.def));
              const facedown = state.players[card.controller].zones.evolveDeck.map((e) => state.cards[e]!).filter((e) => !e.faceUp && engine.db.get(e.def).evolved);
              const expected = new Set(facedown.filter((e) => partners.has(e.def)).map((e) => e.def));
              expect([...offered].sort(), `${seed} step ${step}: ${card.def}`).toEqual([...expected].sort());
              if (offered.size > 0) withOptions += 1;
            }
          }
        }
        game.act(randomAnswer(rng, game.decision));
      }
    }
    expect(followers).toBeGreaterThan(1000);
    expect(withOptions).toBeGreaterThan(200);
  }, 300_000);
});
