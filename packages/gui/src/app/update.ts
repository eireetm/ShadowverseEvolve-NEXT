// The PC release's updates, which its local server does (host/update.ts, /api/update): the settings' "检查版本更新" asks it
// which version the latest release on GitHub is; "更新" has it download that release's package, put it in place and restart
// with it, and the page then loads the new version. Nowhere else: the dev server and the Android and iOS apps have no
// /api/update.
import { hostApi } from "../host/api";

/** What a check found. */
export type UpdateCheck =
  | { ok: true; current: string; latest: string; newer: boolean; page: string }
  | { ok: false; why: "unreachable" };

export type UpdateFailure = "download" | "noPackage" | "badPackage" | "cantWrite" | "noCheck";

/** An update under way. */
export type UpdateJob =
  | { state: "idle" }
  | { state: "downloading"; received: number; total: number | null }
  | { state: "installing" }
  | { state: "restarting"; version: string }
  | { state: "failed"; why: UpdateFailure; detail: string };

export interface UpdateStatus {
  /** The version the local server is. */
  version: string;
  job: UpdateJob;
}

/** The local server's update state; null when it can't update this program (not the PC release) or doesn't answer. */
export async function updateStatus(): Promise<UpdateStatus | null> {
  if (hostApi.platform !== "web") return null;
  try {
    const res = await fetch("/api/update/status", { cache: "no-store" });
    // The dev server answers null.
    return res.ok ? ((await res.json()) as UpdateStatus | null) : null;
  } catch {
    return null;
  }
}

/** Ask which version the latest release is. */
export async function checkUpdate(): Promise<UpdateCheck> {
  try {
    const res = await fetch("/api/update/check", { cache: "no-store" });
    return res.ok ? ((await res.json()) as UpdateCheck) : { ok: false, why: "unreachable" };
  } catch {
    return { ok: false, why: "unreachable" };
  }
}

/** Install the newer version the last check found; how it goes: updateStatus(). */
export async function startUpdate(): Promise<UpdateStatus> {
  const res = await fetch("/api/update/install", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
  return (await res.json()) as UpdateStatus;
}
