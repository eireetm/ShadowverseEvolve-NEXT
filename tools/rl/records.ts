// The records of training games (JobGame, tools/train/job.ts: one JSON line per game) in files of gzip pieces, one piece per
// game, as the training kit and npm run rl:ingest write them; read the same way by rl:ingest, rl:encode and the training tools.
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import type { JobGame } from "../train/job";

/** Damaged pieces met while reading. */
export interface ReadStats {
  broken: number;
}

/**
 * The decoded pieces of a file of gzip pieces, in order, piece by piece: a damaged piece is counted and skipped, the others
 * read — a file cut short, or ending in zeros after a crash, gives what it has, and zeros between pieces don't hide the pieces
 * after them (as they would from one gunzip of the whole file). A piece starts with the gzip magic; the magic may also turn up
 * inside a piece's compressed bytes, so a piece that doesn't decode up to the next start is tried up to the ones after it.
 */
export function* pieceTexts(bytes: Buffer, stats: ReadStats): Generator<string> {
  const magic = Buffer.from([0x1f, 0x8b, 0x08]);
  const starts: number[] = [];
  for (let at = bytes.indexOf(magic); at >= 0; at = bytes.indexOf(magic, at + 1)) starts.push(at);
  starts.push(bytes.length);
  if (bytes.subarray(0, starts[0]).some((b) => b !== 0)) stats.broken += 1;
  for (let i = 0; i < starts.length - 1; ) {
    let next = -1;
    let text = "";
    for (let j = i + 1; j < starts.length && j <= i + 16 && next < 0; j++) {
      try {
        text = gunzipSync(bytes.subarray(starts[i], starts[j])).toString("utf8");
        next = j;
      } catch {
        // not a whole piece yet: up to the next start
      }
    }
    if (next < 0) {
      stats.broken += 1;
      i += 1;
      continue;
    }
    i = next;
    yield text;
  }
}

/** Each game's line of a file, in order (one game a piece, a piece may hold several lines). */
export function* gameLines(file: string, stats: ReadStats = { broken: 0 }): Generator<string> {
  for (const text of pieceTexts(readFileSync(file), stats)) for (const line of text.split("\n")) if (line.trim()) yield line;
}

/** The games of a file; a line that isn't JSON counts as broken. */
export function gamesOf(file: string): { games: JobGame[]; broken: number } {
  const stats: ReadStats = { broken: 0 };
  const games: JobGame[] = [];
  for (const line of gameLines(file, stats)) {
    try {
      games.push(JSON.parse(line) as JobGame);
    } catch {
      stats.broken += 1;
    }
  }
  return { games, broken: stats.broken };
}
