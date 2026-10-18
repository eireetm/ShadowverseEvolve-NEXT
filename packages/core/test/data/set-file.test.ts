import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readCardSetFile } from "../../src/data/set-file";

// The data files (tools/build-card-data.ts): a set's definitions in <SET>.json, their texts in a file per language
// (<SET>_en.json, <SET>_cn.json, <SET>_ja.json), merged again when the set is loaded.

const DATA = join(__dirname, "..", "..", "data");
const card = { id: "X-001", printings: ["X-001"], name: "Knight", names: { en: "Knight", cn: "骑士", ja: "ナイト" }, class: "Neutral", type: "follower", evolved: false, token: false, cost: 1, attack: 1, defense: 1, traits: [] };
const set = (cards: object[]) => ({ format: 2, set: "X", printings: cards.length, cards });
const texts = (en: object, cn: object = {}, ja: object = {}) => ({
  en: { format: 1, set: "X", lang: "en", cards: en },
  cn: { format: 1, set: "X", lang: "cn", cards: cn },
  ja: { format: 1, set: "X", lang: "ja", cards: ja },
});

describe("a set's data files", () => {
  it("give each definition its texts: none is an empty English text, no Chinese or Japanese one", () => {
    const loaded = readCardSetFile(set([card, { ...card, id: "X-002", printings: ["X-002"], name: "Squire" }]), texts({ "X-001": "Ward." }, { "X-001": "【守护】" }, { "X-002": "" }));
    expect(loaded.cards.map((c) => c.text)).toEqual([
      { en: "Ward.", cn: "【守护】", ja: null },
      { en: "", cn: null, ja: "" },
    ]);
  });

  it("must agree: the format, each text file's set and language, and only the set's definitions", () => {
    expect(() => readCardSetFile({ ...set([card]), format: 1 }, texts({}))).toThrow(/re-run npm run build:cards/);
    expect(() => readCardSetFile(set([card]), { ...texts({}), cn: { format: 1, set: "Y", lang: "cn", cards: {} } })).toThrow(/X_cn\.json: it says set Y/);
    expect(() => readCardSetFile(set([card]), texts({ "X-009": "?" }))).toThrow(/X_en\.json: X-009 is not a definition of X/);
  });

  it("hold, in each set's file, definitions whose ids start with the set's code (a player's text file replaces them by it)", () => {
    const wrong: string[] = [];
    for (const name of readdirSync(DATA).filter((n) => /^[A-Za-z0-9]+\.json$/.test(n))) {
      const file = JSON.parse(readFileSync(join(DATA, name), "utf8")) as { set: string; cards: { id: string }[] };
      for (const c of file.cards) if (!c.id.startsWith(`${file.set}-`)) wrong.push(`${name}: ${c.id}`);
    }
    expect(wrong).toEqual([]);
  });
});
