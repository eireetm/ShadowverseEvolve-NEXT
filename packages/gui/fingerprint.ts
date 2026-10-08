import { createHash, type Hash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * The online fingerprint of what decides how a game goes. Two programs play one game, or one watches the other's, only when
 * theirs are the same (each answer also carries the game state's hash: a difference that slips through stops the game,
 * src/engine/game-host.ts). It counts:
 *  - the core's code: the rules, the card scripts, the loading of the card data (engineCode);
 *  - what the rules read of the card data (rulesDataOf);
 *  - the worker that runs a game (src/engine; not client.ts, the page's side of it).
 * Not, so that they don't part players: comments and the code's layout (codeOf); the card texts and the English, Chinese and
 * alternate names; the modules that build the card data files (CARD_DATA_BUILD) and the core's test helpers. `gui` is
 * packages/gui. vite.config.ts builds it into the app; scripts/release-pc.ts writes it into a release's VERSION.txt.
 */
export function engineFingerprint(gui: string): string {
  const hash = createHash("sha256");
  // How it is made: made another way, every program's value is another one.
  hash.update("engine 2\n");
  for (const { name, file } of engineCode(gui)) add(hash, name, codeOf(readFileSync(file, "utf8")));
  const data = join(gui, "..", "core", "data");
  for (const name of readdirSync(data).filter((n) => n.endsWith(".json")).sort()) {
    add(hash, `data/${name}`, rulesDataOf(JSON.parse(readFileSync(join(data, name), "utf8"))));
  }
  return hash.digest("hex").slice(0, 16);
}

/**
 * The core's alone, its source and card data as they are (comments too): what games played without the app depend on — the
 * training kit's, taken back by npm run rl:ingest (a change of the app's worker host doesn't make them another engine's).
 * The kits and replay certificates recorded these values, so the way it is made stays.
 */
export function rulesFingerprint(gui: string): string {
  const hash = createHash("sha256");
  const walk = (root: string, dir: string) => {
    for (const name of readdirSync(dir).sort()) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(root, full);
      else if (/\.(ts|json)$/.test(name)) {
        hash.update(relative(root, full).split("\\").join("/"));
        hash.update(readFileSync(full, "utf8").replace(/\r\n/g, "\n"));
      }
    }
  };
  for (const dir of ["../core/src", "../core/data"]) walk(join(gui, dir), join(gui, dir));
  return hash.digest("hex").slice(0, 16);
}

function add(hash: Hash, name: string, content: string): void {
  hash.update(name);
  hash.update("\0");
  hash.update(content);
  hash.update("\0");
}

/**
 * The card data's build pipeline in packages/core/src/data (tools/build-card-data.ts: scraped data, fixes, translations ->
 * the data files). It only shapes the data files, which count by what the rules read; the game loads them with the other
 * modules there (database.ts, set-file.ts, universes.ts, errors.ts), which count.
 */
export const CARD_DATA_BUILD: ReadonlySet<string> = new Set(["custom.ts", "english-text.ts", "fixes.ts", "normalize.ts", "preview.ts", "preview-bp22.ts", "raw.ts"]);

/** The code files the online fingerprint counts, by name ("core/engine/flow/attack.ts", "engine/game-host.ts"). */
export function engineCode(gui: string): { name: string; file: string }[] {
  const out: { name: string; file: string }[] = [];
  const walk = (prefix: string, root: string, dir: string, skip: (path: string) => boolean) => {
    for (const entry of readdirSync(dir).sort()) {
      const full = join(dir, entry);
      const path = relative(root, full).split("\\").join("/");
      if (skip(path)) continue;
      if (statSync(full).isDirectory()) walk(prefix, root, full, skip);
      else if (entry.endsWith(".ts")) out.push({ name: `${prefix}/${path}`, file: full });
    }
  };
  const core = join(gui, "..", "core", "src");
  walk("core", core, core, (path) => path === "testing" || (path.startsWith("data/") && CARD_DATA_BUILD.has(path.slice(5))));
  const worker = join(gui, "src", "engine");
  walk("engine", worker, worker, (path) => path === "client.ts");
  return out;
}

/**
 * A card set file (packages/core/data) with what the rules read of its cards: not their texts, nor their English, Chinese and
 * alternate names (the rules know a card by its card name, CR 2.13.2; BP22-059 reads the Japanese name). Keys in order: how
 * the file orders them doesn't count either.
 */
export function rulesDataOf(file: unknown): string {
  const set = file as Record<string, unknown> & { cards?: Record<string, unknown>[] };
  const cards = (set.cards ?? []).map((card) => {
    const kept: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(card)) if (key !== "text" && key !== "names" && key !== "alternateNames") kept[key] = value;
    kept.names = { ja: (card.names as { ja?: unknown } | undefined)?.ja ?? null };
    return kept;
  });
  return canonical({ ...set, cards });
}

/** JSON with each object's keys in order. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/** Words an expression can follow: after them a "/" starts a regular expression, not a division. */
const BEFORE_EXPRESSION = new Set(["return", "typeof", "instanceof", "in", "of", "new", "delete", "void", "throw", "case", "do", "else", "yield", "await", "extends"]);
const WORD = /[\w$\u0080-\uffff]/;
const SPACE = /[\s\ufeff]/;
const LINE_BREAK = /[\n\r\u2028\u2029]/;

/** Two tokens that would read as one without a space between them: two words, "+ +", "- -", "/ /", "/ *". */
function joins(last: string, first: string): boolean {
  return (WORD.test(last) && WORD.test(first)) || (last === first && (last === "+" || last === "-")) || (last === "/" && (first === "/" || first === "*"));
}

/**
 * Code without what doesn't run: comments go, and so does its layout — tokens stay apart by one space only where they
 * would join (joins), and by one line break where there was one (a line break can end a statement, ASI). Strings,
 * template literals and regular expressions stay as they are written. Not a parser: a "/" starts a regular expression where
 * an expression can start (after an operator, "(", ",", "return" ...); test/fingerprint.test.ts checks that every counted
 * file reads the same before and after.
 */
export function codeOf(source: string): string {
  const n = source.length;
  let out = "";
  // The last token: a word, "0" for a literal (string, template, regular expression), or a sign.
  let prev = "";
  // What separates the next token from the last: nothing, space, or a line break.
  let gap = "" as "" | " " | "\n";
  // Open braces: a block or object "{", or a template literal's "${".
  const braces: ("{" | "${")[] = [];
  const emit = (token: string, kind: string) => {
    if (out !== "" && (gap === "\n" || (gap === " " && joins(out[out.length - 1]!, token[0]!)))) out += gap;
    gap = "";
    out += token;
    prev = kind;
  };
  // A template literal's text from its "`" or a substitution's "}" to its end "`" or the next "${".
  const template = (start: number): number => {
    let j = start + 1;
    while (j < n) {
      const c = source[j]!;
      if (c === "\\") j += 2;
      else if (c === "`") {
        emit(source.slice(start, j + 1), "0");
        return j + 1;
      } else if (c === "$" && source[j + 1] === "{") {
        emit(source.slice(start, j + 2), "{");
        braces.push("${");
        return j + 2;
      } else j++;
    }
    emit(source.slice(start), "0");
    return n;
  };
  let i = 0;
  while (i < n) {
    const c = source[i]!;
    const next = source[i + 1];
    if (SPACE.test(c)) {
      gap = LINE_BREAK.test(c) || gap === "\n" ? "\n" : " ";
      i++;
    } else if (c === "/" && next === "/") {
      while (i < n && !LINE_BREAK.test(source[i]!)) i++;
      if (gap === "") gap = " ";
    } else if (c === "/" && next === "*") {
      const close = source.indexOf("*/", i + 2);
      const end = close < 0 ? n : close + 2;
      gap = LINE_BREAK.test(source.slice(i, end)) || gap === "\n" ? "\n" : " ";
      i = end;
    } else if (c === "'" || c === '"') {
      let j = i + 1;
      while (j < n && source[j] !== c && !LINE_BREAK.test(source[j]!)) j += source[j] === "\\" ? 2 : 1;
      emit(source.slice(i, j + 1), "0");
      i = j + 1;
    } else if (c === "`") {
      i = template(i);
    } else if (c === "}" && braces[braces.length - 1] === "${") {
      braces.pop();
      i = template(i);
    } else if (c === "/" && (prev === "" || (WORD.test(prev[0]!) ? BEFORE_EXPRESSION.has(prev) : prev !== ")" && prev !== "]" && prev !== "0"))) {
      // A regular expression: to the "/" that ends it (not one in a character class), then its flags.
      let j = i + 1;
      let inClass = false;
      while (j < n && !LINE_BREAK.test(source[j]!)) {
        const d = source[j]!;
        if (d === "\\") j += 2;
        else {
          if (d === "[") inClass = true;
          else if (d === "]") inClass = false;
          else if (d === "/" && !inClass) break;
          j++;
        }
      }
      j++;
      while (j < n && WORD.test(source[j]!)) j++;
      emit(source.slice(i, j), "0");
      i = j;
    } else if (WORD.test(c)) {
      let j = i + 1;
      while (j < n && WORD.test(source[j]!)) j++;
      const word = source.slice(i, j);
      emit(word, word);
      i = j;
    } else {
      if (c === "{") braces.push("{");
      else if (c === "}") braces.pop();
      emit(c, c);
      i++;
    }
  }
  return out;
}
