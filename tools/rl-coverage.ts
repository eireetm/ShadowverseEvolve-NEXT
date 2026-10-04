/**
 * Which decisions a bot really compares: npm run rl:coverage -- <dir | games.jsonl.gz> [--games N]
 * Plays recorded games (npm run bot:arena -- ... --out) again and, at every decision, counts the legal answers the engine
 * lists (enumerateAnswers, independent of the bots) and the answers a planner bot (Medium, Hard) would compare there: in its
 * main phase the planner's branches (and ending the main phase), at the other decisions of its turn the same, at any other
 * decision its greedy bot's candidates. A decision with more than one legal answer where only one is compared is "blind":
 * the bot can never choose another answer there, so no data and no training can teach it to. Prints a table by decision
 * type and reason, the blind ones first; blind on purpose (and why) are marked as such. Also how often the fast answer
 * used inside simulations agrees with the answer recorded.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { constants, gunzipSync } from "node:zlib";
import { createEngine, enumerateAnswers, seedRng, type Answer, type Decision, type DeckList, type Input, type PlayerId } from "../packages/core/src";
import { ALL_CARDS, ALL_SCRIPTS } from "../packages/core/src/sets";
import { candidateAnswers, fastAnswer, lookupFromReader, planBranches } from "../packages/bot/src";

interface RecordedGame {
  index: number;
  seed: string;
  config: Record<string, unknown>;
  decks: { name: string; deck: DeckList }[];
  inputs: [PlayerId, Input][];
}

/** Blind on purpose: decisions with one answer compared by design, and why. */
const ON_PURPOSE: Record<string, string> = {
  chooseTurnOrder: "always first: the first player wins 54.9% of Medium mirror games",
  mulligan: "a rule (keep with 2 cards of cost 3 or less) until a learned value can compare keep and redraw",
  "orderCards:deckBottom": "the order of cards put at the bottom of the deck hardly matters",
  "selectCards:wardEnterEngaged": "a Ward follower enters reserved in its controller's turn (the end phase can engage it, CR 12.8.2 ii), engaged in the opponent's turn",
};

const args = process.argv.slice(2);
const option = (name: string) => {
  const at = args.indexOf(name);
  return at >= 0 ? (args[at + 1] ?? null) : null;
};
const path = args.find((a, i) => !a.startsWith("--") && !(i > 0 && args[i - 1] === "--games"));
const file = path && existsSync(path) && statSync(path).isDirectory() ? join(path, "games.jsonl.gz") : path;
const limit = option("--games") === null ? Infinity : Number(option("--games"));
if (!file || !existsSync(file) || !(limit >= 1)) {
  console.error("usage: npm run rl:coverage -- <dir | games.jsonl.gz> [--games N]");
  process.exit(1);
}

const engine = createEngine({ cards: ALL_CARDS, scripts: ALL_SCRIPTS });
const text = gunzipSync(readFileSync(file), { finishFlush: constants.Z_SYNC_FLUSH }).toString("utf8");
const games: RecordedGame[] = [];
for (const line of text.split("\n")) {
  if (!line.trim()) continue;
  try {
    games.push(JSON.parse(line) as RecordedGame);
  } catch {
    // a file cut short
  }
}
games.sort((a, b) => a.index - b.index);

/** An answer as a set where order doesn't matter (selections, choices). */
const canon = (a: Answer) =>
  a.type === "selectCards" ? `s${[...a.cards].sort().join(",")}` : a.type === "choose" ? `c${[...a.ids].sort().join(",")}` : a.type === "mulligan" ? `m${a.redraw}` : JSON.stringify(a);

interface Row {
  n: number;
  legal: number;
  compared: number;
  multi: number;
  blind: number;
  fastAgrees: number;
  incomplete: number;
}
const rows = new Map<string, Row>();
let played = 0;
let failed = 0;
for (const g of games.slice(0, limit)) {
  let game;
  try {
    game = engine.newGame({ seed: g.seed, players: [g.decks[0]!.deck, g.decks[1]!.deck], config: g.config });
    for (const [, input] of g.inputs) {
      const d = game.decision as Decision | null;
      if (!d) break;
      if (input.type !== "concede") {
        const st = game.state;
        const lookup = lookupFromReader(game.reader());
        const own = st.activePlayer === d.player && st.phase === "main" && d.type !== "mulligan" && d.type !== "chooseTurnOrder";
        const listed = d.type === "mainPhase" ? { answers: d.actions, complete: true } : enumerateAnswers(d, 2000);
        let compared: number;
        if (d.type === "mulligan" || d.type === "chooseTurnOrder") compared = 1;
        else if (d.type === "mainPhase") compared = planBranches(d, lookup, seedRng("coverage"), 16).length + (d.actions.some((a) => a.type === "endMainPhase") ? 1 : 0);
        else compared = new Set((own ? planBranches(d, lookup, seedRng("coverage"), 16) : candidateAnswers(d, lookup, seedRng("coverage"), 32)).map(canon)).size;
        const reason = "reason" in d ? `:${String(d.reason)}` : d.type === "quick" ? `:${d.timing}` : "";
        const key = `${d.type}${reason}`;
        const r = rows.get(key) ?? { n: 0, legal: 0, compared: 0, multi: 0, blind: 0, fastAgrees: 0, incomplete: 0 };
        rows.set(key, r);
        r.n += 1;
        r.legal += listed.answers.length;
        r.compared += compared;
        if (!listed.complete) r.incomplete += 1;
        if (listed.answers.length > 1) {
          r.multi += 1;
          if (compared <= 1) r.blind += 1;
        }
        if (canon(fastAnswer(d, lookup)) === canon(input as Answer)) r.fastAgrees += 1;
      }
      game.act(input);
    }
    played += 1;
  } catch {
    failed += 1;
  }
}

const table = [...rows.entries()].sort((a, b) => (b[1].blind > 0 ? 1 : 0) - (a[1].blind > 0 ? 1 : 0) || b[1].n - a[1].n);
console.log(`${file}: ${played} games played again${failed > 0 ? `, ${failed} didn't replay` : ""}`);
console.log("decision | count | with several legal answers | blind (one compared) | mean legal / compared | fast answer = recorded");
for (const [key, r] of table) {
  const why = ON_PURPOSE[key] ?? ON_PURPOSE[key.split(":")[0]!];
  const flag = r.blind > 0 ? (why ? " (on purpose)" : " BLIND") : "";
  console.log(
    `${key}${flag} | ${r.n} | ${r.multi} | ${r.blind} | ${(r.legal / r.n).toFixed(1)}${r.incomplete > 0 ? "+" : ""} / ${(r.compared / r.n).toFixed(1)} | ${((100 * r.fastAgrees) / r.n).toFixed(0)}%`,
  );
}
const unexplained = table.filter(([key, r]) => r.blind > 0 && !(ON_PURPOSE[key] ?? ON_PURPOSE[key.split(":")[0]!]));
console.log(unexplained.length === 0 ? "no blind decision type left unexplained" : `blind, not on purpose: ${unexplained.map(([k]) => k).join(", ")}`);
for (const [key, why] of Object.entries(ON_PURPOSE)) if (rows.get(key)?.blind) console.log(`  on purpose — ${key}: ${why}`);
