/**
 * Extract the clause numbers (and section titles) of a Comprehensive Rules PDF into
 * tools/data/cr-clauses.json (the English rules) or tools/data/cr-clauses-ja.json (the Japanese
 * rules, `--lang ja`). Only numbers and short titles are stored, not the rules text.
 *
 *   npm run rules:clauses                       # the English rules in ../rules/
 *   npm run rules:clauses -- --lang ja          # the Japanese rules in ../rules/
 *   npm run rules:clauses -- --pdf <file> --pdftotext <exe>
 *
 * Needs `pdftotext` (poppler; Git for Windows ships one in mingw64/bin).
 * The code cites the English rules. The Japanese rules come out first, so they can have clauses
 * the English ones don't have yet (a new universe's rules): those are cited as "CR JP <number>".
 * When the rules are updated, re-run this and `npm run rules:index`: citations of clauses
 * that no longer exist fail the citation test, and git diff of the JSON shows what changed.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const lang = arg("lang") ?? "en";
if (lang !== "en" && lang !== "ja") throw new Error(`--lang must be en or ja, not ${lang}`);

/** The rules folder also holds other PDFs (the Chinese quick guide): pick the language's rules by name. */
function findPdf(): string {
  const explicit = arg("pdf");
  if (explicit) return resolve(explicit);
  const dir = join(repoRoot, "..", "rules");
  const name = lang === "ja" ? /cr_jpn/i : /comprehensive-rules/i;
  const pdfs = readdirSync(dir).filter((f) => f.toLowerCase().endsWith(".pdf") && name.test(f)).sort();
  if (pdfs.length === 0) throw new Error(`no ${lang === "ja" ? "Japanese" : "English"} rules PDF in ${dir}`);
  return join(dir, pdfs[pdfs.length - 1]!);
}

function findPdftotext(): string {
  const candidates = [
    arg("pdftotext"),
    process.env.PDFTOTEXT,
    "C:\Program Files\Git\mingw64\bin\pdftotext.exe",
    "pdftotext",
  ].filter((x): x is string => !!x);
  return candidates.find((c) => c === "pdftotext" || existsSync(c))!;
}

const pdf = findPdf();
const text = execFileSync(findPdftotext(), ["-enc", "UTF-8", pdf, "-"], { encoding: "utf8", maxBuffer: 64 << 20 })
  .replace(/\s+/g, " ");

// "Ver. 1.26.1" in the English rules, "ver. 1.29.0" in the Japanese ones.
const version = /ver\.\s*([\d.]+)/i.exec(text)?.[1] ?? "unknown";
const clauses = new Set<string>();
for (const m of text.matchAll(/(?<![\d.])(\d{1,2}(?:\.\d{1,2}){1,6})\.\s/g)) clauses.add(m[1]!);
// Chapter headings: "1. Game Overview", "1. ゲームの概要".
const chapter = lang === "ja" ? /(?<![\d.])(\d{1,2})\.\s[\u3040-\u30ff\u3400-\u9fff]/g : /(?<![\d.])(\d{1,2})\.\s[A-Z][A-Za-z-]+/g;
for (const m of text.matchAll(chapter)) clauses.add(m[1]!);
for (const c of [...clauses]) if (c.split(".")[0] === "0") clauses.delete(c); // e.g. "... to 0. "

const sections: Record<string, string> = {};
for (const m of text.matchAll(/(?<![\d.])(\d{1,2}\.\d{1,2})\. (.{2,70}?) \1\.1\./g)) {
  sections[m[1]!] ??= m[2]!.trim();
}

const byNumber = (a: string, b: string) => {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? -1) - (pb[i] ?? -1);
    if (d !== 0) return d;
  }
  return 0;
};

const out = {
  version,
  source: basename(pdf),
  sections: Object.fromEntries(Object.entries(sections).sort(([a], [b]) => byNumber(a, b))),
  clauses: [...clauses].sort(byNumber),
};
const file = lang === "ja" ? "cr-clauses-ja.json" : "cr-clauses.json";
writeFileSync(join(repoRoot, "tools", "data", file), JSON.stringify(out, null, 1) + "\n", "utf8");
console.log(`CR ${version}: ${out.clauses.length} clause numbers, ${Object.keys(out.sections).length} sections -> tools/data/${file}`);
