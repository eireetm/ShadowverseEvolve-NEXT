import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseAst } from "rolldown/parseAst";
import { describe, expect, it } from "vitest";
import { buildCardFeatureFile, CARD_FEATURE_COLUMNS, cardFeatureFileText, cardFeatureRow, cardFeatureTable, FX_FAMILY_COLUMNS, type CardFeatureFile, type RefFilter } from "../../packages/bot/src";
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
  const refs = (def: string) =>
    analysis()
      .get(def)!
      .refs.map((r) => ({ timing: r.timing, where: r.where, zones: r.zones, side: r.side, filter: r.filter, agg: r.agg, threshold: r.threshold, scaled: r.scaled, ...(r.top ? { top: r.top } : {}), ...(r.distinct ? { distinct: r.distinct } : {}) }));
  it("for cards whose effects count a kind of card", () => {
    // BP11-058: banish up to as many enemy followers as Dragoncraft cards costing 7 or more in your cemetery; its activated
    // ability's cost discards another such card from the hand.
    expect(refs("BP11-058").filter((r) => r.where !== "target")).toEqual([
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
    expect(refs("BP07-021").filter((r) => r.where !== "target").map((r) => [r.timing, r.threshold?.n])).toEqual([
      ["continuous", 10],
      ["fanfare", 5],
    ]);
    // SD05-006: as much damage as Forest Bat tokens on your field.
    expect(refs("SD05-006").find((r) => r.where === "resolve")).toMatchObject({ zones: ["field"], side: "own", filter: { t: "and", args: [{ t: "token" }, { t: "name", v: "Forest Bat" }] }, scaled: true });
  }, 120_000);
  it("for keyword conditions, deck-top looks, the cards a passive or trigger is about, and amounts", () => {
    const a = (def: string) => analysis().get(def)!;
    // BP01-017: Combo (3) (CR 13.2.1.2), 3 damage; SD01-009: Combo (3).
    expect(a("BP01-017").conds.combo).toBe(3);
    expect(a("BP01-017").amounts.dmg).toBe(3);
    // SD03-001: Spellchain (7) and (15) (CR 13.3.1.2), each a count of the spells in your cemetery; BP01-070 reads the count.
    expect(refs("SD03-001").map((r) => [r.where, r.threshold?.n])).toEqual([
      ["spellchain", 7],
      ["spellchain", 15],
    ]);
    expect(refs("BP01-070").filter((r) => r.where === "spellchain").map((r) => r.threshold?.n)).toEqual([5, 10]);
    // SD05-010: Necrocharge (10) (CR 13.5.1.2).
    expect(a("SD05-010").conds.necrocharge).toBe(10);
    // BP01-148: an amulet among the top 5 cards of your deck (CR 5.11).
    expect(refs("BP01-148")).toMatchObject([{ where: "search", zones: ["deck"], top: 5, filter: { t: "type", v: "amulet" } }]);
    // SD01-002: your Pixie tokens have Assail; when a Pixie token enters your field, it gets +1/+1; its fanfare buffs each one.
    expect(refs("SD01-002").map((r) => [r.where, JSON.stringify(r.filter)])).toEqual([
      ["affects", JSON.stringify({ t: "and", args: [{ t: "token" }, { t: "trait", v: "妖精" }] })],
      ["trigger", JSON.stringify({ t: "and", args: [{ t: "token" }, { t: "trait", v: "妖精" }] })],
      ["each", JSON.stringify({ t: "and", args: [{ t: "token" }, { t: "trait", v: "妖精" }, { t: "type", v: "follower" }] })],
    ]);
    // SD01-001: your other Pixie followers have Rush.
    expect(refs("SD01-001")[0]).toMatchObject({ where: "affects", zones: ["field"], side: "own", filter: { t: "and", args: [{ t: "notSelf" }, { t: "and", args: [{ t: "type", v: "follower" }, { t: "trait", v: "妖精" }] }] } });
    // BP01-119: mill 1; BP09-060: 5 damage (the larger branch).
    expect(a("BP01-119").amounts.mill).toBe(1);
    expect(a("BP09-060").amounts.dmg).toBe(5);
    // CP04-038: spells with different names in your cemetery.
    expect(refs("CP04-038").find((r) => r.zones[0] === "cemetery")).toMatchObject({ where: "target", distinct: true });
  }, 120_000);
  it("for the cards a community player checked by hand", () => {
    const one = (def: string, where: string) => refs(def).filter((r) => r.where === where);
    const follower = { t: "type", v: "follower" };
    // CP01-034: one of your racing followers (CR 14.2.3.1); CSD01-030: whether the chosen Umamusume is racing.
    expect(one("CP01-034", "resolve")).toMatchObject([{ zones: ["field"], side: "own", filter: { t: "and", args: [follower, { t: "racing" }] } }]);
    expect(one("CSD01-030", "targetCondition")).toMatchObject([{ filter: { t: "and", args: [follower, { t: "trait", v: "ウマ娘" }, { t: "racing" }] } }]);
    // DSD01b-012: a closure made by a factory (withAnotherDuelist): another Duelist on your field.
    expect(one("DSD01b-012", "selfKeywords")).toMatchObject([{ zones: ["field"], filter: { t: "and", args: [{ t: "notSelf" }, { t: "trait", v: "武闘竜人" }] } }]);
    // CP04-008: engage 3 reserved cards as its cost (CR 10.4.6; a helper's default count n = 3).
    expect(one("CP04-008", "canPay")).toMatchObject([{ filter: { t: "not", arg: { t: "engaged" } }, agg: "count", threshold: { op: ">=", n: 3 } }]);
    // CP04-073: banish 5 cards from your cemetery (zones mapped through a callback; a rule exception is not a kind of card).
    expect(one("CP04-073", "canPay")).toMatchObject([{ zones: ["cemetery"], filter: { t: "any" }, threshold: { op: ">=", n: 5 } }]);
    // CP04-101: the default count of a cost helper; BP13-019: its default filter, with the caller's filter.
    expect(one("CP04-101", "canPay")).toMatchObject([{ filter: { t: "type", v: "amulet" }, threshold: { op: ">=", n: 1 } }]);
    expect(one("BP13-019", "canPay")).toMatchObject([{ filter: { t: "and", args: [{ t: "notSelf" }, follower, { t: "trait", v: "レヴィオン" }] } }]);
    // BP13-027: a card put from your hand, chosen among a computed list (its cost bound by your max PP is not read yet).
    expect(one("BP13-027", "choose")).toMatchObject([{ zones: ["hand"], side: "own", filter: { t: "and", args: [follower, { t: "class", v: "Swordcraft" }, { t: "nameIncludes", v: "Albert" }, { t: "other" }] } }]);
    // BP13-028, DSD01a-014: a play option's cost spread into its object.
    expect(one("BP13-028", "canPay")).toMatchObject([{ filter: { t: "and", args: [follower, { t: "trait", v: "レヴィオン" }, { t: "costMax", v: 3 }] } }]);
    expect(one("DSD01a-014", "canPay")).toMatchObject([{ zones: ["hand"], filter: { t: "and", args: [{ t: "notSelf" }, { t: "trait", v: "学院" }] }, threshold: { op: ">=", n: 2 } }]);
    // BP13-035: the three sisters (a constant list's .some / .map): any of them, then each.
    expect(one("BP13-035", "search")[0]!.filter).toMatchObject({ t: "or", args: [{ t: "name" }, { t: "name" }, { t: "name" }] });
    expect(one("BP13-035", "searchEach")).toHaveLength(3);
    // BP10-054: "if the top card costs less than 5, stop": the top card costs 5 or more.
    expect(refs("BP10-054")).toMatchObject([{ where: "topCard", zones: ["deck"], top: 1, filter: { t: "costMin", v: 5 } }]);
    // CP02-103, ECP02-039: loops matching the cards to pay with are not effects "for each".
    expect(one("CP02-103", "each")).toEqual([]);
    expect(one("ECP02-039", "each")).toEqual([]);
    // CP04-016: a predicate's guard ("if (id === self) return false") stays when the rest can't be read.
    expect(one("CP04-016", "canPay")[0]!.filter).toMatchObject({ t: "and", args: [{ t: "notSelf" }, { t: "other" }] });
  }, 120_000);
  it("under the player's choices, and the deck's top as luck", () => {
    const all = (def: string) => analysis().get(def)!.refs;
    // BP13-035: one sister to the hand, or (played for 4 more, CR 10.4.7.3) one of each summoned.
    expect(all("BP13-035").map((r) => [r.where, r.alt])).toEqual([
      ["searchEach", ["opt:plus4"]],
      ["searchEach", ["opt:plus4"]],
      ["searchEach", ["opt:plus4"]],
      ["search", ["!opt:plus4"]],
    ]);
    // DSD01a-014: a required single play option is no choice.
    expect(all("DSD01a-014")[0]!.alt).toBeUndefined();
    // BP01-057: the play option's cost, 10 spells in the cemetery (g.spellsInCemetery).
    expect(all("BP01-057")).toMatchObject([{ where: "canPay", alt: ["opt:banish10"], zones: ["cemetery"], filter: { t: "type", v: "spell" }, threshold: { op: ">=", n: 10 } }]);
    // CP03-014: its target is needed in either mode (one ref, no tag); mode 2 has its own cost (CR 10.4.7.5), and its
    // search is luck (the top card).
    expect(all("CP03-014").map((r) => [r.where, r.alt ?? null, r.chance ?? null])).toEqual([
      ["target", null, null],
      ["canPay", ["mode:2", "pay"], null],
      ["search", ["mode:2", "pay"], "top"],
    ]);
    // BP06-017: an optional cost's own requirement (fx.optionalCost, CR 10.4.7.5).
    expect(all("BP06-017").find((r) => r.where === "canPay")).toMatchObject({ alt: ["pay"], agg: "count", threshold: { op: ">=", n: 2 } });
    // On Super-Evolve is its own timing (CR 12.17).
    expect(all("CP04-038").map((r) => r.timing)).toEqual(["onEvolve", "onSuperEvolve"]);
    // BP10-054: the top card's original cost — luck for a fair player (CR 4.5.2), not a condition.
    expect(all("BP10-054")).toMatchObject([{ where: "topCard", chance: "top", top: 1, filter: { t: "costMin", v: 5 } }]);
    // PCS01-048: a PriConne follower on top (the helper's whole filter, one condition); CP02-015: a Cute card taken from the top.
    expect(all("PCS01-048").find((r) => r.chance)).toMatchObject({ where: "topCard", filter: { t: "and", args: [{ t: "type", v: "follower" }, { t: "trait", v: "プリコネ" }] } });
    expect(all("CP02-015")).toMatchObject([{ where: "topCard", chance: "top", filter: { t: "trait", v: "キュート" } }]);
    // BP15-024: the opponent's top card (fx.mill(1, opponent)): a follower, or a spell or an amulet.
    expect(all("BP15-024").map((r) => [r.side, r.chance, r.filter])).toEqual([
      ["opp", "top", { t: "type", v: "follower" }],
      ["opp", "top", { t: "or", args: [{ t: "type", v: "spell" }, { t: "type", v: "amulet" }] }],
    ]);
    // A test on a top card negated: BP14-099 "a non-Havencraft card", BP17-045 "a non-Runecraft card".
    expect(all("BP14-099").find((r) => r.chance)!.filter).toEqual({ t: "not", arg: { t: "class", v: "Havencraft" } });
    expect(all("BP17-045")[0]!.filter).toEqual({ t: "not", arg: { t: "class", v: "Runecraft" } });
    // ...given up on when it fails ("if (!milled.some(...)) return;"): BP05-054 goes on with a Rhino on top.
    expect(all("BP05-054").find((r) => r.chance)!.filter).toEqual({ t: "name", v: "Electromagical Rhino" });
    // Two tests on one top card are one condition (BP21-066: a Dragoncraft follower).
    expect(all("BP21-066").map((r) => r.filter)).toEqual([{ t: "and", args: [{ t: "type", v: "follower" }, { t: "class", v: "Dragoncraft" }] }]);
    // Each player's top card (BP01-083): the side isn't known from the code.
    expect(all("BP01-083")[0]!.side).toBe("?");
    // An automatic ability's own optional cost (CR 10.4.7.4): its target is under "pay", its trigger isn't (BP13-027).
    expect(all("CP04-008").map((r) => [r.where, r.alt])).toEqual([
      ["canPay", ["pay"]],
      ["target", ["pay"]],
    ]);
    expect(all("BP13-027").find((r) => r.where === "trigger")!.alt).toBeUndefined();
    // ...nor its condition, checked before paying (BP13-024); a mode's own cost (DSD01a-008 mode 2, CR 10.4.7.5).
    expect(all("BP13-024").find((r) => r.where === "condition")!.alt).toBeUndefined();
    expect(all("DSD01a-008").find((r) => r.where === "resolve")!.alt).toEqual(["mode:2", "pay"]);
    // "if (!machina(g, id)) continue;" in a loop: each Machina follower (BP07-070).
    expect(all("BP07-070").filter((r) => r.where === "each").map((r) => r.filter)).toEqual([
      { t: "type", v: "follower" },
      { t: "and", args: [{ t: "type", v: "follower" }, { t: "trait", v: "機械" }] },
    ]);
    // "if it isn't Mjerrabaine: +1/+1, done" then +3/+3: both conditions on the target (BP05-112).
    expect(all("BP05-112").filter((r) => r.where === "targetCondition").map((r) => JSON.stringify(r.filter))).toEqual([
      JSON.stringify({ t: "and", args: [{ t: "type", v: "follower" }, { t: "not", arg: { t: "name", v: "Mjerrabaine, Omen of One" } }] }),
      JSON.stringify({ t: "and", args: [{ t: "type", v: "follower" }, { t: "name", v: "Mjerrabaine, Omen of One" }] }),
    ]);
    // In the table: luck is counted in ref.top, not as a target or a threshold.
    const row = (def: string) => {
      const r = cardFeatureRow(engine.db.get(def), ALL_SCRIPTS[def], { ...analysis().get(def)!, refs: analysis().get(def)!.refs.map((x) => ({ ...x, filter: x.filter as RefFilter })) });
      return (c: string) => r[CARD_FEATURE_COLUMNS.indexOf(c)];
    };
    const erntz = row("BP10-054");
    expect([erntz("ref.top"), erntz("ref.w.target"), erntz("ref.threshold")]).toEqual([1, 0, 0]);
  }, 120_000);
  it("for what a card's targets and searches need", () => {
    // CSD02a-001: a Cute follower costing 4 or less (and one costing 2 or less) in your cemetery.
    expect(refs("CSD02a-001").map((r) => [r.where, r.zones[0], r.agg, JSON.stringify(r.filter)])).toEqual([
      ["target", "cemetery", "exists", JSON.stringify({ t: "and", args: [{ t: "type", v: "follower" }, { t: "trait", v: "キュート" }, { t: "costMax", v: 4 }] })],
      ["target", "cemetery", "exists", JSON.stringify({ t: "and", args: [{ t: "type", v: "follower" }, { t: "trait", v: "キュート" }, { t: "costMax", v: 2 }] })],
      // Lesson (1) (CR 14.3.2.1): a Magical Item in your EX area.
      ["canPay", "ex", "count", JSON.stringify({ t: "name", v: "Magical Item" })],
    ]);
    // BP09-060: 5 damage instead of 2 when the chosen enemy follower is a Wyrmkin: is there one.
    expect(refs("BP09-060").filter((r) => r.where === "targetCondition")).toEqual([{ timing: "onEvolve", where: "targetCondition", zones: ["field"], side: "opp", filter: { t: "and", args: [{ t: "type", v: "follower" }, { t: "trait", v: "竜族" }] }, agg: "exists", threshold: { op: ">=", n: 1 }, scaled: false }]);
    // BP01-017: its target, an enemy follower (a removal has nothing to do without one).
    expect(refs("BP01-017")).toEqual([{ timing: "fanfare", where: "target", zones: ["field"], side: "opp", filter: { t: "type", v: "follower" }, agg: "exists", threshold: { op: ">=", n: 1 }, scaled: false }]);
    // BP12-054: whether its EX area has room is the zone's size, already in the vector: no reference (only its target).
    expect(refs("BP12-054").filter((r) => r.where !== "target")).toEqual([]);
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
