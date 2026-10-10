import { useApp } from "../../app/store";
import { useSettings } from "../../app/settings";
import { cardName } from "../../app/catalog";
import { useT } from "../../i18n";
import type { AbilityUpdate as GameUpdate } from "../../presentation/protocol";
import { isOnTable } from "../../engine/view-utils";
import { displayAbilityHeading, displayAbilityText } from "../card/ability-display";
import { CardTextLine } from "../card/CardText";
import { scriptLabel } from "../options";
import { setHighlight, showCard } from "../focus";

/** Both the dialog and table read exactly the context published for this decision. */
export function AbilityPrompt({ update, compact = false }: { update: GameUpdate; compact?: boolean }) {
  const t = useT();
  const catalog = useApp((s) => s.catalog)!;
  const { cardLang } = useSettings();
  const context = update.effectContext;
  if (!context) return null;
  const heading = displayAbilityHeading(context, update, catalog, cardLang, t);
  const text = displayAbilityText(context, catalog, cardLang);
  const processing = t(context.kind === "cardPlay" ? "decision.processingCard" : "decision.processingAbility", { ability: heading });
  const highlight = () => setHighlight(isOnTable(update.view, context.source) ? [context.source] : []);
  const inspect = () => {
    if (context.sourceCard) showCard({ ...context.sourceCard, id: context.source });
    else if (context.textRef && context.origin === "printed") showCard({ def: context.textRef.def, printing: null });
  };
  const body = (
    <>
      {context.providerDef ? <span className="sve-ability-provider">{t("decision.abilityProvider", { card: cardName(catalog.def(context.providerDef), cardLang) })}</span> : null}
      {text?.match === "body" ? <span className="sve-ability-provider">{t("decision.abilityBody")}</span> : null}
      {context.kind === "cardPlay" && text ? <span className="sve-ability-provider">{t("decision.playDetails")}</span> : null}
      {context.playOptionLabel ? <span className="sve-ability-provider">{t("decision.selectedPlay", {
        option: context.playOptionId === "normal" ? t("option.playNormally") : scriptLabel(context.playOptionLabel, { catalog, lang: cardLang }),
      })}</span> : null}
      {text ? <CardTextLine className="sve-ability-text" line={text.text} lang={text.lang} /> : null}
    </>
  );
  return (
    <div className={`sve-ability-context${compact ? " sve-ability-compact" : ""}`} data-testid={compact ? "table-ability" : "prompt-ability"}>
      {compact ? (
        <details key={context.instanceId ?? `${context.pendingId ?? context.sourceDef}:${context.abilityIndex}`}>
          <summary onMouseEnter={highlight} onMouseLeave={() => setHighlight([])}>{processing}</summary>
          <div className="sve-ability-expanded">{body}</div>
        </details>
      ) : (
        <>
          <button type="button" className="sve-ability-heading" onMouseEnter={highlight} onMouseLeave={() => setHighlight([])} onClick={inspect}>
            {processing}
          </button>
          {body}
        </>
      )}
    </div>
  );
}
