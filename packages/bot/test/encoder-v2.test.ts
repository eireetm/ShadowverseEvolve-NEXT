import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createEngine, randomAnswer, randomInt, seedRng, type GameSession, type PlayerId, type PlayerView } from "../src/core";
import { ALL_CARDS, ALL_SCRIPTS } from "../../core/src/sets";
import { deckPool, randomDeck } from "../../core/src/testing";
import { scenario } from "../../core/src/testing/scenario";
import { CARD_FEATURE_COLUMNS, cardFeatureTable, encode, encoderSchema, knownDeck, PLAYER_TYPES_V1, type CardFeatureFile, type EncoderContext } from "../src";
import {
  CARD_BODY_COLUMNS_V2,
  CARD_WIDTH_V2,
  decodeV2,
  describeV2,
  emptyDiagnosticsV2,
  encodeV2,
  encoderV2Schema,
  ENCODER_V2_MINOR,
  ENCODER_V2_VERSION,
  GDEF_COLUMNS_V2,
  GLOBAL_COLUMNS_V2,
  PLAYER_TYPES_V2,
  POOL_LAYOUT_V2,
  poolV2,
  prepareV2,
  ZONES_V2,
  type EncodedV2,
  type EncoderV2Context,
  type PreparedV2,
} from "../src/encoder-v2";
import type { RefTrace } from "../src/encoder-v2-refs";

// Encoder v2: its layout, the fairness rules (only the view: the same features for every sample of what the viewer can't
// see, whatever the zones' order, the ids or the seats; memory only through `known`), v1's part equal to v1, the pooled
// vector equal to a plain recomputation, and golden positions.
const engine = createEngine({ cards: ALL_CARDS, scripts: ALL_SCRIPTS });
const table = cardFeatureTable(JSON.parse(readFileSync(join(__dirname, "..", "src", "card-features.json"), "utf8")) as CardFeatureFile);
const schema = encoderV2Schema();
const JOB_CONFIG = { autoResolve: ["selectPending", "selectCards", "choose", "orderCards"] as ("selectPending" | "selectCards" | "choose" | "orderCards")[], deckRestrictions: false };
const definitionOf = (p: string) => engine.db.ofPrinting(p).id;

function randomGame(seed: string) {
  const pool = deckPool(engine);
  const decks = [randomDeck(pool, `${seed}/0`), randomDeck(pool, `${seed}/1`)] as const;
  const game = engine.newGame({ seed, players: [decks[0], decks[1]], config: JOB_CONFIG });
  const ctx: EncoderContext = { table, decks: [knownDeck(definitionOf, decks[0]), knownDeck(definitionOf, decks[1])], players: ["medium", "easy"] };
  return { game, ctx };
}
function play(game: GameSession, seed: string, at: (game: GameSession, step: number) => void, steps = 3000) {
  const rng = seedRng(`${seed}:answers`);
  for (let i = 0; game.decision && i < steps; i++) {
    at(game, i);
    game.act(randomAnswer(rng, game.decision));
  }
}
const isSamplePoint = (g: GameSession) => g.decision?.type === "mainPhase" && g.decision.player === g.state.activePlayer;

/** The features a network gathers from the arrays (pointers replaced by what they point to), in canonical order. */
function gathered(enc: EncodedV2, prep: PreparedV2): string[] {
  const out: string[] = [`g:${[...enc.global].join(",")}`];
  const rows: string[] = [];
  for (let i = 0; i < enc.nCards; i++) {
    const r = enc.cards.subarray(i * CARD_WIDTH_V2, (i + 1) * CARD_WIDTH_V2);
    rows.push(`c:${r[0]}:${prep.defIds[r[1]! - 1] ?? "?"}:${[...prep.gdRows[r[2]!]!].join(",")}:${[...r.subarray(3)].join(",")}`);
  }
  for (let i = 0; i < enc.nPiles; i++) {
    const r = enc.piles.subarray(i * 4, i * 4 + 4);
    rows.push(`p:${r[0]}:${prep.defIds[r[1]! - 1] ?? "?"}:${[...prep.gdRows[r[2]!]!].join(",")}:${r[3]}`);
  }
  return [...out, ...rows.sort()];
}

describe("the layout", () => {
  it("has 163 global values, card tokens of 3 + 100, pile entries of 4, gdef rows of 2 + 23, a pooled vector of 6,739", () => {
    expect([GLOBAL_COLUMNS_V2.length, CARD_WIDTH_V2, CARD_BODY_COLUMNS_V2.length, GDEF_COLUMNS_V2.length, schema.pooled.dims]).toEqual([163, 103, 100, 23, 6739]);
    expect(new Set(GLOBAL_COLUMNS_V2).size).toBe(163);
    expect(new Set(CARD_BODY_COLUMNS_V2).size).toBe(100);
    expect(new Set(schema.pooled.names).size).toBe(6739);
    // Static, gdef and body names never collide.
    const all = [...CARD_FEATURE_COLUMNS, ...GDEF_COLUMNS_V2, ...CARD_BODY_COLUMNS_V2];
    expect(new Set(all).size).toBe(all.length);
    expect(schema.global.masked).toHaveLength(7);
    expect(schema.pooled.masked).toHaveLength(31);
    expect(schema.pooled.groups.map((g) => g.name)).toEqual(POOL_LAYOUT_V2.map((g) => g.name));
    const names = [...GLOBAL_COLUMNS_V2, ...CARD_BODY_COLUMNS_V2, ...GDEF_COLUMNS_V2, ...schema.pooled.names, ...ZONES_V2.map((z) => `${z.code}:${z.name}`)].join("\n");
    expect([ENCODER_V2_VERSION, createHash("sha256").update(names).digest("hex").slice(0, 16)]).toEqual([2, NAMES_HASH_V2]);
  });

  // A column of v2 never moves, so v2's data keeps its meaning: a new player type goes at the end of the block.
  it("keeps v2's 159 global columns first, in their order; the table of who plays only grows at its end", () => {
    expect(createHash("sha256").update(GLOBAL_COLUMNS_V2.slice(0, 159).join("\n")).digest("hex").slice(0, 16)).toBe("f7209471c3c28e4d");
    expect(GLOBAL_COLUMNS_V2.slice(159)).toEqual(["player.me.human", "player.me.expert", "player.opp.human", "player.opp.expert"]);
    expect(PLAYER_TYPES_V2.slice(0, PLAYER_TYPES_V1.length)).toEqual([...PLAYER_TYPES_V1]);
    expect([schema.version, schema.minor, schema.playerTypes]).toEqual([ENCODER_V2_VERSION, ENCODER_V2_MINOR, PLAYER_TYPES_V2]);
  });

  it("never looks at a game, only at the view (static guard)", () => {
    const source = readFileSync(join(__dirname, "..", "src", "encoder-v2.ts"), "utf8");
    expect(source).not.toMatch(/GameSession|\.reader\(|\.state\b|determinized|clone\(|ALL_SCRIPTS|ALL_CARDS|createEngine|newGame|\.act\(|scripts\[/);
    const imports = [...source.matchAll(/from\s+["']([^"']+)["']/g)].map((m) => m[1]);
    expect(imports.every((i) => ["./core", "./card-features", "./encoder", "./encoder-v2-refs"].includes(i!))).toBe(true);
    // Remembered cards are read in one place, the counting module's helper.
    expect(source.match(/\.known\?\./g)).toBeNull();
  });
});

describe("encoding real positions", () => {
  it("every decision of random whole-pool games: 0 diagnostics, the mask, v1's part equal to v1", () => {
    const v1 = encoderSchema();
    const shared = GLOBAL_COLUMNS_V2.filter((n) => v1.names.includes(n));
    expect(shared).toHaveLength(135);
    for (const seed of ["enc2-a", "enc2-b", "enc2-c"]) {
      const { game, ctx } = randomGame(seed);
      const prep = prepareV2(ctx);
      const ctx1: EncoderContext = ctx;
      const diag = emptyDiagnosticsV2();
      let positions = 0;
      play(game, seed, (g) => {
        for (const v of [0, 1] as PlayerId[]) {
          const view = g.view(v);
          const enc = encodeV2(view, v, prep, diag);
          positions += 1;
          const x1 = encode(view, v, ctx1);
          const d = decodeV2(enc);
          for (const n of shared) expect(d.global(n), n).toBe(x1[v1.names.indexOf(n)]);
          const deciding = d.global("mask.decides") === 1;
          for (let i = 0; i < enc.nCards; i++) {
            const zone = d.card(i, "zone");
            for (const a of schema.card.applies[zone] ?? []) expect(deciding ? d.card(i, a) >= 0 : d.card(i, a) === -1, `${zone} ${a}`).toBe(true);
          }
          expect(d.global("g.opp.unseen")).toBeGreaterThanOrEqual(0);
        }
      });
      expect(positions).toBeGreaterThan(50);
      expect(diag, seed).toEqual(emptyDiagnosticsV2());
    }
  }, 240_000);

  it("is the same for samples of what the viewer can't see (50 seeds), in any zone order, with any ids, from either seat", () => {
    const { game, ctx } = randomGame("leak2");
    const prep = prepareV2(ctx);
    const swappedPrep = prepareV2({ table, decks: [ctx.decks[1], ctx.decks[0]], players: [ctx.players[1], ctx.players[0]] });
    let checked = 0;
    play(game, "leak2", (g, step) => {
      if (!isSamplePoint(g) || step % 3 !== 0) return;
      for (const v of [0, 1] as PlayerId[]) {
        const view = g.view(v);
        const enc = encodeV2(view, v, prep);
        const x = gathered(enc, prep);
        const pooled = [...poolV2(enc, prep)];
        for (let k = 0; k < 50; k += 5) {
          const copy = g.determinized(v, `leak:${k}`);
          const cv = copy.view(v);
          if (cv.turn !== g.state.turn || cv.decision?.type !== view.decision?.type) continue;
          expect(gathered(encodeV2(cv, v, prep), prep), `seed ${k}`).toEqual(x);
          checked += 1;
        }
        const shuffled = encodeV2(shuffledRenamed(view, `s${step}:${v}`), v, prep);
        expect(gathered(shuffled, prep)).toEqual(x);
        expect([...poolV2(shuffled, prep)]).toEqual(pooled);
        const swapped = seatsSwapped(view);
        const sw = encodeV2(swapped, swapped.viewer, swappedPrep);
        expect(gathered(sw, swappedPrep)).toEqual(x);
        expect([...poolV2(sw, swappedPrep)]).toEqual(pooled);
      }
    });
    expect(checked).toBeGreaterThan(40);
  }, 240_000);

  it("lights only the columns of who plays, swapped from the other seat; nothing else depends on them", () => {
    const { game, ctx } = randomGame("players2");
    const lit = (prep: PreparedV2, v: PlayerId) => {
      const { global } = encodeV2(game.view(v), v, prep);
      return GLOBAL_COLUMNS_V2.flatMap((n, i) => (n.startsWith("player.") && global[i] !== 0 ? [`${n}=${global[i]}`] : []));
    };
    const prep = prepareV2({ ...ctx, players: ["human", "expert"] });
    const swapped = prepareV2({ ...ctx, players: ["expert", "human"] });
    expect(lit(prep, 0)).toEqual(["player.me.human=1", "player.opp.expert=1"]);
    expect(lit(prep, 1)).toEqual(["player.me.expert=1", "player.opp.human=1"]);
    expect(lit(swapped, 0)).toEqual(lit(prep, 1));
    expect(lit(swapped, 1)).toEqual(lit(prep, 0));
    const rest = (p: PreparedV2, v: PlayerId) => {
      const enc = encodeV2(game.view(v), v, p);
      return [[...enc.global].filter((_, i) => !GLOBAL_COLUMNS_V2[i]!.startsWith("player.")), [...enc.cards], [...enc.piles]];
    };
    const plain = prepareV2(ctx);
    for (const v of [0, 1] as PlayerId[]) expect(rest(prep, v)).toEqual(rest(plain, v));
  });

  it("refuses a player type it doesn't know", () => {
    const { game, ctx } = randomGame("players2");
    const prep = prepareV2({ ...ctx, players: ["medium", "robot" as "medium"] });
    expect(() => encodeV2(game.view(0), 0, prep)).toThrow(/a player type encoder v2 doesn't know/);
  });

  it("reads memory only through `known`: without it, only the revealed hand cards", () => {
    const g = scenario(engine, {
      players: [{ hand: ["BP01-001"] }, { hand: ["CP02-014", "CSD02a-009", "CP02-014"], deck: ["CP02-014"] }],
    });
    const lists: EncoderV2Context["decks"] = [
      { main: new Map([["BP01-001", 1]]), evolve: new Map() },
      { main: new Map([["CP02-014", 3], ["CSD02a-009", 1]]), evolve: new Map() },
    ];
    const prep = prepareV2({ table, decks: lists, players: ["medium", "medium"] });
    const hand = g.state.players[1].zones.hand;
    g.state.cards[hand[1]!]!.knownBy = [0];
    const withMemory = decodeV2(encodeV2(g.view(0), 0, prep));
    expect(withMemory.global("g.opp.hand.known")).toBe(1);
    expect(withMemory.global("g.opp.unseen")).toBe(3);
    const forgot = JSON.parse(JSON.stringify(g.view(0)), (key, value: unknown) => (key === "known" ? undefined : value)) as PlayerView;
    const without = encodeV2(forgot, 0, prep);
    expect([decodeV2(without).global("g.opp.hand.known"), without.cards.filter((_, i) => i % CARD_WIDTH_V2 === 0 && _ === 3).length, decodeV2(without).global("g.opp.unseen")]).toEqual([0, 0, 4]);
  });
});

describe("what a card token says", () => {
  it("whether a follower can still evolve (CP02-014 with none left, CSD02a-009 with one)", () => {
    const g = scenario(engine, { players: [{ hand: ["CP02-014", "CSD02a-009"], evolveDeck: ["CSD02a-010"] }, {}] });
    const lists: EncoderV2Context["decks"] = [
      { main: new Map([["CP02-014", 1], ["CSD02a-009", 1]]), evolve: new Map([["CSD02a-010", 1]]) },
      { main: new Map(), evolve: new Map() },
    ];
    const prep = prepareV2({ table, decks: lists, players: ["medium", "medium"] });
    const enc = encodeV2(g.view(0), 0, prep);
    const d = decodeV2(enc);
    const row = (def: string) => [...Array(enc.nCards).keys()].find((i) => prep.defIds[d.card(i, "def") - 1] === def)!;
    expect([d.card(row("CP02-014"), "evo.left"), d.card(row("CP02-014"), "evo.can")]).toEqual([0, 0]);
    expect([d.card(row("CSD02a-009"), "evo.left"), d.card(row("CSD02a-009"), "evo.can")]).toEqual([1, 1]);
    expect([d.global("g.me.evo.matchField"), d.global("g.me.evo.matchAll")]).toEqual([0, 1]);
  });

  it("its trace lines add up to its REL columns, and the print runs", () => {
    const { game, ctx } = sampleGame("trace", "csd02a", "sd07");
    const prep = prepareV2(ctx);
    let tokens = 0;
    play(game, "trace", (g, step) => {
      if (step % 5 !== 0) return;
      for (const v of [0, 1] as PlayerId[]) {
        const trace = new Map<string, RefTrace[]>();
        const enc = encodeV2(g.view(v), v, prep, undefined, trace);
        const d = decodeV2(enc);
        for (let i = 0; i < enc.nCards; i++) {
          const lines = trace.get(enc.cardIds[i]!)!;
          expect(d.card(i, "rel.live")).toBe(lines.filter((x) => x.live).length);
          expect(d.card(i, "rel.dead")).toBe(lines.filter((x) => !x.live).length);
          expect(d.card(i, "rel.partial")).toBe(lines.filter((x) => x.live && x.partial).length);
          tokens += 1;
        }
      }
    }, 400);
    expect(tokens).toBeGreaterThan(200);
    const text = describeV2(game.view(0), 0, prep);
    expect(text).toContain("[向量里有]");
    expect(text).toContain("[只打印]");
  }, 120_000);
});

describe("the pooled vector", () => {
  it("equals a plain recomputation from the arrays by name", () => {
    const { game, ctx } = randomGame("pool2");
    const prep = prepareV2(ctx);
    let checked = 0;
    play(game, "pool2", (g, step) => {
      if (step % 7 !== 0) return;
      const v = (step % 2) as PlayerId;
      const enc = encodeV2(g.view(v), v, prep);
      const pooled = poolV2(enc, prep);
      const index = new Map(schema.pooled.names.map((n, i) => [n, i]));
      const expected = new Map<string, number>();
      GLOBAL_COLUMNS_V2.forEach((n, i) => expected.set(n, enc.global[i]!));
      for (const group of POOL_LAYOUT_V2) {
        const items: { values: Map<string, number>; mult: number }[] = [];
        if (group.kind === "card") {
          for (let i = 0; i < enc.nCards; i++) {
            const r = enc.cards.subarray(i * CARD_WIDTH_V2, (i + 1) * CARD_WIDTH_V2);
            if (!group.zones.includes(r[0]!)) continue;
            const values = new Map<string, number>();
            const s = r[1]! > 0 ? table.row(prep.defIds[r[1]! - 1]!) : new Int16Array(CARD_FEATURE_COLUMNS.length);
            CARD_FEATURE_COLUMNS.forEach((c, j) => values.set(c, s[j]!));
            GDEF_COLUMNS_V2.forEach((c, j) => values.set(c, prep.gdRows[r[2]!]![j]!));
            CARD_BODY_COLUMNS_V2.forEach((c, j) => values.set(c, r[3 + j]!));
            items.push({ values, mult: 1 });
          }
        } else {
          for (let i = 0; i < enc.nPiles; i++) {
            const r = enc.piles.subarray(i * 4, i * 4 + 4);
            if (!group.zones.includes(r[0]!)) continue;
            const values = new Map<string, number>();
            const s = r[1]! > 0 ? table.row(prep.defIds[r[1]! - 1]!) : new Int16Array(CARD_FEATURE_COLUMNS.length);
            CARD_FEATURE_COLUMNS.forEach((c, j) => values.set(c, s[j]!));
            GDEF_COLUMNS_V2.forEach((c, j) => values.set(c, prep.gdRows[r[2]!]![j]!));
            items.push({ values, mult: r[3]! });
          }
        }
        expected.set(`${group.name}.count`, items.reduce((s, x) => s + x.mult, 0));
        const columns = group.kind === "card" ? [...CARD_FEATURE_COLUMNS, ...GDEF_COLUMNS_V2, ...CARD_BODY_COLUMNS_V2] : [...CARD_FEATURE_COLUMNS, ...GDEF_COLUMNS_V2];
        for (const c of columns) {
          expected.set(`${group.name}.sum.${c}`, items.reduce((s, x) => s + x.mult * x.values.get(c)!, 0));
          if (group.parts.includes("max")) expected.set(`${group.name}.max.${c}`, items.length ? Math.max(...items.map((x) => x.values.get(c)!)) : 0);
        }
      }
      if (enc.global[0] === 0) for (const i of schema.pooled.masked) expected.set(schema.pooled.names[i]!, -1);
      for (const [n, val] of expected) expect(pooled[index.get(n)!], n).toBe(val);
      checked += 1;
    });
    expect(checked).toBeGreaterThan(10);
  }, 120_000);
});

/** A game of random answers between two sample decks. */
function sampleGame(seed: string, a: string, b: string) {
  const deck = (name: string) => {
    const json = JSON.parse(readFileSync(join(__dirname, "..", "..", "gui", "decks", "samples", `${name}.json`), "utf8")) as { leader: string; main: Record<string, number>; evolve?: Record<string, number> };
    const expand = (counts: Record<string, number> = {}) => Object.entries(counts).flatMap(([id, n]) => Array<string>(n).fill(id));
    return { leader: json.leader, main: expand(json.main), evolve: expand(json.evolve) };
  };
  const decks = [deck(a), deck(b)] as const;
  const game = engine.newGame({ seed, players: [decks[0], decks[1]], config: JOB_CONFIG });
  const ctx: EncoderV2Context = { table, decks: [knownDeck(definitionOf, decks[0]), knownDeck(definitionOf, decks[1])], players: ["medium", "medium"] };
  return { game, ctx };
}

describe("golden positions", () => {
  // If this fails and the encoder didn't change, the game or the card table did: check, then pin the new values.
  it("sd01 vs sd02 and csd02a vs sd07 at fixed decisions, both viewers", () => {
    const hashes: string[] = [];
    for (const [a, b, steps] of [
      ["sd01", "sd02", [10, 25, 40]],
      ["csd02a", "sd07", [20, 50, 90]],
    ] as const) {
      const { game, ctx } = sampleGame(`golden2-${a}`, a, b);
      const prep = prepareV2(ctx);
      play(game, `golden2-${a}`, (g, step) => {
        if (!(steps as readonly number[]).includes(step)) return;
        for (const v of [0, 1] as PlayerId[]) hashes.push(`${a}@${step}/${v}:${createHash("sha256").update(gathered(encodeV2(g.view(v), v, prep), prep).join("\n")).digest("hex").slice(0, 12)}`);
      });
    }
    expect(hashes).toEqual(GOLDEN_V2);
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

const NAMES_HASH_V2 = "69a4c5ee60eed78f";
const GOLDEN_V2: string[] = [
  "sd01@10/0:20683f06b62a",
  "sd01@10/1:57b950f62e18",
  "sd01@25/0:e0bf23da948f",
  "sd01@25/1:cfcaf98f77c6",
  "sd01@40/0:b7078ac94e62",
  "sd01@40/1:452ec10d2368",
  "csd02a@20/0:14cb8601e621",
  "csd02a@20/1:cad8faef264e",
  "csd02a@50/0:5e027ffaa6c9",
  "csd02a@50/1:796ae901e8d9",
  "csd02a@90/0:5539cea23041",
  "csd02a@90/1:0ea8a01832a4",
];
