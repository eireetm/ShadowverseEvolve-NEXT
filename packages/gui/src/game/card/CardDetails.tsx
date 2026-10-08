import { useState } from "react";
import { cardName, cardText } from "../../app/catalog";
import { type CardLang, useSettings } from "../../app/settings";
import { useApp } from "../../app/store";
import { shownPrinting } from "../../app/token-art";
import { traitName } from "../../app/traits";
import type { CardRuntimeDetails } from "../../engine/protocol";
import { findCard, sideOf } from "../../engine/view-utils";
import { htmlLang, useT } from "../../i18n";
import { useFocusSelect, type FocusCard } from "../focus";
import { ArtViewer, type ArtFace } from "./ArtViewer";
import { CardArt } from "./CardArt";
import { CardText } from "./CardText";
import { displayOf } from "./display";

const LANGS: readonly CardLang[] = ["en", "cn", "ja"];

/**
 * The last card the pointer went over (CardPanel). A card of the game is followed while it stays in its zone (it evolves,
 * takes damage ...). A moved or hidden instance is no longer shown; we do not retain historical snapshots.
 */
export function CardDetails() {
  const shown = useFocusSelect((f) => f.shown);
  const update = useApp((s) => s.update);
  const catalog = useApp((s) => s.catalog);
  const t = useT();
  if (!shown || !catalog) return <p className="sve-hint">{t("card.hint")}</p>;
  const now = shown.id && update ? findCard(update.view, shown.id) : null;
  if (shown.id && !now) return <p className="sve-hint">{t("card.hint")}</p>;
  return <CardPanel
    focus={now && update ? { ...displayOf(now, sideOf(update.view, now.id), catalog), view: now } : shown}
    details={now && update ? update.cardDetails[now.id] : undefined}
  />;
}

/**
 * A card's panel: picture (click it for a large one), names, type, traits, stats, text, printings. `exact`: this printing as
 * it is, not a token's chosen art; without `art`, no picture (the token art window shows one printing large beside it).
 */
export function CardPanel({ focus, details, exact = false, art = true }: { focus: FocusCard; details?: CardRuntimeDetails; exact?: boolean; art?: boolean }) {
  const catalog = useApp((s) => s.catalog)!;
  const { cardLang, tokenArt } = useSettings();
  const t = useT();
  const [viewing, setViewing] = useState<readonly ArtFace[] | null>(null);
  const def = catalog.def(focus.def);
  if (!def) return <p className="sve-hint">{focus.def}</p>;
  const view = focus.view;
  // The name in the card language, then in the other two (each drawn in its own language's characters).
  const name = cardName(def, cardLang);
  // Only the languages' own names, each once (a language without one would repeat the card name, e.g. a pre-release card's
  // Japanese name where it has no Chinese one).
  const others = LANGS.filter((l) => l !== cardLang)
    .map((l) => ({ lang: l, name: def.names[l] ?? "" }))
    .filter((o, i, all) => o.name !== "" && o.name !== name && all.findIndex((x) => x.name === o.name) === i);
  const stat = (label: string, now: number | null | undefined, printed: number | null) =>
    (now === undefined ? printed : now) === null ? null : (
      <div className="sve-details-stat">
        <span>{label}</span>
        <strong>{now === undefined ? printed : now}</strong>
        {now !== undefined && now !== null && printed !== null && now !== printed ? <small>{t("card.printed", { value: printed })}</small> : null}
      </div>
    );
  const text = cardText(def, cardLang);
  // The physical card's printings (a back face has none: its front's).
  const physical = def.frontFace ? catalog.def(def.frontFace) : def;
  const printings = physical?.printings ?? [];
  // A token: the printing its picture shows (token-art.ts).
  const own = focus.printing ?? printings[0] ?? null;
  const printing = exact ? own : shownPrinting(catalog, tokenArt, def.id, own);
  const faces = (): ArtFace[] => {
    const front = physical ?? def;
    const face = (id: string, back: boolean): ArtFace => ({ def: id, printing, back, name: cardName(catalog.def(id), cardLang, id) });
    return front.backFace ? [face(front.id, false), face(front.backFace, true)] : [face(def.id, focus.back ?? false)];
  };
  return (
    <div className="sve-details">
      {art ? (
        <button type="button" className="sve-details-art" onClick={() => setViewing(faces())} title={t("card.enlarge")} data-testid="details-art">
          <CardArt printing={focus.printing} def={def.id} back={focus.back} name={name} subtitle={t(`type.${view?.type ?? def.type}` as const)} exact={exact} />
        </button>
      ) : null}
      <h3 className="sve-details-name" lang={htmlLang(cardLang)}>
        {name}
      </h3>
      {others.length > 0 ? (
        <div className="sve-details-names">
          {others.map((o, i) => (
            <span key={o.lang} lang={htmlLang(o.lang)}>
              {i > 0 ? " / " : ""}
              {o.name}
            </span>
          ))}
        </div>
      ) : null}
      <div className="sve-details-type">
        {[
          t(`class.${def.class}` as const),
          view && view.type !== def.type
            ? t("card.currentType", { current: t(`type.${view.type}`), original: t(`type.${def.type}`) })
            : t(`type.${def.type}` as const),
          def.evolved ? t("card.evolved") : null,
          def.token ? t("card.token") : null,
          def.universe ? t(`universe.${def.universe}` as const) : null,
        ]
          .filter(Boolean)
          .join(" · ")}
      </div>
      {details?.maneuveredThisTurn ? <div className="sve-details-type sve-details-maneuver-duration">{t("card.maneuverDuration")}</div> : null}
      {def.traits.length > 0 ? (
        <div className="sve-details-traits">
          {t("card.traits")}: <span lang={htmlLang(cardLang)}>{def.traits.map((trait) => traitName(trait, cardLang)).join("・")}</span>
          <span className="sve-details-other">
            {" ("}
            {LANGS.filter((l) => l !== cardLang).map((l, i) => (
              <span key={l} lang={htmlLang(l)}>
                {i > 0 ? " / " : ""}
                {def.traits.map((trait) => traitName(trait, l)).join("・")}
              </span>
            ))}
            {")"}
          </span>
        </div>
      ) : null}
      <div className="sve-details-stats">
        {def.type !== "leader" ? stat(t("card.cost"), view?.cost, def.cost) : null}
        {stat(t("card.attack"), view?.attack, def.attack)}
        {stat(t("card.defense"), view?.defense, def.defense)}
      </div>
      {text ? <CardText text={text} lang={cardLang} /> : <p className="sve-hint">{t("card.noText")}</p>}
      <div className="sve-details-meta">
        {printing ?? def.id}
        {printing && physical && printing !== physical.id ? ` · ${t("card.altPrinting", { card: physical.id })}` : ""} · {t(`card.status.${def.status}` as const)}
      </div>
      {printings.length > 1 ? (
        <div className="sve-details-printings" data-testid="details-printings">
          {t("card.printings")}:{" "}
          {printings.map((p, i) => (
            <span key={p} className={p === printing ? "sve-current" : undefined}>
              {i > 0 ? " · " : ""}
              {p}
            </span>
          ))}
        </div>
      ) : null}
      {view && details ? (
        <>
          <section className="sve-details-runtime sve-details-current-state" data-testid="details-state">
            <h4>{t("card.currentState")}</h4>
            <div className="sve-details-flags">
              {details.enteredFieldThisTurn ? <span>{t("card.enteredThisTurn")}</span> : null}
              {details.boxed ? <span>{t("card.boxed")}</span> : null}
              {details.abilitiesLost ? <span>{t("card.abilitiesLost")}</span> : null}
            </div>
            {details.abilitiesLost ? <p className="sve-hint sve-details-abilities-lost-help">{t("card.abilitiesLostHelp")}</p> : null}
          </section>
          {/* Reserved for gained abilities; no list is inferred from printed keywords or CardView. */}
          <section className="sve-details-runtime sve-details-gained-abilities" data-testid="details-gained">
            <h4>{t("card.gainedAbilities")}</h4>
          </section>
        </>
      ) : null}
      {viewing ? <ArtViewer faces={viewing} onClose={() => setViewing(null)} /> : null}
    </div>
  );
}
