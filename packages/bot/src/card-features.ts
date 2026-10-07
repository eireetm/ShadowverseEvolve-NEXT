import { CARD_CLASSES, type AbilityDef, type CardDefinition, type CardScript, type DefId } from "./core";

/**
 * The card feature table: what a card is, as numbers a value network can read without knowing the card — its definition
 * (type, class, cost, stats, special types) and the fields its script declares (keywords, abilities by kind and timing, their
 * costs and limits, choices, play options, passive rules). Never the card's id or name. Every value is a small whole number.
 * A new card gets its row from the same rules; a card's row changes only when its definition or declared fields do (npm run
 * rl:features reports it). The table is generated into card-features.json.
 * Version 2 keeps version 1's 119 columns first, in order (encoder v1 reads only those), and adds per definition its traits
 * (CR 2.4, as indices into the file's trait list) and the evolve cards that can evolve it (evolvePartners).
 */
export const CARD_FEATURES_VERSION = 2;

const CLASS_COLUMNS = ["cls.neutral", "cls.forest", "cls.sword", "cls.rune", "cls.dragon", "cls.abyss", "cls.haven"] as const;
const UNIVERSES = ["umamusume", "cinderellaGirls", "vanguard", "princessConnect"] as const;
const TRIGGERS = ["critical", "draw", "stand", "heal"] as const;
const KEYWORDS = ["quick", "ward", "storm", "rush", "assail", "intimidate", "drain", "bane", "aura", "stack"] as const;
const TIMINGS = ["fanfare", "lastWords", "onEvolve", "onSuperEvolve", "strike", "onRace", "onDrive", "other"] as const;
const FP_DAMAGE = ["damageDealt", "damageBy", "damageTaken", "damageToFollower", "damageToLeader"] as const;
const FP_ATTACK = ["followersBeforeLeaders", "preventsAttack", "forcesEnemyAttacks"] as const;
const FP_OTHER = [
  "combatDamageFromDefense",
  "spellchainCountsRunecraftFollowers",
  "banishesEnemyFollowersInsteadOfCemetery",
  "extraEndPhaseTriggers",
  "chooseAnyNumberOfOptions",
  "opponentsAbilitiesDontTrigger",
  "dieRerolls",
] as const;

/** Version 1's columns, in order (119): the first columns of every later version. */
export const CARD_FEATURE_COLUMNS_V1: readonly string[] = [
  ...["follower", "amulet", "spell", "crest", "equipment"].map((t) => `type.${t}`),
  ...CLASS_COLUMNS,
  ...UNIVERSES.map((u) => `uni.${u}`),
  ...TRIGGERS.map((t) => `trig.${t}`),
  "evolved",
  "advanced",
  "token",
  "dfc.front",
  "dfc.back",
  "cost",
  "cost.null",
  "cost.le1",
  "cost.2",
  "cost.3",
  "cost.4",
  "cost.5",
  "cost.6",
  "cost.ge7",
  "atk",
  "def",
  ...KEYWORDS.map((k) => `kw.${k}`),
  "kw.driveChecks",
  "kw.selfCond",
  ...TIMINGS.map((t) => `auto.${t}`),
  "auto.cost",
  "auto.limited",
  "auto.cond",
  "auto.ub",
  "auto.offField",
  "act.evolve",
  "act.evolve.pp",
  "act.evolve.restricted",
  "act.other",
  "act.pp",
  "act.quick",
  "act.adv",
  "act.ub",
  "act.engage",
  "act.bury",
  "act.custom",
  "act.limited",
  "act.cond",
  "act.offField",
  "act.life",
  "spell",
  "modes",
  "modes.fn",
  "tgt.count",
  "tgt.any",
  "tgt.upTo",
  "tgt.cond",
  "earthRite.req",
  "earthRite.opt",
  "play.costFn",
  "play.options",
  "play.optionsRequired",
  "play.cheaper",
  "play.cond",
  "play.fromCemetery",
  "nextPlay",
  "evolve.costFn",
  "cannotAttack.always",
  "cannotAttack.cond",
  "cannotAttackLeader.cond",
  "ignoresWard.always",
  "ignoresWard.cond",
  "entersEngaged",
  "noStartRefresh",
  "indestructible.always",
  "indestructible.cond",
  "unbanishable",
  "mustBeSelected",
  "alsoNames",
  "typeWhile",
  "fp.costOf",
  "fp.keywordsFor",
  "fp.damage",
  "fp.grants",
  "fp.attackRules",
  "fp.cantLose",
  "fp.forbidsDraw",
  "fp.unlimitedEvolve",
  "fp.other",
  "ex.keywordsFor",
  "equip.keywords",
  "equip.abilities",
  "script.none",
];

/** The columns, in order: version 1's, then the ones version 2 adds. */
export const CARD_FEATURE_COLUMNS: readonly string[] = [...CARD_FEATURE_COLUMNS_V1];

/** Encoder v1's columns pooled over a zone's cards (class and universe are the leader's and the side's, not each card's): 108. */
export const POOLED_COLUMNS: readonly string[] = CARD_FEATURE_COLUMNS_V1.filter((c) => !c.startsWith("cls.") && !c.startsWith("uni."));

/** A short row for the zones read only in summary (cemetery, banished, equipment, a revealed hand): 40. */
export const BRIEF_COLUMNS: readonly string[] = [
  ...["follower", "amulet", "spell", "crest", "equipment"].map((t) => `type.${t}`),
  "cost",
  "cost.le1",
  "cost.2",
  "cost.3",
  "cost.4",
  "cost.5",
  "cost.6",
  "cost.ge7",
  "atk",
  "def",
  "evolved",
  "advanced",
  "token",
  ...KEYWORDS.map((k) => `kw.${k}`),
  "auto.fanfare",
  "auto.lastWords",
  "auto.onEvolve",
  "auto.strike",
  "auto.other",
  "act.other",
  "act.offField",
  "spell",
  "play.fromCemetery",
  "equip.keywords",
  "equip.abilities",
  "script.none",
];

/**
 * Every key of a script's objects the table reads, and the ones it leaves out on purpose (deck building, code, labels):
 * a script field it doesn't know fails a test, so a new kind of field gets a column or a written reason.
 */
export const KNOWN_SCRIPT_KEYS = {
  script: [
    "keywords",
    "selfKeywords",
    "typeWhile",
    "abilities",
    "playCost",
    "playOptions",
    "playOptionsRequired",
    "field",
    "exPassives",
    "cannotAttack",
    "alsoNames",
    "mustBeSelected",
    "cannotAttackLeader",
    "cannotBeDestroyedByAbilities",
    "cannotBeBanishedByAbilities",
    "playableIf",
    "playableFromCemetery",
    "evolveCostChange",
    "entersEngaged",
    "noStartPhaseRefresh",
    "ignoresWard",
    "nextPlay",
    "equipment",
  ],
  field: ["playCostOf", "keywordsFor", "grantsFor", "cantLose", "forbidsDraw", "unlimitedEvolve", ...FP_DAMAGE, ...FP_ATTACK, ...FP_OTHER],
  exPassives: ["keywordsFor"],
  ability: ["kind", "timing", "validIn", "evolve", "evolveNameIncludes", "evolveInto", "quick", "advanced", "unionBurst", "cost", "oncePerTurn", "timesPerTurn", "condition", "triggerIf", "earthRite", "modes", "modeCount", "targets"],
  cost: ["playPoints", "engageSelf", "custom", "leaderDefense", "burySelf"],
  target: ["count", "upTo", "when"],
  mode: ["targets", "earthRite"],
  playOption: ["setCost", "costDelta", "earthRite"],
  equipment: ["keywords", "abilities"],
  /** Read for nothing (deck building rules, code that runs, names and labels). */
  ignored: ["deckLimit", "restrictsDeck", "resolve", "trigger", "id", "label", "canPay", "pay", "candidates", "max", "distinct", "distinctNames", "available", "targetFilter", "freesFieldSlots", "delayed", "mode", "count", "cost"],
} as const;

const COLUMN_INDEX = new Map(CARD_FEATURE_COLUMNS.map((c, i) => [c, i]));

/** A card's row (CARD_FEATURE_COLUMNS order): its definition and its script's declared fields; `script` undefined: none. */
export function cardFeatureRow(def: CardDefinition, script: CardScript | undefined): number[] {
  const row = new Array<number>(CARD_FEATURE_COLUMNS.length).fill(0);
  const add = (column: string, value: number | boolean) => {
    const i = COLUMN_INDEX.get(column);
    if (i === undefined) throw new Error(`no column ${column}`);
    row[i]! += Number(value);
  };
  if (def.type !== "leader") add(`type.${def.type}`, 1);
  add(CLASS_COLUMNS[CARD_CLASSES.indexOf(def.class)]!, 1);
  if (def.universe) add(`uni.${def.universe}`, 1);
  if (def.trigger) add(`trig.${def.trigger}`, 1);
  add("evolved", def.evolved);
  add("advanced", def.advanced === true);
  add("token", def.token);
  add("dfc.front", def.backFace !== undefined);
  add("dfc.back", def.frontFace !== undefined);
  if (def.cost === null) add("cost.null", 1);
  else {
    add("cost", def.cost);
    add(def.cost <= 1 ? "cost.le1" : def.cost >= 7 ? "cost.ge7" : `cost.${def.cost}`, 1);
  }
  add("atk", def.attack ?? 0);
  add("def", def.defense ?? 0);
  if (!script) {
    add("script.none", 1);
    return row.map((v) => Math.min(v, 2047));
  }
  const keywords: readonly string[] = script.keywords ?? [];
  for (const k of KEYWORDS) add(`kw.${k}`, keywords.includes(k));
  add("kw.driveChecks", keywords.includes("twinDrive") ? 2 : keywords.includes("singleDrive") ? 1 : 0);
  add("kw.selfCond", typeof script.selfKeywords === "function");
  let evolvePp = Infinity;
  let otherPp = Infinity;
  for (const a of (script.abilities ?? []) as readonly AbilityDef[]) {
    const limited = "oncePerTurn" in a && (a.oncePerTurn === true || (a.timesPerTurn ?? 0) > 0);
    const offField = "validIn" in a && (a.validIn ?? []).some((z) => z !== "field");
    if (a.kind === "automatic") {
      add(`auto.${(TIMINGS as readonly string[]).includes(a.timing) ? a.timing : "other"}`, 1);
      add("auto.cost", a.cost !== undefined);
      add("auto.limited", limited);
      add("auto.cond", a.condition !== undefined || a.triggerIf !== undefined);
      add("auto.ub", a.unionBurst === true);
      add("auto.offField", offField);
    } else if (a.kind === "activated") {
      if (a.evolve) {
        add("act.evolve", 1);
        evolvePp = Math.min(evolvePp, a.cost.playPoints ?? 0);
        add("act.evolve.restricted", a.evolveNameIncludes !== undefined || a.evolveInto !== undefined);
      } else {
        add("act.other", 1);
        otherPp = Math.min(otherPp, a.cost.playPoints ?? 0);
        add("act.quick", a.quick === true);
        add("act.adv", a.advanced === true);
        add("act.ub", a.unionBurst === true);
        add("act.engage", a.cost.engageSelf === true);
        add("act.bury", a.cost.burySelf === true);
        add("act.custom", a.cost.custom !== undefined);
        add("act.limited", limited);
        add("act.cond", a.condition !== undefined);
        add("act.offField", offField);
        add("act.life", a.cost.leaderDefense ?? 0);
      }
    } else add("spell", 1);
    const modes = a.modes ?? [];
    add("modes", modes.length);
    add("modes.fn", a.modeCount !== undefined);
    for (const t of [...(a.targets ?? []), ...modes.flatMap((m) => m.targets ?? [])]) {
      if (Number.isFinite(t.count) && t.count <= 9) add("tgt.count", t.count);
      else add("tgt.any", 1);
      add("tgt.upTo", t.upTo === true);
      add("tgt.cond", t.when !== undefined);
    }
    if (a.earthRite?.mode === "required") add("earthRite.req", 1);
    if (a.earthRite?.mode === "optional" || modes.some((m) => m.earthRite)) add("earthRite.opt", 1);
  }
  if (evolvePp < Infinity) add("act.evolve.pp", evolvePp);
  if (otherPp < Infinity) add("act.pp", otherPp);
  const options = script.playOptions ?? [];
  add("play.costFn", typeof script.playCost === "function");
  add("play.options", options.length);
  add("play.optionsRequired", script.playOptionsRequired === true);
  add("play.cheaper", Math.min(15, Math.max(0, ...options.map((o) => (o.setCost !== undefined ? 1 : Math.max(0, -(o.costDelta ?? 0)))))));
  if (options.some((o) => o.earthRite)) add("earthRite.opt", 1);
  add("play.cond", typeof script.playableIf === "function");
  add("play.fromCemetery", typeof script.playableFromCemetery === "function");
  add("nextPlay", Object.keys(script.nextPlay ?? {}).length);
  add("evolve.costFn", typeof script.evolveCostChange === "function");
  add("cannotAttack.always", script.cannotAttack === true);
  add("cannotAttack.cond", typeof script.cannotAttack === "function");
  add("cannotAttackLeader.cond", typeof script.cannotAttackLeader === "function");
  add("ignoresWard.always", script.ignoresWard === true);
  add("ignoresWard.cond", typeof script.ignoresWard === "function");
  add("entersEngaged", script.entersEngaged === true);
  add("noStartRefresh", script.noStartPhaseRefresh === true);
  add("indestructible.always", script.cannotBeDestroyedByAbilities === true);
  add("indestructible.cond", typeof script.cannotBeDestroyedByAbilities === "function");
  add("unbanishable", script.cannotBeBanishedByAbilities === true);
  add("mustBeSelected", script.mustBeSelected === true);
  add("alsoNames", script.alsoNames?.length ?? 0);
  add("typeWhile", typeof script.typeWhile === "function");
  const field = (script.field ?? {}) as Record<string, unknown>;
  const has = (k: string) => field[k] !== undefined && field[k] !== false;
  add("fp.costOf", has("playCostOf"));
  add("fp.keywordsFor", has("keywordsFor"));
  add("fp.damage", FP_DAMAGE.filter(has).length);
  add("fp.grants", has("grantsFor"));
  add("fp.attackRules", FP_ATTACK.filter(has).length);
  add("fp.cantLose", has("cantLose"));
  add("fp.forbidsDraw", has("forbidsDraw"));
  add("fp.unlimitedEvolve", has("unlimitedEvolve"));
  add("fp.other", FP_OTHER.filter(has).length);
  add("ex.keywordsFor", script.exPassives?.keywordsFor !== undefined);
  add("equip.keywords", script.equipment?.keywords?.length ?? 0);
  add("equip.abilities", script.equipment?.abilities?.length ?? 0);
  return row.map((v) => Math.min(v, 2047));
}

/** The table as card-features.json keeps it: sparse rows ([column, value] pairs of the nonzero values) by definition. */
export interface CardFeatureFile {
  format: "sve-card-features";
  version: number;
  columns: string[];
  /** sha256 of the version and the columns (first 16 hex digits), and of the rows: written by the tools, compared as text. */
  columnsHash: string;
  hash: string;
  /** The rules code the rows were made from (the core's fingerprint). */
  rulesFingerprint: string;
  /** A double-faced card's back face (CR 2.14), by front. */
  backFace: Record<DefId, DefId>;
  /** Every trait of the definitions (CR 2.4: the Japanese strings, the only trait identity), sorted. */
  traits: string[];
  /** A definition's traits, as indices into `traits` (definitions without traits are left out). */
  cardTraits: Record<DefId, number[]>;
  /**
   * The evolved cards that can evolve a follower (CR 5.16.1.1.1 / 12.2.2: the same name, or what its evolve ability says:
   * "with [text] in its name", "into X or Y"; either face of a double-faced card, 4.6.4), by the follower's definition. From
   * the printed names: an effect that renames a card on the field is not seen here.
   */
  evolvePartners: Record<DefId, DefId[]>;
  rows: Record<DefId, [number, number][]>;
}

/** The table, read for use: a definition's dense row (a zero row and `known` false for one it doesn't have). */
export interface CardFeatureTable {
  readonly file: CardFeatureFile;
  row(def: DefId): Int16Array;
  known(def: DefId): boolean;
  /** Its traits (indices into file.traits). */
  traitsOf(def: DefId): readonly number[];
  /** The evolved cards that can evolve it (none for a card that isn't a follower). */
  partnersOf(def: DefId): readonly DefId[];
}

/** Reads a card-features.json (its version and columns must be these). Rows are expanded once, when first asked for. */
export function cardFeatureTable(file: CardFeatureFile): CardFeatureTable {
  if (file.format !== "sve-card-features" || file.version !== CARD_FEATURES_VERSION || file.columns.join("|") !== CARD_FEATURE_COLUMNS.join("|")) {
    throw new Error(`card-features.json is version ${file.version} with other columns: this code reads version ${CARD_FEATURES_VERSION} (npm run rl:features)`);
  }
  const dense = new Map<DefId, Int16Array>();
  const zero = new Int16Array(CARD_FEATURE_COLUMNS.length);
  const none: readonly never[] = [];
  return {
    file,
    known: (def) => file.rows[def] !== undefined,
    traitsOf: (def) => file.cardTraits[def] ?? none,
    partnersOf: (def) => file.evolvePartners[def] ?? none,
    row(def) {
      let r = dense.get(def);
      if (!r) {
        const sparse = file.rows[def];
        if (!sparse) return zero;
        r = new Int16Array(CARD_FEATURE_COLUMNS.length);
        for (const [i, v] of sparse) r[i] = v;
        dense.set(def, r);
      }
      return r;
    },
  };
}

/**
 * The table of every definition (and the back faces): what npm run rl:features writes and the drift test rebuilds. `sha256`
 * gives a text's hash in hex (the tools pass node's; the bot itself never hashes).
 */
export function buildCardFeatureFile(
  definitions: readonly CardDefinition[],
  scripts: Readonly<Record<DefId, CardScript>>,
  rulesFingerprint: string,
  sha256: (text: string) => string,
): CardFeatureFile {
  const ids = definitions.map((d) => d.id).sort();
  const byId = new Map(definitions.map((d) => [d.id, d]));
  const rows: Record<DefId, [number, number][]> = {};
  const backFace: Record<DefId, DefId> = {};
  for (const id of ids) {
    const def = byId.get(id)!;
    rows[id] = cardFeatureRow(def, scripts[id]).flatMap((v, i) => (v !== 0 ? [[i, v] as [number, number]] : []));
    if (def.backFace) backFace[id] = def.backFace;
  }
  const traits = [...new Set(definitions.flatMap((d) => d.traits))].sort();
  const traitIndex = new Map(traits.map((t, i) => [t, i]));
  const cardTraits: Record<DefId, number[]> = {};
  for (const id of ids) {
    const own = [...new Set(byId.get(id)!.traits)].map((t) => traitIndex.get(t)!).sort((a, b) => a - b);
    if (own.length > 0) cardTraits[id] = own;
  }
  const evolvePartners = partnersByFollower(definitions, scripts);
  const rowText = [
    ...ids.map((id) => `${id}:${rows[id]!.map(([i, v]) => `${i}=${v}`).join(",")}`),
    `traits:${traits.join(",")}`,
    ...Object.keys(cardTraits).sort().map((id) => `t:${id}:${cardTraits[id]!.join(",")}`),
    ...Object.keys(evolvePartners).sort().map((id) => `e:${id}:${evolvePartners[id]!.join(",")}`),
  ].join("\n");
  return {
    format: "sve-card-features",
    version: CARD_FEATURES_VERSION,
    columns: [...CARD_FEATURE_COLUMNS],
    columnsHash: sha256(`${CARD_FEATURES_VERSION}|${CARD_FEATURE_COLUMNS.join("|")}`).slice(0, 16),
    hash: sha256(rowText).slice(0, 16),
    rulesFingerprint,
    backFace,
    traits,
    cardTraits,
    evolvePartners,
    rows,
  };
}

/**
 * Every follower's evolve cards (CardFeatureFile.evolvePartners), as Core's correspondingEvolveCards finds them on the field
 * (engine/abilities/evolve.ts; CR 5.16.1.1.1, 4.6.4) but from printed names: evolved cards with its name, plus for each of its
 * evolve abilities the cards that ability names ("with [text] in its name", "into X or Y").
 */
function partnersByFollower(definitions: readonly CardDefinition[], scripts: Readonly<Record<DefId, CardScript>>): Record<DefId, DefId[]> {
  const byId = new Map(definitions.map((d) => [d.id, d]));
  // An evolved card answers to its own name and, double-faced, to its back face's (CR 4.6.4).
  const evolved = definitions
    .filter((d) => d.evolved && d.frontFace === undefined)
    .map((d) => ({ id: d.id, names: [d.name, ...(d.backFace !== undefined && byId.has(d.backFace) ? [byId.get(d.backFace)!.name] : [])] }));
  const out: Record<DefId, DefId[]> = {};
  for (const d of definitions) {
    if (d.type !== "follower" || d.evolved) continue;
    const matches: ((name: string) => boolean)[] = [(name) => name === d.name];
    for (const a of (scripts[d.id]?.abilities ?? []) as readonly AbilityDef[]) {
      if (a.kind !== "activated" || !a.evolve) continue;
      const includes = a.evolveNameIncludes;
      const into = a.evolveInto;
      if (into !== undefined) matches.push((name) => into.includes(name));
      else if (includes !== undefined) matches.push((name) => name.includes(includes));
    }
    const partners = evolved.filter((e) => e.names.some((n) => matches.some((m) => m(n)))).map((e) => e.id);
    if (partners.length > 0) out[d.id] = partners.sort();
  }
  return out;
}

/** The file's text: one definition a line, so a change of a card shows as a change of its line. */
export function cardFeatureFileText(file: CardFeatureFile): string {
  const head = {
    format: file.format,
    version: file.version,
    columns: file.columns,
    columnsHash: file.columnsHash,
    hash: file.hash,
    rulesFingerprint: file.rulesFingerprint,
    backFace: file.backFace,
    traits: file.traits,
  };
  const lines = (record: Record<string, unknown>) =>
    Object.keys(record)
      .sort()
      .map((id) => `  ${JSON.stringify(id)}: ${JSON.stringify(record[id])}`)
      .join(",\n");
  return `${JSON.stringify(head).slice(0, -1)},\n "cardTraits": {\n${lines(file.cardTraits)}\n },\n "evolvePartners": {\n${lines(file.evolvePartners)}\n },\n "rows": {\n${lines(file.rows)}\n }\n}\n`;
}
