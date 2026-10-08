// The menu of a card clicked on the table: everything the pending decision lets it do (play; each way to evolve; its
// activated abilities; attack each target). Choosing an item answers the decision; a click elsewhere or Escape closes it.
// Longer than the room beside the card (a phone: five enemy followers to attack, evolve, abilities ...), its items scroll.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useSettings } from "../../app/settings";
import { useApp } from "../../app/store";
import type { GameUpdate } from "../../engine/protocol";
import { useT } from "../../i18n";
import { setHighlight } from "../focus";
import { actionsFor, answerFor, openMenu, sendAnswer, useInteraction } from "../interaction";
import { actionLabel, cardLabel } from "../labels";
import { useBack } from "../../app/back";
import { placeMenu } from "./menu-place";

export function CardMenu({ update }: { update: GameUpdate }) {
  const menu = useInteraction((s) => s.menu);
  const catalog = useApp((s) => s.catalog);
  const { cardLang } = useSettings();
  const t = useT();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") openMenu(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  useBack(menu !== null, () => openMenu(null));
  // Items scrolled out of sight above or below: that edge of the list fades (a finger's scrolling has no scroll bar).
  const list = useRef<HTMLDivElement>(null);
  const [more, setMore] = useState({ above: false, below: false });
  const measure = useCallback(() => {
    const el = list.current;
    if (!el) return;
    const above = el.scrollTop > 1;
    const below = el.scrollTop + el.clientHeight < el.scrollHeight - 1;
    setMore((m) => (m.above === above && m.below === below ? m : { above, below }));
  }, []);
  useLayoutEffect(measure);
  const info = update.decision;
  if (!menu || !info || !catalog) return null;
  const decision = info.decision;
  const actions = actionsFor(decision, menu.card);
  if (actions.length === 0) return null;
  const place = placeMenu(menu.anchor, window.innerWidth, window.innerHeight);
  return createPortal(
    <>
      <div className="sve-card-menu-backdrop" onPointerDown={() => openMenu(null)} />
      {/* A menu of another card is a new one: its items from the top. */}
      <div key={menu.card} className="sve-card-menu" style={place} role="menu" data-testid="card-menu">
        <div className="sve-card-menu-title">{cardLabel(menu.card, update, catalog, cardLang, t)}</div>
        <div
          ref={list}
          className="sve-card-menu-items"
          onScroll={measure}
          data-more-above={more.above ? "" : undefined}
          data-more-below={more.below ? "" : undefined}
          data-testid="card-menu-items"
        >
          {actions.map((action, i) => (
            <button
              key={i}
              type="button"
              role="menuitem"
              onClick={() => sendAnswer(update, answerFor(decision, action))}
              onMouseEnter={() => setHighlight(action.type === "attack" ? [action.attacker, action.target] : [menu.card])}
              onMouseLeave={() => setHighlight([])}
            >
              {actionLabel(action, info, update, catalog, cardLang, t)}
            </button>
          ))}
        </div>
      </div>
    </>,
    document.body,
  );
}
