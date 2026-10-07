// Replay certificates: recorded games made with older rules code that still play exactly the same with the current code.
// A game record is its seed and inputs; the engine's fingerprint (packages/gui/fingerprint.ts rulesFingerprint) changes with
// any edit of the core, comments included, so a later fix elsewhere in the rules would make every recorded game "other rules
// code". npm run rl:certify replays all of a run's games with the current code: when every input is accepted and every game
// ends as recorded (winner and turn), it writes certified-<current rules>.json beside games.jsonl.gz, and npm run rl:encode
// then takes those games as if they had been recorded with the current code.
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface ReplayCertificate {
  format: "sve-replay-certificate";
  version: 1;
  /** The core's fingerprint the games were replayed with. */
  rules: string;
  /** The records it is about (the file's hash: a certificate says nothing about games added later). */
  records: { file: string; sha256: string; games: number };
  /** The rules fingerprints the games were recorded with (after the old kits' mapping, tools/train/code.ts), with counts. */
  recordedRules: Record<string, number>;
  /** How the check went: every game was replayed, every input accepted, every game ended as recorded. */
  replayed: number;
  commit: string;
  dirty: boolean;
  date: string;
  command: string;
}

export const certificatePath = (runDir: string, rules: string) => join(runDir, `certified-${rules}.json`);

export const sha256Of = (file: string) => createHash("sha256").update(readFileSync(file)).digest("hex");

/**
 * The recorded rules fingerprints a run's certificate for the current rules accepts, or none: there must be one for these
 * rules, about exactly this records file (its hash), covering all its games.
 */
export function certifiedRules(runDir: string, rules: string, recordsFile: string): { accepted: ReadonlySet<string>; certificate: ReplayCertificate } | null {
  const path = certificatePath(runDir, rules);
  if (!existsSync(path)) return null;
  const certificate = JSON.parse(readFileSync(path, "utf8")) as ReplayCertificate;
  if (certificate.format !== "sve-replay-certificate" || certificate.rules !== rules || certificate.records.sha256 !== sha256Of(recordsFile)) return null;
  if (certificate.replayed !== certificate.records.games) return null;
  return { accepted: new Set(Object.keys(certificate.recordedRules)), certificate };
}
