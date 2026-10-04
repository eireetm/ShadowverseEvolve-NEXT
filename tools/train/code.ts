import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * A fingerprint of the bots' code (packages/bot/src), like the engine's (packages/gui/fingerprint.ts): the same seed gives the
 * same game only with the same rules code and the same bots, so recorded games carry both and npm run rl:ingest takes only
 * games of the code it runs. Line endings don't count.
 */
export function botFingerprint(repo: string): string {
  const hash = createHash("sha256");
  const root = join(repo, "packages", "bot", "src");
  const walk = (dir: string) => {
    for (const name of readdirSync(dir).sort()) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.(ts|json)$/.test(name)) {
        hash.update(relative(root, full).split("\\").join("/"));
        hash.update(readFileSync(full, "utf8").replace(/\r\n/g, "\n"));
      }
    }
  };
  walk(root);
  return hash.digest("hex").slice(0, 16);
}
