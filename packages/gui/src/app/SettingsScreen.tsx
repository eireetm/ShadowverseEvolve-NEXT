import { useEffect, useState } from "react";
import { hostApi, type ImportResult } from "../host/api";
import { useT } from "../i18n";
import { engine } from "./store";
import { applyUiTransparency, currentUiTransparency, loadResources } from "../resources/resources";
import { updateSettings, useSettings, type CardLang, type UiLang } from "./settings";
import { settingsFilePath } from "./settings-file";
import { useApp } from "./store";
import { changedTokens } from "./token-art";
import { TokenArtWindow } from "./TokenArtWindow";
import { ServerConfigWindow } from "./ServerConfigWindow";
import { loadServerConfig, useServerConfig } from "../net/server-config";
import { APP_VERSION } from "./version";

type ResourceStatus =
  | { kind: "idle" }
  | { kind: "importing"; written: number }
  | { kind: "imported"; result: ImportResult }
  | { kind: "reloaded"; files: number }
  | { kind: "failed"; error: string };

/**
 * The Android and iOS apps: where the player's own files go (the app's public/ folder, copied over a USB cable or with the
 * Files app), importing them
 * from a zip file, and reading the folder again after copying; how many resources the app has of its own, if any.
 */
function ResourcesSection() {
  const t = useT();
  const [status, setStatus] = useState<ResourceStatus>({ kind: "idle" });
  const importZip = async (file: File | undefined) => {
    if (!file) return;
    setStatus({ kind: "importing", written: 0 });
    try {
      const result = await hostApi.importResources!(file, (written) => setStatus({ kind: "importing", written }));
      await loadResources();
      setStatus({ kind: "imported", result });
    } catch (err) {
      setStatus({ kind: "failed", error: err instanceof Error ? err.message : String(err) });
    }
  };
  const reload = async () => {
    await loadResources();
    setStatus({ kind: "reloaded", files: (await hostApi.resources()).length });
  };
  const busy = status.kind === "importing";
  return (
    <section className="sve-settings-group" data-testid="settings-resources">
      <h3>{t("settings.resources")}</h3>
      <p className="sve-settings-folder">
        {t(hostApi.platform === "ios" ? "settings.resourcesFolderIos" : "settings.resourcesFolder", { folder: hostApi.resourceFolder ?? "" })}
      </p>
      <p className="sve-hint">{t(hostApi.platform === "ios" ? "settings.resourcesHelpIos" : "settings.resourcesHelp")}</p>
      {hostApi.bundledResources ? <p className="sve-hint">{t("settings.resourcesBundled", { n: hostApi.bundledResources })}</p> : null}
      <div className="sve-settings-buttons">
        <label className={`sve-file-button${busy ? " sve-disabled" : ""}`}>
          {t("settings.resourcesImport")}
          <input
            type="file"
            accept=".zip,application/zip"
            hidden
            disabled={busy}
            onChange={(e) => {
              void importZip(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
        </label>
        <button type="button" disabled={busy} onClick={() => void reload()}>
          {t("settings.resourcesReload")}
        </button>
      </div>
      {status.kind === "importing" ? <p className="sve-hint">{t("settings.resourcesImporting", { n: status.written })}</p> : null}
      {status.kind === "imported" ? (
        <p className="sve-ok">{t("settings.resourcesImported", { written: status.result.written, skipped: status.result.skipped })}</p>
      ) : null}
      {status.kind === "reloaded" ? <p className="sve-ok">{t("settings.resourcesReloaded", { n: status.files })}</p> : null}
      {status.kind === "failed" ? <p className="sve-problem">{t("settings.resourcesFailed", { error: status.error })}</p> : null}
    </section>
  );
}

/**
 * The settings (remembered in this browser, and in the PC release's settings.ini too): the languages (the interface's and
 * the card text's), the appearance, sound, the game, online play.
 */
export function SettingsScreen({ onBack }: { onBack: () => void }) {
  const t = useT();
  const settings = useSettings();
  // Applied at once, so that the slider shows the style's own value after "default".
  const setTransparency = (value: number | null) => {
    applyUiTransparency(value);
    updateSettings({ uiTransparency: value });
  };
  const transparency = settings.uiTransparency ?? currentUiTransparency();
  const file = settingsFilePath();
  const catalog = useApp((s) => s.catalog);
  const [tokenArt, setTokenArt] = useState(false);
  // The online server ("使用服务器" in the online screen): which one is set, and its window.
  const server = useServerConfig().server;
  const [serverWindow, setServerWindow] = useState(false);
  useEffect(() => {
    void loadServerConfig();
  }, []);
  return (
    <div className="sve-menu">
      <div className="sve-menu-panel sve-settings">
        <h2>{t("settings.title")}</h2>
        {file ? (
          <p className="sve-hint" data-testid="settings-file">
            {t("settings.fileHelp", { path: file })}
          </p>
        ) : null}
        <section className="sve-settings-group">
          <h3>{t("settings.language")}</h3>
          <label className="sve-settings-row">
            <span>{t("settings.uiLang")}</span>
            <select value={settings.uiLang} onChange={(e) => updateSettings({ uiLang: e.target.value as UiLang })} data-testid="settings-ui-lang">
              <option value="en">English</option>
              <option value="zh">中文</option>
              <option value="ja">日本語</option>
            </select>
          </label>
          <label className="sve-settings-row">
            <span>{t("settings.cardLang")}</span>
            <select value={settings.cardLang} onChange={(e) => updateSettings({ cardLang: e.target.value as CardLang })}>
              <option value="en">English</option>
              <option value="cn">中文</option>
              <option value="ja">日本語</option>
            </select>
          </label>
        </section>
        <section className="sve-settings-group">
          <h3>{t("settings.appearance")}</h3>
          <div className="sve-settings-row">
            <label htmlFor="sve-ui-transparency">{t("settings.uiTransparency")}</label>
            <span className="sve-settings-slider">
              <input
                id="sve-ui-transparency"
                type="range"
                min={0}
                max={0.6}
                step={0.01}
                value={transparency}
                onChange={(e) => setTransparency(Number(e.target.value))}
                data-testid="settings-ui-transparency"
              />
              <output className="sve-settings-value">{Math.round(transparency * 100)}%</output>
              <button type="button" disabled={settings.uiTransparency === null} onClick={() => setTransparency(null)}>
                {t("settings.default")}
              </button>
            </span>
          </div>
          <div className="sve-settings-row">
            <span>{t("settings.tokenArt")}</span>
            <button type="button" disabled={!catalog} onClick={() => setTokenArt(true)} data-testid="settings-token-art">
              {t("settings.tokenArtChoose")}
            </button>
          </div>
          <p className="sve-hint" data-testid="settings-token-art-help">
            {t("settings.tokenArtHelp", { n: changedTokens(catalog, settings.tokenArt) })}
          </p>
          {tokenArt && catalog ? <TokenArtWindow onClose={() => setTokenArt(false)} /> : null}
        </section>
        {hostApi.platform !== "web" ? <ResourcesSection /> : null}
        <section className="sve-settings-group">
          <h3>{t("settings.sound")}</h3>
          {(
            [
              ["bgmVolume", "settings.bgmVolume"],
              ["volume", "settings.sfxVolume"],
            ] as const
          ).map(([key, label]) => (
            <div key={key} className="sve-settings-row">
              <label htmlFor={`sve-${key}`}>{t(label)}</label>
              <span className="sve-settings-slider">
                <input
                  id={`sve-${key}`}
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={settings[key]}
                  onChange={(e) => updateSettings({ [key]: Number(e.target.value) })}
                  data-testid={`settings-${key}`}
                />
                <output className="sve-settings-value">{Math.round(settings[key] * 100)}%</output>
              </span>
            </div>
          ))}
          <p className="sve-hint">{t(hostApi.platform !== "web" ? "settings.soundHelpAndroid" : "settings.soundHelp")}</p>
        </section>
        <section className="sve-settings-group">
          <h3>{t("settings.game")}</h3>
          <label className="sve-settings-row" title={t("settings.announceQuickHelp")}>
            <span>{t("settings.announceQuick")}</span>
            <input
              type="checkbox"
              checked={settings.announceQuick}
              onChange={(e) => {
                updateSettings({ announceQuick: e.target.checked });
                engine.send({ kind: "settings", settings: { announceQuick: e.target.checked } });
              }}
              data-testid="settings-announce-quick"
            />
          </label>
          <p className="sve-hint">{t("settings.announceQuickHelp")}</p>
        </section>
        <section className="sve-settings-group">
          <h3>{t("settings.online")}</h3>
          {(
            [
              ["urls", "settings.turnUrls", "turn:example.com:3478"],
              ["username", "settings.turnUsername", ""],
              ["credential", "settings.turnCredential", ""],
            ] as const
          ).map(([key, label, placeholder]) => (
            <label key={key} className="sve-settings-row">
              <span>{t(label)}</span>
              <input
                type={key === "credential" ? "password" : "text"}
                value={settings.turn[key]}
                placeholder={placeholder}
                autoComplete="off"
                onChange={(e) => updateSettings({ turn: { ...settings.turn, [key]: e.target.value } })}
                data-testid={`settings-turn-${key}`}
              />
            </label>
          ))}
          <p className="sve-hint">{t("settings.turnHelp")}</p>
          <div className="sve-settings-row">
            <span>{t("settings.server")}</span>
            <span className="sve-settings-server">
              <span data-testid="settings-server">{server ? server.name : t("settings.serverNone")}</span>
              <button type="button" onClick={() => setServerWindow(true)} data-testid="settings-server-edit">
                {t("settings.serverEdit")}
              </button>
            </span>
          </div>
          <p className="sve-hint">{t("settings.serverHelp")}</p>
          {serverWindow ? <ServerConfigWindow onClose={() => setServerWindow(false)} /> : null}
          <label className="sve-settings-row" title={t("settings.shareGamesHelp")}>
            <span>{t("settings.shareGames")}</span>
            <input type="checkbox" checked={settings.shareGames} onChange={(e) => updateSettings({ shareGames: e.target.checked })} data-testid="settings-share-games" />
          </label>
          <p className="sve-hint">{t("settings.shareGamesHelp")}</p>
        </section>
        <button type="button" className="sve-menu-button" onClick={onBack}>
          {t("common.back")}
        </button>
        <p className="sve-settings-version" data-testid="settings-version">
          {t("settings.version", { version: APP_VERSION })}
        </p>
      </div>
    </div>
  );
}
