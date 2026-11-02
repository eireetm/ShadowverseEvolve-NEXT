import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useSettings } from "../../app/settings";
import { useApp } from "../../app/store";
import type { GameUpdate } from "../../engine/protocol";
import { htmlLang, useT } from "../../i18n";
import { CardLink } from "../card/CardText";
import { setHighlight, showCard } from "../focus";
import { describeEntry, shuffledPlacements, type LogLine, type LogLink } from "./format";

/** Where the log was being read when it gave way to the card panel (a phone's: `onCard`), for when it comes back. */
let readAt: number | null = null;

/** A line's words, the cards it names as links. */
function lineParts(line: LogLine, lang: string, open: (card: LogLink["card"]) => void): ReactNode[] {
  const parts: ReactNode[] = [];
  let at = 0;
  for (const [i, link] of line.links.entries()) {
    parts.push(line.text.slice(at, link.start));
    parts.push(
      <CardLink key={i} def={link.card.def} testId="log-card-link" lang={lang} onOpen={() => open(link.card)}>
        {line.text.slice(link.start, link.end)}
      </CardLink>,
    );
    at = link.end;
  }
  parts.push(line.text.slice(at));
  return parts;
}

/**
 * The game so far, newest at the bottom; pointing at a line lights up its cards on the board, and a card a line names opens
 * in the card panel with a click: as a card of the table does, followed while it stays in its zone. Only cards the worker let
 * this log's viewer know are named (a line about another is "a card"). `onCard`: the panel isn't beside the log (a phone's).
 */
export function LogPanel({ update, onCard }: { update: GameUpdate; onCard?: () => void }) {
  const t = useT();
  const log = useApp((s) => s.log);
  const catalog = useApp((s) => s.catalog)!;
  const { cardLang, uiLang } = useSettings();
  const [showAll, setShowAll] = useState(false);
  const list = useRef<HTMLDivElement>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const shuffled = useMemo(() => shuffledPlacements(log), [log]);
  const lines = useMemo(
    () =>
      log.flatMap((entry) => {
        const line = describeEntry(entry, { t, catalog, lang: cardLang, uiLang, update, shuffled }, showAll);
        return line ? [{ entry, line }] : [];
      }),
    [log, t, catalog, cardLang, uiLang, update, showAll, shuffled],
  );
  // The log's end at each new line, or where it was being read when it comes back. Once for the same lines: React's strict
  // mode runs a new component's effects twice.
  const scrolledFor = useRef<number | null>(null);
  // (Braces: scrollIntoView returns a promise in newer browsers, and an effect may only return a clean-up function.)
  useLayoutEffect(() => {
    if (scrolledFor.current === lines.length) return;
    scrolledFor.current = lines.length;
    if (readAt !== null && list.current) list.current.scrollTop = readAt;
    else bottom.current?.scrollIntoView({ block: "end" });
    readAt = null;
  }, [lines.length]);
  const open = (card: LogLink["card"]) => {
    // A card of a back face's definition is shown with its back up (CR 2.14).
    showCard({ ...card, back: !!catalog.def(card.def)?.frontFace });
    if (!onCard) return;
    readAt = list.current?.scrollTop ?? null;
    onCard();
  };
  return (
    <div className="sve-log">
      <label className="sve-check">
        <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />
        {t("log.showAll")}
      </label>
      <div className="sve-log-lines" ref={list}>
        {lines.length === 0 ? <p className="sve-hint">{t("log.empty")}</p> : null}
        {lines.map(({ entry, line }) => (
          <div
            key={entry.seq}
            className={`sve-log-line sve-log-${line.kind}`}
            onMouseEnter={() => setHighlight(Object.keys(entry.cards))}
            onMouseLeave={() => setHighlight([])}
          >
            {lineParts(line, htmlLang(cardLang), open)}
          </div>
        ))}
        <div ref={bottom} />
      </div>
    </div>
  );
}
