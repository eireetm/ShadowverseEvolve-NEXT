/**
 * Generate docs/rules-index.md: for every Comprehensive Rules clause cited in the core
 * (implementation and tests), where it is cited. Use it to find the code affected by a
 * rules update, or to see which clauses have tests. Clauses only the Japanese rules have
 * ("CR JP <number>") get a section of their own at the end.
 *
 *   npm run rules:index
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CITATION_DIRS, citationProblem, compareClauses, loadClauses, scanCitations, type Citation } from "./lib/citations";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cr = loadClauses(repoRoot);
const crJa = loadClauses(repoRoot, "ja");
const known = new Set(cr.clauses);
const knownJa = new Set(crJa.clauses);
const citations = scanCitations(repoRoot, CITATION_DIRS);

const group = (list: Citation[]) => {
  const map = new Map<string, Citation[]>();
  for (const c of list) {
    const refs = map.get(c.clause);
    if (refs) refs.push(c);
    else map.set(c.clause, [c]);
  }
  return map;
};
const byClause = group(citations.filter((c) => c.lang === "en"));
const byClauseJa = group(citations.filter((c) => c.lang === "ja"));
const clauses = [...byClause.keys()].sort(compareClauses);
const clausesJa = [...byClauseJa.keys()].sort(compareClauses);
const wrong = citations.flatMap((c) => {
  const problem = citationProblem(c, known, knownJa);
  return problem ? [`- ${c.lang === "ja" ? "JP " : ""}${c.clause}（${problem}）: ${fmt(c)}`] : [];
});

const chapterTitle = (ch: string) =>
  ({
    "1": "Game Overview",
    "2": "Card Information",
    "3": "Player Information",
    "4": "Zones",
    "5": "Key Notations",
    "6": "Game Preparation",
    "7": "Game Progression",
    "8": "Main Phase Processes",
    "9": "Handling Special Card Types",
    "10": "Playing and Resolving Cards and Abilities",
    "11": "Rules Handling",
    "12": "Keywords and Keyword Abilities",
    "13": "Class-Specific Information and Keywords",
    "14": "Universe-Specific Information and Keywords",
    "15": "Miscellaneous",
  })[ch] ?? "";

const lines: string[] = [
  "# 综合规则条款引用索引",
  "",
  `由 \`npm run rules:index\` 生成，勿手改。规则版本：CR ${cr.version}（${cr.source}）；只有日文版才有的条款按日文 ver. ${crJa.version}（${crJa.source}）。`,
  "",
  `共引用 ${clauses.length} 个条款，另有日文版才有的 ${clausesJa.length} 个；每个条款列出引用它的实现（src）与测试（test）位置。`,
  "",
];
if (wrong.length > 0) lines.push("## ⚠ 规则书中找不到的引用", "", ...wrong, "");
let chapter = "";
for (const clause of clauses) {
  const ch = clause.split(".")[0]!;
  if (ch !== chapter) {
    if (chapter !== "") lines.push("");
    chapter = ch;
    lines.push(`## ${ch}. ${chapterTitle(ch)}`, "");
  }
  entry(clause, byClause.get(clause)!, cr.sections);
}
if (clausesJa.length > 0) {
  lines.push("", `## 日文版才有的条款（CR JP，ver. ${crJa.version}）`, "");
  for (const clause of clausesJa) entry(clause, byClauseJa.get(clause)!, crJa.sections, "JP ");
}
// docs/ holds the local notes (not in the repository): made when missing.
mkdirSync(join(repoRoot, "docs"), { recursive: true });
writeFileSync(join(repoRoot, "docs", "rules-index.md"), lines.join("\n") + "\n", "utf8");
console.log(`${clauses.length} clauses cited (+ ${clausesJa.length} Japanese only), ${wrong.length} wrong -> docs/rules-index.md`);

function entry(clause: string, refs: Citation[], sections: Record<string, string>, prefix = ""): void {
  const src = refs.filter((r) => r.file.includes("/src/"));
  const test = refs.filter((r) => r.file.includes("/test/"));
  const section = sections[clause.split(".").slice(0, 2).join(".")];
  lines.push(`- **${prefix}${clause}**${section ? ` (${section})` : ""}`);
  if (src.length) lines.push(`  - 实现: ${dedupe(src).join(", ")}`);
  if (test.length) lines.push(`  - 测试: ${dedupe(test).join(", ")}`);
}

function fmt(c: Citation): string {
  return `${c.file}:${c.line}`;
}

function dedupe(refs: Citation[]): string[] {
  const byFile = new Map<string, number[]>();
  for (const r of refs) byFile.set(r.file, [...(byFile.get(r.file) ?? []), r.line]);
  return [...byFile].map(([file, ls]) => `\`${file.replace("packages/core/", "")}\`:${[...new Set(ls)].join(",")}`);
}
