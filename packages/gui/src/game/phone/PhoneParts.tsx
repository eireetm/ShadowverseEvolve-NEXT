// What a phone's game screen puts around the table (LandscapeChrome.tsx): the card panel (the card last read, or the log),
// a player's card, the turn and what the game waits for, and the buttons that answer the decision. The table itself is
// board/Table.tsx with the phone's sizes (board/layout.ts).
import type { PlayerSideView } from "@sve/core";
import { useEffect, useRef } from "react";
import { useApp } from "../../app/store";
import type { GameUpdate } from "../../engine/protocol";
import { useT } from "../../i18n";
import { Chat } from "../../online/Chat";
import type { CenterState } from "../board/center-state";
import { clockTime, PlayerTotalTime, useTurnClock } from "../board/CenterLine";
import { CardArt } from "../card/CardArt";
import { CardDetails } from "../card/CardDetails";
import { DebugPanel } from "../debug/DebugPanel";
import { ProcessingPrompt } from "../decisions/ProcessingPrompt";
import { showCard, useFocusSelect } from "../focus";
import { openManual } from "../interaction";
import { deckBasis, playerLabel } from "../labels";
import { LogPanel } from "../log/LogPanel";

export type PhoneTab = "log" | "chat" | "debug";

/**
 * The card panel, always shown on a phone: the card last read (a tap or a long press on it), or the log, chat and debug
 * tabs in its place (the wide layout's sidebar).
 */
export function PhoneCardPanel({
  update,
  log,
  tabs,
  tab,
  onTab,
  onCloseLog,
}: {
  update: GameUpdate;
  log: boolean;
  tabs: readonly PhoneTab[];
  tab: PhoneTab;
  onTab: (tab: PhoneTab) => void;
  onCloseLog: () => void;
}) {
  const t = useT();
  useFollowedCards(update);
  if (!log) {
    return (
      <section className="sve-phone-panel" data-testid="phone-panel" data-panel="card">
        <div className="sve-phone-card">
          <CardDetails />
        </div>
      </section>
    );
  }
  return (
    <section className="sve-phone-panel sve-phone-panel-log" data-testid="phone-panel" data-panel="log">
      <div className="sve-phone-log-head">
        <nav className="sve-phone-tabs">
          {tabs.map((key) => (
            <button key={key} type="button" className={tab === key ? "sve-tab-active" : undefined} onClick={() => onTab(key)} data-testid={`tab-${key}`}>
              {t(`tab.${key}` as const)}
            </button>
          ))}
        </nav>
        <button type="button" onClick={onCloseLog} data-testid="phone-log-close">
          {t("app.dismiss")}
        </button>
      </div>
      <div className="sve-phone-log-body">{tab === "chat" ? <Chat /> : tab === "debug" ? <DebugPanel update={update} /> : <LogPanel update={update} />}</div>
    </section>
  );
}

/**
 * The card panel follows what the game shows everyone, as a player at a real table looks at it: a Quick card announced, a
 * card put into a hand in public, cards just looked at, cards revealed. Until anything was shown, it shows your leader.
 * All of these are in the person's own view (nothing hidden from them).
 */
function useFollowedCards(update: GameUpdate): void {
  const shown = useFocusSelect((f) => f.shown);
  const catalog = useApp((s) => s.catalog);
  // The engine sends new log lines; remember the last one looked at (a new game starts again).
  const seen = useRef({ seed: update.seed, seq: 0 });
  useEffect(() => {
    if (seen.current.seed !== update.seed) seen.current = { seed: update.seed, seq: 0 };
    const fresh = update.log.filter((entry) => entry.seq > seen.current.seq);
    for (const entry of fresh) seen.current.seq = Math.max(seen.current.seq, entry.seq);
    const last = fresh[fresh.length - 1];
    const toHand = update.toHand?.[update.toHand.length - 1] ?? null;
    const looked = update.looked?.cards[update.looked.cards.length - 1] ?? null;
    const revealed = last?.event.type === "cardsRevealed" ? (last.event.cards[last.event.cards.length - 1] ?? null) : null;
    if (update.announcement) showCard({ id: update.announcement.source, def: update.announcement.card.def, printing: update.announcement.card.printing });
    else if (toHand) showCard({ id: toHand.id, def: toHand.card.def, printing: toHand.card.printing });
    else if (looked) showCard({ id: looked.id, def: looked.card.def, printing: looked.card.printing });
    else if (revealed) showCard({ id: revealed.id, def: revealed.def, printing: null });
  }, [update.seed, update.log, update.announcement, update.toHand, update.looked]);
  useEffect(() => {
    if (shown || !catalog) return;
    const leader = update.view.players[update.perspective].leader;
    if (leader && !leader.hidden) showCard({ id: leader.id, def: leader.def, printing: leader.printing, view: leader });
  }, [shown, catalog, update.view, update.perspective]);
}

/**
 * One player, as a small card: their leader's picture (with "1st" or "2nd" once the turn order is known, CR 6.2.1.6), name,
 * what the deck is built on, play points, and under them the evolution points. Held sideways, the name is beside the
 * picture; `upright` (a phone held upright), under it, the rest beside both (`mirrored`: on the picture's left, for the
 * player on the right). In a game with manual debugging, a tap opens the player's points and tokens (as the wide layout's
 * player panel does).
 */
export function PhonePlayer({ update, side, upright = false, mirrored = false }: { update: GameUpdate; side: PlayerSideView; upright?: boolean; mirrored?: boolean }) {
  const t = useT();
  const catalog = useApp((s) => s.catalog);
  const view = update.view;
  const active = view.activePlayer === side.id && view.phase !== "over";
  const deciding = update.waitingFor === side.id;
  const you = side.id === update.perspective && update.controllers[side.id] === "human";
  const order = view.firstPlayer === null ? null : view.firstPlayer === side.id ? "first" : "second";
  const leader = side.leader && !side.leader.hidden ? side.leader : null;
  const basis = deckBasis(update, side, catalog, t);
  const manual = update.manual !== null;
  const label = playerLabel(side.id, update, t);
  const face = (
    <div className="sve-phone-face">
      {leader && catalog ? <CardArt printing={leader.printing} def={leader.def} name={t("game.leader")} /> : null}
      {order ? (
        <span className={`sve-phone-order sve-phone-order-${order}`} data-testid={`player-order-${side.id}`}>
          {t(order === "first" ? "game.orderFirst" : "game.orderSecond")}
        </span>
      ) : null}
    </div>
  );
  const name = (
    <div className="sve-phone-player-name" title={label}>
      {label}
      {you ? ` · ${t("game.you")}` : ""}
    </div>
  );
  const points = (
    <>
      {basis ? (
        <div className="sve-phone-player-basis" data-testid={`player-basis-${side.id}`}>
          {basis}
        </div>
      ) : null}
      <div className="sve-phone-player-pp" title={t("game.pp")}>
        {t("game.pp")} <strong>{side.playPoints}</strong>/{side.maxPlayPoints}
      </div>
      <div className="sve-phone-player-ep">
        <span title={t("game.ep")}>
          {t("game.ep")} <strong>{side.evolutionPoints}</strong>
        </span>{" "}
        <span title={t("game.sep")}>
          {t("game.sep")} <strong>{side.superEvolutionPoints}</strong>
        </span>
      </div>
      <PlayerTotalTime update={update} player={side.id} />
    </>
  );
  return (
    <div
      className={`sve-phone-player${upright ? " sve-phone-player-upright" : ""}${mirrored ? " sve-phone-player-mirrored" : ""}${active ? " sve-active" : ""}${deciding ? " sve-deciding" : ""}${manual ? " sve-manual-target" : ""}`}
      onClick={manual ? () => openManual({ kind: "player", player: side.id }) : undefined}
      data-testid={`player-panel-${side.id}`}
      data-player={side.id}
    >
      {upright ? (
        <>
          <div className="sve-phone-face-column">
            {face}
            {name}
          </div>
          <div className="sve-phone-player-info">{points}</div>
        </>
      ) : (
        <>
          {face}
          <div className="sve-phone-player-info">
            {name}
            {points}
          </div>
        </>
      )}
    </div>
  );
}

/**
 * The turn, the phase and whose turn it is (with the turn clock next to it, online with a time limit), then what the game
 * waits for, and what the decision answered on the table is part of.
 */
export function PhonePrompt({ update, center, placing }: { update: GameUpdate; center: CenterState; placing: boolean }) {
  const t = useT();
  const clock = useTurnClock(update);
  const clockText = !clock
    ? null
    : clock.player === update.view.activePlayer
      ? clockTime(clock.seconds)
      : t("game.clock", { player: playerLabel(clock.player, update, t), time: clockTime(clock.seconds) });
  return (
    <div className="sve-phone-prompt" data-testid="phone-prompt">
      <div className="sve-phone-turn">
        <strong>{t("game.turn", { n: center.turn })}</strong> · {center.phase}
      </div>
      {center.activeLine !== null || clock ? (
        <div className="sve-phone-active">
          {center.activeLine !== null ? <span data-testid="center-active-player">{center.activeLine}</span> : null}
          {clock ? (
            <span className={`sve-phone-clock${clock.seconds <= 30 ? " sve-phone-clock-low" : ""}`} data-testid="center-clock" data-player={clock.player} data-seconds={clock.seconds}>
              {clockText}
            </span>
          ) : null}
        </div>
      ) : null}
      {center.prompt !== null ? (
        <div className={`sve-phone-prompt-text${center.yours ? " sve-your-move" : ""}`} data-testid={placing ? "table-choose-slot" : undefined}>
          {center.prompt}
        </div>
      ) : null}
      {update.decision && !center.dialog ? <ProcessingPrompt update={update} compact /> : null}
    </div>
  );
}

/** The buttons that finish the pending decision (center-state.ts), the same test ids as beside the wide table's mats. */
export function PhoneActions({ center }: { center: CenterState }) {
  if (center.buttons.length === 0) return null;
  return (
    <div className="sve-phone-actions" data-testid="phone-actions">
      {center.buttons.map((b) => (
        <button key={b.key} type="button" className={b.primary ? "sve-primary" : undefined} disabled={b.disabled} onClick={b.onClick} data-testid={`table-${b.key}`}>
          {b.label}
        </button>
      ))}
    </div>
  );
}
