// Reading a zip file by its central directory (PKWARE's APPNOTE.TXT, the zip format): the list at the end of the file gives each
// entry's exact place and size, so its bytes are read by position, whatever they hold. A reader that scans for the next header
// instead (fflate's streaming Unzip, the app's before 2026-10-18) cuts an entry whose sizes come after it, in a data
// descriptor, wherever its bytes happen to look like a header — in a pack of thousands of pictures that happens, and the
// import failed. Also ZIP64 (a pack over 4 GB or 65,535 files) and names in GBK (Chinese Windows tools). Pure: a Blob in,
// bytes out (tested without a phone, test/zip-reader.test.ts).
import { inflateSync } from "fflate";

/** One entry of a zip's central directory. */
export interface ZipEntry {
  /** Its path in the zip ("public/images/cards/BP01-001.png"); a folder's ends with "/" (or "\" from some Windows tools). */
  name: string;
  /** 0: stored, 8: deflated — the two read; others (deflate64, LZMA ...) are named in the error. */
  method: number;
  compressedSize: number;
  size: number;
  /** Where its local header starts. */
  offset: number;
  encrypted: boolean;
}

const EOCD = 0x06054b50;
const ZIP64_LOCATOR = 0x07064b50;
const ZIP64_EOCD = 0x06064b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;

const u16 = (b: Uint8Array, i: number): number => b[i]! | (b[i + 1]! << 8);
const u32 = (b: Uint8Array, i: number): number => (b[i]! | (b[i + 1]! << 8) | (b[i + 2]! << 16)) + b[i + 3]! * 0x1000000;
const u64 = (b: Uint8Array, i: number): number => u32(b, i) + u32(b, i + 4) * 0x100000000;

async function read(blob: Blob, start: number, length: number): Promise<Uint8Array> {
  return new Uint8Array(await blob.slice(start, start + length).arrayBuffer());
}

const utf8 = new TextDecoder("utf-8", { fatal: true });

/**
 * An entry's name: UTF-8 when its flag says so (general purpose bit 11); else UTF-8 if it reads as such (many tools write it
 * without the flag), else GBK (Chinese Windows tools), else one character per byte.
 */
function nameOf(bytes: Uint8Array, flaggedUtf8: boolean): string {
  if (flaggedUtf8) return new TextDecoder("utf-8").decode(bytes);
  try {
    return utf8.decode(bytes);
  } catch {
    // Not UTF-8.
  }
  try {
    return new TextDecoder("gbk").decode(bytes);
  } catch {
    return Array.from(bytes, (b) => String.fromCharCode(b)).join("");
  }
}

/** The entries of a zip file, as its central directory lists them. Throws for a file that isn't a whole zip. */
export async function readZipEntries(blob: Blob): Promise<ZipEntry[]> {
  // The end of central directory record: the last 22 bytes, or before a comment of up to 65,535 bytes.
  const tailStart = Math.max(0, blob.size - 22 - 0xffff);
  const tail = await read(blob, tailStart, blob.size - tailStart);
  let at = -1;
  for (let i = tail.length - 22; i >= 0; i--) {
    if (u32(tail, i) === EOCD) {
      at = i;
      break;
    }
  }
  if (at < 0) throw new Error("not a zip file (or a cut-short one)");
  let count = u16(tail, at + 10);
  let size = u32(tail, at + 12);
  let start = u32(tail, at + 16);
  // ZIP64: the record's values are at their maximum, the ZIP64 end of central directory record (found by the locator just
  // before it) has them.
  if (count === 0xffff || size === 0xffffffff || start === 0xffffffff) {
    const locator = await read(blob, tailStart + at - 20, 20);
    if (u32(locator, 0) !== ZIP64_LOCATOR) throw new Error("its ZIP64 end record is missing");
    const record = await read(blob, u64(locator, 8), 56);
    if (u32(record, 0) !== ZIP64_EOCD) throw new Error("its ZIP64 end record is missing");
    count = u64(record, 32);
    size = u64(record, 40);
    start = u64(record, 48);
  }
  const dir = await read(blob, start, size);
  const entries: ZipEntry[] = [];
  let i = 0;
  for (let n = 0; n < count; n++) {
    if (i + 46 > dir.length || u32(dir, i) !== CENTRAL) throw new Error("its central directory is broken");
    const flags = u16(dir, i + 8);
    const nameLength = u16(dir, i + 28);
    const extraLength = u16(dir, i + 30);
    const entry: ZipEntry = {
      name: nameOf(dir.subarray(i + 46, i + 46 + nameLength), (flags & 0x800) !== 0),
      method: u16(dir, i + 10),
      compressedSize: u32(dir, i + 20),
      size: u32(dir, i + 24),
      offset: u32(dir, i + 42),
      encrypted: (flags & 1) !== 0,
    };
    // The ZIP64 extended information extra field (header ID 1): the 64-bit values of the fields at their maximum, in order.
    const extra = dir.subarray(i + 46 + nameLength, i + 46 + nameLength + extraLength);
    for (let e = 0; e + 4 <= extra.length; e += 4 + u16(extra, e + 2)) {
      if (u16(extra, e) !== 1) continue;
      let p = e + 4;
      if (entry.size === 0xffffffff) (entry.size = u64(extra, p)), (p += 8);
      if (entry.compressedSize === 0xffffffff) (entry.compressedSize = u64(extra, p)), (p += 8);
      if (entry.offset === 0xffffffff) entry.offset = u64(extra, p);
    }
    entries.push(entry);
    i += 46 + nameLength + extraLength + u16(dir, i + 32);
  }
  return entries;
}

/** An entry's contents, read where the central directory says (the local header only tells where its data starts). */
export async function readZipEntry(blob: Blob, entry: ZipEntry): Promise<Uint8Array> {
  if (entry.encrypted) throw new Error("it is encrypted");
  if (entry.method !== 0 && entry.method !== 8) throw new Error(`compression method ${entry.method} (only stored and deflated files are read)`);
  const header = await read(blob, entry.offset, 30);
  if (header.length < 30 || u32(header, 0) !== LOCAL) throw new Error("its data isn't where the central directory says");
  const data = await read(blob, entry.offset + 30 + u16(header, 26) + u16(header, 28), entry.compressedSize);
  if (data.length !== entry.compressedSize) throw new Error("the zip is cut short");
  const out = entry.method === 0 ? data : inflateSync(data);
  if (out.length !== entry.size) throw new Error(`it reads as ${out.length} bytes, not ${entry.size}`);
  return out;
}
