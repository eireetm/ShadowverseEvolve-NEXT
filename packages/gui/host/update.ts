// The PC release's updates (settings "检查版本更新", README "发行版"): which version the newest release on GitHub is, and that
// release's PC package put in place of this program. Only the program is replaced — what the package has besides the
// player's folders and files, which are never written: public/, decks/ (but the release's own decks/samples/), replays/,
// settings.ini, online-server.ini. The old program is kept in update/previous/ until the next update.
//
// Where from. The package only from GitHub: github.com's download link, followed only to GitHub's own hosts, over HTTPS — it
// is the file the release has. The latest version may also be read from a mirror when GitHub answers neither of its two
// ways (from mainland China GitHub is often slow or cut): a wrong answer there brings no code, as the download is still
// GitHub's, of the version asked, and the package's VERSION.txt has to say that version — at worst a download that isn't
// there. Node's requests don't follow the computer's proxy as the browser does: these do, when there is one (HTTPS_PROXY,
// or Windows' system proxy, which VPN programs set), and go direct when it doesn't answer.
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { request as httpRequest, type ClientRequest, type IncomingHttpHeaders, type RequestOptions } from "node:http";
import { request as httpsRequest } from "node:https";
import type { Socket } from "node:net";
import { dirname, join } from "node:path";
import { connect as tlsConnect } from "node:tls";
import { unzipSync } from "fflate";

/** The repository whose releases these are. */
export const REPO = "eireetm/ShadowverseEvolve-NEXT";

/** A release's PC package (scripts/release-pc.ts): the program, without anyone's server configuration or resources. */
export const packageName = (version: string): string => `SVEN-${version}-pc.zip`;

/** A version from a tag or VERSION.txt ("v0.4.2", "0.4.2"), or null. */
export function parseVersion(text: string): [number, number, number] | null {
  const m = /^v?(\d{1,4})\.(\d{1,4})\.(\d{1,4})$/.exec(text.trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/** Whether version `a` comes after `b` (0.4.10 after 0.4.9; the same version doesn't). */
export function isNewer(a: string, b: string): boolean {
  const x = parseVersion(a);
  const y = parseVersion(b);
  if (!x || !y) return false;
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i]! > y[i]!;
  return false;
}

/** Where updates come from. */
export interface UpdateSources {
  /** GitHub's API for the latest release: its tag, its files with their sizes and SHA-256. */
  api: string;
  /** The repository on github.com: /releases/latest redirects to the latest release's tag; /releases/download/ has the files. */
  github: string;
  /** Asked for the latest version only, when GitHub answers neither way: a copy of the API's answer, or of the redirect. */
  mirrors: { url: string; kind: "api" | "redirect" }[];
  /** The hosts a download may be redirected to: GitHub's own. */
  downloadHost: (host: string) => boolean;
}

export const GITHUB: UpdateSources = {
  api: `https://api.github.com/repos/${REPO}/releases/latest`,
  github: `https://github.com/${REPO}`,
  // Free GitHub mirrors much used in mainland China (2026-10). They come and go: one that is gone only fails.
  mirrors: [
    { url: `https://gh-proxy.com/https://api.github.com/repos/${REPO}/releases/latest`, kind: "api" },
    { url: `https://ghfast.top/https://github.com/${REPO}/releases/latest`, kind: "redirect" },
    { url: `https://ghproxy.net/https://github.com/${REPO}/releases/latest`, kind: "redirect" },
  ],
  downloadHost: (host) => host === "github.com" || host.endsWith(".githubusercontent.com"),
};

/** Tests: GitHub played by a server on this computer (http://127.0.0.1:<port>), with GitHub's paths. */
export function localSources(origin: string, mirrors: UpdateSources["mirrors"] = []): UpdateSources {
  const host = new URL(origin).host;
  return { api: `${origin}/repos/${REPO}/releases/latest`, github: `${origin}/${REPO}`, mirrors, downloadHost: (h) => h === host };
}

// ---------------------------------------------------------------------------------------------------------------------
// Requests

/** An HTTP proxy that takes CONNECT: what VPN programs and companies' proxies offer. */
export type Proxy = URL;

/** The proxy didn't answer (the VPN program was closed ...): direct instead. */
class ProxyError extends Error {}

interface Answer {
  status: number;
  headers: IncomingHttpHeaders;
  body: Buffer;
}

interface GetOptions {
  /** How long to wait for the answer, and then for each next piece of it. */
  timeoutMs: number;
  maxBytes: number;
  onProgress?: (received: number, total: number | null) => void;
}

/** One GET, redirects not followed (the caller decides where it may go), through `proxy` when there is one. */
function getOnce(url: URL, proxy: Proxy | null, { timeoutMs, maxBytes, onProgress }: GetOptions): Promise<Answer> {
  return new Promise((resolve, reject) => {
    const secure = url.protocol === "https:";
    const port = Number(url.port) || (secure ? 443 : 80);
    let settled = false;
    let req: ClientRequest | null = null;
    let timer: NodeJS.Timeout | undefined;
    const finish = (answer: Answer): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(answer);
    };
    const fail = (err: Error): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      req?.destroy();
      reject(err);
    };
    const wait = (): void => {
      clearTimeout(timer);
      timer = setTimeout(() => fail(new Error(`${url.host}: no answer in ${timeoutMs / 1000} s`)), timeoutMs);
    };
    const send = (tunnel: Socket | null): void => {
      const options: RequestOptions = {
        method: "GET",
        hostname: url.hostname,
        port,
        path: `${url.pathname}${url.search}`,
        headers: { Host: url.host, "User-Agent": "SVEN-updater", Accept: "*/*" },
      };
      // Through the proxy: the connection it opened (TLS over it for https), given instead of the agent's.
      if (tunnel) options.createConnection = () => (secure ? tlsConnect({ socket: tunnel, servername: url.hostname }) : tunnel);
      req = (secure ? httpsRequest : httpRequest)(options, (res) => {
        const status = res.statusCode ?? 0;
        if (status >= 300 && status < 400) {
          res.resume();
          finish({ status, headers: res.headers, body: Buffer.alloc(0) });
          return;
        }
        const length = Number(res.headers["content-length"] ?? Number.NaN);
        const total = Number.isFinite(length) ? length : null;
        if (total !== null && total > maxBytes) return fail(new Error(`${url.host}: ${total} bytes, too big`));
        const chunks: Buffer[] = [];
        let received = 0;
        wait();
        res.on("data", (chunk: Buffer) => {
          received += chunk.length;
          if (received > maxBytes) return fail(new Error(`${url.host}: too big`));
          chunks.push(chunk);
          onProgress?.(received, total);
          wait();
        });
        res.on("end", () => {
          if (total !== null && received !== total) return fail(new Error(`${url.host}: cut off (${received} of ${total} bytes)`));
          finish({ status, headers: res.headers, body: Buffer.concat(chunks) });
        });
        res.on("error", fail);
      });
      req.on("error", fail);
      req.end();
    };
    wait();
    if (!proxy) return send(null);
    const connect = httpRequest({
      hostname: proxy.hostname,
      port: Number(proxy.port) || 80,
      method: "CONNECT",
      path: `${url.hostname}:${port}`,
      headers: { Host: `${url.hostname}:${port}` },
    });
    req = connect;
    connect.on("connect", (res, socket) => {
      if (res.statusCode !== 200) {
        socket.destroy();
        return fail(new ProxyError(`proxy ${proxy.host}: ${res.statusCode}`));
      }
      send(socket);
    });
    connect.on("error", (err) => fail(new ProxyError(`proxy ${proxy.host}: ${err.message}`)));
    connect.end();
  });
}

/** A proxy setting ("127.0.0.1:7890", "http://proxy:8080"), or null: only http:// proxies (CONNECT), not SOCKS. */
function proxyUrl(value: string): Proxy | null {
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `http://${value}`);
    return url.protocol === "http:" && url.hostname !== "" ? url : null;
  } catch {
    return null;
  }
}

/**
 * Windows' system proxy, from `reg query` of Internet Settings: on (ProxyEnable 0x1) and ProxyServer — "host:port", or one
 * per protocol ("http=host:port;https=host:port;socks=...").
 */
export function windowsProxy(regOutput: string): Proxy | null {
  if (!/^\s*ProxyEnable\s+REG_DWORD\s+0x0*1\s*$/im.test(regOutput)) return null;
  const server = /^\s*ProxyServer\s+REG_SZ\s+(\S+)\s*$/im.exec(regOutput)?.[1];
  if (!server) return null;
  const entries = server.split(";").map((entry) => entry.trim()).filter((entry) => entry !== "");
  const of = (scheme: string) => entries.find((entry) => entry.toLowerCase().startsWith(`${scheme}=`))?.slice(scheme.length + 1);
  const value = of("https") ?? of("http") ?? entries.find((entry) => !entry.includes("="));
  return value ? proxyUrl(value) : null;
}

/** The computer's proxy: HTTPS_PROXY and the like, else Windows' system proxy; null: none. */
export async function systemProxy(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): Promise<Proxy | null> {
  for (const name of ["HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy", "ALL_PROXY", "all_proxy"]) {
    const value = env[name];
    const url = value ? proxyUrl(value) : null;
    if (url) return url;
  }
  if (platform !== "win32") return null;
  const output = await new Promise<string>((done) =>
    execFile("reg", ["query", "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings"], { windowsHide: true, timeout: 5000 }, (err, stdout) =>
      done(err ? "" : stdout),
    ),
  );
  return windowsProxy(output);
}

/** Requests through the proxy while it answers, then direct. */
class Net {
  private proxy: Promise<Proxy | null>;

  constructor(proxy: Promise<Proxy | null>) {
    this.proxy = proxy.catch(() => null);
  }

  async get(url: URL, options: GetOptions): Promise<Answer> {
    const proxy = await this.proxy;
    if (proxy) {
      try {
        return await getOnce(url, proxy, options);
      } catch (err) {
        if (!(err instanceof ProxyError)) throw err;
        this.proxy = Promise.resolve(null);
      }
    }
    return getOnce(url, null, options);
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// The latest release

export type UpdateFailure = "download" | "noPackage" | "badPackage" | "cantWrite" | "noCheck";

export class UpdateError extends Error {
  constructor(
    readonly why: UpdateFailure,
    detail: string,
  ) {
    super(detail);
  }
}

interface Release {
  version: string;
  tag: string;
  /** The PC package as GitHub's API lists it; null when the version came another way. */
  file: { size: number; sha256: string | null } | null;
}

function versionOfTag(tag: string): string {
  const version = parseVersion(tag);
  if (!version) throw new Error(`not a version: ${tag}`);
  return version.join(".");
}

/** The latest release from the API's answer (GitHub's own: with its package's size and checksum; a mirror's: the tag only). */
function fromApi(answer: Answer, withFile: boolean): Release {
  if (answer.status !== 200) throw new Error(`HTTP ${answer.status}`);
  const json = JSON.parse(answer.body.toString("utf8")) as { tag_name?: unknown; assets?: unknown };
  const tag = typeof json.tag_name === "string" ? json.tag_name : "";
  const version = versionOfTag(tag);
  let file: Release["file"] = null;
  if (withFile && Array.isArray(json.assets)) {
    const asset = (json.assets as { name?: unknown; size?: unknown; digest?: unknown }[]).find((a) => a?.name === packageName(version));
    if (asset && typeof asset.size === "number") {
      const digest = typeof asset.digest === "string" && /^sha256:[0-9a-f]{64}$/i.test(asset.digest) ? asset.digest.slice(7).toLowerCase() : null;
      file = { size: asset.size, sha256: digest };
    }
  }
  return { version, tag, file };
}

/** The latest release from the redirect of /releases/latest to its tag's page (".../releases/tag/v0.4.2"). */
function fromRedirect(answer: Answer): Release {
  const tag = /\/releases\/tag\/([^/?#]+)$/.exec(answer.headers.location ?? "")?.[1];
  if (answer.status < 300 || answer.status >= 400 || !tag) throw new Error(`HTTP ${answer.status}`);
  const decoded = decodeURIComponent(tag);
  return { version: versionOfTag(decoded), tag: decoded, file: null };
}

/** What a check found (the settings' "检查版本更新"). */
export type UpdateCheck =
  | { ok: true; current: string; latest: string; newer: boolean; page: string; from: "github" | "mirror" }
  | { ok: false; why: "unreachable" };

/** An update under way, as the settings' window shows it. */
export type UpdateJob =
  | { state: "idle" }
  | { state: "downloading"; received: number; total: number | null }
  | { state: "installing" }
  | { state: "restarting"; version: string }
  | { state: "failed"; why: UpdateFailure; detail: string };

const CHECK_MS = 8000;
const DOWNLOAD_MS = 30_000;
const MAX_PACKAGE = 64 << 20;

// ---------------------------------------------------------------------------------------------------------------------
// The package

/** A package's files by their path in the release's folder ("app/index.html"); null: a folder ("public/images/cards"). */
export type PackageFiles = Map<string, Uint8Array | null>;

const MAX_UNPACKED = 256 << 20;

/** The player's: an update never writes them (only the release's sample decks, decks/samples/, are the program's). */
const PLAYERS = new Set(["public", "replays", "decks", "update", "settings.ini", "online-server.ini"]);

/** A downloaded package's files, checked: a zip of a release's folder, of the version asked (its VERSION.txt), whole. */
export function readPackage(zip: Uint8Array, version: string): PackageFiles {
  let unpacked = 0;
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(zip, {
      filter: (file) => {
        unpacked += file.originalSize;
        if (unpacked > MAX_UNPACKED) throw new UpdateError("badPackage", "too big unpacked");
        return true;
      },
    });
  } catch (err) {
    throw err instanceof UpdateError ? err : new UpdateError("badPackage", `not a zip: ${String(err)}`);
  }
  const names = Object.keys(entries);
  // The release's zip has its folder at the top ("SVEN-0.4.2-pc/app/..."): left out.
  const strip = new Set(names.map((name) => name.split("/")[0])).size === 1 && names.every((name) => name.includes("/"));
  const files: PackageFiles = new Map();
  for (const name of names) {
    const path = strip ? name.slice(name.indexOf("/") + 1) : name;
    if (path === "") continue;
    const folder = path.endsWith("/");
    const parts = (folder ? path.slice(0, -1) : path).split("/");
    if (path.includes("\\") || parts.some((part) => part === "" || part === "." || part === ".." || part.includes(":"))) {
      throw new UpdateError("badPackage", `a path out of the folder: ${name}`);
    }
    files.set(parts.join("/"), folder ? null : entries[name]!);
  }
  const versionFile = files.get("VERSION.txt");
  const said = versionFile ? /^﻿?Shadowverse: Evolve NEXT (\S+)/.exec(new TextDecoder().decode(versionFile))?.[1] : undefined;
  if (said !== version) throw new UpdateError("badPackage", `VERSION.txt says ${said ?? "nothing"}, not ${version}`);
  for (const needed of ["server.mjs", "app/index.html"]) {
    if (!(files.get(needed) instanceof Uint8Array)) throw new UpdateError("badPackage", `no ${needed}`);
  }
  return files;
}

/** The program's parts in a package (what an update replaces): its top-level files and folders but the player's, and decks/samples. */
export function programParts(files: PackageFiles): string[] {
  const parts = new Set<string>();
  for (const path of files.keys()) {
    const top = path.split("/")[0]!;
    if (!PLAYERS.has(top)) parts.add(top);
    else if (path === "decks/samples" || path.startsWith("decks/samples/")) parts.add("decks/samples");
  }
  return [...parts].sort();
}

/** fs.rename, tried again for a few seconds while Windows has the file busy (an antivirus scan, the search indexer). */
async function renameRetrying(from: string, to: string, move: typeof rename): Promise<void> {
  for (let tries = 0; ; tries++) {
    try {
      return await move(from, to);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (tries >= 30 || !(code === "EPERM" || code === "EBUSY" || code === "EACCES")) throw err;
      await new Promise((done) => setTimeout(done, 100));
    }
  }
}

/**
 * Put a package's program in place of the one in `root`. The new program is written beside it first (update/new/); then
 * each part of the old one goes to update/previous/ (the last version's only) and the new one takes its place — and on a
 * failure what was moved goes back, so the folder is as it was. Then the player's folders the new version has and this one
 * hadn't (empty: new resource folders in public/) are made; nothing in them is written.
 */
export async function installPackage(root: string, files: PackageFiles, move: typeof rename = rename): Promise<void> {
  const fresh = join(root, "update", "new");
  const previous = join(root, "update", "previous");
  const parts = programParts(files);
  const inProgram = (path: string) => parts.some((part) => path === part || path.startsWith(`${part}/`));
  try {
    await rm(fresh, { recursive: true, force: true });
    for (const [path, data] of files) {
      if (!inProgram(path)) continue;
      if (data === null) await mkdir(join(fresh, path), { recursive: true });
      else {
        await mkdir(dirname(join(fresh, path)), { recursive: true });
        await writeFile(join(fresh, path), data);
      }
    }
    await rm(previous, { recursive: true, force: true });
  } catch (err) {
    throw new UpdateError("cantWrite", String(err));
  }
  const moved: { from: string; to: string }[] = [];
  const shift = async (from: string, to: string): Promise<void> => {
    await mkdir(dirname(to), { recursive: true });
    await renameRetrying(from, to, move);
    moved.push({ from, to });
  };
  try {
    for (const part of parts) {
      if (existsSync(join(root, part))) await shift(join(root, part), join(previous, part));
      await shift(join(fresh, part), join(root, part));
    }
  } catch (err) {
    for (const { from, to } of moved.reverse()) await renameRetrying(to, from, move).catch(() => undefined);
    throw new UpdateError("cantWrite", String(err));
  }
  for (const [path, data] of files) if (data === null && !inProgram(path)) await mkdir(join(root, path), { recursive: true }).catch(() => undefined);
  await rm(fresh, { recursive: true, force: true }).catch(() => undefined);
}

// ---------------------------------------------------------------------------------------------------------------------
// The updater of a release's folder

export interface UpdaterOptions {
  /** The release's folder. */
  root: string;
  /** This program's version. */
  version: string;
  sources?: UpdateSources;
  /** The computer's proxy, looked for at each check (tests: none, or theirs). */
  proxy?: () => Promise<Proxy | null>;
  /** Tests: a rename that fails. */
  rename?: typeof rename;
}

/** The release server's updater (host/release-server.ts): checks, and one update at a time. */
export class Updater {
  private readonly sources: UpdateSources;
  private readonly findProxy: () => Promise<Proxy | null>;
  private net: Net;
  /** The newer release the last check found: what "更新" installs (nothing else). */
  private offered: Release | null = null;
  private job: UpdateJob = { state: "idle" };

  constructor(private readonly options: UpdaterOptions) {
    this.sources = options.sources ?? GITHUB;
    this.findProxy = options.proxy ?? (() => systemProxy());
    this.net = new Net(Promise.resolve(null));
  }

  status(): { version: string; job: UpdateJob } {
    return { version: this.options.version, job: this.job };
  }

  /** Which version the latest release is: GitHub's two ways at once, then the mirrors. */
  async check(): Promise<UpdateCheck> {
    this.net = new Net(this.findProxy());
    const get = (url: string) => this.net.get(new URL(url), { timeoutMs: CHECK_MS, maxBytes: 1 << 20 });
    // The API's answer when it comes (it has the package's size and checksum), else the redirect's.
    const page = get(`${this.sources.github}/releases/latest`).then(fromRedirect);
    page.catch(() => undefined);
    let release: Release | null = await get(this.sources.api)
      .then((answer) => fromApi(answer, true))
      .catch(() => page)
      .catch(() => null);
    let from: "github" | "mirror" = "github";
    if (!release) {
      // GitHub answered neither way: the newest any mirror says.
      from = "mirror";
      const said = await Promise.allSettled(this.sources.mirrors.map(({ url, kind }) => get(url).then((answer) => (kind === "api" ? fromApi(answer, false) : fromRedirect(answer)))));
      for (const one of said) if (one.status === "fulfilled" && (!release || isNewer(one.value.version, release.version))) release = one.value;
    }
    if (!release) {
      this.offered = null;
      return { ok: false, why: "unreachable" };
    }
    const newer = isNewer(release.version, this.options.version);
    this.offered = newer ? release : null;
    return { ok: true, current: this.options.version, latest: release.version, newer, page: `${this.sources.github}/releases/tag/${encodeURIComponent(release.tag)}`, from };
  }

  /**
   * Install the newer version the last check found: download, check, put in place, then `restart` (the new server.mjs). False
   * when an update is under way already; how it goes: status().
   */
  install(restart: () => void): boolean {
    if (this.job.state === "downloading" || this.job.state === "installing" || this.job.state === "restarting") return false;
    const release = this.offered;
    if (!release) {
      this.job = { state: "failed", why: "noCheck", detail: "" };
      return true;
    }
    this.job = { state: "downloading", received: 0, total: release.file?.size ?? null };
    this.run(release).then(
      () => {
        this.job = { state: "restarting", version: release.version };
        restart();
      },
      (err: unknown) => {
        this.job = err instanceof UpdateError ? { state: "failed", why: err.why, detail: err.message } : { state: "failed", why: "cantWrite", detail: String(err) };
      },
    );
    return true;
  }

  private async run(release: Release): Promise<void> {
    const zip = await this.download(release);
    this.job = { state: "installing" };
    await installPackage(this.options.root, readPackage(zip, release.version), this.options.rename);
  }

  /** The release's package from GitHub, redirects followed only to GitHub's hosts; its size and checksum when the API gave them. */
  private async download(release: Release): Promise<Uint8Array> {
    const name = packageName(release.version);
    let url = new URL(`${this.sources.github}/releases/download/${encodeURIComponent(release.tag)}/${name}`);
    const protocol = url.protocol;
    const onProgress = (received: number, total: number | null) => {
      this.job = { state: "downloading", received, total: total ?? release.file?.size ?? null };
    };
    for (let hops = 0; ; hops++) {
      let answer: Answer;
      try {
        answer = await this.net.get(url, { timeoutMs: DOWNLOAD_MS, maxBytes: MAX_PACKAGE, onProgress });
      } catch (err) {
        throw new UpdateError("download", err instanceof Error ? err.message : String(err));
      }
      if (answer.status >= 300 && answer.status < 400) {
        const next = new URL(answer.headers.location ?? "", url);
        if (hops >= 5 || next.protocol !== protocol || !this.sources.downloadHost(next.host)) throw new UpdateError("download", `redirected to ${next.host}`);
        url = next;
        continue;
      }
      if (answer.status === 404) throw new UpdateError("noPackage", name);
      if (answer.status !== 200) throw new UpdateError("download", `${url.host}: HTTP ${answer.status}`);
      if (release.file && answer.body.length !== release.file.size) throw new UpdateError("badPackage", `${answer.body.length} bytes, not ${release.file.size}`);
      if (release.file?.sha256 && createHash("sha256").update(answer.body).digest("hex") !== release.file.sha256) throw new UpdateError("badPackage", "SHA-256 differs");
      return answer.body;
    }
  }
}
