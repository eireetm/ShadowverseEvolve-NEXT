// Cards the person at the screen has just looked at (CR 5.11.1: the top card of their deck, ...) that no decision of theirs
// shows — nothing among them could be taken (SD07-012 with no Levin card on top), or the ability only looks (BP04-056): the
// game waits until they have seen them (the host holds on, GameUpdate.looked), as after a Quick announcement. Only that
// player is shown it. OK (or Enter / Escape) lets the game go on; answering their next decision does too.
import { useEffect } from "react";
import { cardName } from "../../app/catalog";
import { useBack } from "../../app/back";
import { useSettings } from "../../app/settings";
import { engine, useApp } from "../../app/store";
import type { GameUpdate, LookedCards as Looked } from "../../engine/protocol";
import { useT } from "../../i18n";
import { CardTile } from "../card/CardTile";

export function LookedCards({ update }: { update: GameUpdate }) {
  const looked = update.looked;
  return looked && !update.watch ? <LookedWindow key={looked.seq} looked={looked} /> : null;
}

function LookedWindow({ looked }: { looked: Looked }) {
  const t = useT();
  const catalog = useApp((s) => s.catalog);
  const { cardLang } = useSettings();
  const ok = () => engine.send({ kind: "lookSeen", seq: looked.seq });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") ok();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
  useBack(true, ok);
  if (!catalog) return null;
  const names = looked.cards.map((c) => t("announce.item", { name: cardName(catalog.def(c.card.def), cardLang) })).join(t("announce.separator"));
  return (
    <div className="sve-looked-backdrop" onClick={(e) => e.stopPropagation()} data-testid="looked">
      <div className="sve-looked" role="alertdialog" aria-labelledby="sve-looked-text">
        <span className="sve-looked-title">{t("looked.title")}</span>
        <div className="sve-looked-cards">
          {looked.cards.map((c) => (
            <div key={c.id} data-def={c.card.def} data-testid="looked-card">
              <CardTile info={c.card} />
            </div>
          ))}
        </div>
        <p id="sve-looked-text" className="sve-looked-line">
          {t("looked.text", { cards: names })}
        </p>
        <button type="button" className="sve-primary" onClick={ok} autoFocus data-testid="looked-ok">
          {t("looked.ok")}
        </button>
      </div>
    </div>
  );
}
