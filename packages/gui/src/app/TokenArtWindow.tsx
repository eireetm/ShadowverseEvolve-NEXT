// The settings' token art: every token with the printing it is shown with. A token opens a second window with all its
// printings; the one picked is the token's picture in games from then on (token-art.ts: the look only, the Core isn't
// asked). "View" under a printing shows it in a third window: the picture large, beside what the card panel says of it.
// The list comes from the card data, so new tokens and their reprints (which join their token's definition when the data
// is built) are in it without more work.
import { useEffect, useMemo, useState } from "react";
import { CardArt } from "../game/card/CardArt";
import { CardPanel } from "../game/card/CardDetails";
import { CardTile } from "../game/card/CardTile";
import type { CatalogCard } from "../engine/protocol";
import { useT } from "../i18n";
import { useBack } from "./back";
import { cardName } from "./catalog";
import { updateSettings, useSettings } from "./settings";
import { useApp } from "./store";
import { shownPrinting, withTokenArt } from "./token-art";

export function TokenArtWindow({ onClose }: { onClose: () => void }) {
  const t = useT();
  const catalog = useApp((s) => s.catalog)!;
  const { cardLang, tokenArt } = useSettings();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<CatalogCard | null>(null);
  // The printing of the open token being viewed.
  const [look, setLook] = useState<string | null>(null);
  const tokens = useMemo(() => catalog.cards.filter((card) => card.token), [catalog]);
  const q = query.trim().toLowerCase();
  const shown = tokens.filter(
    (card) => q === "" || card.printings.some((p) => p.toLowerCase().startsWith(q)) || [card.name, card.names.cn, card.names.ja].some((n) => !!n && n.toLowerCase().includes(q)),
  );
  const current = (card: CatalogCard) => shownPrinting(catalog, tokenArt, card.id, card.printings[0]!) ?? card.printings[0]!;
  const closePrintings = () => {
    setLook(null);
    setOpen(null);
  };
  // Escape and the Android back button close the window on top: the printing viewed, the printings, then the list.
  const back = () => (look ? setLook(null) : open ? closePrintings() : onClose());
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") back();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
  useBack(true, back);
  const pick = (card: CatalogCard, printing: string) => {
    updateSettings({ tokenArt: withTokenArt(tokenArt, card.id, printing, card.printings[0]!) });
    closePrintings();
  };
  return (
    <div className="sve-modal-backdrop sve-token-art-backdrop" onClick={onClose}>
      <div className="sve-modal sve-token-art" onClick={(e) => e.stopPropagation()} data-testid="token-art">
        <header className="sve-modal-header">
          <span>{t("tokenArt.title")}</span>
          <input placeholder={t("tokenArt.search")} value={query} onChange={(e) => setQuery(e.target.value)} autoFocus />
          <button type="button" disabled={Object.keys(tokenArt).length === 0} onClick={() => updateSettings({ tokenArt: {} })} data-testid="token-art-reset">
            {t("tokenArt.reset")}
          </button>
          <button type="button" onClick={onClose}>
            {t("game.close")}
          </button>
        </header>
        <p className="sve-hint">{t("tokenArt.help")}</p>
        <div className="sve-token-art-grid">
          {shown.map((card) => {
            const printing = current(card);
            return (
              <div key={card.id} className="sve-token-art-option" role="button" onClick={() => setOpen(card)} data-token={card.id}>
                <CardTile info={{ def: card.id, printing }} exact />
                <span className="sve-token-art-name">{cardName(card, cardLang)}</span>
                <span className={`sve-printing-label${printing !== card.printings[0] ? " sve-alt" : ""}`}>{printing}</span>
                <span className="sve-token-art-count">{t("tokenArt.count", { n: card.printings.length })}</span>
              </div>
            );
          })}
        </div>
      </div>
      {open ? (
        <div
          className="sve-modal-backdrop sve-token-art-backdrop"
          onClick={(e) => {
            e.stopPropagation();
            closePrintings();
          }}
        >
          <div className="sve-modal sve-token-art sve-token-art-printings" onClick={(e) => e.stopPropagation()} data-testid="token-art-printings">
            <header className="sve-modal-header">
              <span>{t("tokenArt.printings", { name: cardName(open, cardLang) })}</span>
              <button type="button" onClick={closePrintings}>
                {t("game.close")}
              </button>
            </header>
            <div className="sve-token-art-grid">
              {open.printings.map((printing, i) => (
                <div
                  key={printing}
                  className={`sve-token-art-option${printing === current(open) ? " sve-token-art-current" : ""}`}
                  role="button"
                  onClick={() => pick(open, printing)}
                  data-printing={printing}
                >
                  <CardTile info={{ def: open.id, printing }} exact />
                  <span className={`sve-printing-label${i > 0 ? " sve-alt" : ""}`}>{printing}</span>
                  {i === 0 ? <span className="sve-token-art-count">{t("tokenArt.own")}</span> : null}
                  <button
                    type="button"
                    className="sve-token-art-view"
                    onClick={(e) => {
                      e.stopPropagation();
                      setLook(printing);
                    }}
                    data-testid="token-art-view"
                  >
                    {t("tokenArt.view")}
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : null}
      {open && look ? (
        <div
          className="sve-modal-backdrop sve-token-art-backdrop"
          onClick={(e) => {
            e.stopPropagation();
            setLook(null);
          }}
        >
          <div className="sve-modal sve-token-art-preview" onClick={(e) => e.stopPropagation()} data-testid="token-art-preview">
            <header className="sve-modal-header">
              <span>
                {cardName(open, cardLang)} · {look}
              </span>
              <button type="button" onClick={() => setLook(null)}>
                {t("game.close")}
              </button>
            </header>
            <div className="sve-token-art-preview-body">
              <div className="sve-token-art-preview-art">
                <CardArt printing={look} def={open.id} name={cardName(open, cardLang)} exact />
              </div>
              <div className="sve-token-art-preview-text">
                <CardPanel focus={{ def: open.id, printing: look }} exact art={false} />
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
