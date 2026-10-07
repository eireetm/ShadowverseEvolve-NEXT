// How the browser keeps the files the local servers send (plugin.ts for the dev server, release-server.ts for the PC
// release): it asks again before each use, and the file is sent again only when it has changed.
import type { Stats } from "node:fs";
import type { IncomingMessage } from "node:http";

/**
 * A file's version (an ETag): its size and modification time. Any change of either is a new file — also a file put back
 * with an older time (the original picture copied over a test one keeps its old date), which If-Modified-Since would
 * call unchanged, so the browser would go on showing the test picture.
 */
export function fileTag(stat: Pick<Stats, "size" | "mtimeMs">): string {
  return `"${stat.size.toString(36)}-${Math.trunc(stat.mtimeMs).toString(36)}"`;
}

/** The browser already has this version of the file (If-None-Match): answer 304 Not Modified. */
export function browserHasFile(req: IncomingMessage, tag: string): boolean {
  const had = req.headers["if-none-match"];
  return had !== undefined && had.split(",").some((t) => t.trim() === tag || t.trim() === `W/${tag}`);
}
