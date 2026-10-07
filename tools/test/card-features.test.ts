import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseAst } from "rolldown/parseAst";
import { describe, expect, it } from "vitest";
import { buildCardFeatureFile, cardFeatureFileText, cardFeatureTable, FX_FAMILY_COLUMNS, type CardFeatureFile } from "../../packages/bot/src";
import { rulesFingerprint } from "../../packages/gui/fingerprint";
import { FAMILY_OF, FX_FAMILY_NAMES } from "../rl/fx-families";
import { checkReferences } from "../rl/ref-oracle";
import { analyzeScripts, type CardAnalysis } from "../rl/script-analysis";
import { createEngine, randomAnswer, seedRng, type AbilityDef, type GameSession } from "../../packages/core/src";
import { correspondingEvolveCards } from "../../packages/core/src/engine/abilities/evolve";
import type { G } from "../../packages/core/src/engine/runtime/context";
import { characteristics } from "../../packages/core/src/engine/state/characteristics";
import type { GameState } from "../../packages/core/src/model/state";
import { ALL_CARDS, ALL_SCRIPTS } from "../../packages/core/src/sets";
import { deckPool, randomDeck } from "../../packages/core/src/testing";
import { DECK_SETS, sampleDeck } from "../rl/series";

// The card feature table (packages/bot/src/card-features.json) checked against the code and the engine: it is what the code
// builds from the card data and the scripts (their declared fields and what their code does and counts); a follower's evolve
// cards (evolvePartners) are the ones Core's correspondingEvolveCards offers on the field (CR 5.16.1.1.1, 4.6.4); every trait
// of the card data is listed; every effect method has a family; and what the analysis says a card counts agrees with the
// card's own code run by the engine.
const engine = createEngine({ cards: ALL_CARDS, scripts: ALL_SCRIPTS });
const JSON_PATH = join(__dirname, "..", "..", "packages", "bot", "src", "card-features.json");
const table = cardFeatureTable(JSON.parse(readFileSync(JSON_PATH, "utf8")) as CardFeatureFile);
let analyses: Map<string, CardAnalysis> | null = null;
const analysis = () => (analyses ??= analyzeScripts(ALL_SCRIPTS));

describe("card-features.json", () => {
  it("is what the code builds (else: npm run rl:features)", () => {
    const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");
    const built = buildCardFeatureFile(ALL_CARDS, ALL_SCRIPTS, rulesFingerprint(join(__dirname, "..", "..", "packages", "gui")), sha256, (def) => analysis().get(def));
    expect(readFileSync(JSON_PATH, "utf8").replace(/\r\n/g, "\n")).toBe(cardFeatureFileText(built));
  }, 120_000);
});

describe("the effect families", () => {
  it("cover every member of the effect context, and are the table's fx columns", () => {
    const source = readFileSync(join(__dirname, "..", "..", "packages", "core", "src", "engine", "effects", "context.ts"), "utf8");
    const ast = parseAst(source, { lang: "ts" }) as unknown as { body: { type: string; declaration?: { type: string; id?: { name: string }; body?: { body: { key?: { name?: string } }[] } } }[] };
    const decl = ast.body.map((x) => x.declaration).find((d) => d?.type === "TSInterfaceDeclaration" && d.id?.name === "EffectContext");
    const members = (decl?.body?.body ?? []).map((m) => m.key?.name).filter((n): n is string => typeof n === "string");
    expect(members.length).toBeGreaterThan(100);
    expect(members.filter((m) => !FAMILY_OF.has(m))).toEqual([]);
    expect(FX_FAMILY_NAMES).toEqual([...FX_FAMILY_COLUMNS]);
  });
});

describe("what a card counts, read from its script", () => {
  const refs = (def: string) => analysis().get(def)!.refs.map((r) => ({ timing: r.timing, where: r.where, zones: r.zones, side: r.side, filter: r.filter, agg: r.agg, threshold: r.threshold, scaled: r.scaled }));
  it("for cards whose effects count a kind of card", () => {
    // BP11-058: banish up to as many enemy followers as Dragoncraft cards costing 7 or more in your cemetery; its activated
    // ability's cost discards another such card from the hand.
    expect(refs("BP11-058")).toEqual([
      { timing: "fanfare", where: "max", zones: ["cemetery"], side: "own", filter: { t: "and", args: [{ t: "class", v: "Dragoncraft" }, { t: "costMin", v: 7 }] }, agg: "count", threshold: null, scaled: true },
      { timing: "activated", where: "canPay", zones: ["hand"], side: "own", filter: { t: "and", args: [{ t: "notSelf" }, { t: "class", v: "Dragoncraft" }, { t: "costMin", v: 7 }] }, agg: "exists", threshold: { op: ">=", n: 1 }, scaled: false },
    ]);
    // BP15-074: the same cost, from a cost factory of script/costs.ts with a local helper.
    expect(refs("BP15-074")).toMatchObject([{ timing: "activated", where: "canPay", zones: ["hand"], threshold: { op: ">", n: 0 } }]);
    // CP02-064: at least 3 iM@S CG followers on your field.
    expect(refs("CP02-064")).toEqual([{ timing: "fanfare", where: "condition", zones: ["field"], side: "own", filter: { t: "and", args: [{ t: "type", v: "follower" }, { t: "trait", v: "デレマス" }] }, agg: "count", threshold: { op: ">=", n: 3 }, scaled: false }]);
    // CSD02a-003: at least 3 Cute followers on your field (destructured card information).
    expect(refs("CSD02a-003")[0]).toMatchObject({ timing: "continuous", where: "selfKeywords", zones: ["field"], filter: { t: "and", args: [{ t: "type", v: "follower" }, { t: "trait", v: "キュート" }] }, threshold: { op: ">=", n: 3 } });
    // BP07-021: Swordcraft followers in your cemetery, read from the printed definitions; 10 for Storm, 5 for the fanfare.
    expect(refs("BP07-021").map((r) => [r.timing, r.threshold?.n])).toEqual([
      ["continuous", 10],
      ["fanfare", 5],
    ]);
    // SD05-006: as much damage as Forest Bat tokens on your field.
    expect(refs("SD05-006")[0]).toMatchObject({ zones: ["field"], side: "own", filter: { t: "and", args: [{ t: "token" }, { t: "name", v: "Forest Bat" }] }, scaled: true });
  }, 120_000);
  it("for what a card's targets and searches need", () => {
    // CSD02a-001: a Cute follower costing 4 or less (and one costing 2 or less) in your cemetery.
    expect(refs("CSD02a-001").map((r) => [r.where, r.zones[0], r.agg, JSON.stringify(r.filter)])).toEqual([
      ["target", "cemetery", "exists", JSON.stringify({ t: "and", args: [{ t: "type", v: "follower" }, { t: "trait", v: "キュート" }, { t: "costMax", v: 4 }] })],
      ["target", "cemetery", "exists", JSON.stringify({ t: "and", args: [{ t: "type", v: "follower" }, { t: "trait", v: "キュート" }, { t: "costMax", v: 2 }] })],
    ]);
    // BP09-060: 5 damage instead of 2 when the chosen enemy follower is a Wyrmkin: is there one.
    expect(refs("BP09-060")).toEqual([{ timing: "onEvolve", where: "targetCondition", zones: ["field"], side: "opp", filter: { t: "and", args: [{ t: "type", v: "follower" }, { t: "trait", v: "竜族" }] }, agg: "exists", threshold: { op: ">=", n: 1 }, scaled: false }]);
    // BP12-054: whether its EX area has room is the zone's size, already in the vector: no reference.
    expect(refs("BP12-054")).toEqual([]);
    // BP08-018: search your deck for a Commander or a Soldier.
    expect(refs("BP08-018")[0]).toMatchObject({ where: "search", zones: ["deck"], agg: "exists", filter: { t: "or", args: [{ t: "trait", v: "指揮官" }, { t: "trait", v: "兵士" }] } });
  }, 120_000);
});

describe("card-features.json, against the card data and the engine", () => {
  it("agrees with the cards' own code: every closure with one reference gives what the reference counts", () => {
    // Games of every sample deck, random answers; at each main phase, each card's conditions, maxes and play conditions.
    const names = [...DECK_SETS.train, ...DECK_SETS.holdout];
    function* positions(): Generator<GameSession> {
      for (const [i, name] of names.entries()) {
        const seed = `refs-${name}`;
        const game = engine.newGame({ seed, players: [sampleDeck(name)!.deck, sampleDeck(names[(i + 5) % names.length]!)!.deck], config: { deckRestrictions: false } });
        const rng = seedRng(`${seed}:answers`);
        for (let step = 0; game.decision && step < 3000; step++) {
          if (game.decision.type === "mainPhase") yield game;
          game.act(randomAnswer(rng, game.decision));
        }
      }
    }
    const result = checkReferences(positions(), (def) => analysis().get(def)?.refs, ALL_SCRIPTS);
    const disagreeing = [...result.byClosure].filter(([, v]) => v.disagree > 0).map(([k, v]) => `${k}: ${v.examples[0]}`);
    expect(disagreeing).toEqual([]);
    expect(result.calls).toBeGreaterThan(400);
    expect(result.byClosure.size).toBeGreaterThanOrEqual(5);
  }, 300_000);

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
