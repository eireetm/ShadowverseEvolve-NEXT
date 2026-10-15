// The online servers' configuration (settings "联机", and the online screen's "使用服务器"): the text each server's owner
// gives — its address and a key — edited here (a [server] part per server), kept where this host keeps it
// (net/server-config.ts: the PC release's online-server.ini, or the browser), and tried: "test" connects to each server and
// says whether it takes the key. The same window on a computer and on the phones (an app can't open a text file in an
// editor as Windows' Notepad does).
import { useEffect, useRef, useState } from "react";
import { useT } from "../i18n";
import { checkServer, type ServerCheck } from "../net/server";
import { BUILT_IN, loadServerConfig, parseServerConfig, resetServerConfig, saveServerConfig, useServerConfig, type ServerConfigProblem } from "../net/server-config";
import { useBack } from "./back";

export function ServerConfigWindow({ onClose }: { onClose: () => void }) {
  const t = useT();
  const config = useServerConfig();
  const [text, setText] = useState(config.text);
  /** Each server's test (in the text's order), while the text stays as it was tested. */
  const [checks, setChecks] = useState<(ServerCheck | "checking")[] | null>(null);
  /** The test under way: an answer to an earlier one (the text changed since) isn't shown. */
  const round = useRef(0);
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
  const { servers, problems, parts } = parseServerConfig(text);
  const changed = text !== config.text;
  /** A problem of the text: with several servers in it, which one's. */
  const problemText = (p: ServerConfigProblem) => (parts > 1 ? t("serverConfig.part", { n: p.at, text: t(p.problem) }) : t(p.problem));
  const forget = () => {
    round.current += 1;
    setChecks(null);
  };
  const save = () => {
    setFailed(null);
    saveServerConfig(text).then(
      () => forget(),
      (err: unknown) => setFailed(String(err)),
    );
  };
  const test = () => {
    if (servers.length === 0) return;
    const mine = ++round.current;
    setChecks(servers.map(() => "checking"));
    servers.forEach((server, i) => {
      void checkServer(server).then((result) => {
        if (round.current === mine) setChecks((all) => all && all.map((c, j) => (j === i ? result : c)));
      });
    });
  };
  const reset = () => {
    setFailed(null);
    forget();
    resetServerConfig().then(
      () => setText(BUILT_IN),
      (err: unknown) => setFailed(String(err)),
    );
  };
  const checking = checks?.some((c) => c === "checking") === true;
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
            forget();
          }}
          rows={servers.length > 1 || parts > 1 ? 12 : 7}
          spellCheck={false}
          autoComplete="off"
          data-testid="server-config-text"
        />
        <div className={problems.length > 0 ? "sve-problem" : undefined} data-testid="server-config-status">
          {problems.length > 0 ? (
            <p>{problems.map(problemText).join(" ")}</p>
          ) : servers.length > 0 ? (
            servers.map((server) => <p key={server.address}>{t("serverConfig.server", { name: server.name, address: server.address })}</p>)
          ) : (
            <p>{t("serverConfig.none")}</p>
          )}
        </div>
        {servers.some((s) => /^ws:\/\//i.test(s.address)) ? <p className="sve-hint">{t("serverConfig.insecure")}</p> : null}
        <p className="sve-hint" data-testid="server-config-where">
          {config.file !== null ? t("serverConfig.file", { path: config.file }) : t("serverConfig.saved")}
          {config.source === "built-in" && !changed ? ` ${t("serverConfig.builtIn")}` : ""}
        </p>
        <div className="sve-online-join">
          <button type="button" className="sve-primary" disabled={!changed || problems.length > 0} onClick={save} data-testid="server-config-save">
            {t("serverConfig.save")}
          </button>
          <button type="button" disabled={servers.length === 0 || checking} onClick={test} data-testid="server-config-test">
            {t(checking ? "serverConfig.testing" : "serverConfig.test")}
          </button>
          <button type="button" disabled={text === BUILT_IN} onClick={reset} data-testid="server-config-reset">
            {t("serverConfig.reset")}
          </button>
        </div>
        {checks?.map((check, i) => {
          const server = servers[i];
          if (check === "checking" || !server) return null;
          const said = check.ok ? t("serverConfig.ok", { ms: check.ms, seats: check.seats }) : t("serverConfig.failed", { why: t(`online.server.${check.problem}`) });
          return (
            <p key={server.address} className={check.ok ? "sve-online-ok-text" : "sve-problem"} data-testid="server-config-check" data-server={server.name}>
              {servers.length > 1 ? t("online.server.at", { name: server.name, text: said }) : said}
            </p>
          );
        })}
        {failed ? <p className="sve-problem">{failed}</p> : null}
      </div>
    </div>
  );
}
