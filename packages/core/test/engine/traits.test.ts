import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createEngine, script, type CardDefinition, type CardScript } from "../../src";
import { ATTRIBUTE_TRAITS, traitMatches } from "../../src/model/traits";
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
      const rel = relative(src, file).replaceAll("\\", "/");
      readFileSync(file, "utf8")
        .split("\n")
        .forEach((line, i) => {
          // A trait given by an effect is added once (characteristics.ts): not a reference.
          const generic = /traits\)?\.includes\(\s*[^"\s]/.test(line) && !line.includes("e.change.trait");
          const attribute = new RegExp(`traits\\)?\\.includes\\(\\s*"(${[...ATTRIBUTE_TRAITS, "全属性"].join("|")})"`).test(line);
          if (generic || attribute) wrong.push(`${rel}:${i + 1}`);
        });
    }
    expect(wrong).toEqual([]);
  });
});
