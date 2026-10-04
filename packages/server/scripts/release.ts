/**
 * The online server's package: npm run release:server -- [--out <folder>]
 * SVEN-server-<version>/ beside the repository, and SVEN-server-<version>.tar.gz of it (tar is on every Linux server; zip
 * isn't always): server.mjs (src/main.ts with the ws library, in one file: the server needs nothing else but Node.js),
 * setup.sh (installs or updates it: sudo bash setup.sh <IP>) and README.txt. The version is packages/server/package.json's.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { build as bundle } from "esbuild";

const here = dirname(fileURLToPath(import.meta.url));
const pkg = resolve(here, "..");
const root = resolve(pkg, "..", "..");
const args = process.argv.slice(2);
const at = args.indexOf("--out");
const version = (JSON.parse(readFileSync(join(pkg, "package.json"), "utf8")) as { version: string }).version;
const out = resolve(at >= 0 && args[at + 1] ? args[at + 1]! : join(root, "..", `SVEN-server-${version}`));
if (existsSync(out) && readdirSync(out).length > 0) {
  console.error(`${out} already exists and isn't empty: choose another --out, or delete that folder first.`);
  process.exit(1);
}
mkdirSync(out, { recursive: true });

await bundle({
  entryPoints: [join(pkg, "src", "main.ts")],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  outfile: join(out, "server.mjs"),
  // ws is CommonJS: its require() of Node's modules needs a require in the ES module; its optional speed-ups stay out.
  banner: { js: 'import { createRequire as __sveRequire } from "node:module";\nconst require = __sveRequire(import.meta.url);' },
  external: ["bufferutil", "utf-8-validate"],
  define: { __SERVER_VERSION__: JSON.stringify(version) },
  legalComments: "none",
  logLevel: "warning",
});
// setup.sh runs on Linux: LF line ends whatever the checkout has.
writeFileSync(join(out, "setup.sh"), readFileSync(join(here, "setup.sh"), "utf8").replace(/\r\n/g, "\n"));
// README.txt is read on Windows first: CRLF and a BOM.
writeFileSync(join(out, "README.txt"), "﻿" + readFileSync(join(here, "README.txt"), "utf8").replaceAll("{{version}}", version).replace(/\r?\n/g, "\r\n"));

/** A tar archive (POSIX ustar) of these entries: a folder, then its files. */
function tar(entries: { name: string; data: Buffer | null; mode: number }[]): Buffer {
  const blocks: Buffer[] = [];
  const mtime = Math.floor(Date.now() / 1000);
  for (const { name, data, mode } of entries) {
    const header = Buffer.alloc(512);
    const put = (text: string, offset: number, length: number) => header.write(text, offset, length, "utf8");
    const octal = (n: number, length: number) => n.toString(8).padStart(length - 1, "0") + "\0";
    put(name, 0, 100);
    put(octal(mode, 8), 100, 8);
    put(octal(0, 8), 108, 8);
    put(octal(0, 8), 116, 8);
    put(octal(data ? data.length : 0, 12), 124, 12);
    put(octal(mtime, 12), 136, 12);
    put("        ", 148, 8);
    put(data ? "0" : "5", 156, 1);
    put("ustar\u000000", 257, 8);
    put("root", 265, 32);
    put("root", 297, 32);
    let sum = 0;
    for (const byte of header) sum += byte;
    put(sum.toString(8).padStart(6, "0") + "\0 ", 148, 8);
    blocks.push(header);
    if (data) blocks.push(data, Buffer.alloc((512 - (data.length % 512)) % 512));
  }
  blocks.push(Buffer.alloc(1024));
  return Buffer.concat(blocks);
}

const top = basename(out);
const files = readdirSync(out).sort();
const archive = tar([
  { name: `${top}/`, data: null, mode: 0o755 },
  ...files.map((name) => ({ name: `${top}/${name}`, data: readFileSync(join(out, name)), mode: name.endsWith(".sh") ? 0o755 : 0o644 })),
]);
const tarFile = `${out}.tar.gz`;
writeFileSync(tarFile, gzipSync(archive, { level: 9 }));
console.log(`online server ${version} -> ${out}`);
console.log(`${tarFile} (${(statSync(tarFile).size / 1024).toFixed(0)} KB): upload it to the server, then  tar xzf ${basename(tarFile)} && sudo bash ${top}/setup.sh <IP>`);
