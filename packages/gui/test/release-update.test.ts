import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { build } from "esbuild";
import { zipSync } from "fflate";
import { afterAll, expect, it } from "vitest";
import { REPO } from "../host/update";

// The PC release's server updating itself (host/release-server.ts with host/update.ts), as a player's click does it: the
// check finds the newer release on GitHub (played here by a server on this computer), the install puts its program in
// place, and the server restarts as the new version on the same port, where the page finds it.

const gui = resolve(__dirname, "..");
const repo = resolve(gui, "..", "..");
const dir = mkdtempSync(join(tmpdir(), "sve-release-update-"));
let server: ChildProcess | null = null;
let github: Server | null = null;

afterAll(() => {
  if (server?.pid) {
    // The old server and the new one it started.
    if (process.platform === "win32") execFileSync("taskkill", ["/pid", String(server.pid), "/T", "/F"], { stdio: "ignore" });
    else process.kill(-server.pid, "SIGKILL");
  }
  github?.closeAllConnections();
  github?.close();
  rmSync(dir, { recursive: true, force: true });
});

/** server.mjs of `version`, as scripts/release-pc.ts bundles it. */
async function serverOf(version: string): Promise<Uint8Array> {
  const outfile = join(dir, `server-${version}.mjs`);
  await build({
    entryPoints: [join(gui, "host", "release-server.ts")],
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node20",
    outfile,
    define: { __SVE_VERSION__: JSON.stringify(version) },
    absWorkingDir: repo,
    legalComments: "none",
    logLevel: "warning",
  });
  return readFileSync(outfile);
}

const freePort = () =>
  new Promise<number>((done) => {
    const probe = createServer().listen(0, "127.0.0.1", () => {
      const { port } = probe.address() as AddressInfo;
      probe.close(() => done(port));
    });
  });

it("checks, installs from GitHub, and comes back as the new version on the same port", { timeout: 90_000 }, async () => {
  const program = (version: string, server: Uint8Array): Record<string, Uint8Array | string> => ({
    "server.mjs": server,
    "VERSION.txt": `Shadowverse: Evolve NEXT ${version}\nBuilt: 2026-10-08\n`,
    "start.bat": "@echo off\r\n",
    "README.txt": `README ${version}`,
    "app/index.html": `<!doctype html><p>${version}</p>`,
    "decks/samples/sd01.json": `{"name":"sample ${version}"}`,
  });
  const root = join(dir, "SVEN-0.4.1-pc");
  const files = { ...program("0.4.1", await serverOf("0.4.1")), "decks/mine.json": '{"name":"mine"}', "settings.ini": "[language]\ninterface = zh\n", "online-server.ini": "[server]\nkey = mine\n" };
  for (const [path, data] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), data);
  }
  const zip = zipSync(Object.fromEntries(Object.entries(program("0.4.2", await serverOf("0.4.2"))).map(([path, data]) => [`SVEN-0.4.2-pc/${path}`, typeof data === "string" ? new TextEncoder().encode(data) : data])));

  // GitHub: the API's latest release, its download link, and the file the link leads to.
  github = createServer((req, res) => {
    const origin = `http://${req.headers.host}`;
    if (req.url === `/repos/${REPO}/releases/latest`) {
      res.setHeader("Content-Type", "application/json");
      return res.end(JSON.stringify({ tag_name: "v0.4.2", assets: [{ name: "SVEN-0.4.2-pc.zip", size: zip.length, digest: `sha256:${createHash("sha256").update(zip).digest("hex")}` }] }));
    }
    if (req.url === `/${REPO}/releases/download/v0.4.2/SVEN-0.4.2-pc.zip`) {
      res.writeHead(302, { Location: `${origin}/assets/1` });
      return res.end();
    }
    if (req.url === "/assets/1") return res.end(Buffer.from(zip));
    res.statusCode = 404;
    return res.end();
  });
  await new Promise<void>((done) => github!.listen(0, "127.0.0.1", () => done()));
  const origin = `http://127.0.0.1:${(github.address() as AddressInfo).port}`;

  const port = await freePort();
  let output = "";
  server = spawn(process.execPath, [join(root, "server.mjs"), "--no-open"], {
    cwd: root,
    env: { ...process.env, SVE_PORT: String(port), SVE_UPDATE_TEST_ORIGIN: origin },
    stdio: ["ignore", "pipe", "pipe"],
    detached: process.platform !== "win32",
  });
  server.stdout!.on("data", (chunk: Buffer) => (output += chunk.toString("utf8")));
  server.stderr!.on("data", (chunk: Buffer) => (output += chunk.toString("utf8")));
  const api = `http://127.0.0.1:${port}/api/update`;
  const status = async (): Promise<{ version: string; job: { state: string } } | null> => {
    try {
      const res = await fetch(`${api}/status`);
      return res.ok ? ((await res.json()) as { version: string; job: { state: string } }) : null;
    } catch {
      return null;
    }
  };
  const until = async (ok: (s: Awaited<ReturnType<typeof status>>) => boolean, what: string) => {
    for (let i = 0; i < 300; i++) {
      const s = await status();
      if (ok(s)) return s;
      await new Promise((done) => setTimeout(done, 100));
    }
    throw new Error(`${what}: not in 30 s\n${output}`);
  };
  await until((s) => s?.version === "0.4.1", "the server");

  expect(await (await fetch(`${api}/check`)).json()).toMatchObject({ ok: true, current: "0.4.1", latest: "0.4.2", newer: true });
  // Only a JSON request: another site's page can't ask for it without the browser asking this server first.
  expect((await fetch(`${api}/install`, { method: "POST", body: "{}", headers: { "Content-Type": "text/plain" } })).status).toBe(415);
  expect((await fetch(`${api}/install`, { method: "POST", body: "{}", headers: { "Content-Type": "application/json" } })).status).toBe(202);

  await until((s) => s?.version === "0.4.2" && s.job.state === "idle", "the new version");
  expect(await (await fetch(`http://127.0.0.1:${port}/`)).text()).toContain("<p>0.4.2</p>");
  expect(readFileSync(join(root, "VERSION.txt"), "utf8")).toContain("0.4.2");
  expect(readFileSync(join(root, "update", "previous", "VERSION.txt"), "utf8")).toContain("0.4.1");
  expect(readFileSync(join(root, "decks", "mine.json"), "utf8")).toBe('{"name":"mine"}');
  expect(readFileSync(join(root, "online-server.ini"), "utf8")).toBe("[server]\nkey = mine\n");
});
