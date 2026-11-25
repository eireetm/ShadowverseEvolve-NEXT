import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createEngine, script, type CardDefinition, type CardScript } from "../../src";
import { ALL_ATTRIBUTES_TRAIT, ATTRIBUTE_TRAITS, traitMatches } from "../../src/model/traits";
import { hasTrait, traitOf } from "../../src/script/targets";
import { drive, testFollower, testTreasure, type DriveSpec } from "../../src/testing";
import { TEST_CARDS, TEST_SCRIPTS } from "../helpers";

// 全属性 (CR JP 14.6.2, the Japanese rules v1.29.0): a reference to an attribute trait also references 全属性.
const { defineCard, uncapAbility } = script;
const CARDS: CardDefinition[] = [
  testFollower("ALL", 2, 2, 2, { traits: ["グラブル", "全属性"] }),
  testFollower("ETERNAL", 2, 2, 2, { traits: ["グラブル", "十天衆"] }),
  testTreasure("T-WATER", { name: "水晶のエレメント", traits: ["グラブル", "水属性"] }),
];
const SCRIPTS: Record<string, CardScript> = { "T-WATER": defineCard({ abilities: [uncapAbility("水属性", "instead")] }) };
const E = createEngine({ cards: [...TEST_CARDS, ...CARDS], scripts: { ...TEST_SCRIPTS, ...SCRIPTS } });
const d = (spec: DriveSpec) => drive(E, spec);

// ---- The guard: a trait is referenced only through traitMatches ----

/** A string literal at a given offset (sticky): "…", '…' or `…`. */
const STRING_AT = /"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\[\s\S])*`/y;
/** A string or a comment, whichever starts first: a "//" in a string is no comment. */
const COMMENT_OR_STRING = new RegExp(`${STRING_AT.source}|${String.raw`\/\/[^\n]*|\/\*[\s\S]*?\*\/`}`, "g");
const ONE_STRING = new RegExp(`^(?:${STRING_AT.source})$`);
/** The attribute traits and 全属性 as the card data has them, in Japanese (CR JP 14.6.2.1, JP 14.6.2.2). */
const ATTRIBUTES: readonly string[] = [...ATTRIBUTE_TRAITS, ALL_ATTRIBUTES_TRAIT];
/** An attribute trait's name in any language of the cards: 闇属性, the Chinese 暗属性 or 风属性, the traditional 屬. */
const ATTRIBUTE_NAME = /[火水土風风光闇暗全][属屬]性/g;
/** The calls that take a trait, by the index of that argument: each reads it through traitMatches (another that does may join). */
const TRAIT_ARGUMENT: Readonly<Record<string, number>> = { hasTrait: 0, traitOf: 0, uncapAbility: 0, traitMatches: 1 };
/**
 * Constants keyed by the attribute traits, which read no card's traits: [file, name]. ELEMENT_OF: the element of each
 * attribute, by the trait its ability selects (uncapAbility).
 */
const ATTRIBUTE_TABLES: readonly (readonly [string, string])[] = [["script/CP05/shared.ts", "ELEMENT_OF"]];
/** A search of a trait array: traits.includes(, traits?.includes(, (traits ?? []).includes(, traits.some( … (1: the method). */
const TRAIT_SEARCH = /(?<![\w$])traits\s*!?\s*(?:\?\?\s*\[\s*\]\s*)?\)?\s*\??\.\s*(includes|indexOf|lastIndexOf|some|every|find|findIndex|findLast|findLastIndex|filter)\s*\(/g;
/** A predicate comparing with a string, `(t) => t === "…"`: a trait named in the code, which the attribute check sees. */
const COMPARES_WITH_STRING = /^\(?\s*([\w$]+)\s*\)?\s*=>\s*(?:\1\s*===?\s*(?:"[^"\n]*"|'[^'\n]*')|(?:"[^"\n]*"|'[^'\n]*')\s*===?\s*\1)$/;
/**
 * Trait arrays searched with a variable that is no reference to a trait: [file, argument]. e.change.trait: a trait an effect
 * gives is added once (CR 10.9.1.3).
 */
const NOT_REFERENCES: readonly (readonly [string, string])[] = [["engine/state/characteristics.ts", "e.change.trait"]];

/** A file's code: its comments blanked out (offsets and lines kept), its strings kept. */
function codeOf(text: string): string {
  return text.replace(COMMENT_OR_STRING, (m) => (m.startsWith("/") ? m.replace(/[^\n]/g, " ") : m));
}

/** The top-level parts, split at commas, of the brackets opening at `open` ([start, end) each; null: they never close). */
function partsOf(code: string, open: number): [number, number][] | null {
  const parts: [number, number][] = [];
  let depth = 0;
  let start = open + 1;
  for (let i = open; i < code.length; i++) {
    const ch = code[i]!;
    STRING_AT.lastIndex = i;
    const str = ch === '"' || ch === "'" || ch === "`" ? STRING_AT.exec(code) : null;
    if (str) i += str[0].length - 1;
    else if ("([{".includes(ch)) depth += 1;
    else if (")]}".includes(ch)) {
      depth -= 1;
      if (depth === 0) return [...parts, [start, i]];
    } else if (ch === "," && depth === 1) {
      parts.push([start, i]);
      start = i + 1;
    }
  }
  return null;
}

/**
 * What in a source file of the engine or the scripts could miss 全属性 (CR JP 14.6.2.2), as "<file>:<line>: <why>": an attribute
 * trait named anywhere but as the trait a call of TRAIT_ARGUMENT takes or in a table of ATTRIBUTE_TABLES, a Chinese name of one
 * (the card data's traits are Japanese: it would match nothing), and a trait array searched with anything but a string (a
 * variable may hold an attribute trait; a string is a trait named in the code, which the first check sees).
 */
function traitCheckProblems(rel: string, text: string): string[] {
  const code = codeOf(text);
  const at = (offset: number) => `${rel}:${code.slice(0, offset).split("\n").length}`;
  const allowed: [number, number][] = [];
  for (const m of code.matchAll(/(?<![\w$.])(hasTrait|traitOf|uncapAbility|traitMatches)\s*\(/g)) {
    const part = partsOf(code, m.index + m[0].length - 1)?.[TRAIT_ARGUMENT[m[1]!]!];
    if (part && ONE_STRING.test(code.slice(...part).trim())) allowed.push(part);
  }
  for (const [file, name] of ATTRIBUTE_TABLES) {
    const m = file === rel ? new RegExp(`(?<![\\w$])const\\s+${name}\\b[^=]*=\\s*\\{`).exec(code) : null;
    const end = m ? partsOf(code, m.index + m[0].length - 1)?.at(-1)?.[1] : undefined;
    if (m && end !== undefined) allowed.push([m.index, end]);
  }
  const problems: string[] = [];
  for (const m of code.matchAll(ATTRIBUTE_NAME)) {
    if (!ATTRIBUTES.includes(m[0])) problems.push(`${at(m.index)}: ${m[0]} is no trait of the card data (their traits are Japanese)`);
    else if (!allowed.some(([a, b]) => m.index >= a && m.index < b)) problems.push(`${at(m.index)}: ${m[0]} not as the trait of hasTrait, traitOf, uncapAbility or traitMatches`);
  }
  for (const m of code.matchAll(TRAIT_SEARCH)) {
    const first = partsOf(code, m.index + m[0].length - 1)?.[0];
    const arg = first ? code.slice(...first).trim() : "";
    // A template literal with ${…} is a computed name (`${kind}属性`): not a literal whose whole name the check above sees.
    const ok = ["includes", "indexOf", "lastIndexOf"].includes(m[1]!)
      ? (ONE_STRING.test(arg) && !arg.includes("${")) || NOT_REFERENCES.some(([file, a]) => file === rel && a === arg)
      : COMPARES_WITH_STRING.test(arg);
    if (!ok) problems.push(`${at(m.index)}: traits searched (${m[1]}) with ${arg.replace(/\s+/g, " ")}: use traitMatches`);
  }
  return problems;
}

describe("全属性 (CR JP 14.6.2)", () => {
  it("CR JP 14.6.2.2 — counts as each attribute trait where one is referenced, not as the others, and not the other way", () => {
    for (const a of ATTRIBUTE_TRAITS) expect(traitMatches(["グラブル", "全属性"], a), a).toBe(true);
    expect(traitMatches(["グラブル", "全属性"], "十天衆")).toBe(false);
    expect(traitMatches(["火属性"], "全属性")).toBe(false);
    const t = d({ me: { field: ["ALL", "ETERNAL"] } });
    const r = t.game.reader();
    expect([hasTrait("闇属性")(r, t.id("ALL")), traitOf("光属性")(r, t.id("ALL")), hasTrait("闇属性")(r, t.id("ETERNAL"))]).toEqual([true, true, false]);
    // It keeps its own traits (CR JP 14.6.2.1): the six aren't added.
    expect(r.info(t.id("ALL")).traits).toEqual(["グラブル", "全属性"]);
  });

  it("an element can select a 全属性 follower (CR JP 14.6.2.2)", () => {
    const t = d({ me: { field: ["ALL"], ex: ["T-WATER"] } });
    expect(t.canActivate("T-WATER")).toBe(true);
    expect(t.activate("T-WATER").stats("ALL")).toEqual([3, 2]);
  });

  it("every trait check of the engine and the scripts goes through traitMatches (CR JP 14.6.2.2)", () => {
    const src = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "src");
    const walk = (dir: string): string[] =>
      readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? walk(join(dir, f)) : f.endsWith(".ts") ? [join(dir, f)] : []));
    const wrong: string[] = [];
    for (const file of [...walk(join(src, "engine")), ...walk(join(src, "script"))]) {
      wrong.push(...traitCheckProblems(relative(src, file).replaceAll("\\", "/"), readFileSync(file, "utf8")));
    }
    expect(wrong).toEqual([]);
  }, 60_000); // it reads every source file of the two: much longer while the whole suite runs in parallel

  it("the guard sees the look-back forms of the scripts (CR 10.7.4.1) and a trait in a variable, and lets a named trait check through", () => {
    const flagged = (code: string, rel = "script/X.ts") => traitCheckProblems(rel, code).length > 0;
    const missed = [
      `m.before?.traits?.includes("闇属性") === true`,
      `(m.before.traits ?? []).includes("闇属性")`,
      `m.before.traits.some((t) => t === "闇属性")`,
      `m.before?.traits?.includes(trait) ?? false`,
      `(c.traits ?? []).includes(trait)`,
      `c.traits.some((t) => t === trait)`,
      `c.traits.find((t) => t.endsWith("属性"))`,
      `const DARK = "闇属性";`,
      `const WEIGHT = { 闇属性: 1 };`,
      `const dark = hasTrait("暗属性");`,
      `export const ELEMENT_OF = { 闇属性: DARK_ELEMENT };`,
      `if (!traits.includes(e.change.trait)) traits.push(e.change.trait);`,
    ].filter((code) => !flagged(code));
    expect(missed).toEqual([]);
    const passed = [
      `const dark = hasTrait("闇属性"), earth = traitOf("土属性");`,
      `(cause) => traitMatches(cause.traits, "闇属性")`,
      `abilities: [uncapAbility("闇属性", "instead")]`,
      `m.before?.traits?.includes("乗物") === true`,
      `(m.before.traits ?? []).includes("八獄") && c.traits.some((t) => t === "妖怪")`,
      `const dark = hasTrait("闇属性"); // not traits.includes(trait), nor "闇属性" alone`,
    ].filter((code) => flagged(code));
    expect(passed).toEqual([]);
    // Where they are allowed: the engine adding an effect's trait (NOT_REFERENCES), the elements' table (ATTRIBUTE_TABLES).
    expect(flagged(`if (!traits.includes(e.change.trait)) traits.push(e.change.trait);`, "engine/state/characteristics.ts")).toBe(false);
    expect(flagged(`export const ELEMENT_OF: Readonly<Record<string, string>> = {\n  闇属性: DARK_ELEMENT,\n};`, "script/CP05/shared.ts")).toBe(false);
  });
});
