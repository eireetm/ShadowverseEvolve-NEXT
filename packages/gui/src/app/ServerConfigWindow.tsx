// The online server's configuration (settings "联机", and the online screen's "使用服务器"): the text the server's owner
// gives — its address and a key — edited here, kept where this host keeps it (net/server-config.ts: the PC release's
// online-server.ini, or the browser), and tried: "test" connects with it and says whether the server takes the key. The
// same window on a computer and on the phones (an app can't open a text file in an editor as Windows' Notepad does).
import { useEffect, useState } from "react";
import { useT } from "../i18n";
import { checkServer, type ServerCheck } from "../net/server";
import { BUILT_IN, loadServerConfig, parseServerConfig, resetServerConfig, saveServerConfig, useServerConfig } from "../net/server-config";
import { useBack } from "./back";

export function ServerConfigWindow({ onClose }: { onClose: () => void }) {
  const t = useT();
  const config = useServerConfig();
  const [text, setText] = useState(config.text);
  const [check, setCheck] = useState<ServerCheck | "checking" | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  // The text kept (read again: the PC release's file may have been edited by hand meanwhile).
  useEffect(() => {
    void loadServerConfig(true).then((loaded) => setText(loaded.text));
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
  useBack(true, onClose);
  const { server, problems } = parseServerConfig(text);
  const changed = text !== config.text;
  const save = () => {
    setFailed(null);
    saveServerConfig(text).then(
      () => setCheck(null),
      (err: unknown) => setFailed(String(err)),
    );
  };
  const test = () => {
    if (!server) return;
    setCheck("checking");
    void checkServer(server).then(setCheck);
  };
  const reset = () => {
    setFailed(null);
    setCheck(null);
    resetServerConfig().then(
      () => setText(BUILT_IN),
      (err: unknown) => setFailed(String(err)),
    );
  };
  return (
    <div className="sve-modal-backdrop sve-server-config-backdrop" onClick={onClose}>
      <div className="sve-modal sve-server-config" onClick={(e) => e.stopPropagation()} data-testid="server-config">
        <header className="sve-modal-header">
          <span>{t("serverConfig.title")}</span>
          <button type="button" onClick={onClose} data-testid="server-config-close">
            {t("game.close")}
          </button>
        </header>
        <p className="sve-hint">{t("serverConfig.help")}</p>
        <textarea
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setCheck(null);
          }}
          rows={7}
          spellCheck={false}
          autoComplete="off"
          data-testid="server-config-text"
        />
        <p className={problems.length > 0 ? "sve-problem" : undefined} data-testid="server-config-status">
          {problems.length > 0
            ? problems.map((p) => t(p)).join(" ")
            : server
              ? t("serverConfig.server", { name: server.name, address: server.address })
              : t("serverConfig.none")}
        </p>
        {server && /^ws:\/\//i.test(server.address) ? <p className="sve-hint">{t("serverConfig.insecure")}</p> : null}
        <p className="sve-hint" data-testid="server-config-where">
          {config.file !== null ? t("serverConfig.file", { path: config.file }) : t("serverConfig.saved")}
          {config.source === "built-in" && !changed ? ` ${t("serverConfig.builtIn")}` : ""}
        </p>
        <div className="sve-online-join">
          <button type="button" className="sve-primary" disabled={!changed || problems.length > 0} onClick={save} data-testid="server-config-save">
            {t("serverConfig.save")}
          </button>
          <button type="button" disabled={!server || check === "checking"} onClick={test} data-testid="server-config-test">
            {t(check === "checking" ? "serverConfig.testing" : "serverConfig.test")}
          </button>
          <button type="button" disabled={text === BUILT_IN} onClick={reset} data-testid="server-config-reset">
            {t("serverConfig.reset")}
          </button>
        </div>
        {check !== null && check !== "checking" ? (
          <p className={check.ok ? "sve-online-ok-text" : "sve-problem"} data-testid="server-config-check">
            {check.ok ? t("serverConfig.ok", { ms: check.ms, seats: check.seats }) : t("serverConfig.failed", { why: t(`online.server.${check.problem}`) })}
          </p>
        ) : null}
        {failed ? <p className="sve-problem">{failed}</p> : null}
      </div>
    </div>
  );
}
