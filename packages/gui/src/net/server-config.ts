// The online server's configuration on this side ("使用服务器" in the online screen): the server's address and the key its
// owner gave, as a short text (sve-server client prints it on the server):
//   [server]
//   name = 北京
//   address = wss://203.0.113.7
//   key = ...
// Where it is kept: the PC release has it as online-server.ini next to its program (a person can edit it with Notepad;
// written by the settings' window too); elsewhere (the phone apps, the dev server) the browser keeps what was saved in
// the settings' window. When nothing is there, the text the app was built with: the project's online-server.ini at build
// time (it isn't in the repository: whoever builds a release decides whether it has a server), or none.
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

/** The server a text describes, or what is wrong with it (null: no server, an empty text). */
export function parseServerConfig(text: string): { server: ServerSettings | null; problems: MessageKey[] } {
  const values = new Map<string, string>();
  for (const raw of text.replace(/^﻿/, "").split(/\r?\n/)) {
    const line = raw.trim();
    if (line === "" || line.startsWith(";") || line.startsWith("#") || line.startsWith("[")) continue;
    const at = line.indexOf("=");
    if (at > 0) values.set(line.slice(0, at).trim().toLowerCase(), line.slice(at + 1).trim());
  }
  const address = values.get("address") ?? "";
  const key = values.get("key") ?? "";
  if (address === "" && key === "") return { server: null, problems: [] };
  const problems: MessageKey[] = [];
  if (!/^wss?:\/\/[^\s/]+/i.test(address)) problems.push("serverConfig.badAddress");
  if (key.length < 8) problems.push("serverConfig.noKey");
  if (problems.length > 0) return { server: null, problems };
  return { server: { name: values.get("name") || address.replace(/^wss?:\/\//i, ""), address, key }, problems };
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
  server: ServerSettings | null;
  /** The PC release's file (its path), when this host keeps one. */
  file: string | null;
}

let loaded: Loaded = { text: "", source: "none", server: null, file: null };
let loading: Promise<Loaded> | null = null;
const listeners = new Set<() => void>();

function setLoaded(next: Loaded): void {
  loaded = next;
  for (const listener of listeners) listener();
}

function fromText(text: string, source: ServerConfigSource, file: string | null): Loaded {
  return { text, source, server: parseServerConfig(text).server, file };
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

/** The server to use now (null: none configured). */
export function currentServer(): ServerSettings | null {
  return loaded.server;
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
