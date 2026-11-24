import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CITATION_DIRS, citationProblem, loadClauses, scanCitations } from "../lib/citations";

// These scan every source file: about a second alone, much longer while the whole suite runs in parallel.
const SCAN_TIMEOUT = 60_000;

/**
 * Every rule decision must name its Comprehensive Rules clause. This test makes
 * sure every cited clause exists in the current rules (tools/data/cr-clauses.json), so a rules
 * update that renumbers or removes clauses cannot silently leave stale citations behind.
 * A "CR JP <number>" citation must be a clause only the Japanese rules have
 * (tools/data/cr-clauses-ja.json): the editions number some other clauses differently.
 */
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

describe("Comprehensive Rules citations", () => {
  it("every clause cited in the core exists in the current rules", () => {
    const en = new Set(loadClauses(root).clauses);
    const ja = new Set(loadClauses(root, "ja").clauses);
    const wrong = scanCitations(root, CITATION_DIRS).flatMap((c) => {
      const problem = citationProblem(c, en, ja);
      return problem ? [`${c.file}:${c.line} cites ${c.lang === "ja" ? "JP " : ""}${c.clause}: ${problem}`] : [];
    });
    expect(wrong).toEqual([]);
  }, SCAN_TIMEOUT);

  it("tells the two editions apart", () => {
    const en = new Set(loadClauses(root).clauses);
    const ja = new Set(loadClauses(root, "ja").clauses);
    const at = { file: "x.ts", line: 1 };
    expect(citationProblem({ ...at, clause: "14.6.4.1", lang: "ja" }, en, ja)).toBeNull();
    expect(citationProblem({ ...at, clause: "14.6.4.1", lang: "en" }, en, ja)).toBe("not in the English rules");
    expect(citationProblem({ ...at, clause: "10.5.2.2", lang: "ja" }, en, ja)).toMatch(/English rules have/);
  });

  it("finds citations in the engine", () => {
    const cited = new Set(scanCitations(root, CITATION_DIRS).map((c) => c.clause));
    for (const clause of ["6.2.1.8", "7.2.4.1", "8.4.3.1", "10.5.2.2", "11.3.2", "12.2.3", "5.16.1.2"]) {
      expect(cited.has(clause), clause).toBe(true);
    }
  }, SCAN_TIMEOUT);
});
