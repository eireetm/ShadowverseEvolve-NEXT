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
}

export interface CardAnalysis {
  fx: Record<FxFamily, number>;
  /** fx methods the families don't know (the table test fails on any). */
  unknownFx: string[];
  refs: RefSite[];
  /** Conditions on one game number the reader computes (CR 13.x keyword conditions). */
  conds: Record<"overflow" | "necrocharge" | "spellchain" | "combo" | "sanguine", number>;
}

// ---- Symbolic values ----

type CardRef = "it" | "self" | "other";
type V =
  | { k: "reader" }
  | { k: "fx" }
  | { k: "side"; v: Side }
  | { k: "card"; v: CardRef }
  | { k: "list"; zones: Zone[]; side: Side; filter: FilterNode; top?: true }
  | { k: "count"; site: RefSite }
  | { k: "exists"; site: RefSite }
  | { k: "cond" }
  | { k: "pred"; f: FilterNode }
  | { k: "info"; of: CardRef }
  | { k: "inst"; of: CardRef }
  | { k: "instDef"; of: CardRef }
  | { k: "db" }
  | { k: "prop"; of: CardRef; path: string[] }
  | { k: "fn"; params: Node[]; body: Node; module: Module; env: Env }
  | { k: "filterFn"; f: FilterNode }
  | { k: "num"; v: number }
  | { k: "str"; v: string }
  | { k: "bool"; v: boolean }
  | { k: "obj"; props: Map<string, V> }
  | { k: "arr"; items: V[] }
  | { k: "external"; name: string }
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
  private depth = 0;
  private readonly declCache = new Map<string, V>();

  private site(list: Extract<V, { k: "list" }>, agg: "count" | "exists"): RefSite {
    const s: RefSite = { timing: this.timing, ability: this.ability, where: this.where, zones: list.zones, side: list.side, filter: list.filter, agg, threshold: null, scaled: false };
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
      return { k: "cond" };
    }
    if (fn.k !== "fn") return UNKNOWN;
    if (this.depth > 40) return UNKNOWN;
    this.depth += 1;
    try {
      const env = new Env(fn.env);
      fn.params.forEach((p, i) => this.bind(p, args[i] ?? UNKNOWN, env, fn.module, args.slice(i)));
      if (fn.body.type === "BlockStatement") return this.block(fn.body, env, fn.module) ?? UNKNOWN;
      return this.eval(fn.body, env, fn.module);
    } finally {
      this.depth -= 1;
    }
  }

  private bind(param: Node, v: V, env: Env, module: Module, rest: V[]): void {
    if (param.type === "Identifier") env.set(param.name as string, v);
    else if (param.type === "AssignmentPattern") this.bind(param.left as Node, v.k === "unknown" ? this.eval(param.right as Node, env, module) : v, env, module, rest);
    else if (param.type === "RestElement") this.bind(param.argument as Node, { k: "arr", items: rest }, env, module, []);
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
    } else walk(param, (n) => n.type === "Identifier" && env.set(n.name as string, UNKNOWN));
  }

  /** A declaration statement, bound into `env`. */
  declare(stmt: Node, env: Env, module: Module): void {
    this.statement(stmt, env, module);
  }

  /** A block's statements; the value of its first return that gives something. */
  block(node: Node, env: Env, module: Module): V | null {
    let result: V | null = null;
    for (const stmt of (node.body as Node[]) ?? []) {
      const r = this.statement(stmt, env, module);
      if (r && !result) result = r;
    }
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
        this.eval(stmt.test as Node, env, module);
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
        this.eval(stmt.right as Node, inner, module);
        const left = stmt.left as Node;
        walk(left, (n) => n.type === "Identifier" && inner.set(n.name as string, { k: "card", v: "other" }));
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
   * A target of script/targets.ts (enemyFollower({...}), inYourZone("cemetery", {...})): its candidates, as a reference when
   * they say more than "a follower on the field" (another zone, or a trait, class, name or cost).
   */
  targetSite(helper: V, args: V[]): void {
    const spec = this.apply(helper, args);
    if (spec.k !== "obj") return;
    const candidates = spec.props.get("candidates");
    if (candidates?.k !== "fn") return;
    const list = this.apply(candidates, [{ k: "reader" }, { k: "side", v: "own" }, { k: "card", v: "self" }]);
    if (list.k !== "list") return;
    const trivial = (f: FilterNode): boolean =>
      f.t === "any" || f.t === "notSelf" || (f.t === "type" && f.v === "follower") || (f.t === "and" && f.args.every(trivial));
    if (list.zones.length === 1 && list.zones[0] === "field" && trivial(list.filter)) return;
    this.recordList(list, "target");
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
        this.eval(node.test as Node, env, module);
        const a = this.eval(node.consequent as Node, env, module);
        const b = this.eval(node.alternate as Node, env, module);
        return a.k !== "unknown" ? a : b;
      }
      case "UnaryExpression": {
        const v = this.eval(node.argument as Node, env, module);
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
    if (v.k !== "count" && v.k !== "exists") return;
    if (!v.site.threshold) v.site.threshold = { op, n };
  }

  private logical(node: Node, env: Env, module: Module): V {
    const a = this.eval(node.left as Node, env, module);
    const b = this.eval(node.right as Node, env, module);
    if (node.operator === "??" || node.operator === "||") {
      if (a.k === "prop") return a; // (g.info(id).cost ?? 0)
      if (a.k === "pred" && b.k === "pred") return { k: "pred", f: or(a.f, b.f) };
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
    const COMPARE: Record<string, NonNullable<RefSite["threshold"]>["op"]> = { ">=": ">=", ">": ">", "<=": "<=", "<": "<", "===": "===", "==": "===" };
    const MIRROR: Record<string, NonNullable<RefSite["threshold"]>["op"]> = { ">=": "<=", ">": "<", "<=": ">=", "<": ">", "===": "===", "==": "===" };
    if (COMPARE[op]) {
      // A count against a number: a threshold.
      if ((a.k === "count" || a.k === "exists") && b.k === "num") return this.threshold(a, COMPARE[op]!, b.v), { k: "cond" };
      if ((b.k === "count" || b.k === "exists") && a.k === "num") return this.threshold(b, MIRROR[op]!, a.v), { k: "cond" };
      // A card's information against a value: a filter atom.
      const prop = a.k === "prop" ? a : b.k === "prop" ? b : null;
      const other = prop === a ? b : a;
      const cmp = prop === a ? COMPARE[op]! : MIRROR[op]!;
      if (prop && prop.of === "it") {
        const last = prop.path[prop.path.length - 1];
        if (last === "cost" && other.k === "num") {
          if (cmp === ">=") return { k: "pred", f: { t: "costMin", v: other.v } };
          if (cmp === ">") return { k: "pred", f: { t: "costMin", v: other.v + 1 } };
          if (cmp === "<=") return { k: "pred", f: { t: "costMax", v: other.v } };
          if (cmp === "<") return { k: "pred", f: { t: "costMax", v: other.v - 1 } };
          if (cmp === "===") return { k: "pred", f: and({ t: "costMin", v: other.v }, { t: "costMax", v: other.v }) };
        }
        // Current attack / defense (CR 2.7, 2.8: what the card has now).
        if ((last === "attack" || last === "defense") && other.k === "num") {
          const s = last === "attack" ? "atk" : "def";
          if (cmp === ">=") return { k: "pred", f: { t: `${s}Min`, v: other.v } as FilterNode };
          if (cmp === ">") return { k: "pred", f: { t: `${s}Min`, v: other.v + 1 } as FilterNode };
          if (cmp === "<=") return { k: "pred", f: { t: `${s}Max`, v: other.v } as FilterNode };
          if (cmp === "<") return { k: "pred", f: { t: `${s}Max`, v: other.v - 1 } as FilterNode };
          if (cmp === "===") return { k: "pred", f: and({ t: `${s}Min`, v: other.v } as FilterNode, { t: `${s}Max`, v: other.v } as FilterNode) };
        }
        if (last === "class" && other.k === "str") return { k: "pred", f: { t: "class", v: other.v } };
        if (last === "type" && other.k === "str") return { k: "pred", f: { t: "type", v: other.v } };
        if (last === "name" && other.k === "str") return { k: "pred", f: { t: "name", v: other.v } };
        return { k: "pred", f: { t: "other", why: `${prop.path.join(".")} ${op}` } };
      }
      // The card itself excluded: id !== self.
      if (op === "!==" || op === "!=") return UNKNOWN;
      return { k: "cond" };
    }
    if ((op === "!==" || op === "!=") && ((a.k === "card" && a.v === "it" && b.k === "card" && b.v === "self") || (b.k === "card" && b.v === "it" && a.k === "card" && a.v === "self"))) {
      return { k: "pred", f: { t: "notSelf" } };
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
      this.eval(node.property as Node, env, module);
      return object.k === "arr" ? (object.items[0] ?? UNKNOWN) : UNKNOWN;
    }
    switch (object.k) {
      case "fx":
        if (name === "game") return { k: "reader" };
        if (name === "controller") return { k: "side", v: "own" };
        if (name === "self") return { k: "card", v: "self" };
        if (name === "targets") return { k: "arr", items: [{ k: "card", v: "other" }] };
        return UNKNOWN;
      case "list":
        if (name === "length") return object.top ? UNKNOWN : { k: "count", site: this.site(object, "count") };
        return { k: "list", zones: object.zones, side: object.side, filter: object.filter };
      case "info":
        return { k: "prop", of: object.of, path: [name] };
      case "inst":
        // g.card(self).controller: the card's controller (its owner on the field, CR 3.1.2).
        if ((name === "controller" || name === "owner") && object.of === "self") return { k: "side", v: "own" };
        if (name === "def") return { k: "instDef", of: object.of };
        return UNKNOWN;
      case "reader":
        return name === "db" ? { k: "db" } : UNKNOWN;
      case "prop":
        return { k: "prop", of: object.of, path: [...object.path, name] };
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
        if (m === "topCards") return { k: "list", zones: ["deck"], side: "own", filter: ANY, top: true };
        if (m === "selectCards" || m === "chooseCards") return { k: "arr", items: [{ k: "card", v: "other" }] };
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
        if (object.top && (m === "filter" || m === "some")) {
          const f = this.predicate(vs[0] ?? UNKNOWN);
          if (meaningful(f)) this.recordList({ k: "list", zones: ["deck"], side: object.side, filter: f }, "search");
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
        return vs[0]?.k === "card" ? { k: "info", of: vs[0].v } : { k: "info", of: "other" };
      case "leader":
        return { k: "card", v: "other" };
      case "card":
        return vs[0]?.k === "card" ? { k: "inst", of: vs[0].v } : UNKNOWN;
      case "controller":
        return { k: "side", v: vs[0]?.k === "card" && vs[0].v === "self" ? "own" : "?" };
      case "overflow":
      case "necrocharge":
      case "spellchain":
      case "combo":
      case "sanguine":
        this.conds[m] += 1;
        return { k: "cond" };
      case "hasKeyword":
        return vs[0]?.k === "card" && vs[0].v === "it" ? { k: "pred", f: { t: "other", why: "keyword" } } : { k: "cond" };
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
    if (found) {
      const node = found.node;
      const mod = found.module;
      const fn: V = { k: "fn", params: node.params as Node[], body: node.body as Node, module: mod, env };
      // The closure's parameters, by its property (CardScript and FieldPassives in script/types.ts).
      const params = node.params as Node[];
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
                    ? [reader, self, other]
                    : [reader, own, self];
      const r = az.apply(fn, args);
      if (key === "max" || key === "modeCount" || key === "playCost" || key === "playCostOf" || key === "evolveCostChange") az.scaleValue(r);
      if (r.k === "exists") az.thresholdOf(r);
    }
  };
  const readObject = (obj: Node, env: Env, mod: Module) => {
    for (const p of (obj.properties as Node[]) ?? []) {
      if (p.type !== "Property") continue;
      const key = ((p.key as Node).name ?? (p.key as Node).value) as string;
      const value = p.value as Node;
      if (key === "resolve" || key === "pay" || (p.method && value.type === "FunctionExpression")) {
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
      for (const a of n.arguments as Node[]) if (a.type === "ObjectExpression" || a.type === "CallExpression" || a.type === "ArrayExpression") readNode(a, env, mod);
      else if (a.type === "ArrowFunctionExpression" || a.type === "FunctionExpression") readValue("filter", a, env, mod);
      const callee = n.callee as Node;
      if (callee.type === "Identifier") {
        const r = resolveName(mod, callee.name as string);
        if (r.kind === "decl" && !r.module.file.endsWith("helpers.ts") && !r.module.file.endsWith("targets.ts") && (r.node.type === "ArrowFunctionExpression" || r.node.type === "FunctionDeclaration")) {
          const inner = new Env();
          (r.node.params as Node[]).forEach((p, i) => {
            const arg = (n.arguments as Node[])[i];
            if (p.type === "Identifier" && arg) inner.set(p.name as string, az.eval(arg, env, mod));
          });
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
  return { fx, unknownFx: [...unknownFx].sort(), refs: dedupe(az.refs), conds: az.conds };
}

/** Sites read twice (a constant's value, a closure evaluated again) count once. */
function dedupe(refs: RefSite[]): RefSite[] {
  const seen = new Map<string, RefSite>();
  for (const r of refs) {
    const key = JSON.stringify([r.timing, r.ability, r.where, r.zones, r.side, r.filter, r.agg]);
    const prev = seen.get(key);
    if (!prev) seen.set(key, r);
    else {
      prev.scaled ||= r.scaled;
      prev.threshold ??= r.threshold;
    }
  }
  return [...seen.values()];
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
