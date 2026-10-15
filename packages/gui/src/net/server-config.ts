// The online servers' configuration on this side ("使用服务器" in the online screen): each server's address and the key its
// owner gave, as a short text (sve-server client prints a server's part on the server):
//   [server]
//   name = 北京
//   address = wss://203.0.113.7
//   key = ...
// One [server] part per server, when people of several servers play together: the lobby lists the rooms of all of them,
// a room is made on one of them (the first one unless the person picks another), and joined where it is. Where it is
// kept: the PC release has it as online-server.ini next to its program (a person can edit it with Notepad; written by the
// settings' window too); elsewhere (the phone apps, the dev server) the browser keeps what was saved in the settings'
// window. When nothing is there, the text the app was built with: the project's online-server.ini at build time (it isn't
// in the repository: whoever builds a release decides whether it has a server), or none.
import { useSyncExternalStore } from "react";
import { hostApi } from "../host/api";
import type { MessageKey } from "../i18n";

declare const __ONLINE_SERVER__: string;
/** The text this build was made with (vite.config.ts: the project's online-server.ini), "" when none. */
export const BUILT_IN = typeof __ONLINE_SERVER__ === "string" ? __ONLINE_SERVER__ : "";

/** Where the browser keeps it (hosts without the file). */
const STORE_KEY = "sve-online-server";

export interface ServerSettings {
  /** What the online screen calls the server ("北京"); the address when the text gives none. */
  name: string;
  address: string;
  key: string;
}

/** What is wrong with a server's part of the text: which part (1: the text's first server) and what. */
export interface ServerConfigProblem {
  at: number;
  problem: MessageKey;
}

/** Whether two addresses are the same server's (as people write them: the letters' case and a last "/" aside). */
const sameAddress = (a: string, b: string): boolean => a.replace(/\/+$/, "").toLowerCase() === b.replace(/\/+$/, "").toLowerCase();

/**
 * The servers a text describes, in its order, and what is wrong with the parts that aren't one (left out); `parts`: how many
 * servers it tries to describe. A part is what follows a "[...]" line (lines before any: the first part, as a text without
 * one says a server); a part without an address or a key (a comment, another section) isn't a server.
 */
export function parseServerConfig(text: string): { servers: ServerSettings[]; problems: ServerConfigProblem[]; parts: number } {
  const blocks: Map<string, string>[] = [];
  let block: Map<string, string> | null = null;
  for (const raw of text.replace(/^﻿/, "").split(/\r?\n/)) {
    const line = raw.trim();
    if (line === "" || line.startsWith(";") || line.startsWith("#")) continue;
    if (line.startsWith("[")) {
      block = null;
      continue;
    }
    const at = line.indexOf("=");
    if (at <= 0) continue;
    if (!block) blocks.push((block = new Map()));
    block.set(line.slice(0, at).trim().toLowerCase(), line.slice(at + 1).trim());
  }
  const servers: ServerSettings[] = [];
  const problems: ServerConfigProblem[] = [];
  let parts = 0;
  for (const values of blocks) {
    const address = values.get("address") ?? "";
    const key = values.get("key") ?? "";
    if (address === "" && key === "") continue;
    parts += 1;
    const wrong: MessageKey[] = [];
    if (!/^wss?:\/\/[^\s/]+/i.test(address)) wrong.push("serverConfig.badAddress");
    if (key.length < 8) wrong.push("serverConfig.noKey");
    if (wrong.length === 0 && servers.some((s) => sameAddress(s.address, address))) wrong.push("serverConfig.twice");
    if (wrong.length > 0) {
      for (const problem of wrong) problems.push({ at: parts, problem });
      continue;
    }
    servers.push({ name: values.get("name") || address.replace(/^wss?:\/\//i, ""), address, key });
  }
  return { servers, problems, parts };
}

/** The text of a server for the window: as its owner's program prints it (comments in the languages). */
export function serverConfigText(server: ServerSettings): string {
  return ["; Shadowverse: Evolve NEXT — 联机服务器 / Online server / オンラインサーバー", "[server]", `name = ${server.name}`, `address = ${server.address}`, `key = ${server.key}`, ""].join("\n");
}

/** Where the text in use came from: the PC release's file, what the browser saved, the build's, or nowhere. */
export type ServerConfigSource = "file" | "saved" | "built-in" | "none";

interface Loaded {
  text: string;
  source: ServerConfigSource;
  /** The servers it describes (none: no server), the first one first. */
  servers: ServerSettings[];
  /** The PC release's file (its path), when this host keeps one. */
  file: string | null;
}

let loaded: Loaded = { text: "", source: "none", servers: [], file: null };
let loading: Promise<Loaded> | null = null;
const listeners = new Set<() => void>();

function setLoaded(next: Loaded): void {
  loaded = next;
  for (const listener of listeners) listener();
}

function fromText(text: string, source: ServerConfigSource, file: string | null): Loaded {
  return { text, source, servers: parseServerConfig(text).servers, file };
}

function readSaved(): string | null {
  try {
    return localStorage.getItem(STORE_KEY);
  } catch {
    return null;
  }
}

/** Read where it is kept (once; again with `again`). */
export function loadServerConfig(again = false): Promise<Loaded> {
  if (loading && !again) return loading;
  loading = (async () => {
    let file: Awaited<ReturnType<typeof hostApi.readServerFile>> = null;
    try {
      file = await hostApi.readServerFile();
    } catch {
      file = null;
    }
    if (file) return fromText(file.text ?? BUILT_IN, file.text !== null ? "file" : BUILT_IN ? "built-in" : "none", file.path);
    const saved = readSaved();
    if (saved !== null) return fromText(saved, "saved", null);
    return fromText(BUILT_IN, BUILT_IN ? "built-in" : "none", null);
  })().then((result) => {
    setLoaded(result);
    return result;
  });
  return loading;
}

/** Keep this text (the settings' window): in the PC release's file, or in the browser. */
export async function saveServerConfig(text: string): Promise<void> {
  if (loaded.file !== null) {
    await hostApi.writeServerFile(text);
    setLoaded(fromText(text, "file", loaded.file));
    return;
  }
  try {
    localStorage.setItem(STORE_KEY, text);
  } catch {
    // a private window: kept for this visit only
  }
  setLoaded(fromText(text, "saved", null));
}

/**
 * Back to the build's text: the PC release's file gets it written; the browser forgets what it saved (so a newer build's
 * text is used then too).
 */
export async function resetServerConfig(): Promise<void> {
  if (loaded.file !== null) return saveServerConfig(BUILT_IN);
  try {
    localStorage.removeItem(STORE_KEY);
  } catch {
    // nothing kept
  }
  setLoaded(fromText(BUILT_IN, BUILT_IN ? "built-in" : "none", null));
}

/** The servers to use now (none configured: none), the first one first. */
export function currentServers(): ServerSettings[] {
  return loaded.servers;
}

/**
 * The server to connect to again for a room made or found on `server`: as the configuration says it now (its key may have
 * been mended meanwhile), or as it was.
 */
export function serverNow(server: ServerSettings): ServerSettings {
  return loaded.servers.find((s) => sameAddress(s.address, server.address)) ?? server;
}

/** The configuration as loaded (the screens: what is used, and from where). */
export function useServerConfig(): Loaded {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => loaded,
  );
}
