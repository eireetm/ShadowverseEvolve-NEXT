import { mkdtempSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import type { IncomingMessage } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { browserHasFile, fileTag } from "../host/file-cache";

const asking = (ifNoneMatch?: string) => ({ headers: ifNoneMatch === undefined ? {} : { "if-none-match": ifNoneMatch } }) as IncomingMessage;

describe("the local servers' file versions (ETag)", () => {
  it("a picture put back with an older date is a new file (the original copied over a test picture)", () => {
    const dir = mkdtempSync(join(tmpdir(), "sve-file-cache-"));
    try {
      const file = join(dir, "field.png");
      writeFileSync(file, "the original picture");
      utimesSync(file, new Date("2026-09-28T12:00:00Z"), new Date("2026-09-28T12:00:00Z"));
      const original = fileTag(statSync(file));
      writeFileSync(file, "a transparent one");
      utimesSync(file, new Date("2026-10-06T12:00:00Z"), new Date("2026-10-06T12:00:00Z"));
      const test = fileTag(statSync(file));
      writeFileSync(file, "the original picture");
      utimesSync(file, new Date("2026-09-28T12:00:00Z"), new Date("2026-09-28T12:00:00Z"));
      const back = fileTag(statSync(file));
      expect(test).not.toBe(original);
      expect(back).toBe(original);
      expect(browserHasFile(asking(test), back)).toBe(false);
      expect(browserHasFile(asking(back), back)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("the same size and date, another content length or date: a new file", () => {
    const tag = fileTag({ size: 100, mtimeMs: 1_790_000_000_000.5 });
    expect(fileTag({ size: 100, mtimeMs: 1_790_000_000_000 })).toBe(tag);
    expect(fileTag({ size: 101, mtimeMs: 1_790_000_000_000 })).not.toBe(tag);
    expect(fileTag({ size: 100, mtimeMs: 1_789_999_999_999 })).not.toBe(tag);
  });

  it("the browser has it only when it names this version (a list, or weak)", () => {
    const tag = fileTag({ size: 5, mtimeMs: 1000 });
    expect(browserHasFile(asking(), tag)).toBe(false);
    expect(browserHasFile(asking(`"x", ${tag}`), tag)).toBe(true);
    expect(browserHasFile(asking(`W/${tag}`), tag)).toBe(true);
    expect(browserHasFile(asking(`"x"`), tag)).toBe(false);
  });
});
