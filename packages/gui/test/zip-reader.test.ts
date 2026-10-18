import { strToU8, Zip, ZipDeflate, ZipPassThrough, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { readZipEntries, readZipEntry } from "../src/host/zip-reader";
import { resourcePathInZip } from "../src/host/zip-paths";

// The apps' zip import reads a zip by its central directory (src/host/zip-reader.ts): every entry whole, whatever its bytes,
// whichever tool made the zip. Zips made here as the tools make them: streamed (sizes after the data), plain, by hand.

/** A Blob of bytes (a copy over an ArrayBuffer, as Blob's type asks). */
const blobOf = (bytes: Uint8Array): Blob => new Blob([new Uint8Array(bytes)]);

/** Every file of a zip, read as the import reads them: path -> bytes. */
async function readAll(zip: Uint8Array): Promise<Record<string, Uint8Array>> {
  const blob = blobOf(zip);
  const out: Record<string, Uint8Array> = {};
  for (const entry of await readZipEntries(blob)) if (!/[\\/]$/.test(entry.name)) out[entry.name] = await readZipEntry(blob, entry);
  return out;
}

/** A picture's bytes that happen to hold a zip header's signature ("PK\3\4") in the middle. */
const picture = new Uint8Array(4000).map((_, i) => (i * 37) % 251);
picture.set([0x50, 0x4b, 0x03, 0x04], 1500);

/** A zip written as a stream: each entry's sizes come after its data, in a data descriptor. */
function streamedZip(): Uint8Array {
  const parts: Uint8Array[] = [];
  const zip = new Zip((err, data) => {
    if (err) throw err;
    parts.push(data);
  });
  const stored = new ZipPassThrough("public/images/cards/BP01-001.png");
  zip.add(stored);
  stored.push(picture, true);
  const deflated = new ZipDeflate("public/theme.css");
  zip.add(deflated);
  deflated.push(strToU8("body { color: red }\n".repeat(50)), true);
  zip.end();
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) out.set(p, at), (at += p.length);
  return out;
}

/** A zip written by hand (stored entries): names as raw bytes without the UTF-8 flag, a method, ZIP64 end records. */
function handZip(entries: { name: Uint8Array; data: Uint8Array; method?: number }[], zip64 = false): Uint8Array {
  const out: number[] = [];
  const le = (n: number, bytes: number) => {
    for (let i = 0; i < bytes; i++) out.push(Math.floor(n / 2 ** (8 * i)) & 0xff);
  };
  const offsets: number[] = [];
  for (const e of entries) {
    offsets.push(out.length);
    le(0x04034b50, 4), le(20, 2), le(0, 2), le(e.method ?? 0, 2), le(0, 4), le(0, 4), le(e.data.length, 4), le(e.data.length, 4);
    le(e.name.length, 2), le(0, 2), out.push(...e.name, ...e.data);
  }
  const dirAt = out.length;
  entries.forEach((e, i) => {
    // With ZIP64, the offset is in the extended information field (extra field 1).
    le(0x02014b50, 4), le(45, 2), le(20, 2), le(0, 2), le(e.method ?? 0, 2), le(0, 4), le(0, 4), le(e.data.length, 4), le(e.data.length, 4);
    le(e.name.length, 2), le(zip64 ? 12 : 0, 2), le(0, 2), le(0, 2), le(0, 2), le(0, 4), le(zip64 ? 0xffffffff : offsets[i]!, 4);
    out.push(...e.name);
    if (zip64) le(1, 2), le(8, 2), le(offsets[i]!, 8);
  });
  const dirSize = out.length - dirAt;
  if (zip64) {
    const recordAt = out.length;
    le(0x06064b50, 4), le(44, 8), le(45, 2), le(45, 2), le(0, 4), le(0, 4), le(entries.length, 8), le(entries.length, 8), le(dirSize, 8), le(dirAt, 8);
    le(0x07064b50, 4), le(0, 4), le(recordAt, 8), le(1, 4);
    le(0x06054b50, 4), le(0, 2), le(0, 2), le(0xffff, 2), le(0xffff, 2), le(0xffffffff, 4), le(0xffffffff, 4), le(0, 2);
  } else {
    le(0x06054b50, 4), le(0, 2), le(0, 2), le(entries.length, 2), le(entries.length, 2), le(dirSize, 4), le(dirAt, 4), le(0, 2);
  }
  return new Uint8Array(out);
}

/** "资源包/public/theme.css" as a Chinese Windows tool writes it: GBK, no UTF-8 flag. */
const GBK_NAME = new Uint8Array([0xd7, 0xca, 0xd4, 0xb4, 0xb0, 0xfc, ...strToU8("/public/theme.css")]);

describe("reading a zip by its central directory", () => {
  it("reads a streamed zip whole, though a picture's bytes look like a header (the scanning reader cut it there)", async () => {
    const files = await readAll(streamedZip());
    expect(Object.keys(files)).toEqual(["public/images/cards/BP01-001.png", "public/theme.css"]);
    expect(files["public/images/cards/BP01-001.png"]).toEqual(picture);
    expect(new TextDecoder().decode(files["public/theme.css"])).toBe("body { color: red }\n".repeat(50));
  });

  it("reads a plain zip of a whole public folder, deflated, into the paths the import puts it", async () => {
    const zip = zipSync({ "SVEN-pc/public/images/cards/BP01-002.png": picture, "SVEN-pc/public/text/BP22_cn.json": strToU8("{}"), "SVEN-pc/app/index.html": strToU8("<html>") });
    const files = await readAll(zip);
    expect(Object.keys(files).map((name) => resourcePathInZip(name))).toEqual(["images/cards/BP01-002.png", "text/BP22_cn.json", null]);
    expect(files["SVEN-pc/public/images/cards/BP01-002.png"]).toEqual(picture);
  });

  it("reads names in GBK, Windows paths with backslashes, and ZIP64's end records", async () => {
    const zip = handZip(
      [
        { name: GBK_NAME, data: strToU8("a{}") },
        { name: strToU8("public\\images\\backs\\default.png"), data: picture },
      ],
      true,
    );
    const files = await readAll(zip);
    expect(Object.keys(files)).toEqual(["资源包/public/theme.css", "public\\images\\backs\\default.png"]);
    expect(Object.keys(files).map((name) => resourcePathInZip(name))).toEqual(["theme.css", "images/backs/default.png"]);
    expect(files["public\\images\\backs\\default.png"]).toEqual(picture);
  });

  it("names what it can't read: another compression, a file that isn't a zip", async () => {
    const zip = handZip([{ name: strToU8("public/a.png"), data: picture, method: 9 }]);
    const [entry] = await readZipEntries(blobOf(zip));
    await expect(readZipEntry(blobOf(zip), entry!)).rejects.toThrow(/compression method 9/);
    await expect(readZipEntries(blobOf(picture))).rejects.toThrow(/not a zip file/);
  });
});
