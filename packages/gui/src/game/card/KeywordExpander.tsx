import { useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import type { CardView, Keyword } from "@sve/core";
import { useBack } from "../../app/back";
import { useApp } from "../../app/store";
import { zoneOf } from "../../engine/view-utils";
import { useT } from "../../i18n";
import { useInteraction } from "../interaction";

// Tile copies share a single open popover, but retain their own anchor and keyboard focus.
let active: string | null = null;
const listeners = new Set<() => void>();
function activate(id: string | null) {
  active = id;
  for (const listener of listeners) listener();
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function KeywordExpander({ card, keywords, remaining }: { card: CardView; keywords: readonly Keyword[]; remaining: number }) {
  const id = useId();
  const opened = useSyncExternalStore(subscribe, () => active === id);
  const update = useApp(s => s.update);
  const dragging = useInteraction(s => s.drag !== null);
  const button = useRef<HTMLButtonElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<CSSProperties>({});
  const t = useT();
  const location = update ? zoneOf(update.view, card.id) : null;
  const context = `${update?.seed}:${update?.perspective}:${!!update?.watch}:${location?.player}:${location?.zone}`;
  const close = (focus = false) => {
    if (active !== id) return;
    activate(null);
    if (focus && button.current?.isConnected) button.current.focus({ preventScroll: true });
  };
  useBack(opened, () => close(true));
  useEffect(() => { close(); }, [context, dragging]);
  useEffect(() => () => { if (active === id) activate(null); }, [id]);
  useLayoutEffect(() => {
    if (!opened) return;
    const measure = () => {
      const anchor = button.current?.getBoundingClientRect();
      if (!anchor) return;
      const width = Math.min(280, window.innerWidth - 16);
      // Scrolling a modal can take the anchor outside the viewport; keep the list inside it.
      const top = Math.max(8, Math.min(anchor.top, window.innerHeight - 8));
      const bottom = Math.max(8, Math.min(anchor.bottom, window.innerHeight - 8));
      const above = Math.max(0, top - 16);
      const below = Math.max(0, window.innerHeight - bottom - 16);
      const upper = above > below;
      setPlace({
        width,
        left: Math.max(8, Math.min((anchor.left + anchor.right - width) / 2, window.innerWidth - width - 8)),
        ...(upper ? { bottom: window.innerHeight - top + 8 } : { top: bottom + 8 }),
        maxHeight: Math.max(0, upper ? above : below),
      });
    };
    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [opened]);
  useEffect(() => {
    if (!opened) return;
    const outside = (e: globalThis.PointerEvent) => {
      if (e.target instanceof Node && !button.current?.contains(e.target) && !popup.current?.contains(e.target)) close();
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // Capture before existing modal/card-menu bubble listeners: one Escape closes one layer.
      e.preventDefault();
      e.stopImmediatePropagation();
      close(true);
    };
    window.addEventListener("pointerdown", outside, true);
    window.addEventListener("keydown", escape, true);
    return () => {
      window.removeEventListener("pointerdown", outside, true);
      window.removeEventListener("keydown", escape, true);
    };
  }, [opened]);

  return <>
    <button
      ref={button} type="button" className="sve-kw sve-keyword-more" data-keyword-interaction=""
      aria-label={t("card.expandKeywords")} aria-expanded={opened} aria-controls={opened ? id : undefined}
      onPointerDown={e => e.stopPropagation()}
      onClick={e => { e.stopPropagation(); if (opened) close(true); else if (!dragging) activate(id); }}
    >+{remaining}</button>
    {opened ? createPortal(
      <div ref={popup} id={id} className="sve-keyword-popover" style={place} role="dialog"
        aria-label={t("card.keywords")} data-keyword-interaction="" data-testid="keyword-popover"
        onPointerDown={e => e.stopPropagation()} onClick={e => e.stopPropagation()}>
        <ul>{keywords.map(keyword => <li key={keyword}>{t(`keyword.${keyword}`)}</li>)}</ul>
      </div>, document.body,
    ) : null}
  </>;
}
