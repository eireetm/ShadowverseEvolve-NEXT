// The references read from the scripts (script-analysis.ts) checked against the engine: at positions of recorded games, a card's
// own closures (a condition, a target's max, a play condition...) are called with the real game, and compared with what the
// reference says (the number of matching cards; whether it reaches the threshold). Tools only (it reads the real game).
import type { AbilityDef, CardId, CardScript, GameReader, GameSession, PlayerId } from "../../packages/core/src";
import type { FilterNode, RefSite, Zone } from "./script-analysis";

/** Does a card match a reference's filter, read with the engine (its current information, as the scripts read it). */
export function matches(g: GameReader, id: CardId, f: FilterNode, self: CardId): boolean {
  switch (f.t) {
    case "any":
      return true;
    case "and":
      return f.args.every((x) => matches(g, id, x, self));
    case "or":
      return f.args.some((x) => matches(g, id, x, self));
    case "not":
      return !matches(g, id, f.arg, self);
    case "notSelf":
      return id !== self;
    case "other":
      return true;
  }
  const info = g.info(id);
  switch (f.t) {
    case "type":
      return info.type === f.v;
    case "trait":
      return info.traits.includes(f.v);
    case "class":
      return info.class === f.v;
    case "name":
      return info.names.includes(f.v);
    case "nameIncludes":
      return info.names.some((n) => n.includes(f.v));
    case "costMin":
      return (info.cost ?? -Infinity) >= f.v;
    case "costMax":
      return (info.cost ?? Infinity) <= f.v;
    case "atkMin":
      return (info.attack ?? -Infinity) >= f.v;
    case "atkMax":
      return (info.attack ?? Infinity) <= f.v;
    case "defMin":
      return (info.defense ?? -Infinity) >= f.v;
    case "defMax":
      return (info.defense ?? Infinity) <= f.v;
    case "evolved":
      return info.evolved;
    case "unevolved":
      return !info.evolved;
    case "token":
      return info.baseDef.token;
  }
}

/** The number of cards a reference counts, for a card of this controller. */
export function refCount(g: GameReader, site: RefSite, controller: PlayerId, self: CardId): number {
  const sides: PlayerId[] = site.side === "own" ? [controller] : site.side === "opp" ? [g.opponent(controller)] : [controller, g.opponent(controller)];
  let n = 0;
  for (const p of sides) {
    for (const zone of site.zones) {
      if (zone === "other" || zone === "leader") continue;
      for (const id of g.cards(p, zone as Exclude<Zone, "other" | "leader">)) if (matches(g, id, site.filter, self)) n += 1;
    }
  }
  return n;
}

/** Whether a count reaches a reference's threshold, read as the number of cards needed (a guard "if fewer than 3, stop" needs 3). */
export function needed(site: RefSite): number | null {
  const t = site.threshold;
  if (!t) return null;
  return t.op === ">" || t.op === "<=" ? t.n + 1 : t.n;
}

export interface OracleResult {
  /** By "def where": agreements and disagreements, with a few examples. */
  byClosure: Map<string, { agree: number; disagree: number; examples: string[] }>;
  calls: number;
}

/** A definition's callable closures, with where they are in the analysis' terms (ability index, property). */
function closuresOf(script: CardScript): { ability: number; where: string; call: (g: GameReader, p: PlayerId, self: CardId) => unknown }[] {
  const out: { ability: number; where: string; call: (g: GameReader, p: PlayerId, self: CardId) => unknown }[] = [];
  ((script.abilities ?? []) as readonly AbilityDef[]).forEach((a, i) => {
    const any = a as unknown as Record<string, unknown>;
    for (const key of ["condition", "triggerIf"]) {
      const f = any[key];
      if (typeof f === "function") out.push({ ability: i, where: key, call: (g, p, self) => (f as (g: GameReader, p: PlayerId, s: CardId) => unknown)(g, p, self) });
    }
    for (const t of (a.targets ?? []) as unknown as Record<string, unknown>[]) {
      for (const key of ["max", "when"]) {
        const f = t[key];
        if (typeof f === "function") out.push({ ability: i, where: key, call: (g, p, self) => (f as (g: GameReader, p: PlayerId, s: CardId) => unknown)(g, p, self) });
      }
    }
  });
  const s = script as unknown as Record<string, unknown>;
  if (typeof s.playableIf === "function") out.push({ ability: -1, where: "playableIf", call: (g, p, self) => (s.playableIf as (g: GameReader, s: CardId, p: PlayerId) => unknown)(g, self, p) });
  if (typeof s.selfKeywords === "function") out.push({ ability: -1, where: "selfKeywords", call: (g, _p, self) => ((s.selfKeywords as (g: GameReader, s: CardId) => readonly unknown[])(g, self) ?? []).length > 0 });
  return out;
}

/**
 * Calls every closure of these definitions' cards at the positions given, and compares. Only closures with exactly one
 * reference are compared (the others mix several counts, or other conditions, with their reference).
 */
export function checkReferences(positions: Iterable<GameSession>, refsOf: (def: string) => readonly RefSite[] | undefined, scripts: Readonly<Record<string, CardScript>>): OracleResult {
  const byClosure = new Map<string, { agree: number; disagree: number; examples: string[] }>();
  let calls = 0;
  for (const game of positions) {
    const g = game.reader();
    for (const p of [0, 1] as PlayerId[]) {
      for (const zone of ["field", "hand", "ex", "cemetery"] as const) {
        for (const id of g.cards(p, zone)) {
          const def = game.state.cards[id]!.def;
          const refs = refsOf(def);
          const script = scripts[def];
          if (!refs || !script) continue;
          for (const c of closuresOf(script)) {
            // A passive of the card itself (selfKeywords) works on the field only (CR 10.3.5).
            if (c.where === "selfKeywords" && zone !== "field") continue;
            const sites = refs.filter((r) => r.ability === c.ability && r.where === c.where);
            if (sites.length !== 1) continue;
            const site = sites[0]!;
            let value: unknown;
            try {
              value = c.call(g, p, id);
            } catch {
              continue;
            }
            calls += 1;
            const count = refCount(g, site, p, id);
            const need = needed(site);
            const predicted: unknown = c.where === "max" ? count : site.agg === "exists" ? count >= (need ?? 1) : need === null ? count > 0 : count >= need;
            const actual = c.where === "max" ? value : Boolean(value);
            const key = `${def} ${c.where}${c.ability >= 0 ? `#${c.ability}` : ""}`;
            const entry = byClosure.get(key) ?? { agree: 0, disagree: 0, examples: [] };
            if (actual === predicted) entry.agree += 1;
            else {
              entry.disagree += 1;
              if (entry.examples.length < 3) entry.examples.push(`turn ${game.state.turn} p${p}: engine ${String(actual)}, reference ${String(predicted)} (count ${count})`);
            }
            byClosure.set(key, entry);
          }
        }
      }
    }
  }
  return { byClosure, calls };
}
