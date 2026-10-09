import { cardName, type Catalog } from "../../app/catalog";
import type { CardLang } from "../../app/settings";
import type { Translate } from "../../i18n";
import type { AbilityDisplayContext } from "../../presentation/protocol";
import { locateAbilityText, locateKeywordAbilityText, type AbilityText } from "./ability-text";
import { giftQuotes } from "./gifts";
import { cardLabel, timingLabel } from "../labels";
import type { AbilityUpdate as GameUpdate } from "../../presentation/protocol";

export function displayAbilityText(context: AbilityDisplayContext, catalog: Catalog, lang: CardLang): AbilityText | null {
  if (context.keyword) return locateKeywordAbilityText(context.keyword, lang);
  const ref = context.textRef;
  const card = ref && catalog.def(ref.def);
  if (!ref || !card) return null;
  if (!ref.quoted) return locateAbilityText(card, lang, ref.timing, ref.rank, ref.count);
  const quotes = (data: "en" | "cn" | "ja") => giftQuotes(card.text[data] ?? "", data).join("\n");
  return locateAbilityText({ id: `${card.id}:quoted`, text: { en: quotes("en"), cn: quotes("cn"), ja: quotes("ja") } }, lang, ref.timing, ref.rank, ref.count);
}

export function displayAbilityHeading(context: AbilityDisplayContext, update: GameUpdate, catalog: Catalog, lang: CardLang, t: Translate): string {
  const name = context.sourceCard ? cardName(catalog.def(context.sourceCard.def), lang) : cardLabel(context.source, update, catalog, lang, t);
  const keyword = context.keyword;
  const type = context.kind === "cardPlay" ? t("ability.cardPlay") : context.kind === "spell" ? t("ability.spell") :
    context.kind === "activated" ? context.textRef?.timing === "evolve" ? t("ability.evolve") :
      context.textRef?.timing === "advanced" ? `${t("ability.advanced")} ${t("ability.act")}` : t("ability.act") :
    keyword === "drain" || keyword === "singleDrive" || keyword === "twinDrive" ? t(`keyword.${keyword}`) : timingLabel(context.timing, t);
  return `${name} — ${type}`;
}
