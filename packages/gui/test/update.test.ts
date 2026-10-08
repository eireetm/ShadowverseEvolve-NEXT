import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { rename } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { connect, createServer as createNetServer, type AddressInfo, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { zipSync } from "fflate";
import { afterEach, describe, expect, it } from "vitest";
import { isNewer, localSources, parseVersion, readPackage, REPO, systemProxy, Updater, windowsProxy, type UpdateSources } from "../host/update";

// The PC release's updates (host/update.ts): the latest version from GitHub (its API, else the redirect of
// /releases/latest, else mirrors), the package downloaded from GitHub only, checked, and put in place of the program — the
// player's files never written, the folder as it was when something fails.

const OLD = "0.4.1";
const NEW = "0.4.2";

const closers: (() => void)[] = [];
afterEach(() => {
  for (const close of closers.splice(0)) close();
});

function temp(): string {
  const dir = mkdtempSync(join(tmpdir(), "sve-update-"));
  closers.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function listen(handler: (req: IncomingMessage, res: ServerResponse) => void): Promise<{ server: Server; origin: string }> {
  const server = createServer(handler);
  return new Promise((done) =>
    server.listen(0, "127.0.0.1", () => {
      closers.push(() => {
        server.closeAllConnections();
        server.close();
      });
      done({ server, origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}` });
    }),
  );
}

const enc = (text: string) => new TextEncoder().encode(text);

/** A release's zip as scripts/release-pc.ts writes it: the folder at the top, its empty folders kept. */
function packageZip(version: string, change: (files: Record<string, Uint8Array>) => void = () => {}): Uint8Array {
  const top = `SVEN-${version}-pc/`;
  const files: Record<string, Uint8Array> = {
    "VERSION.txt": enc(`Shadowverse: Evolve NEXT ${version}\nBuilt: 2026-10-08\n`),
    "server.mjs": enc(`// server ${version}`),
    "start.bat": enc(`@echo off\r\nrem ${version}\r\n`),
    "README.txt": enc(`README ${version}`),
    "app/": new Uint8Array(0),
    "app/index.html": enc(`<p>${version}</p>`),
    [`app/assets/index-${version}.js`]: enc(`app ${version}`),
    "decks/samples/sd01.json": enc(`{"name":"sample ${version}"}`),
    "replays/": new Uint8Array(0),
    "public/images/cards/": new Uint8Array(0),
    "public/textures/new/": new Uint8Array(0),
    // Never in a package for GitHub; were it there, an update still mustn't take it.
    "online-server.ini": enc("[server]\naddress = wss://elsewhere\nkey = theirs\n"),
  };
  change(files);
  return zipSync(Object.fromEntries(Object.entries(files).map(([path, data]) => [top + path, data])));
}

/** A release's folder of `version` with the player's own files. */
function releaseFolder(version: string): string {
  const root = temp();
  const write = (path: string, text: string) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  };
  write("VERSION.txt", `Shadowverse: Evolve NEXT ${version}\n`);
  write("server.mjs", `// server ${version}`);
  write("start.bat", "@echo off\r\n");
  write("README.txt", `README ${version}`);
  write("app/index.html", `<p>${version}</p>`);
  write(`app/assets/index-${version}.js`, `app ${version}`);
  write("decks/samples/sd01.json", `{"name":"sample ${version}"}`);
  write("decks/mine.json", '{"name":"mine"}');
  write("replays/game.json", "{}");
  write("public/images/cards/BP01-001.png", "my art");
  write("settings.ini", "[language]\ninterface = zh\n");
  write("online-server.ini", "[server]\naddress = wss://mine\nkey = mine\n");
  return root;
}

const read = (root: string, path: string) => readFileSync(join(root, path), "utf8");

interface GitHubOptions {
  /** The API's status (200: the release); "none": no route. */
  api?: number;
  /** /releases/latest redirects to the tag. */
  redirect?: boolean;
  /** The package (null: 404). */
  zip?: Uint8Array | null;
  /** What the API says of the package's size and checksum (default: the package's). */
  asset?: { size?: number; digest?: string };
  /** Where the download link redirects (default: this server's /assets/package). */
  downloadAt?: (origin: string) => string;
}

/** GitHub played on this computer: the API, the redirect of /releases/latest, the download link and the file it leads to. */
async function fakeGitHub(options: GitHubOptions, version = NEW) {
  const zip = options.zip === undefined ? packageZip(version) : options.zip;
  const hits: string[] = [];
  const { origin } = await listen((req, res) => {
    const url = req.url ?? "";
    hits.push(url);
    if (url === `/repos/${REPO}/releases/latest` && (options.api ?? 200) === 200) {
      const assets = zip
        ? [{ name: `SVEN-${version}-pc.zip`, size: options.asset?.size ?? zip.length, digest: options.asset?.digest ?? `sha256:${createHash("sha256").update(zip).digest("hex")}` }]
        : [];
      res.setHeader("Content-Type", "application/json");
      return res.end(JSON.stringify({ tag_name: `v${version}`, assets }));
    }
    if (url === `/repos/${REPO}/releases/latest`) {
      res.statusCode = options.api!;
      return res.end("{}");
    }
    if (url === `/${REPO}/releases/latest` && options.redirect !== false) {
      res.writeHead(302, { Location: `https://github.com/${REPO}/releases/tag/v${version}` });
      return res.end();
    }
    if (url === `/${REPO}/releases/download/v${version}/SVEN-${version}-pc.zip` && zip) {
      res.writeHead(302, { Location: options.downloadAt?.(origin) ?? `${origin}/assets/package?signed=1` });
      return res.end();
    }
    if (url === "/assets/package?signed=1" && zip) {
      res.setHeader("Content-Length", String(zip.length));
      return res.end(Buffer.from(zip));
    }
    res.statusCode = url.startsWith(`/repos/`) || url.endsWith("/latest") ? 500 : 404;
    return res.end("no");
  });
  return { origin, hits, zip, sources: localSources(origin) };
}

/** The updater of `root` at `version`, against `sources`, with no proxy. */
const updater = (root: string, sources: UpdateSources, version = OLD, move?: typeof rename) =>
  new Updater({ root, version, sources, proxy: async () => null, ...(move ? { rename: move } : {}) });

/** Install, and wait until it is done (restarting) or failed. */
async function install(up: Updater): Promise<{ restarted: boolean }> {
  let restarted = false;
  expect(up.install(() => (restarted = true))).toBe(true);
  for (let i = 0; i < 400; i++) {
    const { job } = up.status();
    if (job.state === "restarting" || job.state === "failed") break;
    await new Promise((done) => setTimeout(done, 10));
  }
  return { restarted };
}

describe("versions", () => {
  it("are read from tags and compared part by part; only a later one is newer", () => {
    expect(parseVersion("v0.4.2")).toEqual([0, 4, 2]);
    expect(parseVersion("0.4.10")).toEqual([0, 4, 10]);
    expect(parseVersion("0.4.2-beta")).toBeNull();
    expect(parseVersion("latest")).toBeNull();
    expect(isNewer("0.4.10", "0.4.9")).toBe(true);
    expect(isNewer("0.5.0", "0.4.12")).toBe(true);
    expect(isNewer("0.4.1", "0.4.1")).toBe(false);
    expect(isNewer("0.4.0", "0.4.1")).toBe(false);
  });
});

describe("checking for a newer version", () => {
  it("asks GitHub's API: the latest release, newer or not", async () => {
    const github = await fakeGitHub({});
    const root = temp();
    expect(await updater(root, github.sources).check()).toEqual({
      ok: true,
      current: OLD,
      latest: NEW,
      newer: true,
      page: `${github.origin}/${REPO}/releases/tag/v${NEW}`,
      from: "github",
    });
    // The same version, or an older one, isn't offered.
    expect(await updater(root, github.sources, NEW).check()).toMatchObject({ ok: true, latest: NEW, newer: false });
    expect(await updater(root, github.sources, "0.4.3").check()).toMatchObject({ ok: true, latest: NEW, newer: false });
  });

  it("takes the redirect of /releases/latest when the API refuses (its 60 an hour), then mirrors when GitHub answers neither", async () => {
    const github = await fakeGitHub({ api: 403 });
    expect(await updater(temp(), github.sources).check()).toMatchObject({ ok: true, latest: NEW, newer: true, from: "github" });

    const down = await fakeGitHub({ api: 503, redirect: false });
    const { origin: mirror } = await listen((req, res) => {
      if (req.url === "/api") {
        res.setHeader("Content-Type", "application/json");
        return res.end(JSON.stringify({ tag_name: "v0.4.2", assets: [] }));
      }
      if (req.url === "/redirect") {
        res.writeHead(302, { Location: `https://mirror.example/https://github.com/${REPO}/releases/tag/v0.4.3` });
        return res.end();
      }
      res.statusCode = 404;
      return res.end();
    });
    const sources = { ...down.sources, mirrors: [{ url: `${mirror}/api`, kind: "api" as const }, { url: `${mirror}/redirect`, kind: "redirect" as const }, { url: `${mirror}/gone`, kind: "api" as const }] };
    // The newest any mirror says.
    expect(await updater(temp(), sources).check()).toMatchObject({ ok: true, latest: "0.4.3", newer: true, from: "mirror" });
    // Nothing answers: unreachable.
    expect(await updater(temp(), { ...down.sources, mirrors: [] }).check()).toEqual({ ok: false, why: "unreachable" });
  });
});

describe("installing", () => {
  it("puts the new program in place, keeps the old one in update/previous, and never writes the player's files", async () => {
    const github = await fakeGitHub({});
    const root = releaseFolder(OLD);
    const up = updater(root, github.sources);
    await up.check();
    const { restarted } = await install(up);
    expect(up.status().job).toEqual({ state: "restarting", version: NEW });
    expect(restarted).toBe(true);
    // The program: new.
    expect(read(root, "server.mjs")).toBe(`// server ${NEW}`);
    expect(read(root, "VERSION.txt")).toContain(NEW);
    expect(read(root, "app/index.html")).toBe(`<p>${NEW}</p>`);
    expect(existsSync(join(root, `app/assets/index-${OLD}.js`))).toBe(false);
    expect(read(root, "decks/samples/sd01.json")).toContain(NEW);
    // The player's: as they were (the package's online-server.ini not taken); new resource folders made.
    expect(read(root, "decks/mine.json")).toBe('{"name":"mine"}');
    expect(read(root, "replays/game.json")).toBe("{}");
    expect(read(root, "public/images/cards/BP01-001.png")).toBe("my art");
    expect(read(root, "settings.ini")).toContain("interface = zh");
    expect(read(root, "online-server.ini")).toContain("wss://mine");
    expect(existsSync(join(root, "public/textures/new"))).toBe(true);
    // The old program, to go back by hand; nothing left half done.
    expect(read(root, "update/previous/server.mjs")).toBe(`// server ${OLD}`);
    expect(read(root, "update/previous/app/index.html")).toBe(`<p>${OLD}</p>`);
    expect(read(root, "update/previous/decks/samples/sd01.json")).toContain(OLD);
    expect(existsSync(join(root, "update/new"))).toBe(false);
    // The download came the way GitHub sends it: the link, then the file it redirects to.
    expect(github.hits).toContain(`/${REPO}/releases/download/v${NEW}/SVEN-${NEW}-pc.zip`);
  });

  it("downloads only from GitHub: a redirect elsewhere is refused, and nothing changes", async () => {
    const github = await fakeGitHub({ downloadAt: (origin) => `${origin.replace("127.0.0.1", "localhost")}/assets/package?signed=1` });
    const root = releaseFolder(OLD);
    const up = updater(root, github.sources);
    await up.check();
    await install(up);
    expect(up.status().job).toMatchObject({ state: "failed", why: "download" });
    expect((up.status().job as { detail: string }).detail).toContain("redirected to localhost");
    expect(read(root, "server.mjs")).toBe(`// server ${OLD}`);
  });

  it("refuses a package that isn't the one GitHub listed, isn't whole, or isn't of the version asked", async () => {
    const cases: [GitHubOptions, string, string][] = [
      [{ asset: { size: 1 } }, "badPackage", "bytes, not 1"],
      [{ asset: { digest: `sha256:${"0".repeat(64)}` } }, "badPackage", "SHA-256"],
      [{ zip: packageZip("0.4.0") }, "badPackage", "VERSION.txt says 0.4.0"],
      [{ zip: packageZip(NEW, (files) => delete files["server.mjs"]) }, "badPackage", "no server.mjs"],
      [{ zip: packageZip(NEW, (files) => (files["../outside.txt"] = enc("no"))) }, "badPackage", "out of the folder"],
      [{ zip: enc("not a zip") }, "badPackage", ""],
      [{ zip: null }, "noPackage", `SVEN-${NEW}-pc.zip`],
    ];
    for (const [options, why, detail] of cases) {
      const github = await fakeGitHub(options);
      const root = releaseFolder(OLD);
      const up = updater(root, github.sources);
      await up.check();
      await install(up);
      expect(up.status().job, `${why} ${detail}`).toMatchObject({ state: "failed", why });
      expect((up.status().job as { detail: string }).detail).toContain(detail);
      expect(read(root, "server.mjs")).toBe(`// server ${OLD}`);
      expect(read(root, "app/index.html")).toBe(`<p>${OLD}</p>`);
    }
  });

  it("installs only the newer version the last check found", async () => {
    const github = await fakeGitHub({});
    const root = releaseFolder(NEW);
    // Not checked yet; checked, nothing newer.
    const up = updater(root, github.sources, NEW);
    await install(up);
    expect(up.status().job).toEqual({ state: "failed", why: "noCheck", detail: "" });
    await up.check();
    await install(up);
    expect(up.status().job).toMatchObject({ state: "failed", why: "noCheck" });
    expect(github.hits.some((hit) => hit.includes("/download/"))).toBe(false);
  });

  it("puts everything back when a part can't be moved (a file held open by another program)", async () => {
    const github = await fakeGitHub({});
    const root = releaseFolder(OLD);
    let moves = 0;
    const failing: typeof rename = async (from, to) => {
      // README.txt, VERSION.txt and app/ swapped (two moves each), then decks/samples refuses.
      if (++moves === 7) throw Object.assign(new Error("EINVAL: held open"), { code: "EINVAL" });
      return rename(from, to);
    };
    const up = updater(root, github.sources, OLD, failing);
    await up.check();
    await install(up);
    expect(up.status().job).toMatchObject({ state: "failed", why: "cantWrite" });
    expect(read(root, "app/index.html")).toBe(`<p>${OLD}</p>`);
    expect(read(root, "server.mjs")).toBe(`// server ${OLD}`);
    expect(read(root, "decks/samples/sd01.json")).toContain(OLD);
    expect(existsSync(join(root, "update/previous/app"))).toBe(false);
  });

  it("reads a release's zip: its top folder left out, folders kept, the version checked", () => {
    const files = readPackage(packageZip(NEW), NEW);
    expect(files.get("server.mjs")).toBeInstanceOf(Uint8Array);
    expect(files.get("public/textures/new")).toBeNull();
    expect(files.has(`SVEN-${NEW}-pc/server.mjs`)).toBe(false);
    expect(() => readPackage(packageZip(NEW), "0.4.3")).toThrow(/VERSION.txt says 0.4.2/);
  });
});

describe("the computer's proxy", () => {
  it("is found in HTTPS_PROXY and the like, or in Windows' system proxy (Internet Settings), http:// ones only", async () => {
    expect((await systemProxy({ HTTPS_PROXY: "http://127.0.0.1:7890" }, "linux"))?.href).toBe("http://127.0.0.1:7890/");
    expect((await systemProxy({ http_proxy: "proxy.example:8080" }, "linux"))?.href).toBe("http://proxy.example:8080/");
    expect(await systemProxy({ ALL_PROXY: "socks5://127.0.0.1:1080" }, "linux")).toBeNull();
    expect(await systemProxy({}, "linux")).toBeNull();
    const reg = (enable: string, server: string) =>
      `\r\nHKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings\r\n    ProxyEnable    REG_DWORD    ${enable}\r\n    ProxyServer    REG_SZ    ${server}\r\n`;
    expect(windowsProxy(reg("0x1", "127.0.0.1:7890"))?.href).toBe("http://127.0.0.1:7890/");
    expect(windowsProxy(reg("0x1", "http=127.0.0.1:8001;https=127.0.0.1:8002;socks=127.0.0.1:1080"))?.href).toBe("http://127.0.0.1:8002/");
    expect(windowsProxy(reg("0x1", "socks=127.0.0.1:1080"))).toBeNull();
    expect(windowsProxy(reg("0x0", "127.0.0.1:7890"))).toBeNull();
    expect(windowsProxy("")).toBeNull();
  });

  it("carries the requests while it answers (CONNECT), and they go direct when it doesn't", async () => {
    const github = await fakeGitHub({});
    const tunnels: string[] = [];
    const { server: proxy, origin: proxyOrigin } = await listen((_req, res) => {
      res.statusCode = 405;
      res.end();
    });
    proxy.on("connect", (req: IncomingMessage, socket: Socket, head: Buffer) => {
      tunnels.push(req.url ?? "");
      const [host, port] = (req.url ?? "").split(":");
      const target = connect(Number(port), host!, () => {
        socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
        target.write(head);
        target.pipe(socket);
        socket.pipe(target);
      });
      target.on("error", () => socket.destroy());
      socket.on("error", () => target.destroy());
    });
    const root = releaseFolder(OLD);
    const via = new Updater({ root, version: OLD, sources: github.sources, proxy: async () => new URL(proxyOrigin) });
    expect(await via.check()).toMatchObject({ ok: true, latest: NEW });
    const port = new URL(github.origin).port;
    expect(tunnels).toContain(`127.0.0.1:${port}`);
    await install(via);
    expect(via.status().job).toEqual({ state: "restarting", version: NEW });

    // A proxy that is gone (its program closed): direct.
    const gone = await new Promise<string>((done) => {
      const probe = createNetServer().listen(0, "127.0.0.1", () => {
        const { port: free } = probe.address() as AddressInfo;
        probe.close(() => done(`http://127.0.0.1:${free}`));
      });
    });
    const direct = new Updater({ root: releaseFolder(OLD), version: OLD, sources: github.sources, proxy: async () => new URL(gone) });
    expect(await direct.check()).toMatchObject({ ok: true, latest: NEW });
  });
});
