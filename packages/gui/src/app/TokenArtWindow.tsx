// The settings' token art: every token with the printing it is shown with. A token opens a second window with all its
// printings; the one picked is the token's picture in games from then on (token-art.ts: the look only, the Core isn't
// asked). The list comes from the card data, so new tokens and their reprints (which join their token's definition when
// the data is built) are in it without more work.
import { useEffect, useMemo, useState } from "react";
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
  const tokens = useMemo(() => catalog.cards.filter((card) => card.token), [catalog]);
  const q = query.trim().toLowerCase();
  const shown = tokens.filter(
    (card) => q === "" || card.printings.some((p) => p.toLowerCase().startsWith(q)) || [card.name, card.names.cn, card.names.ja].some((n) => !!n && n.toLowerCase().includes(q)),
  );
  const current = (card: CatalogCard) => shownPrinting(catalog, tokenArt, card.id, card.printings[0]!) ?? card.printings[0]!;
  // Escape and the Android back button close the printings first, then the list.
  const back = () => (open ? setOpen(null) : onClose());
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
    setOpen(null);
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
            setOpen(null);
          }}
        >
          <div className="sve-modal sve-token-art sve-token-art-printings" onClick={(e) => e.stopPropagation()} data-testid="token-art-printings">
            <header className="sve-modal-header">
              <span>{t("tokenArt.printings", { name: cardName(open, cardLang) })}</span>
              <button type="button" onClick={() => setOpen(null)}>
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
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
