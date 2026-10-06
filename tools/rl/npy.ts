// Arrays for the training tools in Python: NumPy's .npy format, version 1.0 (numpy.lib.format), little-endian, C order.
// numpy reads them with np.load(path, mmap_mode="r").
import { writeFileSync } from "node:fs";

/** The bytes of a .npy file of `data` (int16 or float32) with this shape. */
export function npyBytes(data: Int16Array | Float32Array, shape: readonly number[]): Buffer {
  if (shape.reduce((a, b) => a * b, 1) !== data.length) throw new Error(`shape ${shape.join("x")} doesn't hold ${data.length} values`);
  const descr = data instanceof Int16Array ? "<i2" : "<f4";
  const dims = shape.length === 1 ? `(${shape[0]},)` : `(${shape.join(", ")})`;
  let header = `{'descr': '${descr}', 'fortran_order': False, 'shape': ${dims}, }`;
  // Magic (6) + version (2) + header length (2) + header, padded with spaces and a newline to a multiple of 64.
  const total = Math.ceil((10 + header.length + 1) / 64) * 64;
  header = header.padEnd(total - 10 - 1, " ") + "\n";
  const head = Buffer.alloc(10);
  head.write("\x93NUMPY", 0, "latin1");
  head[6] = 1;
  head[7] = 0;
  head.writeUInt16LE(header.length, 8);
  if (new Uint8Array(new Uint16Array([1]).buffer)[0] !== 1) throw new Error("a big-endian machine: the arrays would need swapping");
  return Buffer.concat([head, Buffer.from(header, "latin1"), Buffer.from(data.buffer, data.byteOffset, data.byteLength)]);
}

export function writeNpy(path: string, data: Int16Array | Float32Array, shape: readonly number[]): void {
  writeFileSync(path, npyBytes(data, shape));
}

/** A .npy file of int16 or float32 values (as npyBytes writes them): its shape and values. */
export function readNpy(bytes: Buffer): { shape: number[]; data: Int16Array | Float32Array } {
  if (bytes.subarray(0, 6).toString("latin1") !== "\x93NUMPY") throw new Error("not a .npy file");
  const length = bytes.readUInt16LE(8);
  const header = bytes.subarray(10, 10 + length).toString("latin1");
  const descr = /'descr': '([^']+)'/.exec(header)?.[1];
  const shape = (/'shape': \(([^)]*)\)/.exec(header)?.[1] ?? "").split(",").map((s) => s.trim()).filter(Boolean).map(Number);
  const body = bytes.subarray(10 + length);
  const copy = body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength);
  if (descr === "<i2") return { shape, data: new Int16Array(copy) };
  if (descr === "<f4") return { shape, data: new Float32Array(copy) };
  throw new Error(`a .npy of ${descr}: only int16 and float32 are read`);
}
