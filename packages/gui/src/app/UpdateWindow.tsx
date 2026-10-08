// The PC release's updates in the settings (app/update.ts): "检查版本更新" under the version asks which version the latest
// release on GitHub is; a newer one opens a window offering it ("更新" / "以后再说"). Updating, the window follows the
// local server — downloading, installing, restarting — and loads the page again once the new version answers.
import { useEffect, useState, type ReactNode } from "react";
import { useT } from "../i18n";
import { useBack } from "./back";
import { checkUpdate, startUpdate, updateStatus, type UpdateCheck, type UpdateJob } from "./update";

type Offer = Extract<UpdateCheck, { ok: true }>;

/** How long the restarted program may take to answer before the person is asked to start it by hand. */
const RESTART_MS = 30_000;

/** Settings, under the version: the button (only where this program can update itself) and what the check found. */
export function UpdateCheckButton() {
  const t = useT();
  const [can, setCan] = useState(false);
  const [checking, setChecking] = useState(false);
  const [found, setFound] = useState<UpdateCheck | null>(null);
  const [offer, setOffer] = useState<Offer | null>(null);
  useEffect(() => {
    let live = true;
    void updateStatus().then((status) => {
      if (live) setCan(status !== null);
    });
    return () => {
      live = false;
    };
  }, []);
  if (!can) return null;
  const check = () => {
    setChecking(true);
    setFound(null);
    void checkUpdate().then((result) => {
      setChecking(false);
      setFound(result);
      if (result.ok && result.newer) setOffer(result);
    });
  };
  return (
    <div className="sve-settings-update">
      <button type="button" disabled={checking} onClick={check} data-testid="settings-check-update">
        {t(checking ? "update.checking" : "update.check")}
      </button>
      {found ? (
        <span className={found.ok ? undefined : "sve-problem"} data-testid="settings-update-result">
          {found.ok ? (found.newer ? t("update.available", { latest: found.latest, current: found.current }) : t("update.upToDate")) : t("update.unreachable")}
        </span>
      ) : null}
      {offer ? <UpdateWindow offer={offer} onClose={() => setOffer(null)} /> : null}
    </div>
  );
}

/** The window: the newer version offered; then the update as it goes, or why it failed. */
function UpdateWindow({ offer, onClose }: { offer: Offer; onClose: () => void }) {
  const t = useT();
  // null: offered, not started.
  const [job, setJob] = useState<UpdateJob | null>(null);
  const [byHand, setByHand] = useState(false);
  const working = job !== null && job.state !== "failed" && !byHand;
  const close = () => {
    if (!working) onClose();
  };
  useBack(true, close);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
  // While it goes: the server's state; once the new version answers (the program restarted), the page again. No answer
  // while restarting is the old server gone and the new one not up yet.
  useEffect(() => {
    if (!working) return;
    let restartingSince: number | null = null;
    const timer = window.setInterval(() => {
      void updateStatus().then((status) => {
        if (status !== null && status.version !== offer.current) {
          window.clearInterval(timer);
          window.location.reload();
          return;
        }
        if (status !== null) setJob(status.job);
        if (status === null || status.job.state === "restarting") {
          restartingSince ??= Date.now();
          if (Date.now() - restartingSince > RESTART_MS) setByHand(true);
        }
      });
    }, 400);
    return () => window.clearInterval(timer);
  }, [working, offer.current]);
  const update = () => {
    setJob({ state: "downloading", received: 0, total: null });
    startUpdate().then(
      (status) => setJob(status.job),
      (err: unknown) => setJob({ state: "failed", why: "download", detail: String(err) }),
    );
  };
  let body: ReactNode;
  if (job === null) {
    body = (
      <>
        <p className="sve-update-text" data-testid="update-offer">
          {t("update.available", { latest: offer.latest, current: offer.current })}
        </p>
        <div className="sve-modal-actions">
          <button type="button" className="sve-primary" onClick={update} data-testid="update-install">
            {t("update.install")}
          </button>
          <button type="button" onClick={onClose} data-testid="update-later">
            {t("update.later")}
          </button>
        </div>
      </>
    );
  } else if (job.state === "failed") {
    body = (
      <>
        <p className="sve-update-text sve-problem" data-testid="update-failed">
          {t("update.failed", { why: t(`update.why.${job.why}`, { file: job.detail }) })}
        </p>
        {job.detail && job.why !== "noPackage" ? <p className="sve-hint">{job.detail}</p> : null}
        <div className="sve-modal-actions">
          <a href={offer.page} target="_blank" rel="noreferrer" data-testid="update-manual">
            {t("update.manual")}
          </a>
          <button type="button" onClick={onClose} data-testid="update-close">
            {t("game.close")}
          </button>
        </div>
      </>
    );
  } else {
    const text = byHand
      ? t("update.restartByHand")
      : job.state === "downloading"
        ? job.total
          ? t("update.downloading", { percent: Math.min(100, Math.floor((job.received / job.total) * 100)) })
          : t("update.downloadingNoSize", { kb: Math.round(job.received / 1024) })
        : job.state === "installing"
          ? t("update.installing")
          : t("update.restarting");
    body = (
      <p className="sve-update-text" data-testid="update-progress">
        {text}
      </p>
    );
  }
  return (
    <div className="sve-modal-backdrop sve-update-backdrop" onClick={close}>
      <div className="sve-modal sve-update" onClick={(e) => e.stopPropagation()} data-testid="update-window">
        {body}
      </div>
    </div>
  );
}
