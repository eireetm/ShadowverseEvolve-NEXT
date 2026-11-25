import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { IMPLEMENTED_KEYWORDS, PLAYER_ZONES, type CardType, type GameEvent, type Keyword, type PlayerZone } from "../src/core";
import { ALL_CARDS } from "../../core/src/sets";

// The bots' census of Core's mechanics. A new card set can bring a keyword, a zone, a card type or an event (CP05: Final
// Uncap, the uncap zone, treasures, "uncapped"). The engine plays it at once; a bot component that reads positions doesn't
// fail on it, it leaves it out without a word. Here leaving it out is a decision. For every keyword Core implements, every
// zone of a player's side, every card type of the pool and every event type, a row says for each component that reads
// positions where it reads the value (a file of the component and the function; by the value's name, or through a path that
// takes every value alike) or why it ignores it. The test fails on a value of Core's without a row, a row without a cell for
// each component, a row for a value Core no longer has, a read put in another component's file or in a file that doesn't
// declare the function, a read by a name the function's code lacks (with the file's constant tables it names), a name of the
// value in the code of a component said to ignore it (or to read it generically) without a note of what that name is there
// (the cell may have gone stale), and a source file of the bot that is in no component and not said to read no position. The
// encoders' layouts are frozen (trained models read them): what they ignore waits for the next encoder version.

// ---- Cells ----

/** What a component does with a value: reads it (where and how), or ignores it (why). */
type Cell =
  /**
   * By the value's name: `token` (the value itself unless given) is in the code of `fn` (functions, or a constant: e.g.
   * DEFAULT_WEIGHTS), or of a constant table of the file (UPPER_CASE, e.g. KW_NOW) that it names, directly or through others.
   */
  | { readonly reads: "by name"; readonly file: string; readonly fn: string; readonly how: string; readonly token?: string }
  /** Through a path that takes every value alike (every field of a card, every zone of the view...). */
  | { readonly reads: "generic"; readonly file: string; readonly fn: string; readonly how: string }
  | { readonly ignores: string };

const byName = (file: string, fn: string, how: string, token?: string): Cell => (token === undefined ? { reads: "by name", file, fn, how } : { reads: "by name", file, fn, how, token });
const generic = (file: string, fn: string, how: string): Cell => ({ reads: "generic", file, fn, how });
const ignores = (why: string): Cell => ({ ignores: why });

// ---- The components that read positions (views, or the simulated game) ----

const COMPONENTS = ["evaluate", "pp1", "danger", "lethal", "cond", "gates", "policy", "search", "quickWindow", "keys", "encoder", "encoderV2", "encoderV2Refs", "features", "setup"] as const;
type Component = (typeof COMPONENTS)[number];
type Row = Readonly<Record<Component, Cell>>;
/** A table: a row per value, keyed by Core's own type (a misspelt or vanished value doesn't compile). */
type Census<V extends string> = { readonly [K in V]?: Row };
/** The same with a row for every value of the type, where the type is the whole list: a missing row doesn't compile either. */
type FullCensus<V extends string> = { readonly [K in V]: Row };

/** Each component's files in packages/bot/src (a cell names one of them). */
const FILES: Readonly<Record<Component, readonly string[]>> = {
  evaluate: ["evaluate.ts"], // the hand-written evaluation
  pp1: ["eval-pp.ts"], // the presets' evaluation: evaluate's, with its play point and hand terms replaced
  danger: ["danger.ts"], // the danger term of the planner's evaluation
  lethal: ["lethal.ts"], // sure lethal
  cond: ["conditional.ts"], // the conditional-Fanfare charge
  gates: ["conditional-gates.ts"], // its gates scope (cond=gates)
  policy: ["policy.ts"], // the fast answers, and the card facts the searches read
  search: ["planner.ts", "branches.ts", "candidates.ts", "plan-lines.ts"], // what the planner tries and which plans it compares
  quickWindow: ["quick-window.ts"], // the bonus at the opponent's end-phase Quick window
  keys: ["keys.ts", "distinct-answers.ts"], // positions and cards told apart (distinct-answers.ts through cardSignatures)
  encoder: ["encoder.ts"], // encoder v1
  encoderV2: ["encoder-v2.ts"], // encoder v2
  encoderV2Refs: ["encoder-v2-refs.ts"], // encoder v2's counting of what cards count
  features: ["card-features.ts"], // the card feature table
  setup: ["setup-sample.ts", "mulligan-sim.ts", "mulligan.ts", "turn-order.ts", "greedy.ts"], // the setup: its samples, mulligans (greedy.ts's too), turn order
};

/** The bot's other source files, and why they read no position themselves. */
const NOT_COMPONENTS: Readonly<Record<string, string>> = {
  "card-table.ts": "loads the bundled card feature table",
  "close-samples.ts": "compares values the planner sampled",
  "core.ts": "re-exports Core's public API",
  "index.ts": "the package's exports",
  "levels.ts": "the presets: options",
  "macro-steps.ts": "groups the search's decisions into actions: reads decisions",
};

// ---- Cells many rows share ----

const DRIVE_ALONE = "no effect on its own (CR 14.4.7.2)";
const DECK_RULE = "a deck-building rule (CR 14.4.4)";
const UNCAP_IN_STATS = "the uncap bonus is already in the follower's attack and defense (CR JP 14.6.4.1.1, JP 14.6.4.2.1)";
const WAITING_UNCAP = "an uncap still to come (a treasure's ability in the attacker's EX area, 0 play points, CR JP 14.6.1) is left to the offset, like an evolution's +1";
const NOT_ATTACKING = "only followers attack or stand in an attack's way (CR 8.4.2, 12.8.2)";
const FROZEN_UNCAP = ignores("frozen layout: no column (the uncap bonus shows in atk.now and def.now); a column waits for the next encoder version");
const NOT_EVENTS = ignores("reads positions, not events: what an event did shows in the next view");

const EV_WEIGHT = byName("evaluate.ts", "fieldCardValue, DEFAULT_WEIGHTS", "a keyword weight of DEFAULT_WEIGHTS");
const EV_LINKED = ignores("not valued: the card it is linked to is valued on the field");
const PP1_REST = ignores("only its play point and hand terms are its own: the rest is evaluate's");
const DG_ZONE = ignores("the visible threat is the field's followers against the leader's defense: anything else that may add to it is left to the offset");
const DG_TYPE = ignores(NOT_ATTACKING);
const DG_ENTERED = ignores("every follower counts as an attacker: the view doesn't say which entered this turn");
const DG_HIDDEN = ignores("hidden, or luck: left to the offset");
const LT_ENGINE = ignores("the engine plays the line, which must win there; the beam ranks by the opponent's defense and the face attacks offered, ties by evaluate's value");
const COND_NO_KW = ignores("judges a played card's Fanfares by its script and the events: no keyword");
const COND_ZONE = ignores("follows only the played card's way to the resolution zone and the field, from wherever it was played");
const COND_PLAYED = generic("conditional.ts", "feedWatch, fanfaresOf", "a card played onto the field: its Fanfares, by its script");
const COND_TOKEN = ignores("a token, never played: no window opens for it");
const COND_EV = ignores("follows only a played card's moves and its own abilities' triggers and plays");
const GATES_NO_KW = ignores("counts cards by the table's filters (type, trait, class, cost, stats): no keyword");
const GATES_ZONE = byName("conditional-gates.ts", "zoneCards", "a zone a gate counts");
const GATES_UNCOUNTED = ignores("not a zone a gate counts (zoneCards: null), so the gate isn't judged");
const GATES_TYPE = generic("conditional-gates.ts", "gateMet", "a type filter compares the type the view shows (factsOfCard)");
const PO_KW = ignores("staticValue weighs only Ward and Bane");
const PO_ZONE = byName("policy.ts", "lookupFromView", "its cards' facts, by zone");
const PO_WORTH = byName("policy.ts", "staticValue", "its worth");
const PO_DEFAULT = generic("policy.ts", "staticValue", "the default worth: half its cost");
const SEARCH_NO_KW = ignores("keys actions by definition, zone and value: no keyword");
const SEARCH_KEY = generic("branches.ts", "actionKey", "an action keyed by its card's definition and zone (the lookup)");
const SEARCH_NO_ACTION = ignores("no action is taken from there");
const SEARCH_EV = ignores("hands the events to cond and drewCards; reads no other itself");
const QW_ONLY = ignores("follows only play points and turn events (PpLine)");
const QW_EV = ignores("follows only play points, the next turn and the game's end");
const KEYS_FIELDS = generic("keys.ts", "positionKey, cardSignatures", "every field the view shows of a card");
const KEYS_ZONE = byName("keys.ts", "cardSignatures", "LISTED_ZONES (positionKey reads every zone of the view)");
const E1_KW = byName("encoder.ts", "encode", "a kw.now column (KW_NOW)");
const E1_ZONE = byName("encoder.ts", "encode", "its count (SIDE_STATS), its cards' rows or sums");
const E1_TYPE = byName("encoder.ts", "encode", "a type column of the table (TYPE_COLUMNS)");
const E2_KW = byName("encoder-v2.ts", "encodeV2", "a kw.now column (KW_NOW)");
const E2_ZONE = byName("encoder-v2.ts", "encodeV2", "its count (SIDE_STATS), card tokens or pile entries");
const E2_STATIC = generic("encoder-v2.ts", "encodeV2, poolV2", "a card's static block is its table row (type.* columns)");
const REFS_NO_KW = ignores("a reference filters by type, trait, class, name, cost and stats: no keyword");
const REFS_ZONE = byName("encoder-v2-refs.ts", "refDomain", "a counted zone (COUNTED_ZONES)");
const REFS_SEEN = byName("encoder-v2-refs.ts", "seenCards", "its cards leave the unseen pools; a reference to it is partial");
const REFS_TYPE = byName("encoder-v2-refs.ts", "defFacts, factsOfCard", "TYPE_NAMES of the table; a visible card's type from the view");
const CF_KW = byName("card-features.ts", "cardFeatureRow", "a kw.* column (KEYWORDS)");
const CF_ZONE = byName("card-features.ts", "cardFeatureRow", "a ref.z.* column (REF_ZONES)");
const CF_REF_ZONES = generic("card-features.ts", "refFrom, zonesOf", "a reference's zones as written (selfKeywords: every zone); no ref.z.* column");
const CF_TYPE = byName("card-features.ts", "cardFeatureRow", "a type.* column");
const SETUP_IDS = ignores("deals identities and counts costs: keywords and types come with the cards");
const SETUP_POOL = byName("setup-sample.ts", "hiddenPools", "a hidden pool dealt again (POOL_ZONES)");
const SETUP_PUBLIC = ignores("not a pool Core's determinize deals again (POOL_ZONES)");
const SETUP_EV = ignores("follows only the setup's moves and shuffle, and the turns of a playout");

/** The components that take every keyword alike. */
const KW_ALIKE = { cond: COND_NO_KW, gates: GATES_NO_KW, quickWindow: QW_ONLY, keys: KEYS_FIELDS, encoderV2Refs: REFS_NO_KW, setup: SETUP_IDS } satisfies Partial<Row>;
/** The components that take every card type alike. */
const TYPE_ALIKE = {
  pp1: ignores("a card counts by its cost and Quick, whatever its type (quickReserve)"),
  search: ignores("keys actions by definition, zone and value: a card's actions are tried as the engine offers them, whatever its type"),
  quickWindow: QW_ONLY,
  keys: KEYS_FIELDS,
  setup: SETUP_IDS,
} satisfies Partial<Row>;
/** An event no component reads. */
const UNREAD: Row = {
  ...{ evaluate: NOT_EVENTS, pp1: NOT_EVENTS, danger: NOT_EVENTS, lethal: NOT_EVENTS, gates: NOT_EVENTS, policy: NOT_EVENTS, keys: NOT_EVENTS },
  ...{ encoder: NOT_EVENTS, encoderV2: NOT_EVENTS, encoderV2Refs: NOT_EVENTS, features: ignores("built from definitions and scripts, not from games") },
  ...{ cond: COND_EV, search: SEARCH_EV, quickWindow: QW_EV, setup: SETUP_EV },
};

// ---- 1. Keywords (IMPLEMENTED_KEYWORDS; rows optional by type: the Keyword union may name one not implemented yet) ----

const KEYWORDS: Census<Keyword> = {
  quick: {
    ...KW_ALIKE,
    evaluate: ignores("no keyword weight: a Quick card in hand counts as any card (pp1 adds its reserve)"),
    pp1: byName("eval-pp.ts", "quickReserve", "the play points its Quick cards could use outside the main phase (CR 12.3.2)"),
    ...{ danger: DG_HIDDEN, lethal: LT_ENGINE, policy: PO_KW, search: SEARCH_NO_KW, encoder: E1_KW, encoderV2: E2_KW, features: CF_KW },
  },
  ward: {
    ...KW_ALIKE,
    ...{ evaluate: EV_WEIGHT, pp1: PP1_REST, encoder: E1_KW, encoderV2: E2_KW, features: CF_KW },
    danger: byName("danger.ts", "wardsOf", "every attack must select a Ward follower while one stands (CR 12.8.2)"),
    lethal: byName("lethal.ts", "stepOf", "a Ward follower's entry is a step of the line (CR 12.8.2)", "wardEnterEngaged"),
    policy: byName("policy.ts", "staticValue, fastSelection", "its worth; the Ward choices (CR 7.4.3, 12.8.2)"),
    search: byName("candidates.ts", "candidateAnswers", "a Ward follower's entry gets the fast answer (the planner compares both itself)", "wardEnterEngaged"),
  },
  storm: {
    ...KW_ALIKE,
    ...{ evaluate: EV_WEIGHT, pp1: PP1_REST, danger: DG_ENTERED, policy: PO_KW, search: SEARCH_NO_KW, encoder: E1_KW, encoderV2: E2_KW, features: CF_KW },
    lethal: byName("lethal.ts", "lethalWithinReach", "a Storm follower in hand (not one in the EX area) adds its attack to the reach (CR 12.9.2)"),
  },
  rush: { ...KW_ALIKE, ...{ evaluate: EV_WEIGHT, pp1: PP1_REST, danger: DG_ENTERED, lethal: LT_ENGINE, policy: PO_KW, search: SEARCH_NO_KW, encoder: E1_KW, encoderV2: E2_KW, features: CF_KW } },
  assail: {
    ...KW_ALIKE,
    ...{ evaluate: EV_WEIGHT, pp1: PP1_REST, lethal: LT_ENGINE, policy: PO_KW, search: SEARCH_NO_KW, encoder: E1_KW, encoderV2: E2_KW, features: CF_KW },
    danger: ignores("lets an attack select a reserved follower (CR 12.11): no more damage reaches the leader"),
  },
  intimidate: {
    ...KW_ALIKE,
    ...{ evaluate: EV_WEIGHT, pp1: PP1_REST, lethal: LT_ENGINE, policy: PO_KW, search: SEARCH_NO_KW, encoder: E1_KW, encoderV2: E2_KW, features: CF_KW },
    danger: byName("danger.ts", "wardsOf", "a Ward follower with it can't be selected, so it forces nothing (CR 12.12.2)"),
  },
  bane: {
    ...KW_ALIKE,
    ...{ evaluate: EV_WEIGHT, pp1: PP1_REST, lethal: LT_ENGINE, policy: PO_WORTH, search: SEARCH_NO_KW, encoder: E1_KW, encoderV2: E2_KW, features: CF_KW },
    danger: byName("danger.ts", "attackersOf", "it breaks the Ward follower it fights (CR 12.14.2)"),
  },
  aura: {
    ...KW_ALIKE,
    ...{ evaluate: EV_WEIGHT, pp1: PP1_REST, lethal: LT_ENGINE, policy: PO_KW, search: SEARCH_NO_KW, encoder: E1_KW, encoderV2: E2_KW, features: CF_KW },
    danger: ignores("protects from the opponent's effects, not from attacks (CR 12.15)"),
  },
  stack: {
    ...KW_ALIKE,
    ...{ pp1: PP1_REST, lethal: LT_ENGINE, policy: PO_KW, search: SEARCH_NO_KW, encoder: E1_KW, encoderV2: E2_KW, features: CF_KW },
    evaluate: ignores("no keyword weight: its Stack counters count as counters (w.counter)"),
    danger: ignores("an amulet's (CR 13.3.2): no attack"),
  },
  drain: {
    ...KW_ALIKE,
    ...{ evaluate: EV_WEIGHT, pp1: PP1_REST, lethal: LT_ENGINE, policy: PO_KW, search: SEARCH_NO_KW, encoder: E1_KW, encoderV2: E2_KW, features: CF_KW },
    danger: ignores("heals the attacker's own leader: no damage to the defender's"),
  },
  singleDrive: {
    ...KW_ALIKE,
    ...{ pp1: PP1_REST, danger: DG_HIDDEN, lethal: LT_ENGINE, policy: PO_KW, search: SEARCH_NO_KW },
    evaluate: ignores("no keyword weight: a drive check is luck the search plays out"),
    encoder: byName("encoder.ts", "encode", "kw.now.driveChecks"),
    encoderV2: byName("encoder-v2.ts", "encodeV2", "kw.now.driveChecks"),
    features: byName("card-features.ts", "cardFeatureRow", "kw.driveChecks"),
  },
  twinDrive: {
    ...KW_ALIKE,
    ...{ pp1: PP1_REST, danger: DG_HIDDEN, lethal: LT_ENGINE, policy: PO_KW, search: SEARCH_NO_KW },
    evaluate: ignores("no keyword weight: a drive check is luck the search plays out"),
    encoder: byName("encoder.ts", "encode", "kw.now.driveChecks"),
    encoderV2: byName("encoder-v2.ts", "encodeV2", "kw.now.driveChecks"),
    features: byName("card-features.ts", "cardFeatureRow", "kw.driveChecks"),
  },
  drive: {
    ...KW_ALIKE,
    ...{ evaluate: ignores(DRIVE_ALONE), pp1: PP1_REST, danger: ignores(DRIVE_ALONE), lethal: LT_ENGINE, policy: PO_KW, search: SEARCH_NO_KW, encoder: E1_KW, encoderV2: E2_KW },
    features: ignores(`${DRIVE_ALONE}: no column (On Drive abilities are auto.onDrive)`),
  },
  startingAmulet: {
    ...KW_ALIKE,
    ...{ evaluate: ignores(DECK_RULE), pp1: PP1_REST, danger: ignores(DECK_RULE), lethal: LT_ENGINE, policy: PO_KW, search: SEARCH_NO_KW },
    ...{ encoder: ignores(`${DECK_RULE}: no column`), encoderV2: ignores(`${DECK_RULE}: no column`), features: ignores(`${DECK_RULE}: no column`) },
  },
  finalUncap: {
    ...KW_ALIKE,
    evaluate: ignores(`no keyword weight: once final-uncapped, ${UNCAP_IN_STATS}; one still to come is valued as its treasure (w.treasure)`),
    danger: ignores(`once final-uncapped, ${UNCAP_IN_STATS}; ${WAITING_UNCAP}`),
    ...{ pp1: PP1_REST, lethal: LT_ENGINE, policy: PO_KW, search: SEARCH_NO_KW, encoder: FROZEN_UNCAP, encoderV2: FROZEN_UNCAP },
    features: ignores("no column yet (no effect of its own, CR JP 14.6.3.2; a treasure can final-uncap its follower): the next table version can add one"),
  },
};

// ---- 2. A player's zones (PLAYER_ZONES: the zones of PlayerSideView) ----

const ZONES: FullCensus<PlayerZone> = {
  leader: {
    ...{ pp1: PP1_REST, cond: COND_ZONE, gates: GATES_UNCOUNTED, policy: PO_ZONE, quickWindow: QW_ONLY, features: CF_REF_ZONES, setup: SETUP_PUBLIC },
    evaluate: byName("evaluate.ts", "leaderValue", "its defense", "leaderDefense"),
    danger: byName("danger.ts", "threatOf", "the defender's defense", "leaderDefense"),
    lethal: byName("lethal.ts", "faceReach, searchSureLethal", "the attacks at it; its defense"),
    search: byName("branches.ts", "targetRank", "attacks at it first"),
    keys: byName("keys.ts", "cardSignatures", "the side's leader (positionKey reads every zone of the view)"),
    encoder: byName("encoder.ts", "encode", "its defense and its class"),
    encoderV2: byName("encoder-v2.ts", "encodeV2", "its defense and its class"),
    encoderV2Refs: ignores("a reference to it is partial (COUNTED_ZONES leaves it out)"),
  },
  deck: {
    ...{ pp1: PP1_REST, danger: DG_ZONE, lethal: LT_ENGINE, cond: COND_ZONE, quickWindow: QW_ONLY, encoderV2Refs: REFS_ZONE, features: CF_ZONE, setup: SETUP_POOL },
    evaluate: byName("evaluate.ts", "sideValue", "a danger when fewer than 3 cards are left", "deckCount"),
    gates: ignores("nobody sees it (CR 4.5.2): a gate on it isn't judged"),
    policy: generic("policy.ts", "lookupFromReader", "any card's zone in a simulation (the view shows a deck card only as a decision does)"),
    search: byName("planner.ts", "mulligan", "the planner's own mulligan (curve mode): the deck's costs, in order for the cheating bot (redrawKnowingDeck); no search action is taken from it"),
    keys: generic("keys.ts", "positionKey", "its count in the view (a deck isn't listed card by card, CR 4.1.2.1)"),
    encoder: byName("encoder.ts", "encode", "its count and the cards left in it (pool.me.deck)", "deckCount"),
    encoderV2: byName("encoder-v2.ts", "encodeV2", "its count and the cards left in it (deck.me)", "deckCount"),
  },
  hand: {
    ...{ danger: DG_ZONE, cond: COND_ZONE, gates: GATES_ZONE, policy: PO_ZONE, quickWindow: QW_ONLY, keys: KEYS_ZONE },
    ...{ encoder: E1_ZONE, encoderV2: E2_ZONE, encoderV2Refs: REFS_ZONE, features: CF_ZONE, setup: SETUP_POOL },
    evaluate: byName("evaluate.ts", "sideValue", "its cards, up to handCap"),
    pp1: byName("eval-pp.ts", "pp1Parts, quickReserve", "the hand cap; its Quick cards"),
    lethal: byName("lethal.ts", "lethalWithinReach", "the Storm followers it can play"),
    search: byName("planner.ts", "kinds", "the cards a plan keeps in hand"),
  },
  field: {
    ...{ pp1: PP1_REST, gates: GATES_ZONE, policy: PO_ZONE, search: SEARCH_KEY, quickWindow: QW_ONLY, keys: KEYS_ZONE },
    ...{ encoder: E1_ZONE, encoderV2: E2_ZONE, encoderV2Refs: REFS_ZONE, features: CF_ZONE, setup: SETUP_PUBLIC },
    evaluate: byName("evaluate.ts", "sideValue, fieldCardValue", "each card on it"),
    danger: byName("danger.ts", "attackersOf, wardsOf", "attackers and Ward followers"),
    lethal: byName("lethal.ts", "lethalWithinReach, faceReach", "its attackers' attack"),
    cond: byName("conditional.ts", "feedWatch", "the played card entering it"),
  },
  ex: {
    ...{ cond: COND_ZONE, gates: GATES_ZONE, policy: PO_ZONE, search: SEARCH_KEY, quickWindow: QW_ONLY, keys: KEYS_ZONE },
    ...{ encoder: E1_ZONE, encoderV2: E2_ZONE, encoderV2Refs: REFS_ZONE, features: CF_ZONE, setup: SETUP_PUBLIC },
    evaluate: byName("evaluate.ts", "sideValue", "each card in it (w.ex; a crest and a treasure by weights of their own)"),
    pp1: byName("eval-pp.ts", "quickReserve", "its Quick cards"),
    danger: ignores(`public (CR 4.8.2) but not counted: a Storm follower there is left to the offset like one in hand, and ${WAITING_UNCAP}`),
    lethal: ignores("the gate, lethalWithinReach, adds the hand's Storm followers but not the EX area's, though cards are played from there too (CR 8.2.1): a blind spot where its margin is small (3: turnValue, lethalFirstModel); a line plays what the engine offers"),
  },
  cemetery: {
    ...{ pp1: PP1_REST, danger: DG_ZONE, lethal: LT_ENGINE, cond: COND_ZONE, gates: GATES_ZONE, policy: PO_ZONE, search: SEARCH_KEY, quickWindow: QW_ONLY },
    ...{ keys: KEYS_ZONE, encoder: E1_ZONE, encoderV2: E2_ZONE, encoderV2Refs: REFS_ZONE, features: CF_ZONE, setup: SETUP_PUBLIC },
    evaluate: ignores("not valued, a gap: no term for what abilities count in it or play from it (gates and the encoders read it)"),
  },
  banished: {
    ...{ pp1: PP1_REST, danger: DG_ZONE, lethal: LT_ENGINE, cond: COND_ZONE, gates: GATES_ZONE, policy: PO_ZONE, search: SEARCH_NO_ACTION, quickWindow: QW_ONLY },
    ...{ keys: KEYS_ZONE, encoder: E1_ZONE, encoderV2: E2_ZONE, encoderV2Refs: REFS_ZONE, features: CF_ZONE, setup: SETUP_POOL },
    evaluate: ignores("not valued, a gap: no term for what abilities count in it (gates and the encoders read it)"),
  },
  evolveDeck: {
    ...{ pp1: PP1_REST, danger: DG_ZONE, lethal: LT_ENGINE, cond: COND_ZONE, gates: GATES_UNCOUNTED, policy: PO_ZONE, quickWindow: QW_ONLY },
    ...{ keys: KEYS_ZONE, encoder: E1_ZONE, encoderV2: E2_ZONE, encoderV2Refs: REFS_ZONE, features: CF_ZONE, setup: SETUP_POOL },
    evaluate: ignores("not valued: the evolution points are"),
    search: ignores("an evolve card is keyed by its definition, not its zone (actionKey)"),
  },
  evolveZone: {
    ...{ pp1: PP1_REST, danger: DG_ZONE, lethal: LT_ENGINE, gates: GATES_ZONE, policy: PO_ZONE, search: SEARCH_NO_ACTION, quickWindow: QW_ONLY },
    ...{ keys: KEYS_ZONE, encoder: E1_ZONE, encoderV2: E2_ZONE, encoderV2Refs: REFS_ZONE, features: CF_REF_ZONES, setup: SETUP_PUBLIC },
    evaluate: ignores("an evolved follower is valued on the field (fieldCardValue: evolvedWith)"),
    cond: byName("conditional.ts", "feedEvolveWatch", "the evolve card of an evolution's window"),
  },
  raceZone: {
    ...{ evaluate: EV_LINKED, pp1: PP1_REST, danger: DG_ZONE, lethal: LT_ENGINE, cond: COND_ZONE, policy: PO_ZONE, search: SEARCH_NO_ACTION, quickWindow: QW_ONLY },
    ...{ keys: KEYS_ZONE, encoder: E1_ZONE, encoderV2: E2_ZONE, features: CF_REF_ZONES, setup: SETUP_PUBLIC },
    gates: byName("conditional-gates.ts", "gateMet", "which followers race (a racing filter)"),
    encoderV2Refs: byName("encoder-v2-refs.ts", "seenCards, refDomain", "its cards leave the unseen pools; which followers race"),
  },
  driveZone: {
    ...{ evaluate: EV_LINKED, pp1: PP1_REST, danger: DG_ZONE, lethal: LT_ENGINE, cond: COND_ZONE, gates: GATES_UNCOUNTED, policy: PO_ZONE, search: SEARCH_NO_ACTION, quickWindow: QW_ONLY },
    ...{ keys: KEYS_ZONE, encoder: E1_ZONE, encoderV2: E2_ZONE, encoderV2Refs: REFS_SEEN, features: CF_REF_ZONES, setup: SETUP_PUBLIC },
  },
  triggerZone: {
    ...{ pp1: PP1_REST, danger: DG_ZONE, lethal: LT_ENGINE, cond: COND_ZONE, gates: GATES_UNCOUNTED, policy: PO_ZONE, search: SEARCH_NO_ACTION, quickWindow: QW_ONLY },
    ...{ keys: KEYS_ZONE, encoder: E1_ZONE, encoderV2: E2_ZONE, encoderV2Refs: REFS_SEEN, features: CF_REF_ZONES, setup: SETUP_PUBLIC },
    evaluate: ignores("a drive check's card, there only until it is resolved (CR 4.15)"),
  },
  equipmentZone: {
    ...{ pp1: PP1_REST, danger: DG_ZONE, lethal: LT_ENGINE, cond: COND_ZONE, gates: GATES_UNCOUNTED, policy: PO_ZONE, search: SEARCH_NO_ACTION, quickWindow: QW_ONLY },
    ...{ keys: KEYS_ZONE, encoder: E1_ZONE, encoderV2: E2_ZONE, setup: SETUP_PUBLIC },
    evaluate: byName("evaluate.ts", "sideValue", "each equipment token (w.equipment)"),
    encoderV2Refs: byName("encoder-v2-refs.ts", "seenCards, liveness", "its cards leave the unseen pools; an equipment token's references work there"),
    features: byName("card-features.ts", "zonesOf", "where an equipment token's abilities work (CR 14.5.2.1)"),
  },
  uncapZone: {
    ...{ pp1: PP1_REST, lethal: LT_ENGINE, cond: COND_ZONE, gates: GATES_UNCOUNTED, search: SEARCH_NO_ACTION, quickWindow: QW_ONLY, features: CF_REF_ZONES, setup: SETUP_PUBLIC },
    evaluate: ignores(`not valued: ${UNCAP_IN_STATS}`),
    danger: ignores(UNCAP_IN_STATS),
    policy: byName("policy.ts", "lookupFromView", "its treasures' facts (staticValue)"),
    keys: KEYS_ZONE,
    encoder: FROZEN_UNCAP,
    encoderV2: FROZEN_UNCAP,
    encoderV2Refs: ignores("holds only treasures, tokens of no deck list: nothing to take out of the pools; no reference counts it"),
  },
};

// ---- 3. Card types (the CardType union: the pool's types and "leader"; rows optional by type, as CardType may have a type no card has yet) ----

const CARD_TYPES: Census<CardType> = {
  leader: {
    ...TYPE_ALIKE,
    ...{ danger: DG_TYPE, lethal: LT_ENGINE, policy: PO_DEFAULT },
    evaluate: ignores("valued by its defense (leaderValue), not as a card"),
    cond: ignores("never played: no window"),
    gates: ignores("not in a zone a gate counts (zoneCards)"),
    encoder: byName("encoder.ts", "encode", "its class, from its table row"),
    encoderV2: byName("encoder-v2.ts", "encodeV2", "its class, from its table row"),
    encoderV2Refs: byName("encoder-v2-refs.ts", "defFacts", "a row with no type column reads as a leader (a treasure's too, until the table has its column); a leader itself is never counted (COUNTED_ZONES leaves its zone out)"),
    features: byName("card-features.ts", "cardFeatureRow", "no type column: a leader is its class (cls.*)"),
  },
  follower: {
    ...TYPE_ALIKE,
    ...{ cond: COND_PLAYED, gates: GATES_TYPE, policy: PO_WORTH, encoder: E1_TYPE, encoderV2Refs: REFS_TYPE, features: CF_TYPE },
    evaluate: byName("evaluate.ts", "fieldCardValue, boardAttack", "its attack, defense, keywords and evolution"),
    danger: byName("danger.ts", "isFollower", "only followers attack and protect"),
    lethal: byName("lethal.ts", "lethalWithinReach", "a Storm follower in hand"),
    encoderV2: byName("encoder-v2.ts", "encodeV2", "follower.now and the evolve columns"),
  },
  amulet: {
    ...TYPE_ALIKE,
    ...{ danger: DG_TYPE, lethal: LT_ENGINE, cond: COND_PLAYED, gates: GATES_TYPE, policy: PO_WORTH, encoder: E1_TYPE, encoderV2: E2_STATIC, encoderV2Refs: REFS_TYPE, features: CF_TYPE },
    evaluate: generic("evaluate.ts", "fieldCardValue", "every card on the field but a follower (a facedown one too): w.amulet"),
  },
  spell: {
    ...TYPE_ALIKE,
    ...{ danger: DG_TYPE, lethal: LT_ENGINE, gates: GATES_TYPE, policy: PO_DEFAULT, encoder: E1_TYPE, encoderV2: E2_STATIC, encoderV2Refs: REFS_TYPE, features: CF_TYPE },
    evaluate: generic("evaluate.ts", "sideValue", "a card in the hand or the EX area counts whatever its type, but for a crest or a treasure in the EX area (w.hand, w.ex)"),
    cond: ignores("never enters the field: no Fanfare to judge"),
  },
  crest: {
    ...TYPE_ALIKE,
    ...{ danger: DG_TYPE, lethal: LT_ENGINE, cond: COND_TOKEN, gates: GATES_TYPE, policy: PO_WORTH, encoder: E1_TYPE, encoderV2: E2_STATIC, encoderV2Refs: REFS_TYPE, features: CF_TYPE },
    evaluate: byName("evaluate.ts", "sideValue", "w.crest and its counters in the EX area"),
  },
  equipment: {
    ...TYPE_ALIKE,
    ...{ danger: DG_TYPE, lethal: LT_ENGINE, cond: COND_TOKEN, policy: PO_DEFAULT, encoder: E1_TYPE, encoderV2: E2_STATIC, encoderV2Refs: REFS_TYPE, features: CF_TYPE },
    evaluate: byName("evaluate.ts", "sideValue", "each token of the equipment zone (w.equipment)", "equipmentZone"),
    gates: ignores("lives in the equipment zone, which a gate doesn't count"),
  },
  treasure: {
    ...TYPE_ALIKE,
    ...{ lethal: LT_ENGINE, cond: COND_TOKEN, gates: GATES_TYPE },
    evaluate: byName("evaluate.ts", "sideValue", "w.treasure: an uncap waiting in the EX area (CR JP 14.6.4)", "w.treasure"),
    danger: ignores(`${NOT_ATTACKING}; ${WAITING_UNCAP}`),
    policy: byName("policy.ts", "staticValue", "0.5, evaluate's treasure weight: a free uncap waiting (CR JP 14.6.4)"),
    encoder: ignores("no type column (the table has none yet; frozen layout): an EX treasure's row has no type"),
    encoderV2: ignores("no type column yet: an EX treasure's token reads as a leader (defFacts), so its type.changed is 1; a column waits for the next encoder version"),
    encoderV2Refs: generic("encoder-v2-refs.ts", "factsOfCard", "a visible card's type is the view's; no table column yet (defFacts reads it as a leader)"),
    features: byName("card-features.ts", "cardFeatureRow, zonesOf", "its abilities work in the EX area; no type column until the next table version (NO_COLUMN_YET)"),
  },
};

// ---- 4. Events (the GameEvent union's types; a row for each, which the compiler checks against the union) ----

const EVENTS: FullCensus<GameEvent["type"]> = {
  gameStarted: UNREAD,
  turnOrderChosen: UNREAD,
  mulligan: UNREAD,
  turnStarted: {
    ...UNREAD,
    quickWindow: byName("quick-window.ts", "PpLine, see", "our next turn ends the line (the refill comes, CR 7.2.2)"),
    setup: byName("mulligan-sim.ts", "playOpening", "the turns a mulligan's playout played"),
  },
  phaseStarted: UNREAD,
  cardsMoved: {
    ...UNREAD,
    cond: byName("conditional.ts", "feedWatch, feedEvolveWatch", "the played card's way to the field; an evolve card put into the evolve zone"),
    search: byName("plan-lines.ts", "drewCards", "an action that draws (CR 5.10), moved first"),
    setup: byName("setup-sample.ts", "setupFacts", "the setup's moves followed back (CR 4.1.4)"),
  },
  tokensEliminated: UNREAD,
  deckShuffled: { ...UNREAD, setup: byName("setup-sample.ts", "setupFacts", "where the setup shuffled (CR 6.2.1.4)") },
  playPointsChanged: { ...UNREAD, quickWindow: byName("quick-window.ts", "PpLine, see", "the play points the line used") },
  evolutionPointsChanged: UNREAD,
  placementChanged: UNREAD,
  countersChanged: UNREAD,
  cardsRevealed: UNREAD,
  extraTurnGranted: UNREAD,
  turnSkipped: UNREAD,
  raced: UNREAD,
  driveChecked: UNREAD,
  driveTriggered: UNREAD,
  givenDrive: UNREAD,
  dieRolled: UNREAD,
  manualOp: UNREAD,
  unionBurstExecuted: UNREAD,
  equipped: UNREAD,
  uncapped: UNREAD,
  damageDealt: UNREAD,
  leaderDefenseChanged: UNREAD,
  evolved: { ...UNREAD, cond: byName("conditional.ts", "feedEvolveWatch", "the follower of an evolution's window evolved") },
  cardsFused: UNREAD,
  statsGained: UNREAD,
  cardsLookedAt: UNREAD,
  cardPlayed: UNREAD,
  cardsSelected: UNREAD,
  abilityPlayed: { ...UNREAD, cond: byName("conditional.ts", "feedWatch", "the played card's own abilities played (CR 10.6.2.7)") },
  abilityTriggered: { ...UNREAD, cond: byName("conditional.ts", "feedWatch", "the played card's own abilities becoming pending (CR 10.7.2)") },
  attackDeclared: UNREAD,
  fought: UNREAD,
  attackEnded: UNREAD,
  gameEnded: { ...UNREAD, quickWindow: byName("quick-window.ts", "see", "the line ends with the game") },
};

// ---- Names that aren't reads ----

const DECISION_QUICK = "the decision (and answer) type quick, not the keyword";
const ZONE_LEADER = "the zone leader (a side's leader card, an attack's target there)";
const TYPE_LEADER = "the card type leader";
const PRINTOUT = "TYPE_CN, the printout's name of the type (not in the vector)";
const DECISION_MULLIGAN = "the decision (and answer) type mulligan, its options and modules, not the event";
const EVOLVED_STATE = "an evolved card or follower (a column, a definition's flag, a filter), not the event";

/**
 * Where the code of a component whose cell ignores a value (or reads it generically) names the value, what that name is
 * there ("<kind> <value>", the files that name it). A name without a note fails (the component may read the value by name
 * now: its cell would be stale), and so does a note no name needs.
 */
const OTHER_NAMES: readonly { readonly at: string; readonly files: readonly string[]; readonly what: string }[] = [
  { at: "keyword quick", files: ["lethal.ts", "policy.ts", "planner.ts", "candidates.ts"], what: DECISION_QUICK },
  { at: "keyword quick", files: ["quick-window.ts"], what: `${DECISION_QUICK}; its identity quick=…` },
  { at: "keyword quick", files: ["greedy.ts"], what: "the module ./quick-window" },
  { at: "keyword stack", files: ["lethal.ts"], what: "a local variable (lineWinsAgainstAll's depth-first stack)" },
  { at: "zone leader", files: ["encoder-v2-refs.ts", "card-features.ts"], what: TYPE_LEADER },
  { at: "zone hand", files: ["conditional.ts"], what: "the hand weight (COND_DEFAULTS' penalty) and Watch.hand, the played card's id (from the hand or the EX area)" },
  { at: "card type leader", files: ["lethal.ts", "policy.ts", "branches.ts", "candidates.ts", "plan-lines.ts", "keys.ts"], what: ZONE_LEADER },
  { at: "card type leader", files: ["evaluate.ts"], what: "w.leader, the weight of a point of leader defense" },
  { at: "card type amulet", files: ["evaluate.ts"], what: "w.amulet, the weight of every card on the field but a follower" },
  { at: "card type amulet", files: ["encoder-v2.ts"], what: PRINTOUT },
  { at: "card type spell", files: ["encoder-v2.ts"], what: PRINTOUT },
  { at: "card type crest", files: ["encoder-v2.ts"], what: PRINTOUT },
  { at: "card type equipment", files: ["encoder-v2.ts"], what: `${PRINTOUT}; the equipment zone's links (link.equipment), by zone` },
  { at: "event mulligan", files: ["policy.ts", "planner.ts", "candidates.ts", "setup-sample.ts", "mulligan-sim.ts", "greedy.ts"], what: DECISION_MULLIGAN },
  { at: "event damageDealt", files: ["card-features.ts"], what: "a script's field passive damageDealt (FP_DAMAGE)" },
  { at: "event evolved", files: ["evaluate.ts", "encoder.ts", "encoder-v2.ts", "encoder-v2-refs.ts", "card-features.ts"], what: EVOLVED_STATE },
];

// ---- Core's values ----

const SRC = join(__dirname, "..", "src");
const COMMENTS = /\/\/.*$|\/\*[\s\S]*?\*\//gm;
const EVENTS_SOURCE = join(__dirname, "..", "..", "core", "src", "events", "types.ts");
const OPENS = "{([";
const CLOSES = "})]";

/** An object type's own text: inside its braces, what is nested blanked out (null: not one object type). */
function ownText(member: string): string | null {
  if (!member.startsWith("{")) return null;
  let depth = 0;
  let own = "";
  for (let i = 0; i < member.length; i++) {
    const ch = member[i]!;
    if (OPENS.includes(ch)) depth += 1;
    else if (CLOSES.includes(ch)) {
      depth -= 1;
      if (depth === 0 && i !== member.length - 1) return null; // `{ … } & Other`
    } else if (depth === 1) own += ch;
  }
  return depth === 0 ? own : null;
}

/**
 * The `type` of each member of Core's GameEvent union, read from its source (there is no list at run time): its members up
 * to the `;` that ends it, each an object type with a `type` of its own. `unread`: the members the parse can't read (a named
 * type, an intersection...), which the compiler finds missing in EVENTS but this test would not.
 */
function readEventTypes(): { types: string[]; unread: string[] } {
  const text = readFileSync(EVENTS_SOURCE, "utf8").replace(COMMENTS, "");
  const head = "export type GameEvent =";
  const start = text.indexOf(head);
  if (start < 0) return { types: [], unread: [`no "${head}"`] };
  const members: string[] = [];
  let depth = 0;
  let from = start + head.length;
  let ended = false;
  for (let i = from; i < text.length && !ended; i++) {
    const ch = text[i]!;
    if (OPENS.includes(ch)) depth += 1;
    else if (CLOSES.includes(ch)) depth -= 1;
    else if (depth === 0 && (ch === "|" || ch === ";")) {
      members.push(text.slice(from, i).trim());
      from = i + 1;
      ended = ch === ";";
    }
  }
  if (!ended) members.push(text.slice(from).trim());
  const types: string[] = [];
  const unread: string[] = [];
  for (const member of members.filter((m) => m !== "")) {
    const own = ownText(member);
    const found = own === null ? [] : [...own.matchAll(/(?:^|[;,\n])\s*(?:readonly\s+)?type\s*:\s*"(\w+)"\s*(?=[;,\n]|$)/g)].map((m) => m[1]!);
    if (found.length === 1) types.push(found[0]!);
    else unread.push(member.replace(/\s+/g, " ").slice(0, 80));
  }
  return { types, unread };
}
const EVENT_TYPES = readEventTypes();

/** Events the parse must find (checked against the union by the compiler). */
const KNOWN_EVENTS: readonly GameEvent["type"][] = ["gameStarted", "cardsMoved", "damageDealt", "evolved", "uncapped", "gameEnded"];

const CENSUS: readonly { kind: string; source: string; values: readonly string[]; rows: Readonly<Record<string, Row | undefined>> }[] = [
  { kind: "keyword", source: "IMPLEMENTED_KEYWORDS (packages/core/src/model/keyword.ts)", values: [...IMPLEMENTED_KEYWORDS], rows: KEYWORDS },
  { kind: "zone", source: "PLAYER_ZONES (packages/core/src/model/state.ts)", values: [...PLAYER_ZONES], rows: ZONES },
  { kind: "card type", source: "the card pool's types and leader", values: [...new Set<string>(["leader", ...ALL_CARDS.map((d) => d.type)])], rows: CARD_TYPES },
  { kind: "event", source: "the GameEvent union (packages/core/src/events/types.ts)", values: EVENT_TYPES.types, rows: EVENTS },
];

// ---- The bot's code ----

const code = new Map<string, string | null>();
/** A source file's code without its comments (null: no such file). */
function codeOf(file: string): string | null {
  if (!code.has(file)) {
    let text: string | null = null;
    try {
      text = readFileSync(join(SRC, file), "utf8").replace(COMMENTS, "");
    } catch {
      text = null;
    }
    code.set(file, text);
  }
  return code.get(file) ?? null;
}
const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const hasWord = (text: string, word: string): boolean => new RegExp(`(?<![\\w$])${escapeRe(word)}(?![\\w$])`).test(text);

/** The words a declaration's line may start with before its kind and name. */
const MODIFIERS = "(?:(?:export|default|declare|abstract|async|public|private|protected|static|readonly|override|get|set)\\s+)*";

/**
 * The code of the declarations named `name` in a file's code: its functions, classes and constants, or else its methods (a
 * line opening `name(` that isn't a statement), each from its first line to the line that closes it at its own indentation (the
 * code is formatted).
 */
function declarationsOf(text: string, name: string): string[] {
  const n = escapeRe(name);
  const heads = [
    new RegExp(`^(\\s*)${MODIFIERS}(?:function\\s*\\*?\\s*${n}\\s*[<(]|class\\s+${n}(?![\\w$])|(?:const|let|var)\\s+${n}\\s*[:=])`),
    new RegExp(`^(\\s*)${MODIFIERS}\\*?\\s*${n}\\s*[<(][^;]*$`),
  ];
  const lines = text.split("\n");
  for (const head of heads) {
    const found: string[] = [];
    for (let i = 0; i < lines.length; i++) {
      const indent = head.exec(lines[i]!)?.[1]?.length;
      if (indent === undefined) continue;
      let end = i;
      for (let j = i + 1; j < lines.length; j++) {
        const line = lines[j]!;
        if (line.trim() === "") continue;
        const at = line.length - line.trimStart().length;
        if (at > indent) end = j;
        else if (at === indent && /^\s*[})\]]/.test(line)) {
          end = j;
          if (!/[{([]\s*$/.test(line)) break; // `): T {` goes on into the body
        } else break;
      }
      found.push(lines.slice(i, end + 1).join("\n"));
    }
    if (found.length > 0) return found;
  }
  return [];
}

/**
 * The code a cell's functions read their names in: theirs, and that of the file's constant tables (UPPER_CASE, top level)
 * they name, directly or through each other (KW_NOW, SIDE_STATS...). Not their parameters' types, nor the functions they call.
 */
function readsOf(text: string, fns: readonly string[]): string {
  const parts = fns.flatMap((fn) => declarationsOf(text, fn));
  const tables = [...new Set([...text.matchAll(/^(?:export\s+)?const\s+([A-Z][A-Z0-9_]*)(?![\w$])/gm)].map((m) => m[1]!))];
  const named = new Set<string>(fns);
  for (let grew = true; grew; ) {
    grew = false;
    const now = parts.join("\n");
    for (const table of tables.filter((t) => !named.has(t) && hasWord(now, t))) {
      named.add(table);
      parts.push(...declarationsOf(text, table));
      grew = true;
    }
  }
  return parts.join("\n");
}

/**
 * The cells whose read isn't where the code is (the test below): another component's file, a function the file doesn't
 * declare, a name the functions' code (readsOf) lacks.
 */
function misplacedReads(): string[] {
  const wrong: string[] = [];
  for (const c of CENSUS) {
    for (const [value, row] of Object.entries(c.rows)) {
      if (!row) continue;
      for (const k of COMPONENTS) {
        const cell = row[k] as Cell | undefined;
        if (!cell || !("reads" in cell)) continue;
        const at = `${c.kind} ${value}, ${k}`;
        const text = codeOf(cell.file);
        const fns = cell.fn.split(/[\s,]+/).filter((s) => s !== "");
        if (!FILES[k].includes(cell.file)) wrong.push(`${at}: ${cell.file} isn't a file of ${k}`);
        else if (text === null) wrong.push(`${at}: no file ${cell.file}`);
        else {
          for (const fn of fns) if (declarationsOf(text, fn).length === 0) wrong.push(`${at}: ${cell.file} declares no ${fn}`);
          const token = cell.reads === "by name" ? (cell.token ?? value) : null;
          if (token !== null && !hasWord(readsOf(text, fns), token)) wrong.push(`${at}: ${cell.fn} in ${cell.file} never names ${token} (generic, or ignores?)`);
        }
      }
    }
  }
  return wrong;
}

function sourceFiles(dir: string, base = ""): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    const rel = base ? `${base}/${f}` : f;
    return statSync(p).isDirectory() ? sourceFiles(p, rel) : f.endsWith(".ts") ? [rel] : [];
  });
}

describe("the census of Core's mechanics (what each component that reads positions does with them)", () => {
  for (const c of CENSUS) {
    it(`has a row for every ${c.kind} Core has (${c.source}), and none for one it doesn't`, () => {
      const missing = c.values.filter((v) => c.rows[v] === undefined);
      const gone = Object.keys(c.rows).filter((v) => !c.values.includes(v));
      expect(missing, `${c.kind}s without a row: add one, with a cell for every component (where it reads the ${c.kind}, or why it ignores it)`).toEqual([]);
      expect(gone, `rows for ${c.kind}s Core no longer has`).toEqual([]);
    });
  }

  it("reads every member of the GameEvent union from its source: the ones known, each once", () => {
    const found = EVENT_TYPES.types;
    expect(EVENT_TYPES.unread, `members of the union in ${EVENTS_SOURCE} that aren't an object type with a type of its own: read them`).toEqual([]);
    expect(KNOWN_EVENTS.filter((t) => !found.includes(t)), `not found in ${EVENTS_SOURCE}`).toEqual([]);
    expect(found.filter((t, i) => found.indexOf(t) !== i)).toEqual([]);
  });

  it("gives every row a cell for each component, with where it reads or why it doesn't", () => {
    const wrong: string[] = [];
    for (const c of CENSUS) {
      for (const [value, row] of Object.entries(c.rows)) {
        if (!row) continue;
        for (const k of COMPONENTS) {
          const cell = row[k] as Cell | undefined;
          if (!cell) wrong.push(`${c.kind} ${value}: no cell for ${k}`);
          else if ("ignores" in cell ? cell.ignores.trim() === "" : cell.how.trim() === "" || cell.fn.trim() === "") wrong.push(`${c.kind} ${value}, ${k}: say where or why`);
        }
        for (const k of Object.keys(row)) if (!(COMPONENTS as readonly string[]).includes(k)) wrong.push(`${c.kind} ${value}: ${k} is no component`);
      }
    }
    expect(wrong).toEqual([]);
  });

  it("puts a read only where the code is: a file of the component, functions it declares, and the name it reads by in their code", () => {
    expect(misplacedReads()).toEqual([]);
  });

  it("says what a value's name is in the code of a component said to ignore it or to read it generically", () => {
    const wrong: string[] = [];
    const notes = new Set<string>();
    for (const n of OTHER_NAMES) {
      for (const f of n.files) {
        const key = `${n.at} in ${f}`;
        if (notes.has(key)) wrong.push(`${key}: noted twice`);
        notes.add(key);
      }
    }
    const needed = new Set<string>();
    for (const c of CENSUS) {
      for (const [value, row] of Object.entries(c.rows)) {
        if (!row) continue;
        for (const k of COMPONENTS) {
          const cell = row[k] as Cell | undefined;
          if (!cell || ("reads" in cell && cell.reads === "by name")) continue;
          for (const f of FILES[k]) {
            const text = codeOf(f);
            if (text === null || !hasWord(text, value)) continue;
            const key = `${c.kind} ${value} in ${f}`;
            needed.add(key);
            if (!notes.has(key)) wrong.push(`${c.kind} ${value}, ${k}: ${f} names ${value} (a read by name now? or say in OTHER_NAMES what the name is there)`);
          }
        }
      }
    }
    for (const key of notes) if (!needed.has(key)) wrong.push(`a note no name needs (gone, or its cell reads by name): ${key}`);
    expect(wrong).toEqual([]);
  });

  it("knows every source file of the bot: a component's, or why it reads no position itself", () => {
    const listed = [...COMPONENTS.flatMap((k) => FILES[k]), ...Object.keys(NOT_COMPONENTS)];
    const files = sourceFiles(SRC);
    expect(
      files.filter((f) => !listed.includes(f)),
      "files of no component: one that reads positions joins a component (or becomes one), any other says why it doesn't",
    ).toEqual([]);
    expect(listed.filter((f) => !files.includes(f)), "listed files that are gone").toEqual([]);
    expect(listed.filter((f, i) => listed.indexOf(f) !== i), "files listed twice").toEqual([]);
  });
});
