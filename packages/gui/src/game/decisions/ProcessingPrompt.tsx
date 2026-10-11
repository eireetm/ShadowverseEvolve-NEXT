// What the pending decision is part of (DecisionInfo.processing, worked out by the engine worker): "Processing: <card> —
// <ability>" or "Playing: <card>", with what it says (card/ability-display.ts), the card that gave the ability and the way
// the card is played. In the decision window above its question; beside the table, one line that opens the text.
import { cardName } from "../../app/catalog";
import { useSettings } from "../../app/settings";
import { useApp } from "../../app/store";
import type { GameUpdate } from "../../engine/protocol";
import { findCard, isOnTable } from "../../engine/view-utils";
import { useT } from "../../i18n";
import { abilityName, abilityText, cardPlayText, giverName } from "../card/ability-display";
import { CardTextLine } from "../card/CardText";
import { setHighlight, showCard } from "../focus";
import { cardLabel } from "../labels";
import { scriptLabel } from "../options";

export function ProcessingPrompt({ update, compact = false }: { update: GameUpdate; compact?: boolean }) {
  const t = useT();
  const catalog = useApp((s) => s.catalog)!;
  const { cardLang } = useSettings();
  const info = update.decision;
  const processing = info?.processing;
  if (!info || !processing) return null;
  const decision = info.decision;
  // The card as the table shows it (an evolved follower by its evolved card), else as the worker named it.
  const name = findCard(update.view, processing.source) ? cardLabel(processing.source, update, catalog, cardLang, t) : cardName(catalog.def(processing.card.def), cardLang);
  const heading =
    processing.kind === "card"
      ? t("decision.processingCard", { card: name })
      : t("decision.processingAbility", { card: name, ability: abilityName(processing.ability, t) });
  const paying = decision.type === "selectCards" && decision.reason === "cost";
  const text = processing.kind === "card" ? cardPlayText(processing, paying, catalog, cardLang) : abilityText(processing.ability, catalog, cardLang);
  const giver = giverName(processing.ability, catalog, cardLang);
  const option = processing.playOption
    ? processing.playOption.id === "normal"
      ? t("option.playNormally")
      : scriptLabel(processing.playOption.label, { catalog, lang: cardLang })
    : null;
  const point = () => setHighlight(isOnTable(update.view, processing.source) ? [processing.source] : []);
  const inspect = () => showCard({ id: processing.source, def: processing.card.def, printing: processing.card.printing });
  const body = (
    <>
      {giver ? <span className="sve-processing-note">{t("decision.abilityGiver", { card: giver })}</span> : null}
      {option ? <span className="sve-processing-note">{t("decision.playedWith", { option })}</span> : null}
      {text ? <CardTextLine className="sve-processing-text" line={text.text} lang={text.lang} /> : null}
    </>
  );
  if (compact) {
    return (
      <details className="sve-processing sve-processing-compact" data-testid="table-processing">
        <summary onMouseEnter={point} onMouseLeave={() => setHighlight([])}>
          {heading}
        </summary>
        <div className="sve-processing-body">{body}</div>
      </details>
    );
  }
  return (
    <div className="sve-processing" data-testid="processing">
      <span
        className="sve-processing-heading"
        role="button"
        tabIndex={0}
        onMouseEnter={point}
        onMouseLeave={() => setHighlight([])}
        onClick={inspect}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") inspect();
        }}
      >
        {heading}
      </span>
      {body}
    </div>
  );
}
