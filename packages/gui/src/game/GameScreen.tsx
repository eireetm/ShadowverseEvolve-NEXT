import { useEffect, useRef, useState } from "react";
import { useBack } from "../app/back";
import { useCompact, usePortrait, useTouch } from "../app/compact";
import { engine, useApp } from "../app/store";
import { hostApi } from "../host/api";
import { useT } from "../i18n";
import { Chat } from "../online/Chat";
import { AnimationLayer } from "./animation/AnimationLayer";
import { Table } from "./board/Table";
import { ZoneBrowser } from "./board/ZoneBrowser";
import { CardDetails } from "./card/CardDetails";
import { installLongPress } from "./long-press";
import { DebugPanel } from "./debug/DebugPanel";
import { LogPanel } from "./log/LogPanel";
import { OnlineStatus } from "./OnlineStatus";
import { handOpen, setHandOpen, useHandOpen } from "./phone/hand";
import { LandscapeLeft, LandscapeRight, LandscapeTools } from "./phone/LandscapeChrome";
import type { PhoneTab } from "./phone/PhoneParts";
import { PortraitBottom, PortraitTop } from "./phone/PortraitChrome";
import { QuickChat } from "./QuickChat";
import { WatchBar } from "./watch/WatchBar";

type Tab = PhoneTab;

interface Props {
  onMenu: () => void;
  onNewGame: () => void;
  onReplays: () => void;
  /** Online play's screen: the next game with the same player, or connecting again. */
  onOnline: () => void;
}

/**
 * The game: the card under the pointer on the left, the table taking the rest. Every decision is answered on the table
 * (lit cards, their menus, the buttons beside the mats) or in the decision window over it. The log and debug tabs are a
 * sidebar, hidden unless shown: it then covers the right of the table, which keeps its size. A replay being watched has its
 * playback bar under the card on the left (nobody answers anything). Online, the connection's state is under the menu
 * button, and the chat is a tab of the sidebar. A player at the screen has the quick chat's button at the top right, left of
 * the sidebar's (of the sidebar when it is shown).
 *
 * On a small screen (a phone, app/compact.ts) held sideways, the table takes the whole screen and columns lie over its sides
 * (game/phone/LandscapeChrome.tsx): the card panel on the left (the log in its place on request), the players, the buttons
 * and what the game waits for on the right, and your hand folded in the bottom right corner, spread by a tap. Held upright
 * (game/phone/PortraitChrome.tsx), the table takes the width between a top bar, the card panel and the players above it,
 * and the buttons (or a replay's playback bar) under it.
 */
export function GameScreen({ onMenu, onNewGame, onReplays, onOnline }: Props) {
  const update = useApp((s) => s.update);
  const t = useT();
  const [tab, setTab] = useState<Tab>("log");
  const [sidebar, setSidebar] = useState(false);
  // A phone's card panel shows the log in its place.
  const [phoneLog, setPhoneLog] = useState(false);
  const compact = useCompact();
  const upright = usePortrait();
  const phone = !compact ? null : upright ? "portrait" : "landscape";
  // Fingers (a phone, or a tablet with the wide layout): a long press reads a card (on a phone, in the card panel, over the
  // log if it shows).
  const touch = useTouch();
  const spread = useHandOpen();
  const gameRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = gameRef.current;
    if (!touch || !root) return;
    return installLongPress(root, { drawer: false, onLongPress: phone !== null ? () => setPhoneLog(false) : undefined });
  }, [touch, update === null, phone]);
  // A phone's hand folds again after any answer, when a decision comes or goes (its window comes over the table), when a
  // Quick card is announced, and when the phone's table goes.
  useEffect(() => setHandOpen(false), [update?.inputCount, update?.decision != null, update?.announcement?.seq, phone]);
  useEffect(() => () => setHandOpen(false), []);
  // A tap anywhere but on the spread hand's cards or a card's menu folds the hand.
  useEffect(() => {
    if (phone !== "landscape") return;
    const down = (event: PointerEvent) => {
      if (!handOpen()) return;
      const target = event.target;
      if (target instanceof Element && (target.closest(".sve-hand-own .sve-hand-card") || target.closest(".sve-card-menu"))) return;
      setHandOpen(false);
    };
    document.addEventListener("pointerdown", down, true);
    return () => document.removeEventListener("pointerdown", down, true);
  }, [phone]);
  useBack(sidebar, () => setSidebar(false));
  useBack(phone !== null && phoneLog, () => setPhoneLog(false));
  useBack(phone === "landscape" && spread, () => setHandOpen(false));
  const online = update?.online ?? null;
  const openChat = () => {
    if (phone !== null) setPhoneLog(true);
    else setSidebar(true);
    setTab("chat");
  };
  if (!update) {
    return (
      <div className="sve-empty-screen">
        <p>{t("game.noGame")}</p>
        <button type="button" className="sve-primary" onClick={onNewGame}>
          {t("game.newGame")}
        </button>
      </div>
    );
  }
  const seat = update.controllers[update.perspective] === "human" && !update.watch ? update.perspective : null;
  const spectating = online?.spectating === true;
  const concede = () => {
    if (seat !== null && window.confirm(t("game.concedeConfirm"))) engine.send({ kind: "concede", seat });
  };
  // A spectator chooses which player is at the bottom (both are shown as the other player sees them).
  const swapSides = () => engine.send({ kind: "spectatorSide", perspective: update.perspective === 0 ? 1 : 0 });
  const tabs: Tab[] = online ? ["log", "chat", "debug"] : ["log", "debug"];
  const shown = tabs.includes(tab) ? tab : "log";
  if (phone === "portrait") {
    return (
      <div className="sve-game sve-game-compact sve-game-phone" ref={gameRef} data-phone="portrait">
        <PortraitTop
          update={update}
          seat={seat}
          logOpen={phoneLog}
          tabs={tabs}
          tab={shown}
          onTab={setTab}
          onCloseLog={() => setPhoneLog(false)}
          onMenu={onMenu}
          onConcede={concede}
          onChat={openChat}
          onOnline={onOnline}
          onSwapSides={spectating ? swapSides : null}
        />
        <Table update={update} onNewGame={online ? onOnline : onNewGame} onMenu={onMenu} onReplays={onReplays} phone="portrait" />
        <PortraitBottom update={update} seat={seat} logOpen={phoneLog} onLog={() => setPhoneLog(!phoneLog)} onReplays={onReplays} />
        {online?.desync ? <Desync at={online.desync} /> : null}
        <ZoneBrowser update={update} />
        <AnimationLayer update={update} />
      </div>
    );
  }
  if (phone === "landscape") {
    return (
      <div className="sve-game sve-game-compact sve-game-phone" ref={gameRef} data-phone="landscape">
        <Table update={update} onNewGame={online ? onOnline : onNewGame} onMenu={onMenu} onReplays={onReplays} phone="landscape" />
        <LandscapeTools
          update={update}
          seat={seat}
          logOpen={phoneLog}
          onMenu={onMenu}
          onLog={() => setPhoneLog(!phoneLog)}
          onConcede={concede}
          onChat={openChat}
          onOnline={onOnline}
          onSwapSides={spectating ? swapSides : null}
        />
        <LandscapeLeft update={update} logOpen={phoneLog} tabs={tabs} tab={shown} onTab={setTab} onCloseLog={() => setPhoneLog(false)}>
          {update.watch ? <WatchBar update={update} onExit={onReplays} /> : null}
        </LandscapeLeft>
        <LandscapeRight update={update} />
        {online?.desync ? <Desync at={online.desync} /> : null}
        <ZoneBrowser update={update} />
        <AnimationLayer update={update} />
      </div>
    );
  }
  return (
    <div className="sve-game" ref={gameRef}>
      <aside className="sve-game-left" data-testid="game-left">
        <div className="sve-game-left-top">
          <button type="button" onClick={onMenu} data-testid="game-menu">
            {t("game.menu")}
          </button>
          {seat !== null && !update.result ? (
            <button type="button" className="sve-concede" onClick={concede} data-testid="game-concede">
              {t("game.concede")}
            </button>
          ) : null}
          {spectating ? (
            <button type="button" onClick={swapSides} data-testid="game-swap-sides">
              {t("game.swapSides")}
            </button>
          ) : null}
        </div>
        {online ? <OnlineStatus update={update} chatOpen={sidebar && shown === "chat"} onChat={openChat} onOnline={onOnline} /> : null}
        <section className="sve-sidebar-card">
          <CardDetails />
        </section>
        {update.watch ? <WatchBar update={update} onExit={onReplays} /> : null}
      </aside>
      <Table update={update} onNewGame={online ? onOnline : onNewGame} onMenu={onMenu} onReplays={onReplays} />
      {sidebar ? (
        <aside className="sve-game-right" data-testid="game-sidebar">
          <nav className="sve-tabs">
            {tabs.map((key) => (
              <button key={key} type="button" className={shown === key ? "sve-tab-active" : undefined} onClick={() => setTab(key)} data-testid={`tab-${key}`}>
                {t(`tab.${key}` as const)}
              </button>
            ))}
            <button type="button" className="sve-sidebar-hide" onClick={() => setSidebar(false)} data-testid="sidebar-hide">
              {t("game.hideSidebar")}
            </button>
          </nav>
          <section className="sve-tab-body">
            {shown === "log" ? <LogPanel update={update} /> : shown === "chat" ? <Chat /> : <DebugPanel update={update} />}
          </section>
        </aside>
      ) : null}
      {seat !== null || !sidebar ? (
        <div className={`sve-game-corner${sidebar ? " sve-game-corner-sidebar" : ""}`}>
          {seat !== null ? <QuickChat update={update} /> : null}
          {!sidebar ? (
            <button type="button" className="sve-sidebar-show" onClick={() => setSidebar(true)} data-testid="sidebar-show">
              {t("game.showSidebar")}
            </button>
          ) : null}
        </div>
      ) : null}
      {online?.desync ? <Desync at={online.desync} /> : null}
      <ZoneBrowser update={update} />
      <AnimationLayer update={update} />
    </div>
  );
}

/** The two programs' games differ: this one can't go on. A bug report file tells where. */
function Desync({ at }: { at: string }) {
  const t = useT();
  const save = async () => {
    const replay = await engine.exportReplay();
    if (replay) await hostApi.saveExport(`sve-replay-${replay.options.seed}-${replay.inputs.length}.json`, replay);
  };
  return (
    <div className="sve-desync" role="alert" data-testid="game-desync">
      <p>{t("game.online.desync", { n: at })}</p>
      <button type="button" onClick={() => void save()}>
        {t("debug.export")}
      </button>
    </div>
  );
}
