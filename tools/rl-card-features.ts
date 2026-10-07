/**
 * The card feature table (packages/bot/src/card-features.ts): npm run rl:features [--check]
 * Builds every definition's row from the card data, the scripts' declared fields and what their code does and counts
 * (tools/rl/script-analysis.ts) and writes packages/bot/src/card-features.json, then
 * tells which rows were added, changed or removed since the file there, and per column how many definitions use it in the
 * whole pool and in the sample decks of the training sets (a column no deck uses can't be learned yet). With --check it
 * writes nothing and fails when the file isn't what the code builds (a script's declared fields changed: the definitions in
 * the training decks then mean encoding the data again and training again).
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildCardFeatureFile, CARD_FEATURE_COLUMNS, cardFeatureFileText, type CardFeatureFile } from "../packages/bot/src";
import { createEngine } from "../packages/core/src";
import { ALL_CARDS, ALL_SCRIPTS } from "../packages/core/src/sets";
import { rulesFingerprint } from "../packages/gui/fingerprint";
import { analyzeScripts } from "./rl/script-analysis";
import { DECK_SETS, ROOT, sampleDeck } from "./rl/series";

const check = process.argv.includes("--check");
const target = join(ROOT, "packages", "bot", "src", "card-features.json");
const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");
const analyses = analyzeScripts(ALL_SCRIPTS);
const file = buildCardFeatureFile(ALL_CARDS, ALL_SCRIPTS, rulesFingerprint(join(ROOT, "packages", "gui")), sha256, (def) => analyses.get(def));
const text = cardFeatureFileText(file);
const old = existsSync(target) ? (JSON.parse(readFileSync(target, "utf8")) as CardFeatureFile) : null;

const engine = createEngine({ cards: ALL_CARDS, scripts: ALL_SCRIPTS });
const deckDefs = new Set<string>();
for (const name of [...DECK_SETS.train, ...DECK_SETS.holdout]) {
  const deck = sampleDeck(name)!.deck;
  for (const p of [...deck.main, ...deck.evolve]) deckDefs.add(engine.db.ofPrinting(p).id);
}
const uses = (ids: Iterable<string>) => {
  const n = new Array<number>(CARD_FEATURE_COLUMNS.length).fill(0);
  for (const id of ids) for (const [i] of file.rows[id] ?? []) n[i]! += 1;
  return n;
};
const inPool = uses(Object.keys(file.rows));
const inDecks = uses(deckDefs);
console.log(`${Object.keys(file.rows).length} definitions, ${CARD_FEATURE_COLUMNS.length} columns; ${deckDefs.size} definitions in the 15 sample decks; hash ${file.hash}`);
console.log(`columns no definition uses: ${CARD_FEATURE_COLUMNS.filter((_, i) => inPool[i] === 0).join(" ") || "none"}`);
console.log(`columns no deck of the training sets uses: ${CARD_FEATURE_COLUMNS.filter((_, i) => inDecks[i] === 0).join(" ") || "none"}`);
if (old) {
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  const added = Object.keys(file.rows).filter((id) => !(id in old.rows));
  const removed = Object.keys(old.rows).filter((id) => !(id in file.rows));
  const changed = Object.keys(file.rows).filter((id) => id in old.rows && !same(old.rows[id], file.rows[id]));
  const changedInDecks = changed.filter((id) => deckDefs.has(id));
  console.log(`since the file: ${added.length} added, ${changed.length} changed (${changedInDecks.length} in the sample decks${changedInDecks.length ? `: ${changedInDecks.join(" ")}` : ""}), ${removed.length} removed`);
  if (old.columnsHash !== file.columnsHash) console.log("the columns changed: a new version of the table");
}
if (check) {
  const current = existsSync(target) ? readFileSync(target, "utf8").replace(/\r\n/g, "\n") : "";
  if (current !== text) {
    console.error("card-features.json isn't what the code builds: npm run rl:features");
    process.exit(1);
  }
  console.log("card-features.json is up to date");
} else {
  writeFileSync(target, text);
  console.log(`-> ${target}`);
}
