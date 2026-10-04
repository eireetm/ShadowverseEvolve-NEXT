// The online server's configuration file (server.ini, /etc/sve-server/ on the server): a text file the owner edits by
// hand, in sections of "name = value" lines (";" and "#" begin comments). [server]: what this server is and where it
// listens; [rooms] and [limits]: how much it takes; [keys]: who may use it, a named key per line. Reading never fails:
// a missing or wrong value is the default (and said so); editing it keeps the rest of the file as it is.
import { randomBytes } from "node:crypto";

/** What the apps say they are (their room id, `APP_ID` in the app): only they are served. */
export const APP_ID = "sve-evolve-gui-online-2";

export interface Limits {
  /** Connections at once, in all, and from one address (many people share one address on mobile networks). */
  maxConnections: number;
  maxConnectionsPerIp: number;
  /** The largest message, in bytes (a spectator's backlog piece is the largest the apps send: a few dozen KB). */
  maxMessageBytes: number;
  /** A connection's messages and bytes per second, on average (bursts of a minute's worth are fine). */
  messagesPerSecond: number;
  bytesPerSecond: number;
}

export interface ServerConfig {
  /** The server's name, shown in the apps' online screen ("北京"). */
  name: string;
  /** The address the apps connect to (wss://<IP>), for the client config this server hands out. */
  address: string;
  port: number;
  /** The address it listens on (empty: all of this machine's; 127.0.0.1: only this machine, for tests). */
  listen: string;
  /** The TLS certificate and key files (PEM); none: plain ws:// (for tests: the phone apps need wss://). */
  tlsCert: string | null;
  tlsKey: string | null;
  /** Spectator seats per room (the apps are told when they connect). */
  spectators: number;
  maxRooms: number;
  limits: Limits;
  /** The keys, by name (a key per name). */
  keys: Map<string, string>;
  /** Finished games the two players let the server keep (records.ts), to train the bots. */
  records: RecordsConfig;
}

export interface RecordsConfig {
  enabled: boolean;
  /** Where (a file of games per month); the service's own folder (systemd StateDirectory). */
  dir: string;
  /** At most this many games a day from one key (a disk filled by one key would stop everyone's). */
  perKeyPerDay: number;
  /** Games aren't kept while the disk has less free space than this (MB). */
  minFreeMb: number;
}

export const DEFAULTS = {
  name: "SVE",
  port: 443,
  spectators: 10,
  maxRooms: 1000,
  maxConnections: 3000,
  maxConnectionsPerIp: 20,
  maxMessageKb: 256,
  messagesPerSecond: 30,
  kbPerSecond: 32,
  recordsDir: "/var/lib/sve-server/games",
  recordsPerKeyPerDay: 2000,
  recordsMinFreeMb: 1024,
} as const;

/** One "name = value" line of a section. */
interface Entry {
  section: string;
  name: string;
  value: string;
}

const SECTION = /^\s*\[([^\]]+)\]\s*$/;
const FLAGS = new Map([...["yes", "true", "on", "1"].map((v) => [v, true] as const), ...["no", "false", "off", "0"].map((v) => [v, false] as const)]);
const ENTRY = /^\s*([^=;#\s][^=]*?)\s*=\s*(.*?)\s*$/;

/** The file's entries in order (comments and blank lines skipped). */
export function entriesOf(text: string): Entry[] {
  const out: Entry[] = [];
  let section = "";
  for (const raw of text.replace(/^﻿/, "").split(/\r?\n/)) {
    const line = raw.trim();
    if (line === "" || line.startsWith(";") || line.startsWith("#")) continue;
    const s = SECTION.exec(line);
    if (s) {
      section = s[1]!.trim().toLowerCase();
      continue;
    }
    const e = ENTRY.exec(line);
    if (e) out.push({ section, name: e[1]!, value: e[2]! });
  }
  return out;
}

/** A whole number in [min, max], or null when the text isn't one. */
function whole(value: string, min: number, max: number): number | null {
  if (!/^\d+$/.test(value)) return null;
  const n = Number(value);
  return n >= min && n <= max ? n : null;
}

/** The configuration a file says, and what in it was wrong (taken as the default). */
export function readConfig(text: string): { config: ServerConfig; problems: string[] } {
  const problems: string[] = [];
  const entries = entriesOf(text);
  const get = (section: string, name: string): string | undefined => entries.find((e) => e.section === section && e.name.toLowerCase() === name)?.value;
  const number = (section: string, name: string, fallback: number, min: number, max: number): number => {
    const value = get(section, name);
    if (value === undefined || value === "") return fallback;
    const n = whole(value, min, max);
    if (n === null) problems.push(`[${section}] ${name} = ${value}: not a whole number from ${min} to ${max}, ${fallback} instead`);
    return n ?? fallback;
  };
  const keys = new Map<string, string>();
  for (const e of entries.filter((x) => x.section === "keys")) {
    if (e.value.length < 8) problems.push(`[keys] ${e.name}: a key needs at least 8 characters, left out`);
    else if (keys.has(e.name)) problems.push(`[keys] ${e.name}: the name is there twice, the first one kept`);
    else keys.set(e.name, e.value);
  }
  const path = (name: string): string | null => {
    const value = get("server", name);
    return value === undefined || value === "" ? null : value;
  };
  const config: ServerConfig = {
    name: get("server", "name") || DEFAULTS.name,
    address: get("server", "address") ?? "",
    port: number("server", "port", DEFAULTS.port, 1, 65535),
    listen: get("server", "listen") ?? "",
    tlsCert: path("tls_cert"),
    tlsKey: path("tls_key"),
    spectators: number("rooms", "spectators", DEFAULTS.spectators, 0, 100),
    maxRooms: number("rooms", "max_rooms", DEFAULTS.maxRooms, 1, 100_000),
    limits: {
      maxConnections: number("limits", "max_connections", DEFAULTS.maxConnections, 1, 100_000),
      maxConnectionsPerIp: number("limits", "max_connections_per_ip", DEFAULTS.maxConnectionsPerIp, 1, 100_000),
      maxMessageBytes: number("limits", "max_message_kb", DEFAULTS.maxMessageKb, 1, 16_384) * 1024,
      messagesPerSecond: number("limits", "messages_per_second", DEFAULTS.messagesPerSecond, 1, 10_000),
      bytesPerSecond: number("limits", "kb_per_second", DEFAULTS.kbPerSecond, 1, 1_000_000) * 1024,
    },
    keys,
    records: { enabled: true, dir: DEFAULTS.recordsDir, perKeyPerDay: DEFAULTS.recordsPerKeyPerDay, minFreeMb: DEFAULTS.recordsMinFreeMb },
  };
  if ((config.tlsCert === null) !== (config.tlsKey === null)) problems.push("[server] tls_cert and tls_key go together: plain ws:// without them");
  const enabled = get("records", "enabled");
  const on = enabled === undefined || enabled === "" ? true : FLAGS.get(enabled.toLowerCase());
  if (on === undefined) problems.push(`[records] enabled = ${enabled}: yes or no, yes instead`);
  config.records = {
    enabled: on ?? true,
    dir: get("records", "dir") || DEFAULTS.recordsDir,
    perKeyPerDay: number("records", "per_key_per_day", DEFAULTS.recordsPerKeyPerDay, 0, 1_000_000),
    minFreeMb: number("records", "min_free_mb", DEFAULTS.recordsMinFreeMb, 0, 10_000_000),
  };
  return { config, problems };
}

/** A new key: 24 random bytes, as 32 letters and digits (base64url). */
export function newKey(): string {
  return randomBytes(24).toString("base64url");
}

/** A key's name: letters (any language), digits, "-", "_", "."; no spaces. */
export function validKeyName(name: string): boolean {
  return /^[\p{L}\p{N}._-]{1,40}$/u.test(name);
}

/** The file with key `name` set to `key` (its line replaced, or added at the end of [keys]); the rest stays as it was. */
export function withKey(text: string, name: string, key: string): string {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/);
  let section = "";
  let keysEnd = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim();
    const s = SECTION.exec(line);
    if (s) {
      section = s[1]!.trim().toLowerCase();
      if (section === "keys") keysEnd = i + 1;
      continue;
    }
    if (section !== "keys") continue;
    const e = ENTRY.exec(line);
    if (e && !line.startsWith(";") && !line.startsWith("#")) {
      if (e[1] === name) {
        lines[i] = `${name} = ${key}`;
        return lines.join("\n");
      }
    }
    if (line !== "") keysEnd = i + 1;
  }
  if (keysEnd < 0) {
    while (lines.length > 0 && lines[lines.length - 1]!.trim() === "") lines.pop();
    lines.push("", "[keys]", `${name} = ${key}`, "");
    return lines.join("\n");
  }
  lines.splice(keysEnd, 0, `${name} = ${key}`);
  return lines.join("\n");
}

/** The file without key `name` (its line removed); null when there is no such key. */
export function withoutKey(text: string, name: string): string | null {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/);
  let section = "";
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim();
    const s = SECTION.exec(line);
    if (s) {
      section = s[1]!.trim().toLowerCase();
      continue;
    }
    const e = ENTRY.exec(line);
    if (section === "keys" && e && !line.startsWith(";") && !line.startsWith("#") && e[1] === name) {
      lines.splice(i, 1);
      return lines.join("\n");
    }
  }
  return null;
}

/** The text an app needs to use this server with key `name` (its "online-server.ini", or pasted in its settings). */
export function clientConfigText(config: ServerConfig, name: string): string | null {
  const key = config.keys.get(name);
  if (key === undefined) return null;
  return [
    "; Shadowverse: Evolve NEXT — 联机服务器 / Online server / オンラインサーバー",
    "; 只给要一起玩的人，不要公开。Only for the people you play with: don't post it.",
    "[server]",
    `name = ${config.name}`,
    `address = ${config.address}`,
    `key = ${key}`,
    "",
  ].join("\n");
}

/** A new server's configuration file (setup.sh): this address, port 443 with the certificate, the defaults, one key. */
export function newConfigText(address: string, keyName: string, key: string, tlsCert: string, tlsKey: string): string {
  return `; Shadowverse: Evolve NEXT — online server (sve-server). Changes are read again within a few seconds,
; except the port and the certificate files (then: sudo systemctl restart sve-server).
; 改了以后几秒内自动生效（端口和证书文件除外：改了要 sudo systemctl restart sve-server）。

[server]
; The name the apps show for this server. 在 App 里显示的服务器名字。
name = ${DEFAULTS.name}
; The address the apps connect to (the client config says it). App 连接的地址（客户端配置里写的就是它）。
address = ${address}
port = ${DEFAULTS.port}
; The certificate (setup.sh gets it and renews it). 证书（setup.sh 自动申请、自动续）。
tls_cert = ${tlsCert}
tls_key = ${tlsKey}

[rooms]
; Spectator seats per room (the apps are told). 每个房间的观战席（App 连上时会知道）。
spectators = ${DEFAULTS.spectators}
max_rooms = ${DEFAULTS.maxRooms}

[limits]
; Safety limits: a key that leaks can't do more than play. 防滥用的上限。
max_connections = ${DEFAULTS.maxConnections}
max_connections_per_ip = ${DEFAULTS.maxConnectionsPerIp}
max_message_kb = ${DEFAULTS.maxMessageKb}
messages_per_second = ${DEFAULTS.messagesPerSecond}
kb_per_second = ${DEFAULTS.kbPerSecond}

[records]
; Finished online games are kept here when both players allow it (the apps' setting, on by default), to train the bots:
; seeds, decks and answers only (no names, no chat, no addresses). sudo sve-server records: how many there are.
; 双方都同意时（App 的设置，默认开着）把下完的联机对局存在这里，用来训练 Bot：只有种子、卡组和每一步的回答，没有名字、聊天和 IP。
enabled = yes
dir = ${DEFAULTS.recordsDir}
per_key_per_day = ${DEFAULTS.recordsPerKeyPerDay}
min_free_mb = ${DEFAULTS.recordsMinFreeMb}

[keys]
; Who may use this server: a line per key, "name = key". Delete a line and that key stops working at once
; (its connections are closed). New key: sudo sve-server newkey <name>
; 谁能用这台服务器：一行一把，"名字 = 密钥"。删掉一行，那把密钥立刻失效。新密钥：sudo sve-server newkey 名字
${keyName} = ${key}
`;
}
