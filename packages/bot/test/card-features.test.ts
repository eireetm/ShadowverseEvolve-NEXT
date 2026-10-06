import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ALL_CARDS, ALL_SCRIPTS } from "../../core/src/sets";
import { rulesFingerprint } from "../../gui/fingerprint";
import { buildCardFeatureFile, CARD_FEATURE_COLUMNS, cardFeatureFileText, cardFeatureTable, KNOWN_SCRIPT_KEYS, type CardFeatureFile } from "../src";

// The card feature table (card-features.json): it is what the code builds from the card data and scripts, every field a
// script declares is either read or left out on purpose, and its values are small whole numbers.
const JSON_PATH = join(__dirname, "..", "src", "card-features.json");
const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

describe("card-features.json", () => {
  it("is what the code builds (else: npm run rl:features), with its hashes", () => {
    const built = buildCardFeatureFile(ALL_CARDS, ALL_SCRIPTS, rulesFingerprint(join(__dirname, "..", "..", "gui")), sha256);
    const committed = readFileSync(JSON_PATH, "utf8").replace(/\r\n/g, "\n");
    expect(committed).toBe(cardFeatureFileText(built));
    const file = JSON.parse(committed) as CardFeatureFile;
    expect(file.columns).toEqual([...CARD_FEATURE_COLUMNS]);
    expect(Object.keys(file.rows).sort()).toEqual(ALL_CARDS.map((d) => d.id).sort());
  }, 60_000);

  it("holds whole numbers from 0 to 2047, a row for every definition and back face, read back densely", () => {
    const file = JSON.parse(readFileSync(JSON_PATH, "utf8")) as CardFeatureFile;
    const table = cardFeatureTable(file);
    const bad: string[] = [];
    for (const def of ALL_CARDS) {
      if (!table.known(def.id)) bad.push(`${def.id}: no row`);
      for (const v of table.row(def.id)) if (!(Number.isInteger(v) && v >= 0 && v <= 2047)) bad.push(`${def.id}: ${v}`);
    }
    expect(bad.slice(0, 10)).toEqual([]);
    for (const [front, back] of Object.entries(file.backFace)) expect(table.known(back), `${front} -> ${back}`).toBe(true);
    expect(table.known("NO-SUCH-CARD")).toBe(false);
    expect([...table.row("NO-SUCH-CARD")].every((v) => v === 0)).toBe(true);
  }, 60_000);
});

describe("the script fields", () => {
  it("are all read or left out on purpose (a new kind of field needs a column or a reason)", () => {
    const strange = new Set<string>();
    const known = (kind: keyof typeof KNOWN_SCRIPT_KEYS, obj: object | undefined, where: string) => {
      if (!obj) return;
      const allowed = new Set<string>([...KNOWN_SCRIPT_KEYS[kind], ...KNOWN_SCRIPT_KEYS.ignored]);
      for (const k of Object.keys(obj)) if (!allowed.has(k)) strange.add(`${kind}.${k} (${where})`);
    };
    const ability = (a: Record<string, unknown>, where: string) => {
      known("ability", a, where);
      known("cost", a.cost as object | undefined, where);
      for (const t of (a.targets as object[] | undefined) ?? []) known("target", t, where);
      for (const m of (a.modes as Record<string, unknown>[] | undefined) ?? []) {
        known("mode", m, where);
        for (const t of (m.targets as object[] | undefined) ?? []) known("target", t, where);
      }
    };
    for (const [id, script] of Object.entries(ALL_SCRIPTS)) {
      known("script", script, id);
      known("field", script.field, id);
      known("exPassives", script.exPassives, id);
      known("equipment", script.equipment, id);
      for (const a of script.abilities ?? []) ability(a as unknown as Record<string, unknown>, id);
      for (const a of script.equipment?.abilities ?? []) ability(a as unknown as Record<string, unknown>, id);
      for (const o of script.playOptions ?? []) known("playOption", o, id);
    }
    expect([...strange].slice(0, 20)).toEqual([]);
  });
});
