import { describe, expect, it } from "vitest";
import { W1_TERMS, compareW1ByName, storedTerms, w1Columns } from "../rl/eval-terms";

// An older encoding's w1 against a run with a term appended since (enc-v2-finish's C10): compared by column name.
describe("w1 arrays of two layouts", () => {
  const before = W1_TERMS.slice(0, W1_TERMS.indexOf("treasure"));
  const oldColumns = w1Columns(before);
  const newColumns = w1Columns();
  /** Two rows a layout: each term's value is its index plus 10 × the row, per side (opp + 100); the appended term as given. */
  const rowsOf = (columns: readonly string[], added: number) =>
    [0, 1].flatMap((r) =>
      columns.map((c) => {
        const [, side, term] = /^w1\.(me|opp)\.(.+)$/.exec(c)!;
        return term === "treasure" ? added : W1_TERMS.indexOf(term as never) + 10 * r + (side === "opp" ? 100 : 0);
      }),
    );

  it("is 24 terms a side before the treasure term, read back by storedTerms", () => {
    expect([oldColumns.length, newColumns.length]).toEqual([48, 2 * W1_TERMS.length]);
    expect(storedTerms(oldColumns)).toEqual(before);
    expect(storedTerms(newColumns)).toEqual([...W1_TERMS]);
  });

  it("finds the same samples the same, though every opp column moved; counts the appended term where it isn't 0", () => {
    const same = compareW1ByName({ columns: oldColumns, data: rowsOf(oldColumns, 0) }, { columns: newColumns, data: rowsOf(newColumns, 0) }, 2);
    expect(same).toEqual({ shared: 48, differ: 0, missing: [], added: ["w1.me.treasure", "w1.opp.treasure"], addedNonZero: 0 });
    const treasures = compareW1ByName({ columns: oldColumns, data: rowsOf(oldColumns, 0) }, { columns: newColumns, data: rowsOf(newColumns, 1) }, 2);
    expect([treasures.differ, treasures.addedNonZero]).toEqual([0, 4]);
  });

  it("finds a changed value, and a column the newer layout lost", () => {
    const changed = rowsOf(newColumns, 0);
    const at = newColumns.length + newColumns.indexOf("w1.opp.hand");
    changed[at] = changed[at]! + 1;
    expect(compareW1ByName({ columns: oldColumns, data: rowsOf(oldColumns, 0) }, { columns: newColumns, data: changed }, 2).differ).toBe(1);
    const lost = newColumns.filter((c) => c !== "w1.me.leader");
    const r = compareW1ByName({ columns: oldColumns, data: rowsOf(oldColumns, 0) }, { columns: lost, data: rowsOf(lost, 0) }, 2);
    expect(r.missing).toEqual(["w1.me.leader"]);
  });
});
