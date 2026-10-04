// The online server's program (server.mjs on the server, `sve-server` in its terminal): runs the relay, or edits the keys.
//   sve-server [--config <file>]            run (the systemd service does: setup.sh sets it up)
//   sve-server newkey <name>                a new key; prints the text an app needs to use it
//   sve-server client <name>                that text again, for a key there is
//   sve-server keys                         the keys' names
//   sve-server revoke <name>                remove a key (its connections close within seconds)
//   sve-server status                       who is connected now, and this hour's use per key
//   sve-server records                      the finished games kept (a file a month), to download and train with
// The configuration file is /etc/sve-server/server.ini (or $SVE_SERVER_CONFIG, or --config). A running server reads it again
// when it changes (once it has stayed the same for a few seconds: an editor writing it isn't caught halfway), and the
// certificate files when they change (certbot renews them every few days).
import { X509Certificate } from "node:crypto";
import { chmodSync, chownSync, existsSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createServer as createHttpsServer, get as httpsGet } from "node:https";
import { get as httpGet } from "node:http";
import { dirname } from "node:path";
import { clientConfigText, newConfigText, newKey, readConfig, validKeyName, withKey, withoutKey, type ServerConfig } from "./config";
import { recordFiles } from "./records";
import { startRelay, type RelayStatus } from "./relay";

declare const __SERVER_VERSION__: string;
const VERSION = typeof __SERVER_VERSION__ === "string" ? __SERVER_VERSION__ : "dev";

const args = process.argv.slice(2);
const option = (name: string): string | null => {
  const at = args.indexOf(name);
  return at >= 0 ? (args[at + 1] ?? null) : null;
};
const words = args.filter((a, i) => !a.startsWith("--") && !(i > 0 && args[i - 1] === "--config"));
const configFile = option("--config") ?? process.env.SVE_SERVER_CONFIG ?? "/etc/sve-server/server.ini";

const HELP = [
  "sve-server                 运行服务器 run the server (the sve-server service does)",
  "sve-server newkey <名字>   新密钥，打印给 App 用的配置 a new key, and the text an app needs",
  "sve-server client <名字>   再打印一次那段配置 that text again",
  "sve-server keys            列出密钥 the keys",
  "sve-server revoke <名字>   作废密钥 revoke a key",
  "sve-server status          现在的连接和本小时的用量 who is connected now, this hour's use",
  "sve-server records         保存下来的对局 the games kept (to train the bots)",
  "配置文件 configuration: /etc/sve-server/server.ini (--config <file>)",
].join("\n");

const log = (line: string): void => console.log(`${new Date().toISOString().slice(0, 19).replace("T", " ")} ${line}`);

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function readText(file: string): string {
  if (!existsSync(file)) fail(`没有配置文件 no configuration file: ${file}`);
  return readFileSync(file, "utf8");
}

/** Write the configuration file whole, in one step (a running server never reads half of it), keeping its owner and mode. */
function writeText(file: string, text: string): void {
  const before = statSync(file);
  const temp = `${file}.new`;
  writeFileSync(temp, text, { mode: before.mode & 0o777 });
  try {
    chownSync(temp, before.uid, before.gid);
    chmodSync(temp, before.mode & 0o777);
  } catch {
    // not root: the file stays this user's
  }
  renameSync(temp, file);
}

function configOf(file: string): ServerConfig {
  const { config, problems } = readConfig(readText(file));
  for (const p of problems) console.error(`配置 config: ${p}`);
  return config;
}

/** The certificate's end, as a date ("2026-10-10 12:00"), and how many hours are left. */
function certificateEnd(pem: string): { date: string; hours: number } {
  const end = new Date(new X509Certificate(pem).validTo);
  return { date: end.toISOString().slice(0, 16).replace("T", " "), hours: Math.floor((end.getTime() - Date.now()) / 3_600_000) };
}

function formatStatus(s: RelayStatus): string {
  const lines = [`在线 online: ${s.connections} · 房间 rooms: ${s.rooms} · 大厅 lobby: ${s.lobby.following} 人看 following, ${s.lobby.listed} 个公开房间 public rooms`];
  lines.push("密钥 key — 现在的连接 connections now · 本小时 this hour: 连上 connects / 开房 rooms / 流量 KB / 存下的对局 games kept");
  for (const [name, k] of Object.entries(s.keys)) lines.push(`  ${name} — ${k.connections} · ${k.connects} / ${k.rooms} / ${Math.round(k.bytes / 1024)} / ${k.records}`);
  const refused = Object.entries(s.refused);
  if (refused.length > 0) lines.push(`拒绝 refused: ${refused.map(([why, n]) => `${why} ${n}`).join(", ")}`);
  return lines.join("\n");
}

/** Run the server until stopped. */
function run(): void {
  let config = configOf(configFile);
  let configStamp = statSync(configFile).mtimeMs;
  let pending: number | null = null;
  const tls = config.tlsCert && config.tlsKey ? { cert: config.tlsCert, key: config.tlsKey } : null;
  const readTls = () => ({ cert: readFileSync(tls!.cert, "utf8"), key: readFileSync(tls!.key, "utf8") });
  let tlsStamp = tls ? statSync(tls.cert).mtimeMs : 0;
  const local = (req: IncomingMessage) => ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(req.socket.remoteAddress ?? "");
  let relay: ReturnType<typeof startRelay> | null = null;
  // The page a browser sees: that this is the server (checks the address and the certificate); the numbers only from here.
  const page = (req: IncomingMessage, res: ServerResponse): void => {
    if (req.url === "/status" && local(req) && relay) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(relay.status()));
    } else if (req.url === "/" || req.url === "/status") {
      res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
      res.end(`Shadowverse: Evolve NEXT — online server ${VERSION}: OK\n联机服务器正常运行。\n`);
    } else {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("not found\n");
    }
  };
  let server: ReturnType<typeof createHttpServer> | ReturnType<typeof createHttpsServer>;
  if (tls) {
    const pem = readTls();
    server = createHttpsServer(pem, page);
    const end = certificateEnd(pem.cert);
    log(`certificate valid until ${end.date} UTC (${end.hours} h)`);
  } else {
    server = createHttpServer(page);
    log("no certificate (tls_cert, tls_key): plain ws:// — the phone apps can't connect like this");
  }
  relay = startRelay(server, config, log);
  server.on("error", (err) => fail(`服务器启动失败 the server can't start: ${err.message}`));
  const listening = () =>
    log(`sve-server ${VERSION} listening on port ${config.port} (${tls ? "wss" : "ws"}): ${config.keys.size} keys, ${config.spectators} spectator seats per room, records ${config.records.enabled ? `kept in ${config.records.dir}` : "off"}`);
  if (config.listen) server.listen(config.port, config.listen, listening);
  else server.listen(config.port, listening);

  const reloadConfig = () => {
    const { config: next, problems } = readConfig(readFileSync(configFile, "utf8"));
    for (const p of problems) log(`config: ${p}`);
    if (next.port !== config.port || next.tlsCert !== config.tlsCert || next.tlsKey !== config.tlsKey) log("config: the port or the certificate files changed: restart to use them (sudo systemctl restart sve-server)");
    config = next;
    relay!.configure(next);
    log(`config read again: ${next.keys.size} keys (${[...next.keys.keys()].join(", ")}), ${next.spectators} spectator seats, records ${next.records.enabled ? "on" : "off"}`);
  };
  const reloadTls = () => {
    if (!tls || !("setSecureContext" in server)) return;
    const pem = readTls();
    server.setSecureContext(pem);
    const end = certificateEnd(pem.cert);
    log(`certificate read again: valid until ${end.date} UTC (${end.hours} h)`);
  };
  // The file changed: read it once it has stayed the same for a check (an editor may be writing it).
  setInterval(() => {
    try {
      const stamp = statSync(configFile).mtimeMs;
      if (stamp !== configStamp) {
        configStamp = stamp;
        pending = stamp;
      } else if (pending === stamp) {
        pending = null;
        reloadConfig();
      }
    } catch (err) {
      log(`config: can't read ${configFile}: ${String(err)}`);
    }
  }, 4000);
  setInterval(() => {
    try {
      if (!tls) return;
      const stamp = statSync(tls.cert).mtimeMs;
      if (stamp !== tlsStamp) {
        tlsStamp = stamp;
        setTimeout(reloadTls, 2000);
      }
    } catch (err) {
      log(`certificate: can't read it: ${String(err)}`);
    }
  }, 60_000);
  // Every hour: the hour's numbers, and a warning when the certificate isn't being renewed.
  setInterval(() => {
    const s = relay!.takeHour();
    log(`hour: ${s.connections} connected, ${s.rooms} rooms (${s.lobby.listed} public); ${Object.entries(s.keys).map(([n, k]) => `${n} ${k.connects} connects/${k.rooms} rooms/${Math.round(k.bytes / 1024)} KB/${k.records} games`).join("; ")}${Object.keys(s.refused).length ? `; refused ${JSON.stringify(s.refused)}` : ""}`);
    if (tls) {
      const end = certificateEnd(readTls().cert);
      if (end.hours < 48) log(`WARNING: the certificate ends in ${end.hours} h and hasn't been renewed (sudo certbot renew)`);
    }
  }, 3_600_000);
  process.on("SIGHUP", () => {
    reloadConfig();
    reloadTls();
  });
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      log("stopping");
      relay?.close();
      server.close();
      process.exit(0);
    });
  }
}

/** Ask the running server (on this machine) for its numbers. */
function status(): void {
  const config = configOf(configFile);
  const options = { host: "127.0.0.1", port: config.port, path: "/status", rejectUnauthorized: false, timeout: 5000 };
  const done = (res: IncomingMessage) => {
    let body = "";
    res.on("data", (chunk: Buffer) => (body += chunk.toString()));
    res.on("end", () => {
      try {
        console.log(formatStatus(JSON.parse(body) as RelayStatus));
      } catch {
        fail(`服务器的回答看不懂 unexpected answer: ${body.slice(0, 200)}`);
      }
    });
  };
  const req = config.tlsCert ? httpsGet(options, done) : httpGet(options, done);
  req.on("error", (err) => fail(`连不上本机的服务器（它在运行吗？sudo systemctl status sve-server） can't reach the server: ${err.message}`));
}

const [command, name] = words;
if (command === undefined || command === "run") run();
else if (command === "status") status();
else if (command === "records") {
  const config = configOf(configFile);
  const files = recordFiles(config.records.dir);
  console.log(`保存对局 keeping games: ${config.records.enabled ? "开 on" : "关 off"} · ${config.records.dir}`);
  if (files.length === 0) console.log("还没有对局 no games yet");
  for (const f of files) console.log(`  ${f.file} — ${f.games} 局 games, ${(f.bytes / 1024).toFixed(0)} KB`);
  if (files.length > 0) console.log(`共 in all: ${files.reduce((s, f) => s + f.games, 0)} 局 games（在控制台的"文件管理"里打开这个文件夹下载 download them with the console's file manager）`);
} else if (command === "keys") {
  const config = configOf(configFile);
  if (config.keys.size === 0) console.log("没有密钥 no keys");
  for (const [n, key] of config.keys) console.log(`${n} = ${key.slice(0, 4)}…`);
} else if (command === "client") {
  if (!name) fail("用法 usage: sve-server client <名字 name>");
  const text = clientConfigText(configOf(configFile), name);
  if (text === null) fail(`没有这个名字的密钥 no key named ${name} (sve-server keys)`);
  console.log(text);
} else if (command === "newkey") {
  if (!name || !validKeyName(name)) fail("用法 usage: sve-server newkey <名字 name>（字母、数字、- _ .，不要空格 letters, digits, - _ ., no spaces）");
  const text = readText(configFile);
  if (readConfig(text).config.keys.has(name)) fail(`已经有这个名字的密钥了 there is a key named ${name} already (sve-server client ${name})`);
  writeText(configFile, withKey(text, name, newKey()));
  console.log(`新密钥 new key "${name}"（几秒后生效 works within seconds）。把下面这段文字给要用它的人 / give this text to the people who use it:\n`);
  console.log(clientConfigText(configOf(configFile), name));
} else if (command === "init") {
  // setup.sh: a new server's configuration file (kept when there is one), owned by root and readable by the service's user.
  if (!name || !/^wss?:\/\/\S+$/.test(name)) fail("用法 usage: sve-server init wss://<IP>");
  if (existsSync(configFile)) {
    console.log(`配置文件已存在，保留 keeping the configuration file: ${configFile}`);
  } else {
    const dir = dirname(configFile);
    writeFileSync(configFile, newConfigText(name, "first", newKey(), `${dir}/tls/fullchain.pem`, `${dir}/tls/privkey.pem`), { mode: 0o640 });
    console.log(`新的配置文件 new configuration file: ${configFile}（第一把密钥叫 first the first key: first）`);
  }
} else if (command === "revoke") {
  if (!name) fail("用法 usage: sve-server revoke <名字 name>");
  const text = withoutKey(readText(configFile), name);
  if (text === null) fail(`没有这个名字的密钥 no key named ${name} (sve-server keys)`);
  writeText(configFile, text);
  console.log(`已作废 revoked: ${name}（用它的连接几秒内断开 its connections close within seconds）`);
} else if (command.endsWith(".ini")) {
  fail("用 --config 指定配置文件 give the configuration file with --config");
} else {
  console.log(HELP);
}
