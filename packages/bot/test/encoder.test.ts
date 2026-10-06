import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createEngine, randomAnswer, randomInt, seedRng, type GameSession, type PlayerId, type PlayerView } from "../src/core";
import { ALL_CARDS, ALL_SCRIPTS } from "../../core/src/sets";
import { deckPool, randomDeck } from "../../core/src/testing";
import { cardFeatureTable, decode, encode, encoderSchema, ENCODER_VERSION, infoDefOf, knownDeck, type CardFeatureFile, type EncodeDiagnostics, type EncoderContext } from "../src";

// Encoder v1: its layout, whole numbers in range, what the view shows only (no hidden card leaks in), the same vector
// whatever the zones' order, the cards' ids or the seats, the "not known" mask, and agreement with the engine.
const engine = createEngine({ cards: ALL_CARDS, scripts: ALL_SCRIPTS });
const table = cardFeatureTable(JSON.parse(readFileSync(join(__dirname, "..", "src", "card-features.json"), "utf8")) as CardFeatureFile);
const schema = encoderSchema();
const JOB_CONFIG = { autoResolve: ["selectPending", "selectCards", "choose", "orderCards"] as ("selectPending" | "selectCards" | "choose" | "orderCards")[], deckRestrictions: false };
const definitionOf = (p: string) => engine.db.ofPrinting(p).id;

/** A game of random answers between two random decks of the whole pool, and the encoder's context for it. */
function randomGame(seed: string) {
  const pool = deckPool(engine);
  const decks = [randomDeck(pool, `${seed}/0`), randomDeck(pool, `${seed}/1`)] as const;
  const game = engine.newGame({ seed, players: [decks[0], decks[1]], config: JOB_CONFIG });
  const ctx: EncoderContext = { table, decks: [knownDeck(definitionOf, decks[0]), knownDeck(definitionOf, decks[1])], players: ["medium", "easy"] };
  return { game, ctx };
}
const zeroDiag = (): EncodeDiagnostics => ({ saturations: 0, poolClamps: 0, poolMismatch: 0, unknownDefs: 0 });
/** Plays the game with random answers, calling `at` at every decision (before answering). */
function play(game: GameSession, seed: string, at: (game: GameSession, step: number) => void, steps = 3000) {
  const rng = seedRng(`${seed}:answers`);
  for (let i = 0; game.decision && i < steps; i++) {
    at(game, i);
    game.act(randomAnswer(rng, game.decision));
  }
}
const isSamplePoint = (g: GameSession) => g.decision?.type === "mainPhase" && g.decision.player === g.state.activePlayer;

describe("the layout", () => {
  it("has 2054 unique names in contiguous groups, 27 masked, the flag first; names tied to the version", () => {
    expect(schema.dims).toBe(2054);
    expect(new Set(schema.names).size).toBe(schema.dims);
    let at = 0;
    for (const g of schema.groups) {
      expect(g.start).toBe(at);
      at = g.end;
    }
    expect(at).toBe(schema.dims);
    expect(schema.masked).toHaveLength(27);
    expect(schema.maskIndicator).toBe(0);
    // A change of the names without a new version would mislead every model trained on them.
    expect([ENCODER_VERSION, createHash("sha256").update(schema.names.join("\n")).digest("hex").slice(0, 16)]).toEqual([1, NAMES_HASH_V1]);
  });

  it("never looks at a game's state, only at the view (no hidden information can reach it)", () => {
    for (const file of ["encoder.ts", "card-features.ts"]) {
      const source = readFileSync(join(__dirname, "..", "src", file), "utf8");
      expect(source, file).not.toMatch(/GameSession|\.reader\(|\.state\b|determinized|clone\(/);
    }
  });
});

describe("encoding real positions", () => {
  it("gives whole numbers in the int16 range at every decision of random games over the whole pool; the mask and the pools agree with the engine", () => {
    for (const seed of ["enc-a", "enc-b", "enc-c"]) {
      const { game, ctx } = randomGame(seed);
      const diag = zeroDiag();
      let positions = 0;
      play(game, seed, (g) => {
        for (const v of [0, 1] as PlayerId[]) {
          const view = g.view(v);
          const x = encode(view, v, ctx, undefined, diag);
          positions += 1;
          expect(x).toHaveLength(schema.dims);
          const get = decode(x);
          const deciding = view.decision?.type === "mainPhase" && view.decision.player === v;
          expect(get("mask.decides")).toBe(deciding ? 1 : 0);
          for (const i of schema.masked) expect(deciding ? x[i]! >= 0 : x[i] === -1).toBe(true);
          // The engine's own numbers.
          const side = view.players[v];
          expect(get("g.me.leaderDefense")).toBe(side.leaderDefense);
          expect(get("g.me.deckCount")).toBe(side.deckCount);
          expect(get("g.me.hand.count")).toBe(side.hand.length);
          expect(get("pool.me.deck.count")).toBe(side.deckCount);
          const reader = g.reader();
          for (const s of view.players) for (const c of s.field) if (!c.hidden) expect(infoDefOf(view, c, table)).toBe(reader.info(c.id).def.id);
        }
      });
      expect(positions).toBeGreaterThan(50);
      expect(diag, seed).toEqual(zeroDiag());
    }
  }, 120_000);

  it("is the same for the views of samples of what the viewer can't see (50 seeds at a few positions)", () => {
    const { game, ctx } = randomGame("leak");
    let checked = 0;
    play(game, "leak", (g, step) => {
      if (!isSamplePoint(g) || step % 3 !== 0) return;
      for (const v of [0, 1] as PlayerId[]) {
        const x = encode(g.view(v), v, ctx);
        for (let k = 0; k < 50; k++) {
          const copy = g.determinized(v, `leak:${k}`);
          const cv = copy.view(v);
          if (cv.turn !== g.state.turn || cv.decision?.type !== g.view(v).decision?.type) continue;
          const y = encode(cv, v, ctx);
          const at = y.findIndex((val, i) => val !== x[i]);
          expect(at === -1 ? null : schema.names[at], `seed ${k}`).toBeNull();
          checked += 1;
        }
      }
    });
    expect(checked).toBeGreaterThan(200);
  }, 120_000);
});

/** A view with every zone (and the actions) in another order and every card id renamed. */
function shuffledRenamed(view: PlayerView, seed: string): PlayerView {
  const rng = seedRng(seed);
  const shuffle = <T>(a: T[]): T[] => {
    for (let i = a.length - 1; i > 0; i--) {
      const j = randomInt(rng, i + 1);
      [a[i], a[j]] = [a[j]!, a[i]!];
    }
    return a;
  };
  const ids = new Map<string, string>();
  const rename = (id: string | null) => (id === null ? null : (ids.get(id) ?? (ids.set(id, `x${ids.size}:${seed}`), ids.get(id)!)));
  const copy = JSON.parse(JSON.stringify(view), (key, value: unknown) => {
    if ((key === "id" || key === "evolvedWith" || key === "linkedTo" || key === "card" || key === "attacker" || key === "target" || key === "evolveCard") && (typeof value === "string" || value === null)) return rename(value as string | null);
    return value;
  }) as PlayerView;
  for (const s of copy.players) for (const z of ["hand", "field", "ex", "cemetery", "banished", "evolveDeck", "evolveZone", "raceZone", "driveZone", "triggerZone", "equipmentZone"] as const) shuffle(s[z] as unknown[]);
  if (copy.decision?.type === "mainPhase") shuffle(copy.decision.actions);
  return copy;
}

/** The same position with the seats swapped: the other player's view of the mirrored game. */
function seatsSwapped(view: PlayerView): PlayerView {
  const flip = (p: PlayerId | null) => (p === null ? null : ((1 - p) as PlayerId));
  const copy = JSON.parse(JSON.stringify(view), (key, value: unknown) => ((key === "owner" || key === "controller" || key === "player") && (value === 0 || value === 1) ? flip(value) : value)) as PlayerView;
  copy.players = [copy.players[1], copy.players[0]];
  copy.players[0].id = 0;
  copy.players[1].id = 1;
  copy.viewer = flip(view.viewer)!;
  copy.activePlayer = flip(view.activePlayer)!;
  copy.firstPlayer = flip(view.firstPlayer);
  copy.waitingFor = flip(view.waitingFor);
  return copy;
}

describe("what doesn't change the vector", () => {
  it("the zones' order, the actions' order, the cards' ids, and which seat a player sits in", () => {
    const { game, ctx } = randomGame("same");
    const swappedCtx: EncoderContext = { table, decks: [ctx.decks[1], ctx.decks[0]], players: [ctx.players[1], ctx.players[0]] };
    let checked = 0;
    play(game, "same", (g, step) => {
      if (step % 4 !== 0) return;
      for (const v of [0, 1] as PlayerId[]) {
        const view = g.view(v);
        const x = encode(view, v, ctx);
        expect([...encode(shuffledRenamed(view, `s${step}:${v}`), v, ctx)]).toEqual([...x]);
        const swapped = seatsSwapped(view);
        expect([...encode(swapped, swapped.viewer, swappedCtx)]).toEqual([...x]);
        checked += 1;
      }
    });
    expect(checked).toBeGreaterThan(30);
  }, 120_000);
});

/** A game of random answers between the sample decks sd01 and sd02 (they don't change when sets are added). */
function sampleGame(seed: string) {
  const deck = (name: string) => {
    const json = JSON.parse(readFileSync(join(__dirname, "..", "..", "gui", "decks", "samples", `${name}.json`), "utf8")) as { leader: string; main: Record<string, number>; evolve?: Record<string, number> };
    const expand = (counts: Record<string, number> = {}) => Object.entries(counts).flatMap(([id, n]) => Array<string>(n).fill(id));
    return { leader: json.leader, main: expand(json.main), evolve: expand(json.evolve) };
  };
  const decks = [deck("sd01"), deck("sd02")] as const;
  const game = engine.newGame({ seed, players: [decks[0], decks[1]], config: JOB_CONFIG });
  const ctx: EncoderContext = { table, decks: [knownDeck(definitionOf, decks[0]), knownDeck(definitionOf, decks[1])], players: ["medium", "medium"] };
  return { game, ctx };
}

describe("golden positions", () => {
  // If this fails and the encoder didn't change, the game did (a fix of an sd01 / sd02 card): pin the new values.
  it("encode as they did when version 1 was made (a change of the encoder needs a new version)", () => {
    const { game, ctx } = sampleGame("golden");
    const hashes: string[] = [];
    play(game, "golden", (g, step) => {
      if ([5, 25, 45].includes(step)) for (const v of [0, 1] as PlayerId[]) hashes.push(createHash("sha256").update(encode(g.view(v), v, ctx)).digest("hex").slice(0, 12));
    });
    expect(hashes).toEqual(GOLDEN_V1);
  }, 60_000);
});

// Pinned when version 1 was made (2026-10-06).
const NAMES_HASH_V1 = "997204950db8ec61";
const GOLDEN_V1: string[] = ["8909635e225e", "f80b26ade7b6", "23eb970585e3", "93af23731704", "9c5faf6e5e91", "fd3db69f1c05"];
