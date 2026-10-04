// Finished online games kept on the server, when both players let it (the apps' "save online games on the server" setting,
// on by default): to train the bots. A file per month (YYYY-MM.jsonl.gz) of gzip pieces, one JSON line per game:
// { received, key, record } — when, through which key, and the game as the app sent it (its seed, both decks, every answer,
// the result, the app's version and engine fingerprint: a replay that program can play again). No names, chat or addresses.
// A game is kept once (by its id: both players send it); a key keeps at most so many a day, and nothing is kept while the
// disk is nearly full.
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statfsSync, statSync } from "node:fs";
import { join } from "node:path";
import { constants, gunzipSync, gzipSync } from "node:zlib";
import type { RecordsConfig } from "./config";

/** What happened to a game sent: kept, or why not (records off, kept already, the key's day is full, the disk is). */
export type Kept = "kept" | "off" | "again" | "quota" | "disk" | "error";

export interface RecordStore {
  keep(id: string, keyName: string, record: unknown, now?: Date): Kept;
  configure(config: RecordsConfig): void;
}

/** How many game ids are remembered as kept (both players send each game, within a minute of each other). */
const REMEMBERED = 20_000;

export function recordStore(initial: RecordsConfig, log: (line: string) => void = () => undefined): RecordStore {
  let config = initial;
  const kept = new Set<string>();
  const perKey = new Map<string, number>();
  let day = "";
  return {
    configure(next) {
      config = next;
    },
    keep(id, keyName, record, now = new Date()) {
      if (!config.enabled) return "off";
      if (kept.has(id)) return "again";
      const today = now.toISOString().slice(0, 10);
      if (today !== day) {
        day = today;
        perKey.clear();
      }
      const count = perKey.get(keyName) ?? 0;
      if (count >= config.perKeyPerDay) return "quota";
      try {
        mkdirSync(config.dir, { recursive: true });
        const free = statfsSync(config.dir);
        if ((free.bavail * free.bsize) / 2 ** 20 < config.minFreeMb) {
          log(`records: not kept, the disk has less than ${config.minFreeMb} MB free`);
          return "disk";
        }
        const line = JSON.stringify({ received: now.toISOString(), key: keyName, record }) + "\n";
        appendFileSync(join(config.dir, `${today.slice(0, 7)}.jsonl.gz`), gzipSync(line));
      } catch (err) {
        log(`records: can't write in ${config.dir}: ${String(err)}`);
        return "error";
      }
      perKey.set(keyName, count + 1);
      kept.add(id);
      if (kept.size > REMEMBERED) kept.delete(kept.values().next().value!);
      return "kept";
    },
  };
}

/** The kept games' files, oldest first: their size and how many games each has (the server's `records` command). */
export function recordFiles(dir: string): { file: string; bytes: number; games: number }[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => /^\d{4}-\d{2}\.jsonl\.gz$/.test(name))
    .sort()
    .map((name) => {
      const path = join(dir, name);
      const text = gunzipSync(readFileSync(path), { finishFlush: constants.Z_SYNC_FLUSH }).toString("utf8");
      return { file: path, bytes: statSync(path).size, games: text.split("\n").filter((l) => l.trim() !== "").length };
    });
}
