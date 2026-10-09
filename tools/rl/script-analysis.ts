// What a card's script counts and what its effects do, read from the script's code (card feature table v2; tools only).
//
// "What it counts": the places where an ability's code (a condition, a target's max, a resolve body, a passive) reads how
// many cards of some kind are in some zone of some player — e.g. BP11-058's fanfare banishes up to as many enemy followers as
// there are "Dragoncraft cards costing 7 or more" in its controller's cemetery; CP02-064's fanfare needs "3 iM@S CG followers on
// your field". Each such place is a reference (RefSite): the zones, whose (the card's controller's or the opponent's), the
// filter on the cards (type, trait, class, name, printed cost, evolved...), whether it is compared with a number (a threshold)
// or used as a quantity (scaled), and the timing of the ability it belongs to. The code is evaluated symbolically: the reader's
// zone reads (g.cards, g.followers), .filter / .some / .length, the filter helpers of script/targets.ts and every helper of the
// script files, followed through imports. What it can't read becomes an "other" atom: the reference is then marked partial.
// Engine code is not read.
//
// "What its effects do": the fx.<method> call sites of the card's code and the script helpers it uses, by family (fx-families.ts).
import type { AbilityDef, CardScript } from "../../packages/core/src";
import { FAMILY_OF, FX_FAMILY_NAMES, type FxFamily } from "./fx-families";
import { moduleOf, resolveName, scriptFiles, walk, type Module, type Node } from "./script-source";

export type Zone = "field" | "cemetery" | "hand" | "deck" | "ex" | "evolveDeck" | "banished" | "evolveZone" | "leader" | "other";
export type Side = "own" | "opp" | "both" | "?";
export type Atom =
  | { t: "type"; v: string }
  | { t: "trait"; v: string }
  | { t: "class"; v: string }
  | { t: "name"; v: string }
  | { t: "nameIncludes"; v: string }
  | { t: "costMin"; v: number }
  | { t: "costMax"; v: number }
  | { t: "atkMin"; v: number }
  | { t: "atkMax"; v: number }
  | { t: "defMin"; v: number }
  | { t: "defMax"; v: number }
  | { t: "evolved" }
  | { t: "unevolved" }
  | { t: "token" }
  | { t: "notSelf" }
  | { t: "racing" }
  | { t: "engaged" }
  | { t: "any" }
  | { t: "other"; why: string };
export type FilterNode = Atom | { t: "and"; args: FilterNode[] } | { t: "or"; args: FilterNode[] } | { t: "not"; arg: FilterNode };

export type Timing = "fanfare" | "lastWords" | "onEvolve" | "strike" | "turnStart" | "turnEnd" | "otherTrigger" | "activated" | "evolve" | "spell" | "continuous" | "fromHand";

export interface RefSite {
  timing: Timing;
  /** The ability it belongs to (index into the script's abilities), or -1 for a script field (a passive, a play condition). */
  ability: number;
  /** Where in the ability: a closure's property (condition, max, triggerIf...), "resolve", or a script field. */
  where: string;
  zones: Zone[];
  side: Side;
  filter: FilterNode;
  /** A number of cards, or whether there is one. */
  agg: "count" | "exists";
  threshold: { op: ">=" | ">" | "<=" | "<" | "==="; n: number } | null;
  /** The number is used as a quantity (a target's max, an effect's amount, a loop). */
  scaled: boolean;
  /** Only the top N cards of the deck are looked at (CR 5.11). */
  top?: number;
  /** The cards must have different names (a target's "with different names"). */
  distinct?: true;
}

export interface CardAnalysis {
  fx: Record<FxFamily, number>;
  /** The amounts its effects give, where the code writes them as numbers (damage, cards drawn, attack and defense...). */
  amounts: Record<AmountKind, number>;
  /** fx methods the families don't know (the table test fails on any). */
  unknownFx: string[];
  refs: RefSite[];
  /**
   * Conditions on one game number the reader computes (CR 13.2–13.5 keyword conditions): the largest number they ask for
   * (Combo 3 → 3; Overflow and Sanguine, which ask for none → 1); 0 when not used.
   */
  conds: Record<"overflow" | "necrocharge" | "spellchain" | "combo" | "sanguine", number>;
}

export const AMOUNT_KINDS = ["dmg", "aoe", "stats", "debuff", "heal", "draw", "mill", "ex", "summon", "pp"] as const;
export type AmountKind = (typeof AMOUNT_KINDS)[number];

// ---- Symbolic values ----

type CardRef = "it" | "self" | "other";
type V =
  | { k: "reader" }
  | { k: "fx" }
  | { k: "side"; v: Side }
  | { k: "card"; v: CardRef; from?: Extract<V, { k: "list" }> }
  | { k: "list"; zones: Zone[]; side: Side; filter: FilterNode; top?: number; each?: true }
  | { k: "count"; site: RefSite }
  | { k: "exists"; site: RefSite }
  | { k: "cond" }
  | { k: "pred"; f: FilterNode }
  | { k: "info"; of: CardRef; from?: Extract<V, { k: "list" }> }
  | { k: "inst"; of: CardRef }
  | { k: "instDef"; of: CardRef }
  | { k: "db" }
  | { k: "prop"; of: CardRef; path: string[]; from?: Extract<V, { k: "list" }> }
  | { k: "fn"; params: Node[]; body: Node; module: Module; env: Env }
  | { k: "filterFn"; f: FilterNode }
  | { k: "num"; v: number }
  | { k: "str"; v: string }
  | { k: "bool"; v: boolean }
  | { k: "obj"; props: Map<string, V> }
  | { k: "arr"; items: V[] }
  | { k: "external"; name: string }
  | { k: "gauge"; name: "combo" }
  | { k: "unknown" };

const UNKNOWN: V = { k: "unknown" };
const ANY: FilterNode = { t: "any" };

class Env {
  private readonly vars = new Map<string, V>();
  constructor(readonly parent: Env | null = null) {}
  get(name: string): V | undefined {
    return this.vars.get(name) ?? this.parent?.get(name);
  }
  set(name: string, v: V): void {
    this.vars.set(name, v);
  }
}

const and = (...fs: FilterNode[]): FilterNode => {
  const args = fs.flatMap((f) => (f.t === "and" ? f.args : f.t === "any" ? [] : [f]));
  return args.length === 0 ? ANY : args.length === 1 ? args[0]! : { t: "and", args };
};
const or = (...fs: FilterNode[]): FilterNode => (fs.some((f) => f.t === "any") ? ANY : fs.length === 1 ? fs[0]! : { t: "or", args: fs });
const flip = (s: Side): Side => (s === "own" ? "opp" : s === "opp" ? "own" : s);

/** The script's filter primitives (script/targets.ts), read by name: their code is plain but uses rest parameters. */
const TYPE_FILTERS: Record<string, FilterNode> = {
  isFollower: { t: "type", v: "follower" },
  isAmulet: { t: "type", v: "amulet" },
  isSpell: { t: "type", v: "spell" },
  isCrest: { t: "type", v: "crest" },
  isToken: { t: "token" },
  isEvolved: { t: "evolved" },
  isUnevolved: { t: "unevolved" },
  isEvolvedFollower: { t: "and", args: [{ t: "type", v: "follower" }, { t: "evolved" }] },
};

/** The analysis of one card: its references and fx sites, gathered while its code is evaluated. */
class Analyzer {
  refs: RefSite[] = [];
  conds = { overflow: 0, necrocharge: 0, spellchain: 0, combo: 0, sanguine: 0 };
  timing: Timing = "otherTrigger";
  ability = -1;
  where = "";
  /** The candidates of the targets of the object being read (fx.targets[i] are chosen among targetLists[i]). */
  targetLists: (Extract<V, { k: "list" }> | null)[] = [];
  /** While reading a passive about some card ("it"): the tests on it that decide what it gets. */
  capture: FilterNode[] | null = null;
  /** While reading the test of an early exit ("if (cost < 5) return;"): a condition on a chosen card is the opposite. */
  private negate = false;
  private depth = 0;
  private readonly declCache = new Map<string, V>();

  private site(list: Extract<V, { k: "list" }>, agg: "count" | "exists"): RefSite {
    const s: RefSite = { timing: this.timing, ability: this.ability, where: this.where, zones: list.zones, side: list.side, filter: list.filter, agg, threshold: null, scaled: false };
    if (list.top !== undefined && list.top > 0) s.top = list.top;
    this.refs.push(s);
    return s;
  }

  /** A filter function's meaning: applied to a card ("it") with the reader. */
  predicate(v: V): FilterNode {
    if (v.k === "filterFn") return v.f;
    if (v.k === "fn") {
      // A filter helper takes (game, card); a callback of .filter / .some takes (card).
      const r = this.apply(v, v.params.length >= 2 ? [{ k: "reader" }, { k: "card", v: "it" }] : [{ k: "card", v: "it" }]);
      return this.asFilter(r);
    }
    if (v.k === "bool") return v.v ? ANY : { t: "other", why: "false" };
    return { t: "other", why: `filter ${v.k}` };
  }

  private asFilter(v: V): FilterNode {
    v = this.asPred(v);
    if (v.k === "pred") return v.f;
    if (v.k === "filterFn") return v.f;
    if (v.k === "bool") return v.v ? ANY : { t: "other", why: "false" };
    return { t: "other", why: `predicate ${v.k}` };
  }

  /** Calls a function value with these arguments. */
  apply(fn: V, args: V[]): V {
    if (fn.k === "filterFn") {
      // f(g, id): the filter applied to a card.
      const card = args[1];
      if (card?.k === "card" && card.v === "it") return { k: "pred", f: fn.f };
      if (card?.k === "card" && card.from) this.targetCondition(card.from, fn.f);
      return { k: "cond" };
    }
    if (fn.k !== "fn") return UNKNOWN;
    if (this.depth > 40) return UNKNOWN;
    this.depth += 1;
    const savedNegate = this.negate;
    this.negate = false;
    try {
      const env = new Env(fn.env);
      fn.params.forEach((p, i) => this.bind(p, args[i] ?? UNKNOWN, env, fn.module, args.slice(i)));
      if (fn.body.type === "BlockStatement") return this.block(fn.body, env, fn.module) ?? UNKNOWN;
      return this.eval(fn.body, env, fn.module);
    } finally {
      this.depth -= 1;
      this.negate = savedNegate;
    }
  }

  private bind(param: Node, v: V, env: Env, module: Module, rest: V[]): void {
    if (param.type === "Identifier") env.set(param.name as string, v);
    else if (param.type === "AssignmentPattern") this.bind(param.left as Node, v.k === "unknown" ? this.eval(param.right as Node, env, module) : v, env, module, rest);
    else if (param.type === "RestElement") this.bind(param.argument as Node, { k: "arr", items: rest }, env, module, []);
    else if (param.type === "ArrayPattern" && v.k === "arr") (param.elements as (Node | null)[]).forEach((e, i) => e && this.bind(e, v.items[i] ?? v.items[0] ?? UNKNOWN, env, module, []));
    else if (param.type === "ObjectPattern" && (v.k === "info" || v.k === "prop")) {
      for (const p of param.properties as Node[]) {
        if (p.type !== "Property") continue;
        const key = ((p.key as Node).name ?? (p.key as Node).value) as string;
        this.bind(p.value as Node, { k: "prop", of: v.of, path: [...(v.k === "prop" ? v.path : []), key] }, env, module, []);
      }
    } else if (param.type === "ObjectPattern" && v.k === "obj") {
      for (const p of param.properties as Node[]) {
        if (p.type !== "Property") continue;
        const key = ((p.key as Node).name ?? (p.key as Node).value) as string;
        this.bind(p.value as Node, v.props.get(key) ?? UNKNOWN, env, module, []);
      }
    } else walk(param, (n) => {
        if (n.type === "Identifier") env.set(n.name as string, UNKNOWN);
      });
  }

  /** A helper's parameters bound to its arguments (defaults included). */
  bindParams(params: Node[], args: V[], env: Env, module: Module): void {
    params.forEach((p, i) => this.bind(p, args[i] ?? UNKNOWN, env, module, args.slice(i)));
  }

  /** A value used as a test (if, ?:): "is there such a card" needs one. */
  private truthy(v: V): void {
    if ((v.k === "exists" || v.k === "count")) this.threshold(v, ">=", 1);
  }

  /** A declaration statement, bound into `env`. */
  declare(stmt: Node, env: Env, module: Module): void {
    this.statement(stmt, env, module);
  }

  /** A block's statements; the value of its first return that gives something. */
  block(node: Node, env: Env, module: Module): V | null {
    let result: V | null = null;
    // A predicate's guards ("if (id === self) return false;"): what is left must not match them.
    const guards: FilterNode[] = [];
    for (const stmt of (node.body as Node[]) ?? []) {
      if (!result && stmt.type === "IfStatement" && !stmt.alternate && returnsFalse(stmt.consequent as Node)) {
        const t = this.eval(stmt.test as Node, env, module);
        if (t.k === "pred") {
          guards.push(t.f.t === "not" ? t.f.arg : { t: "not", arg: t.f });
          continue;
        }
      }
      const r = this.statement(stmt, env, module);
      if (r && !result) result = r;
    }
    if (guards.length > 0 && result && !(result.k === "bool" && !result.v)) return { k: "pred", f: and(...guards, this.asFilter(this.asPred(result))) };
    return result;
  }

  private statement(stmt: Node, env: Env, module: Module): V | null {
    switch (stmt.type) {
      case "VariableDeclaration":
        for (const d of stmt.declarations as Node[]) {
          const v = d.init ? this.eval(d.init as Node, env, module) : UNKNOWN;
          this.bind(d.id as Node, v, env, module, []);
        }
        return null;
      case "ExpressionStatement":
        this.eval(stmt.expression as Node, env, module);
        return null;
      case "ReturnStatement":
        return stmt.argument ? this.eval(stmt.argument as Node, env, module) : null;
      case "IfStatement": {
        const exit = isBareReturn(stmt.consequent as Node) && !stmt.alternate;
        const savedNegate = this.negate;
        if (exit) this.negate = !this.negate;
        const test = this.asPred(this.eval(stmt.test as Node, env, module));
        this.negate = savedNegate;
        this.truthy(test);
        // "if (!isFairy(g, card)) return []": the guard's own filter is what the card must be.
        if (this.capture && test.k === "pred") this.capture.push(test.f.t === "not" ? test.f.arg : test.f);
        const a = this.statement(stmt.consequent as Node, new Env(env), module);
        const b = stmt.alternate ? this.statement(stmt.alternate as Node, new Env(env), module) : null;
        return a ?? b;
      }
      case "BlockStatement":
        return this.block(stmt, new Env(env), module);
      case "ForStatement": {
        const inner = new Env(env);
        if (stmt.init) (stmt.init as Node).type === "VariableDeclaration" ? this.statement(stmt.init as Node, inner, module) : this.eval(stmt.init as Node, inner, module);
        if (stmt.test) this.scale(this.eval(stmt.test as Node, inner, module));
        return this.statement(stmt.body as Node, inner, module);
      }
      case "ForOfStatement":
      case "ForInStatement": {
        const inner = new Env(env);
        const over = this.eval(stmt.right as Node, inner, module);
        // An effect for each card of a zone that matches (CR: "for each"): the number of them is a quantity.
        // A loop inside a cost (matching the cards to pay with) is not an effect "for each".
        const each = over.k === "list" && over.top === undefined && this.where !== "pay" && this.where !== "canPay";
        if (each && meaningful(over.filter)) {
          const site = this.site(over, "count");
          site.scaled = true;
          site.where = "each";
        }
        // The loop variable: each card of the list (a test on it inside the loop is a filter of that list).
        const card: V = each ? { k: "card", v: "other", from: { ...over, each: true } } : { k: "card", v: "other" };
        const left = stmt.left as Node;
        walk(left, (n) => {
          if (n.type === "Identifier") inner.set(n.name as string, card);
        });
        return this.statement(stmt.body as Node, inner, module);
      }
      case "WhileStatement":
      case "DoWhileStatement":
        this.eval(stmt.test as Node, env, module);
        return this.statement(stmt.body as Node, new Env(env), module);
      case "SwitchStatement":
        this.eval(stmt.discriminant as Node, env, module);
        for (const c of stmt.cases as Node[]) for (const s of c.consequent as Node[]) this.statement(s, new Env(env), module);
        return null;
      case "TryStatement":
        return this.block(stmt.block as Node, new Env(env), module);
      case "FunctionDeclaration":
        if (stmt.id) env.set((stmt.id as Node).name as string, { k: "fn", params: stmt.params as Node[], body: stmt.body as Node, module, env });
        return null;
      default:
        return null;
    }
  }

  /** "Is there such a card": a reference that needs at least one. */
  recordList(list: Extract<V, { k: "list" }>, where: string): void {
    const saved = this.where;
    this.where = where;
    const s = this.site(list, "exists");
    s.threshold = { op: ">=", n: 1 };
    this.where = saved;
  }

  /**
   * A condition on a chosen card ("if it's a Wyrmkin follower"): is there such a card among its candidates. On each card of a
   * zone (a loop: "give each Pixie token on your field +1/+1"): how many such cards, a quantity.
   */
  targetCondition(list: Extract<V, { k: "list" }>, f: FilterNode): void {
    if (!meaningful(f)) return;
    if (list.each) {
      const saved = this.where;
      this.where = "each";
      const site = this.site({ k: "list", zones: list.zones, side: list.side, filter: and(list.filter, f) }, "count");
      site.scaled = true;
      this.where = saved;
      return;
    }
    this.recordList({ k: "list", zones: list.zones, side: list.side, filter: and(list.filter, f), ...(list.top ? { top: list.top } : {}) }, list.top ? "topCard" : "targetCondition");
  }

  /** A card's information read as a filter atom: a predicate on the card being filtered, or a condition on a chosen card. */
  private onCard(of: CardRef, from: Extract<V, { k: "list" }> | undefined, f: FilterNode): V {
    if (of === "it") return { k: "pred", f };
    if (from) this.targetCondition(from, f);
    return { k: "cond" };
  }

  /**
   * A target of script/targets.ts (enemyFollower({...}), inYourZone("cemetery", {...})): its candidates, as a reference when
   * they say more than "a follower on the field" (another zone, or a trait, class, name or cost). They are also kept for the
   * body's conditions on the chosen cards.
   */
  targetSite(helper: V, args: V[]): void {
    const spec = this.apply(helper, args);
    const candidates = spec.k === "obj" ? spec.props.get("candidates") : undefined;
    const list = candidates?.k === "fn" ? this.apply(candidates, [{ k: "reader" }, { k: "side", v: "own" }, { k: "card", v: "self" }]) : UNKNOWN;
    this.targetLists.push(list.k === "list" ? list : null);
    if (list.k !== "list") return;
    this.recordList(list, "target");
    if (spec.k === "obj" && ((spec.props.get("distinctNames") as V | undefined)?.k === "bool" || args.some((a) => a.k === "obj" && a.props.get("distinctNames")?.k === "bool"))) {
      const last = this.refs[this.refs.length - 1];
      if (last) last.distinct = true;
    }
  }

  /** Which of the controller's cards a passive or a trigger is about ("each other Fairy follower gets Rush"): how many there are. */
  recordAffected(f: FilterNode, zones: Zone[], where: string): void {
    if (!meaningful(f)) return;
    const saved = this.where;
    this.where = where;
    this.site({ k: "list", zones, side: "own", filter: f }, "count");
    this.where = saved;
  }

  /** A count used as a quantity. */
  private scale(v: V): void {
    if (v.k === "count") v.site.scaled = true;
  }

  /** A closure's result used as a quantity (a target's max, a cost). */
  scaleValue(v: V): void {
    this.scale(v);
  }

  /** A closure that answers whether there is such a card: at least 1. */
  thresholdOf(v: V): void {
    this.threshold(v, ">=", 1);
  }

  private nameOf(module: Module, name: string, env: Env): V {
    const local = env.get(name);
    if (local) return local;
    if (TYPE_FILTERS[name] && resolveName(module, name).kind === "decl") return { k: "filterFn", f: TYPE_FILTERS[name]! };
    const r = resolveName(module, name);
    if (r.kind === "external") {
      if (name === "Infinity") return { k: "num", v: Infinity };
      return { k: "external", name: r.name };
    }
    if (r.kind === "unknown") return name === "Infinity" ? { k: "num", v: Infinity } : name === "undefined" ? UNKNOWN : UNKNOWN;
    const key = `${r.module.file}#${r.name}`;
    const cached = this.declCache.get(key);
    if (cached) return cached;
    const node = r.node;
    let v: V;
    if (node.type === "FunctionDeclaration" || node.type === "ArrowFunctionExpression" || node.type === "FunctionExpression") {
      v = { k: "fn", params: node.params as Node[], body: node.body as Node, module: r.module, env: new Env() };
    } else {
      this.declCache.set(key, UNKNOWN); // recursion guard
      // A constant's value (e.g. const bigDragon = and(isClass("Dragoncraft"), costAtLeast(7))). Its sites belong to whoever uses it.
      const saved = this.refs.length;
      v = this.eval(node, new Env(), r.module);
      this.refs.length = saved;
    }
    this.declCache.set(key, v);
    return v;
  }

  eval(node: Node, env: Env, module: Module): V {
    switch (node.type) {
      case "Literal":
        return typeof node.value === "number" ? { k: "num", v: node.value } : typeof node.value === "string" ? { k: "str", v: node.value } : typeof node.value === "boolean" ? { k: "bool", v: node.value } : UNKNOWN;
      case "TemplateLiteral":
        return (node.expressions as Node[]).length === 0 ? { k: "str", v: ((node.quasis as Node[])[0]!.value as { cooked: string }).cooked } : UNKNOWN;
      case "Identifier":
        return this.nameOf(module, node.name as string, env);
      case "TSAsExpression":
      case "TSNonNullExpression":
      case "TSSatisfiesExpression":
      case "TSTypeAssertion":
      case "ParenthesizedExpression":
      case "ChainExpression":
        return this.eval(node.expression as Node, env, module);
      case "AwaitExpression":
      case "YieldExpression":
        return node.argument ? this.eval(node.argument as Node, env, module) : UNKNOWN;
      case "ArrowFunctionExpression":
      case "FunctionExpression":
        return { k: "fn", params: node.params as Node[], body: node.body as Node, module, env };
      case "ArrayExpression":
        return { k: "arr", items: (node.elements as (Node | null)[]).flatMap((e) => (!e ? [] : e.type === "SpreadElement" ? this.spread(this.eval(e.argument as Node, env, module)) : [this.eval(e, env, module)])) };
      case "ObjectExpression": {
        const props = new Map<string, V>();
        for (const p of node.properties as Node[]) {
          if (p.type === "SpreadElement") {
            const s = this.eval(p.argument as Node, env, module);
            if (s.k === "obj") for (const [k, v] of s.props) props.set(k, v);
            continue;
          }
          const key = ((p.key as Node).name ?? (p.key as Node).value) as string;
          const value = p.value as Node;
          props.set(key, this.eval(value, env, module));
        }
        return { k: "obj", props };
      }
      case "SequenceExpression": {
        let last: V = UNKNOWN;
        for (const e of node.expressions as Node[]) last = this.eval(e, env, module);
        return last;
      }
      case "AssignmentExpression": {
        const v = this.eval(node.right as Node, env, module);
        const left = node.left as Node;
        if (left.type === "Identifier") env.set(left.name as string, v);
        return v;
      }
      case "UpdateExpression":
        return UNKNOWN;
      case "ConditionalExpression": {
        const test = this.asPred(this.eval(node.test as Node, env, module));
        this.truthy(test);
        if (this.capture && test.k === "pred") this.capture.push(test.f);
        const a = this.eval(node.consequent as Node, env, module);
        const b = this.eval(node.alternate as Node, env, module);
        return a.k !== "unknown" ? a : b;
      }
      case "UnaryExpression": {
        const v = this.asPred(this.eval(node.argument as Node, env, module));
        if (node.operator === "!") return v.k === "pred" ? { k: "pred", f: { t: "not", arg: v.f } } : v.k === "exists" ? (this.threshold(v, "<", 1), { k: "cond" }) : { k: "cond" };
        if (node.operator === "-" && v.k === "num") return { k: "num", v: -v.v };
        this.scale(v);
        return UNKNOWN;
      }
      case "LogicalExpression":
        return this.logical(node, env, module);
      case "BinaryExpression":
        return this.binary(node, env, module);
      case "MemberExpression":
        return this.member(node, env, module);
      case "CallExpression":
        return this.call(node, env, module);
      case "NewExpression":
        for (const a of node.arguments as Node[]) this.eval(a, env, module);
        return UNKNOWN;
      default:
        return UNKNOWN;
    }
  }

  private spread(v: V): V[] {
    return v.k === "arr" ? v.items : v.k === "list" ? [v] : [UNKNOWN];
  }

  private threshold(v: V, op: NonNullable<RefSite["threshold"]>["op"], n: number): void {
    if (v.k === "gauge") {
      this.conds[v.name] = Math.max(this.conds[v.name], op === ">" ? n + 1 : n);
      return;
    }
    if (v.k !== "count" && v.k !== "exists") return;
    if (v.site.where === "spellchain" || v.site.where === "necrocharge") this.conds[v.site.where] = Math.max(this.conds[v.site.where], op === ">" ? n + 1 : n);
    if (!v.site.threshold) v.site.threshold = { op, n };
    else if (v.site.threshold.op !== op || v.site.threshold.n !== n) this.refs.push({ ...v.site, threshold: { op, n } });
  }

  /** A card's boolean information used as a test (def.token, info.evolved): a filter atom. */
  private asPred(v: V): V {
    if (v.k !== "prop") return v;
    const last = v.path[v.path.length - 1];
    const atom: FilterNode | null = last === "token" ? { t: "token" } : last === "evolved" ? { t: "evolved" } : last === "engaged" && v.path.length === 1 ? { t: "engaged" } : null;
    if (!atom) return v;
    return v.of === "it" ? { k: "pred", f: atom } : v.from ? this.onCard(v.of, v.from, atom) : v;
  }

  private logical(node: Node, env: Env, module: Module): V {
    const a = this.asPred(this.eval(node.left as Node, env, module));
    const b = this.asPred(this.eval(node.right as Node, env, module));
    if (node.operator === "??" || node.operator === "||") {
      if (a.k === "prop") return a; // (g.info(id).cost ?? 0)
      if (a.k === "pred" && b.k === "pred") return { k: "pred", f: or(a.f, b.f) };
      if (node.operator === "||" && (a.k === "pred" || b.k === "pred") && (a.k === "cond" || a.k === "unknown" || b.k === "cond" || b.k === "unknown")) return a.k === "pred" ? a : b;
      if (a.k === "exists") this.threshold(a, ">=", 1);
      if (b.k === "exists") this.threshold(b, ">=", 1);
      return a.k !== "unknown" ? (a.k === "pred" || a.k === "cond" ? a : a) : b;
    }
    // &&
    if (a.k === "pred" && b.k === "pred") return { k: "pred", f: and(a.f, b.f) };
    if (a.k === "pred" && (b.k === "bool" || b.k === "cond" || b.k === "unknown")) return a;
    if (b.k === "pred" && (a.k === "bool" || a.k === "cond" || a.k === "unknown")) return b;
    if (a.k === "exists") this.threshold(a, ">=", 1);
    if (b.k === "exists") this.threshold(b, ">=", 1);
    return { k: "cond" };
  }

  private binary(node: Node, env: Env, module: Module): V {
    const op = node.operator as string;
    const a = this.eval(node.left as Node, env, module);
    const b = this.eval(node.right as Node, env, module);
    const itAndSelf = (a.k === "card" && a.v === "it" && b.k === "card" && b.v === "self") || (b.k === "card" && b.v === "it" && a.k === "card" && a.v === "self");
    if ((op === "!==" || op === "!=") && itAndSelf) return { k: "pred", f: { t: "notSelf" } };
    if ((op === "===" || op === "==") && itAndSelf) return { k: "pred", f: { t: "not", arg: { t: "notSelf" } } };
    const COMPARE: Record<string, NonNullable<RefSite["threshold"]>["op"]> = { ">=": ">=", ">": ">", "<=": "<=", "<": "<", "===": "===", "==": "===" };
    const MIRROR: Record<string, NonNullable<RefSite["threshold"]>["op"]> = { ">=": "<=", ">": "<", "<=": ">=", "<": ">", "===": "===", "==": "===" };
    if (COMPARE[op]) {
      // A count against a number: a threshold.
      if ((a.k === "count" || a.k === "exists" || a.k === "gauge") && b.k === "num") return this.threshold(a, COMPARE[op]!, b.v), { k: "cond" };
      if ((b.k === "count" || b.k === "exists" || b.k === "gauge") && a.k === "num") return this.threshold(b, MIRROR[op]!, a.v), { k: "cond" };
      // A card's information against a value: a filter atom.
      const prop = a.k === "prop" ? a : b.k === "prop" ? b : null;
      const other = prop === a ? b : a;
      const cmp0 = prop === a ? COMPARE[op]! : MIRROR[op]!;
      const NEG: Record<string, NonNullable<RefSite["threshold"]>["op"]> = { ">=": "<", ">": "<=", "<=": ">", "<": ">=", "===": "===" };
      const cmp = this.negate && prop?.of !== "it" ? NEG[cmp0]! : cmp0;
      if (prop && (prop.of === "it" || prop.from)) {
        const at = (f: FilterNode) => this.onCard(prop.of, prop.from, f);
        const last = prop.path[prop.path.length - 1];
        if (last === "cost" && other.k === "num") {
          if (cmp === ">=") return at({ t: "costMin", v: other.v });
          if (cmp === ">") return at({ t: "costMin", v: other.v + 1 });
          if (cmp === "<=") return at({ t: "costMax", v: other.v });
          if (cmp === "<") return at({ t: "costMax", v: other.v - 1 });
          if (cmp === "===") return at(and({ t: "costMin", v: other.v }, { t: "costMax", v: other.v }));
        }
        // Current attack / defense (CR 2.7, 2.8: what the card has now).
        if ((last === "attack" || last === "defense") && other.k === "num") {
          const s = last === "attack" ? "atk" : "def";
          if (cmp === ">=") return at({ t: `${s}Min`, v: other.v } as FilterNode);
          if (cmp === ">") return at({ t: `${s}Min`, v: other.v + 1 } as FilterNode);
          if (cmp === "<=") return at({ t: `${s}Max`, v: other.v } as FilterNode);
          if (cmp === "<") return at({ t: `${s}Max`, v: other.v - 1 } as FilterNode);
          if (cmp === "===") return at(and({ t: `${s}Min`, v: other.v } as FilterNode, { t: `${s}Max`, v: other.v } as FilterNode));
        }
        if (last === "engaged" && other.k === "bool" && cmp === "===") return at(other.v ? { t: "engaged" } : { t: "not", arg: { t: "engaged" } });
        if (last === "class" && other.k === "str") return at({ t: "class", v: other.v });
        if (last === "type" && other.k === "str") return at({ t: "type", v: other.v });
        if (last === "name" && other.k === "str") return at({ t: "name", v: other.v });
        return prop.of === "it" ? { k: "pred", f: { t: "other", why: `${prop.path.join(".")} ${op}` } } : { k: "cond" };
      }
      // The card itself excluded: id !== self.
      if (op === "!==" || op === "!=") return UNKNOWN;
      return { k: "cond" };
    }
    if ((op === "!==" || op === "!=") && (a.k === "count" || a.k === "exists") && b.k === "num") return this.threshold(a, b.v === 0 ? ">=" : ">=", b.v === 0 ? 1 : b.v), { k: "cond" };
    // Arithmetic with a count: it is used as a quantity.
    if (["+", "-", "*", "/", "%"].includes(op)) {
      this.scale(a);
      this.scale(b);
      return UNKNOWN;
    }
    return UNKNOWN;
  }

  private member(node: Node, env: Env, module: Module): V {
    const object = this.eval(node.object as Node, env, module);
    const name = node.computed ? null : ((node.property as Node).name as string);
    if (name === null) {
      const index = this.eval(node.property as Node, env, module);
      if (object.k !== "arr") return UNKNOWN;
      return (index.k === "num" ? object.items[index.v] : undefined) ?? object.items[0] ?? UNKNOWN;
    }
    switch (object.k) {
      case "fx":
        if (name === "game") return { k: "reader" };
        if (name === "controller") return { k: "side", v: "own" };
        if (name === "self") return { k: "card", v: "self" };
        if (name === "targets")
          return this.targetLists.length > 0
            ? { k: "arr", items: this.targetLists.map((l) => ({ k: "arr", items: [{ k: "card", v: "other", ...(l ? { from: l } : {}) }] }) as V) }
            : { k: "arr", items: [{ k: "arr", items: [{ k: "card", v: "other" }] }] };
        return UNKNOWN;
      case "list":
        if (name === "length") return object.top !== undefined ? UNKNOWN : { k: "count", site: this.site(object, "count") };
        return { k: "list", zones: object.zones, side: object.side, filter: object.filter };
      case "info":
        return { k: "prop", of: object.of, path: [name], ...(object.from ? { from: object.from } : {}) };
      case "inst":
        // g.card(self).controller: the card's controller (its owner on the field, CR 3.1.2).
        if ((name === "controller" || name === "owner") && object.of === "self") return { k: "side", v: "own" };
        if (name === "def") return { k: "instDef", of: object.of };
        if (name === "engaged") return { k: "prop", of: object.of, path: ["engaged"] };
        return UNKNOWN;
      case "reader":
        return name === "db" ? { k: "db" } : UNKNOWN;
      case "prop":
        return { k: "prop", of: object.of, path: [...object.path, name], ...(object.from ? { from: object.from } : {}) };
      case "obj":
        return object.props.get(name) ?? UNKNOWN;
      case "arr":
        if (name === "length") return UNKNOWN;
        return UNKNOWN;
      default:
        return UNKNOWN;
    }
  }

  private call(node: Node, env: Env, module: Module): V {
    const callee = node.callee as Node;
    const argNodes = node.arguments as Node[];
    const args = () => argNodes.flatMap((a) => (a.type === "SpreadElement" ? this.spread(this.eval(a.argument as Node, env, module)) : [this.eval(a, env, module)]));
    // obj.method(...)
    if (callee.type === "MemberExpression" && !callee.computed) {
      const object = this.eval(callee.object as Node, env, module);
      const m = (callee.property as Node).name as string;
      if (object.k === "fx") {
        const vs = args();
        for (const v of vs) this.scale(v);
        // A search of the deck (CR 5.8) or a pick from the evolve deck: is there such a card there.
        if (m === "search" || m === "searchEach" || m === "fromEvolveDeck") {
          const filters = m === "searchEach" ? (vs[0]?.k === "arr" ? vs[0].items : []) : [vs[0] ?? UNKNOWN];
          for (const f of filters) this.recordList({ k: "list", zones: [m === "fromEvolveDeck" ? "evolveDeck" : "deck"], side: "own", filter: this.predicate(f) }, m);
          return m === "search" ? { k: "arr", items: [{ k: "card", v: "other" }] } : UNKNOWN;
        }
        // Other closures handed to effects are read for what they count.
        for (const v of vs) if (v.k === "fn") this.predicate(v);
        // The top cards of the deck: what is looked for among them is looked for in the deck (their number is no count).
        if (m === "topCards") return { k: "list", zones: ["deck"], side: "own", filter: ANY, top: vs[0]?.k === "num" ? vs[0].v : 0 };
        if (m === "selectCards" || m === "chooseCards") {
          const list = vs[0]?.k === "list" && vs[0].top === undefined ? vs[0] : null;
          if (list && this.where !== "pay") this.recordList(list, "choose");
          return { k: "arr", items: [{ k: "card", v: "other", ...(list ? { from: list } : {}) }] };
        }
        // The top card of the deck moved somewhere: a test on it is a test on the deck's cards.
        if (m === "topToEx") return { k: "arr", items: [{ k: "card", v: "other", from: { k: "list", zones: ["deck"], side: vs[1]?.k === "side" ? vs[1].v : "own", filter: ANY, top: vs[0]?.k === "num" ? vs[0].v : 0 } }] };
        return UNKNOWN;
      }
      if (object.k === "reader") return this.readerCall(m, args());
      if (object.k === "db") {
        // g.db.get(g.card(id).def): the card's printed information.
        const vs = args();
        return m === "get" && vs[0]?.k === "instDef" ? { k: "info", of: vs[0].of } : UNKNOWN;
      }
      if (object.k === "obj") {
        // o.filter(g, id), opts.max(...): a function kept in an object.
        const f = object.props.get(m);
        const vs = args();
        return f && (f.k === "fn" || f.k === "filterFn") ? this.apply(f, vs) : UNKNOWN;
      }
      if (object.k === "list") {
        const vs = args();
        if (object.top !== undefined && (m === "filter" || m === "some")) {
          const f = this.predicate(vs[0] ?? UNKNOWN);
          if (meaningful(f)) this.recordList({ k: "list", zones: ["deck"], side: object.side, filter: f, ...(object.top ? { top: object.top } : {}) }, "search");
          return m === "filter" ? { ...object, filter: and(object.filter, f) } : { k: "cond" };
        }
        if (m === "filter") return { ...object, filter: and(object.filter, this.predicate(vs[0] ?? UNKNOWN)) };
        if (m === "some") return { k: "exists", site: this.site({ ...object, filter: and(object.filter, this.predicate(vs[0] ?? UNKNOWN)) }, "exists") };
        if (m === "every") return { k: "cond" };
        if (m === "includes" || m === "indexOf") return { k: "cond" };
        if (m === "find") return { k: "card", v: "other" };
        if (m === "slice" || m === "concat" || m === "sort" || m === "map") return m === "map" ? UNKNOWN : object;
        return UNKNOWN;
      }
      if (object.k === "prop" && object.of !== "it" && object.from) {
        const vs = args();
        const last = object.path[object.path.length - 1];
        if ((last === "traits" || last === "names") && m === "includes" && vs[0]?.k === "str") return this.onCard(object.of, object.from, { t: last === "traits" ? "trait" : "name", v: vs[0].v });
        return { k: "cond" };
      }
      if (object.k === "prop" && object.of === "it") {
        const vs = args();
        const last = object.path[object.path.length - 1];
        if ((last === "traits" || last === "names") && m === "includes" && vs[0]?.k === "str") return { k: "pred", f: { t: last === "traits" ? "trait" : "name", v: vs[0].v } };
        if (last === "names" && m === "some" && vs[0]?.k === "fn") {
          // names.some((n) => n.includes(part))
          const body = vs[0].body;
          if (body.type === "CallExpression" && ((body.callee as Node).property as Node | undefined)?.name === "includes") {
            const part = this.eval((body.arguments as Node[])[0]!, vs[0].env, vs[0].module);
            if (part.k === "str") return { k: "pred", f: { t: "nameIncludes", v: part.v } };
          }
        }
        if (last === "keywords" && m === "includes") return { k: "pred", f: { t: "other", why: "keyword" } };
        return { k: "pred", f: { t: "other", why: `${object.path.join(".")}.${m}` } };
      }
      if (object.k === "arr") {
        const vs = args();
        if (m === "flat") return { k: "arr", items: object.items.flatMap((x) => (x.k === "arr" ? x.items : [x])) };
        if ((m === "map" || m === "flatMap" || m === "some" || m === "every") && vs[0]?.k === "fn") {
          // A constant list (zones, names) mapped through a callback: the callback on each item.
          const results = object.items.map((x, i) => this.apply(vs[0]!, [x, { k: "num", v: i }, object]));
          if (m === "map") return { k: "arr", items: results };
          if (m === "flatMap") {
            const lists = results.filter((r): r is Extract<V, { k: "list" }> => r.k === "list");
            if (lists.length > 0 && lists.length === results.length && lists.every((l) => l.side === lists[0]!.side && JSON.stringify(l.filter) === JSON.stringify(lists[0]!.filter))) {
              return { k: "list", zones: [...new Set(lists.flatMap((l) => l.zones))], side: lists[0]!.side, filter: lists[0]!.filter };
            }
            return { k: "arr", items: results.flatMap((x) => (x.k === "arr" ? x.items : [x])) };
          }
          if (results.length > 0 && results.every((r) => r.k === "pred")) {
            const fs = results.map((r) => (r as Extract<V, { k: "pred" }>).f);
            return { k: "pred", f: m === "some" ? or(...fs) : and(...fs) };
          }
          return { k: "cond" };
        }
        if (m === "some" || m === "every" || m === "includes") return { k: "cond" };
        if (m === "filter" && object.items.length > 0) return object.items.length === 1 && object.items[0]!.k === "list" ? { ...(object.items[0] as Extract<V, { k: "list" }>), filter: and((object.items[0] as Extract<V, { k: "list" }>).filter, this.predicate(vs[0] ?? UNKNOWN)) } : UNKNOWN;
        return UNKNOWN;
      }
      args();
      return UNKNOWN;
    }
    const fn = this.eval(callee, env, module);
    const vs = args();
    if (fn.k === "external") return this.externalCall(fn.name, vs);
    // The filter combinators of script/targets.ts.
    if (callee.type === "Identifier") {
      const name = callee.name as string;
      const r = env.get(name) ? null : resolveName(module, name);
      if (r?.kind === "decl" && r.module.file.endsWith("targets.ts")) {
        const filterArgs = () => vs.map((v) => this.predicate(v));
        const str = vs[0]?.k === "str" ? vs[0].v : null;
        const num = vs[0]?.k === "num" ? vs[0].v : null;
        switch (r.name) {
          case "and":
            return { k: "filterFn", f: and(...filterArgs()) };
          case "or":
            return { k: "filterFn", f: or(...filterArgs()) };
          case "not":
            return { k: "filterFn", f: { t: "not", arg: filterArgs()[0] ?? ANY } };
          case "hasTrait":
            return { k: "filterFn", f: str !== null ? { t: "trait", v: str } : { t: "other", why: "trait ?" } };
          case "isClass":
            return { k: "filterFn", f: str !== null ? { t: "class", v: str } : { t: "other", why: "class ?" } };
          case "named":
            return { k: "filterFn", f: str !== null ? { t: "name", v: str } : { t: "other", why: "name ?" } };
          case "nameIncludes":
            return { k: "filterFn", f: str !== null ? { t: "nameIncludes", v: str } : { t: "other", why: "name ?" } };
          case "costAtMost":
            return { k: "filterFn", f: num !== null ? { t: "costMax", v: num } : { t: "other", why: "cost ?" } };
          case "costAtLeast":
            return { k: "filterFn", f: num !== null ? { t: "costMin", v: num } : { t: "other", why: "cost ?" } };
          case "ofType":
            return vs[1]?.k === "card" && vs[1].v === "it" && vs[2]?.k === "str" ? { k: "pred", f: { t: "type", v: vs[2].v } } : UNKNOWN;
        }
      }
    }
    if (fn.k === "fn" || fn.k === "filterFn") return this.apply(fn, vs);
    return UNKNOWN;
  }

  private readerCall(m: string, vs: V[]): V {
    const sideOf = (v: V | undefined): Side => (v?.k === "side" ? v.v : "?");
    switch (m) {
      case "cards": {
        const zone = vs[1]?.k === "str" ? (vs[1].v as Zone) : "other";
        return { k: "list", zones: [zone], side: sideOf(vs[0]), filter: ANY };
      }
      case "followers":
        return { k: "list", zones: ["field"], side: sideOf(vs[0]), filter: { t: "type", v: "follower" } };
      case "opponent":
        return { k: "side", v: flip(sideOf(vs[0])) };
      case "info":
      case "typeAndTraits":
      case "statsOf":
        return vs[0]?.k === "card" ? { k: "info", of: vs[0].v, ...(vs[0].from ? { from: vs[0].from } : {}) } : { k: "info", of: "other" };
      case "spellchainCount": {
        const saved = this.where;
        this.where = "spellchain";
        const site = this.site({ k: "list", zones: ["cemetery"], side: vs[0]?.k === "side" ? vs[0].v : "own", filter: { t: "type", v: "spell" } }, "count");
        this.where = saved;
        return { k: "count", site };
      }
      case "playedThisTurn":
        return { k: "gauge", name: "combo" };
      case "namesOf":
        return vs[0]?.k === "card" ? { k: "prop", of: vs[0].v, path: ["names"], ...(vs[0].from ? { from: vs[0].from } : {}) } : UNKNOWN;
      case "leader":
        return { k: "card", v: "other" };
      case "card":
        return vs[0]?.k === "card" ? { k: "inst", of: vs[0].v } : UNKNOWN;
      case "controller":
        return { k: "side", v: vs[0]?.k === "card" && vs[0].v === "self" ? "own" : "?" };
      case "overflow":
      case "sanguine":
        this.conds[m] = Math.max(this.conds[m], 1);
        return { k: "cond" };
      case "necrocharge":
      case "spellchain":
      case "combo": {
        // CR 13.5.1.2 Necrocharge (X): X cards in the cemetery; 13.3.1.2 Spellchain (X): X spells in the cemetery (the
        // reader also counts what passives add); 13.2.1.2 Combo (X): X cards played this turn.
        const x = vs[1]?.k === "num" ? vs[1].v : 1;
        this.conds[m] = Math.max(this.conds[m], x);
        if (m !== "combo") {
          const saved = this.where;
          this.where = m;
          const s = this.site({ k: "list", zones: ["cemetery"], side: vs[0]?.k === "side" ? vs[0].v : "own", filter: m === "spellchain" ? { t: "type", v: "spell" } : ANY }, "count");
          s.threshold = { op: ">=", n: x };
          this.where = saved;
        }
        return { k: "cond" };
      }
      case "hasKeyword":
        return vs[0]?.k === "card" && vs[0].v === "it" ? { k: "pred", f: { t: "other", why: "keyword" } } : { k: "cond" };
      case "isRacing":
        // CR 14.2.3.1 "a racing follower".
        return vs[0]?.k === "card" ? this.onCard(vs[0].v, vs[0].from, { t: "racing" }) : { k: "cond" };
      case "banishableByAbilities":
        // A rule exception (cards that can't be banished by abilities), not a kind of card: no filter.
        return vs[0]?.k === "card" && vs[0].v === "it" ? { k: "pred", f: ANY } : { k: "cond" };
      default:
        return UNKNOWN;
    }
  }

  private externalCall(name: string, vs: V[]): V {
    if (name === "opponentOf") return { k: "side", v: vs[0]?.k === "side" ? flip(vs[0].v) : "?" };
    return UNKNOWN;
  }
}

/** The constructors of script/helpers.ts whose automatic abilities have a timing the ability object doesn't name. */
const CONSTRUCTOR_TIMING: Record<string, Timing> = {
  whenYourFollowerAttacks: "strike",
  whenEnemyFollowerAttacks: "strike",
  whenThisDealsCombatDamage: "strike",
  whenThisDealsDamageToEnemyLeader: "strike",
  atStartOfYourMainPhase: "turnStart",
  atStartOfOpponentsMainPhase: "turnStart",
  atStartOfEachMainPhase: "turnStart",
  atStartOfYourEndPhase: "turnEnd",
  atStartOfOpponentsEndPhase: "turnEnd",
  delayedAtStartOfYourEndPhase: "turnEnd",
};

/** An ability's timing: from the ability object (exact), refined by its constructor's name for the "other" automatic ones. */
function timingOf(a: AbilityDef, constructor: string | null): Timing {
  if (a.kind === "spell") return "spell";
  if (a.kind === "activated") return a.evolve ? "evolve" : "activated";
  switch (a.timing) {
    case "fanfare":
      return "fanfare";
    case "lastWords":
      return "lastWords";
    case "onEvolve":
    case "onSuperEvolve":
      return "onEvolve";
    case "strike":
      return "strike";
    default:
      return (constructor && CONSTRUCTOR_TIMING[constructor]) || "otherTrigger";
  }
}

/** Passives about some card of their controller, and where those cards are: the cards they affect. */
const AFFECTS: Record<string, Zone[] | undefined> = { keywordsFor: ["field"], grantsFor: ["field"], playCostOf: ["hand"] };
/** Triggers about a card ("when a Fairy follower enters your field"), by constructor: where that card is. */
const TRIGGER_ZONES: Record<string, Zone[]> = {
  whenFollowerEntersYourField: ["field"],
  whenCardEntersYourField: ["field"],
  whenYourFollowerAttacks: ["field"],
  whenYourFollowerEvolves: ["field"],
  whenYourFollowerLeaves: ["field"],
  whenYourFollowerToCemetery: ["field"],
  whenYourCardLeaves: ["field"],
  whenYouPlay: ["hand"],
  whenYouPlayOrFuse: ["hand"],
  whenCardPutIntoYourEx: ["ex"],
};

const CLOSURE_KEYS = new Set(["condition", "triggerIf", "max", "when", "modeCount", "available", "candidates", "filter", "playableIf", "playCost", "selfKeywords", "cannotAttack", "cannotAttackLeader", "keywordsFor", "playCostOf", "typeWhile", "ignoresWard", "cannotBeDestroyedByAbilities", "evolveCostChange", "canPay"]);
const FROM_HAND = new Set(["playableIf", "playCost", "playOptions", "playOptionsRequired", "playableFromCemetery", "nextPlay"]);

/**
 * Analyzes a definition's script file. `script` is the runtime object (its abilities give the exact timings, index by index
 * with the source's abilities array).
 */
export function analyzeScript(file: string, script: CardScript): CardAnalysis {
  const module = moduleOf(file);
  const az = new Analyzer();
  const root = module.defaultExport;
  const cardObject = root?.type === "CallExpression" ? ((root.arguments as Node[])[0] ?? null) : root;
  const runtime = (script.abilities ?? []) as readonly AbilityDef[];

  /** A function given by name (resolve: fairyToEx, condition: hasThree): its declaration. */
  const functionNode = (node: Node, mod: Module): { node: Node; module: Module } | null => {
    if (node.type === "ArrowFunctionExpression" || node.type === "FunctionExpression" || node.type === "FunctionDeclaration") return { node, module: mod };
    if (node.type !== "Identifier") return null;
    const r = resolveName(mod, node.name as string);
    if (r.kind !== "decl") return null;
    return r.node.type === "ArrowFunctionExpression" || r.node.type === "FunctionExpression" || r.node.type === "FunctionDeclaration" ? { node: r.node, module: r.module } : null;
  };
  /** Reads one value of an ability (a closure, a nested object, a resolve body) in the analyzer's current timing. */
  const readValue = (key: string, given: Node, env: Env, givenModule: Module) => {
    az.where = key;
    const found = functionNode(given, givenModule);
    // A closure made by a factory (selfKeywords: withAnotherDuelist(["storm"])): the closure it returns.
    const made = !found && (given.type === "CallExpression" || given.type === "Identifier") ? az.eval(given, env, givenModule) : null;
    if (found || made?.k === "fn") {
      const fn: V = found ? { k: "fn", params: found.node.params as Node[], body: found.node.body as Node, module: found.module, env } : made!;
      // The closure's parameters, by its property (CardScript and FieldPassives in script/types.ts).
      const params = (fn as Extract<V, { k: "fn" }>).params;
      const first = params[0]?.type === "Identifier" ? (params[0].name as string) : "";
      const reader: V = { k: "reader" };
      const own: V = { k: "side", v: "own" };
      const self: V = { k: "card", v: "self" };
      const other: V = { k: "card", v: "other" };
      const args: V[] =
        first === "fx"
          ? [{ k: "fx" }]
          : key === "filter"
            ? params.length >= 2 ? [reader, { k: "card", v: "it" }] : [{ k: "card", v: "it" }]
            : ["playCost", "playableIf", "playableFromCemetery"].includes(key)
              ? [reader, self, own]
              : ["selfKeywords", "typeWhile", "cannotAttackLeader", "evolveCostChange", "cannotAttack", "cannotBeDestroyedByAbilities", "ignoresWard", "forcesEnemyAttacks"].includes(key)
                ? [reader, self]
                : key === "playCostOf"
                  ? [reader, self, other, own]
                  : ["keywordsFor", "grantsFor", "preventsAttack"].includes(key)
                    ? [reader, self, AFFECTS[key] ? { k: "card", v: "it" } : other]
                    : [reader, own, self];
      if (key === "playCostOf") args[2] = { k: "card", v: "it" };
      const affects = AFFECTS[key];
      if (affects) az.capture = [];
      const r = az.apply(fn, args);
      if (affects) {
        const captured = az.capture ?? [];
        az.capture = null;
        if (captured.length > 0) az.recordAffected(captured.length === 1 ? captured[0]! : { t: "and", args: captured }, affects, "affects");
      }
      if (key === "max" || key === "modeCount" || key === "playCost" || key === "playCostOf" || key === "evolveCostChange") az.scaleValue(r);
      if (r.k === "exists") az.thresholdOf(r);
    }
  };
  const readObject = (obj: Node, env: Env, mod: Module) => {
    if ((obj.properties as Node[]).some((p) => p.type === "Property" && ((p.key as Node).name ?? (p.key as Node).value) === "targets")) az.targetLists = [];
    for (const p of (obj.properties as Node[]) ?? []) {
      // ...buryFromYourField(...) in a play option: the cost's own object.
      if (p.type === "SpreadElement") readNode(p.argument as Node, env, mod);
      if (p.type !== "Property") continue;
      const key = ((p.key as Node).name ?? (p.key as Node).value) as string;
      const value = p.value as Node;
      if (key === "resolve" || key === "pay" || (p.method && value.type === "FunctionExpression" && !CLOSURE_KEYS.has(key))) {
        az.where = key;
        const found = functionNode(value, mod);
        if (!found) continue;
        const env2 = new Env(found.module === mod ? env : new Env());
        const params = found.node.params as Node[];
        if (params[0]?.type === "Identifier") env2.set(params[0].name as string, { k: "fx" });
        const body = found.node.body as Node;
        if (body.type === "BlockStatement") az.block(body, env2, found.module);
        else az.eval(body, env2, found.module);
        continue;
      }
      if (CLOSURE_KEYS.has(key)) readValue(key, value, env, mod);
      else if (value.type === "ObjectExpression" || value.type === "Identifier") readNode(value, env, mod);
      else if (value.type === "ArrayExpression") for (const e of value.elements as Node[]) readNode(e, env, mod);
      else if (value.type === "CallExpression") readNode(value, env, mod);
    }
  };
  /** An ability-like node: an object literal, a call of a constructor or helper with object arguments, or a shared value. */
  const readNode = (n: Node | null, env: Env, mod: Module) => {
    if (!n) return;
    if (n.type === "ObjectExpression") return readObject(n, env, mod);
    if (n.type === "CallExpression") {
      const target = n.callee as Node;
      if (target.type === "Identifier") {
        const r = resolveName(mod, target.name as string);
        if (r.kind === "decl" && r.module.file.endsWith("targets.ts") && (r.node.type === "ArrowFunctionExpression" || r.node.type === "FunctionDeclaration")) {
          const argValues = (n.arguments as Node[]).map((a) => az.eval(a, env, mod));
          az.targetSite({ k: "fn", params: r.node.params as Node[], body: r.node.body as Node, module: r.module, env: new Env() }, argValues);
        }
      }
      // A target helper (enemyFollower({...max...})), a constructor (fanfare({...})), a shared ability factory: read its object
      // arguments, and a helper defined in the scripts with its arguments bound.
      const calleeName = (n.callee as Node).type === "Identifier" ? (((n.callee as Node).name as string) ?? "") : "";
      const triggerZones = TRIGGER_ZONES[calleeName];
      if (triggerZones) {
        for (const a of n.arguments as Node[]) {
          if (a.type !== "ObjectExpression") continue;
          const filterProp = (a.properties as Node[]).find((q) => q.type === "Property" && ((q.key as Node).name ?? (q.key as Node).value) === "filter");
          if (filterProp) az.recordAffected(az.predicate(az.eval(filterProp.value as Node, env, mod)), triggerZones, "trigger");
        }
      }
      for (const a of n.arguments as Node[]) {
        if (a.type === "ObjectExpression" || a.type === "CallExpression" || a.type === "ArrayExpression") readNode(a, env, mod);
        else if (a.type === "ArrowFunctionExpression" || a.type === "FunctionExpression" || (a.type === "Identifier" && TRIGGER_ZONES[calleeName])) {
          const zones = TRIGGER_ZONES[calleeName];
          if (zones) {
            // "When a [filter] follower enters your field": the cards that trigger it.
            const found = functionNode(a, mod);
            const f = found ? az.predicate({ k: "fn", params: found.node.params as Node[], body: found.node.body as Node, module: found.module, env }) : az.predicate(az.eval(a, env, mod));
            az.recordAffected(f, zones, "trigger");
          } else if (a.type !== "Identifier") readValue("filter", a, env, mod);
        }
      }
      const callee = n.callee as Node;
      if (callee.type === "Identifier") {
        const r = resolveName(mod, callee.name as string);
        if (r.kind === "decl" && !r.module.file.endsWith("helpers.ts") && !r.module.file.endsWith("targets.ts") && (r.node.type === "ArrowFunctionExpression" || r.node.type === "FunctionDeclaration")) {
          const inner = new Env();
          az.bindParams(r.node.params as Node[], (n.arguments as Node[]).map((a) => az.eval(a, env, mod)), inner, r.module);
          const body = r.node.body as Node;
          if (body.type === "ObjectExpression" || body.type === "CallExpression") readNode(body, inner, r.module);
          else if (body.type === "BlockStatement") {
            // Its local declarations first (const others = ...), then what it returns.
            for (const stmt of body.body as Node[]) {
              if (stmt.type === "VariableDeclaration" || stmt.type === "FunctionDeclaration") az.declare(stmt, inner, r.module);
              else if (stmt.type === "ReturnStatement" && stmt.argument) readNode(stmt.argument as Node, inner, r.module);
            }
          }
        }
      }
      return;
    }
    if (n.type === "ArrayExpression") for (const e of n.elements as Node[]) readNode(e, env, mod);
    if (n.type === "SpreadElement") readNode(n.argument as Node, env, mod);
    if (n.type === "Identifier") {
      const r = resolveName(mod, n.name as string);
      if (r.kind === "decl" && (r.node.type === "ObjectExpression" || r.node.type === "CallExpression" || r.node.type === "ArrayExpression")) readNode(r.node, new Env(), r.module);
    }
  };

  if (cardObject?.type === "ObjectExpression") {
    for (const p of cardObject.properties as Node[]) {
      if (p.type !== "Property") continue;
      const key = ((p.key as Node).name ?? (p.key as Node).value) as string;
      const value = p.value as Node;
      if (key === "abilities" && value.type === "ArrayExpression") {
        const elements = value.elements as Node[];
        const exact = elements.length === runtime.length && elements.every((e) => e.type !== "SpreadElement");
        elements.forEach((e, i) => {
          const callee = e.type === "CallExpression" ? (e.callee as Node) : null;
          const constructor = callee?.type === "Identifier" ? (callee.name as string) : null;
          az.timing = exact ? timingOf(runtime[i]!, constructor) : (constructor && CONSTRUCTOR_TIMING[constructor]) || "otherTrigger";
          az.ability = exact ? i : -2;
          readNode(e, new Env(), module);
        });
        continue;
      }
      az.timing = FROM_HAND.has(key) ? "fromHand" : "continuous";
      az.ability = -1;
      if (CLOSURE_KEYS.has(key)) readValue(key, value, new Env(), module);
      else readNode(value, new Env(), module);
    }
  }
  // fx call sites, in the card's code and every script helper it reaches.
  const fx = Object.fromEntries(FX_FAMILY_NAMES.map((f) => [f, 0])) as Record<FxFamily, number>;
  const amounts = Object.fromEntries(AMOUNT_KINDS.map((k) => [k, 0])) as Record<AmountKind, number>;
  const unknownFx = new Set<string>();
  const seen = new Set<string>();
  const visit = (node: Node, mod: Module) => {
    walk(node, (n) => {
      // A cost's payment (cost: { custom: { canPay, pay } }) is a cost, not an effect.
      if (n.type === "Property" && ["pay", "canPay"].includes(((n.key as Node).name ?? (n.key as Node).value) as string)) return false;
      if (n.type === "CallExpression") {
        const callee = n.callee as Node;
        // helpers.ts lookAtTopCards(fx, n, { to, rest }): what it does depends on its options, not on all of its branches.
        if (callee.type === "Identifier" && callee.name === "lookAtTopCards") {
          const r = resolveName(mod, "lookAtTopCards");
          if (r.kind === "decl" && r.module.file.endsWith("helpers.ts")) {
            const opts = (n.arguments as Node[])[2];
            const option = (key: string) => {
              const p = opts?.type === "ObjectExpression" ? (opts.properties as Node[]).find((q) => q.type === "Property" && ((q.key as Node).name ?? (q.key as Node).value) === key) : undefined;
              return p && (p.value as Node).type === "Literal" ? ((p.value as Node).value as string) : undefined;
            };
            fx.search += 1;
            const to = option("to");
            if (to === "hand") fx.toHand += 1;
            else if (to === "ex") fx.ex += 1;
            else if (to === "field") fx.summon += 1;
            if (option("rest") === "cemetery") fx.bury += 1;
            else fx.deck += 1;
          }
        }
        if (callee.type === "MemberExpression" && !callee.computed && (callee.object as Node).type === "Identifier" && (callee.object as Node).name === "fx") {
          const m = (callee.property as Node).name as string;
          const family = FAMILY_OF.get(m);
          if (family === undefined) unknownFx.add(m);
          else if (family !== "none") fx[family] += 1;
          addAmounts(amounts, m, n.arguments as Node[]);
        }
      }
      if (n.type === "Identifier") {
        const r = resolveName(mod, n.name as string);
        if (r.kind !== "decl" || r.module === mod) return;
        // Not followed: target filters (no effects), cost builders (costs, not effects: the table's act.* / auto.cost columns),
        // and lookAtTopCards (counted at its call above).
        if (r.module.file.endsWith("targets.ts") || r.module.file.endsWith("costs.ts")) return;
        if (r.module.file.endsWith("helpers.ts") && r.name === "lookAtTopCards") return;
        const key = `${r.module.file}#${r.name}`;
        if (seen.has(key)) return;
        seen.add(key);
        visit(r.node, r.module);
      }
      return true;
    });
  };
  if (root) visit(root, module);
  // Local helpers of the card's own file used by its card object.
  for (const [name, node] of module.decls) if (!seen.has(`${module.file}#${name}`)) visit(node, module);
  const refs = dedupe(az.refs).filter((r) => !(r.filter.t === "any" && r.agg === "count" && !r.threshold && !r.scaled));
  return { fx, amounts, unknownFx: [...unknownFx].sort(), refs, conds: az.conds };
}

/** A number written in the code: a literal, a negated one, or the larger branch of `a ? 5 : 2`. */
function literalNumber(node: Node | undefined): number | null {
  if (!node) return null;
  if (node.type === "Literal" && typeof node.value === "number") return node.value;
  if (node.type === "UnaryExpression" && node.operator === "-") {
    const v = literalNumber(node.argument as Node);
    return v === null ? null : -v;
  }
  if (node.type === "ConditionalExpression") {
    const a = literalNumber(node.consequent as Node);
    const b = literalNumber(node.alternate as Node);
    return a === null ? b : b === null ? a : Math.max(a, b);
  }
  if (node.type === "TSAsExpression" || node.type === "ParenthesizedExpression") return literalNumber(node.expression as Node);
  return null;
}

/** The amounts of an effect call, where its code writes them (fx.dealDamage(target, 3), fx.giveStats(id, 1, 1), fx.summon([a, b])). */
function addAmounts(amounts: Record<AmountKind, number>, method: string, args: Node[]): void {
  const at = (i: number) => literalNumber(args[i]);
  const add = (kind: AmountKind, v: number | null) => {
    if (v !== null && v > 0) amounts[kind] += v;
  };
  switch (method) {
    case "dealDamage":
    case "dealDividedDamage":
      return add("dmg", at(1));
    case "dealDamageEach":
      return add("aoe", at(1));
    case "giveStats":
      for (const v of [at(1), at(2)]) {
        if (v === null) continue;
        if (v > 0) amounts.stats += v;
        else amounts.debuff -= v;
      }
      return;
    case "giveLeaderDefense":
      return add("heal", at(1));
    case "draw":
      return add("draw", at(0));
    case "mill":
      return add("mill", at(0));
    case "topToEx":
      return add("ex", at(0));
    case "recoverPlayPoints":
    case "increaseMaxPlayPoints":
      return add("pp", at(0));
    case "summon":
    case "tokensToEx": {
      const list = args[0];
      if (list?.type === "ArrayExpression") add(method === "summon" ? "summon" : "ex", (list.elements as Node[]).length);
      return;
    }
  }
}

/** Sites read twice (a constant's value, a closure evaluated again) count once. */
function dedupe(refs: RefSite[]): RefSite[] {
  const seen = new Map<string, RefSite>();
  for (const r of refs) {
    const key = JSON.stringify([r.timing, r.ability, r.where, r.zones, r.side, r.filter, r.agg, r.threshold, r.top]);
    const prev = seen.get(key);
    if (!prev) seen.set(key, r);
    else {
      prev.scaled ||= r.scaled;
      prev.threshold ??= r.threshold;
    }
  }
  return [...seen.values()];
}

/** `return false;` or `{ return false; }`. */
function returnsFalse(n: Node): boolean {
  if (n.type === "ReturnStatement") return (n.argument as Node | null)?.type === "Literal" && (n.argument as Node).value === false;
  if (n.type === "BlockStatement") return (n.body as Node[]).length === 1 && returnsFalse((n.body as Node[])[0]!);
  return false;
}

/** `return;` or `{ return; }`: an early exit. */
function isBareReturn(n: Node): boolean {
  if (n.type === "ReturnStatement") return !n.argument;
  if (n.type === "BlockStatement") return (n.body as Node[]).length === 1 && isBareReturn((n.body as Node[])[0]!);
  return false;
}

/** Whether a filter says anything about a card (a type, trait, class, name, cost...): not only parts it couldn't read. */
function meaningful(f: FilterNode): boolean {
  if (f.t === "and" || f.t === "or") return f.args.some(meaningful);
  if (f.t === "not") return meaningful(f.arg);
  return f.t !== "any" && f.t !== "other" && f.t !== "notSelf";
}

/** Whether a filter has parts the analysis couldn't read. */
export function partial(f: FilterNode): boolean {
  if (f.t === "other") return true;
  if (f.t === "and" || f.t === "or") return f.args.some(partial);
  if (f.t === "not") return partial(f.arg);
  return false;
}

/** Every scripted definition analyzed, by definition (the card feature table's input; an unknown fx method throws). */
export function analyzeScripts(scripts: Readonly<Record<string, CardScript>>): Map<string, CardAnalysis> {
  const files = scriptFiles();
  const out = new Map<string, CardAnalysis>();
  for (const [def, script] of Object.entries(scripts)) {
    const file = files.get(def);
    if (!file) throw new Error(`no script file for ${def}`);
    const a = analyzeScript(file, script);
    if (a.unknownFx.length > 0) throw new Error(`${def}: fx methods without a family (tools/rl/fx-families.ts): ${a.unknownFx.join(", ")}`);
    out.set(def, a);
  }
  return out;
}
