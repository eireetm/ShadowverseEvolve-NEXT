import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { parseAst } from "rolldown/parseAst";
import { afterAll, describe, expect, it } from "vitest";
import { codeOf, engineCode, engineFingerprint } from "../fingerprint";

// The online fingerprint (fingerprint.ts): what decides how a game goes counts, comments, the code's layout, card texts and
// translated names don't. Checked on a small tree of its own, and on the real code: each counted file reads the same after
// codeOf, and the counted code doesn't use a module that isn't counted.

const GUI = join(__dirname, "..");

describe("the code without comments and layout", () => {
  it("keeps one space where tokens would join, a line break where there was one", () => {
    expect(codeOf("const a = 1; // one\n\n/* two */ let  b =\n  a + 2;")).toBe("const a=1;\nlet b=\na+2;");
    expect(codeOf("a + +b; c - -d; e / /f/")).toBe("a+ +b;c- -d;e/ /f/");
    // A line break can end a statement: it stays (ASI).
    expect(codeOf("return\nx")).toBe("return\nx");
  });

  it("keeps strings, template literals and regular expressions as written", () => {
    expect(codeOf('const s = "a  // b"; const t = `x ${ /* c */ y } z`; const r = /\\/\\/ +/g;')).toBe(
      'const s="a  // b";const t=`x ${y} z`;const r=/\\/\\/ +/g;',
    );
    expect(codeOf("f(`a ${`b ${c}`} d`) / 2")).toBe("f(`a ${`b ${c}`} d`)/2");
    expect(codeOf("x = a / b / c; y = /[/]x/.test(s)")).toBe("x=a/b/c;y=/[/]x/.test(s)");
  });
});

describe("the online fingerprint", () => {
  // A tree like the repository's: packages/core/src, packages/core/data, packages/gui/src/engine.
  const root = mkdtempSync(join(tmpdir(), "sve-fingerprint-"));
  afterAll(() => rmSync(root, { recursive: true, force: true }));
  const files: Record<string, string> = {
    "core/src/rules.ts": "// The rules.\nexport const LIMIT = 5;\n",
    "core/src/data/database.ts": "export const LOADED = true;\n",
    "core/src/data/fixes.ts": 'export const FIX = "汉字";\n',
    "core/src/testing/driver.ts": "export const DRIVE = 1;\n",
    "gui/src/engine/game-host.ts": "export function pace(): number {\n  return 1;\n}\n",
    "gui/src/engine/client.ts": "export const PAGE = 1;\n",
  };
  const card = { id: "X-001", name: "Knight", names: { en: "Knight", cn: "骑士", ja: "ナイト" }, cost: 1, text: { en: "Ward.", cn: "【守护】", ja: "【守護】" }, traits: ["兵士"] };
  const write = (changes: Record<string, string> = {}, data: Record<string, unknown> = card) => {
    rmSync(join(root, "core"), { recursive: true, force: true });
    rmSync(join(root, "gui"), { recursive: true, force: true });
    for (const [path, text] of Object.entries({ ...files, ...changes })) {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), text);
    }
    mkdirSync(join(root, "core", "data"), { recursive: true });
    writeFileSync(join(root, "core", "data", "X.json"), JSON.stringify({ format: 1, set: "X", printings: 1, cards: [data] }));
    return engineFingerprint(join(root, "gui"));
  };
  const base = write();

  it("doesn't change with comments, layout, card texts, English and Chinese names, the data build and the page's side", () => {
    expect(write({ "core/src/rules.ts": "/** How many. */\n\nexport   const LIMIT =   5; // five\n" })).toBe(base);
    expect(write({ "gui/src/engine/game-host.ts": "export function pace() : number {\n\n      return 1; // one\n  }\n" })).toBe(base);
    expect(write({}, { ...card, text: { en: "Ward. (fixed)", cn: "【守护】。", ja: "【守護】" }, names: { en: "Knight!", cn: "骑士！", ja: "ナイト" } })).toBe(base);
    expect(write({}, { ...card, alternateNames: { "X-001a": { en: "Sir", cn: "爵士", ja: "サー" } } })).toBe(base);
    const { id, ...rest } = card;
    expect(write({}, { ...rest, id })).toBe(base);
    expect(write({ "core/src/data/fixes.ts": 'export const FIX = "漢字";\n' })).toBe(base);
    expect(write({ "core/src/testing/driver.ts": "export const DRIVE = 2;\n" })).toBe(base);
    expect(write({ "gui/src/engine/client.ts": "export const PAGE = 2;\n" })).toBe(base);
  });

  it("changes with the rules code, the worker, and what the rules read of a card", () => {
    expect(write({ "core/src/rules.ts": "export const LIMIT = 6;\n" })).not.toBe(base);
    expect(write({ "core/src/data/database.ts": "export const LOADED = false;\n" })).not.toBe(base);
    expect(write({ "gui/src/engine/game-host.ts": "export function pace(): number {\n  return 2;\n}\n" })).not.toBe(base);
    expect(write({}, { ...card, cost: 2 })).not.toBe(base);
    expect(write({}, { ...card, name: "Knightess" })).not.toBe(base);
    expect(write({}, { ...card, names: { ...card.names, ja: "ナイトX" } })).not.toBe(base);
    expect(write({}, { ...card, traits: ["兵士", "指揮官"] })).not.toBe(base);
  });
});

describe("the counted code", () => {
  const counted = engineCode(GUI);

  it("reads the same after codeOf: each file parses to the same program", () => {
    const shape = (code: string) =>
      JSON.stringify(parseAst(code, { lang: "ts" }), (key, value: unknown) => (["start", "end", "range", "loc", "comments"].includes(key) ? undefined : value));
    const differ: string[] = [];
    for (const { name, file } of counted) {
      const source = readFileSync(file, "utf8");
      if (shape(source) !== shape(codeOf(source))) differ.push(name);
    }
    expect(counted.length).toBeGreaterThan(3000);
    expect(differ).toEqual([]);
  }, 180_000);

  it("uses only counted modules (and the bots, which don't play online games; and the card data files)", () => {
    const files = new Set(counted.map((c) => resolve(c.file)));
    const data = resolve(GUI, "..", "core", "data");
    const outside: string[] = [];
    for (const { name, file } of counted) {
      const source = readFileSync(file, "utf8");
      // Imports and re-exports of values (types don't run), side-effect and dynamic imports.
      const specs = [
        ...source.matchAll(/^\s*(?:import|export)\s+(?!type\b)[^;]*?\bfrom\s+"([^"]+)"/gm),
        ...source.matchAll(/^\s*import\s+"([^"]+)"/gm),
        ...source.matchAll(/\bimport\(\s*"([^"]+)"\s*\)/g),
      ].map((m) => m[1]!);
      for (const spec of specs) {
        if (spec.startsWith("@sve/bot")) continue;
        // The core package's paths are its src folder's (packages/core/package.json "exports").
        const base =
          spec === "@sve/core" || spec.startsWith("@sve/core/")
            ? resolve(GUI, "..", "core", "src", spec.slice("@sve/core".length).replace(/^\//, ""))
            : spec.startsWith(".")
              ? resolve(dirname(file), spec)
              : null;
        if (base === null) continue;
        const target = [`${base}.ts`, join(base, "index.ts"), base].find((p) => existsSync(p) && statSync(p).isFile()) ?? base;
        if (target.endsWith(".json") && target.startsWith(data)) continue;
        if (!files.has(target)) outside.push(`${name} -> ${spec}`);
      }
    }
    expect(outside).toEqual([]);
  }, 180_000);
});
