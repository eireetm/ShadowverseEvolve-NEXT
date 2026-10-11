// How an ability a decision is about reads (a pending one, the one being played): its name in a heading and its text — from
// what the engine worker tells of it (AbilityInfo: the engine's ability, its kind and rank), located in the card text by
// ability-text.ts. Nothing here works out rules.
import { cardName, type Catalog } from "../../app/catalog";
import type { CardLang } from "../../app/settings";
import type { AbilityInfo, ProcessingInfo } from "../../engine/protocol";
import type { MessageKey, Translate } from "../../i18n";
import { abilityLabel } from "../labels";
import { locateAbilityText, locateQuotedText, type AbilityText } from "./ability-text";

/** The kind its paragraph is found by: an automatic ability's timing; an evolve, an advanced or another activated ability. */
export function textGroup(info: AbilityInfo): string | null {
  if (info.kind === "automatic") return info.timing ?? "other";
  if (info.kind === "activated") return info.evolve ? "evolve" : info.advanced ? "advanced" : "activated";
  if (info.kind === "spell") return "spell";
  return null;
}

/** An ability's name in a heading: a keyword's ability by its keyword (Drain, Single Drive ...), else its timing or kind. */
export function abilityName(info: AbilityInfo | undefined, t: Translate): string {
  return info?.keyword ? t(`keyword.${info.keyword}` as MessageKey) : abilityLabel(info, t);
}

/**
 * What an ability says: its paragraph of its card's text; a given or an equipment token's ability, the quote of the card that
 * gave it. None for a keyword's ability (its keyword says it), or where the text doesn't tell.
 */
export function abilityText(info: AbilityInfo | undefined, catalog: Catalog, lang: CardLang): AbilityText | null {
  if (!info || info.keyword) return null;
  const group = textGroup(info);
  if (!group) return null;
  if (info.giver) {
    const giver = catalog.def(info.giver);
    return giver ? locateQuotedText(giver, lang, group, info.rank ?? 0, info.count ?? 1) : null;
  }
  if (!info.sourceDef || info.sourceDef.includes(":") || info.rank === undefined || info.count === undefined) return null;
  const card = catalog.def(info.sourceDef);
  return card ? locateAbilityText(card, lang, group, info.rank, info.count) : null;
}

/** The name of the card giving an ability, when another card did (a given ability, an equipment token's). */
export function giverName(info: AbilityInfo | undefined, catalog: Catalog, lang: CardLang): string | null {
  return info?.giver ? cardName(catalog.def(info.giver), lang) : null;
}

/**
 * What a card being played says while it is (CR 10.6.2): a spell, its text (its effect); played another way, or paying an
 * additional cost, the paragraph that says how (CR 10.4.7.3). Nothing for a follower or amulet played normally.
 */
export function cardPlayText(processing: ProcessingInfo, paying: boolean, catalog: Catalog, lang: CardLang): AbilityText | null {
  const card = catalog.def(processing.card.def);
  if (!card) return null;
  if (card.type === "spell") return locateAbilityText(card, lang, "spell", 0, 1);
  const otherWay = processing.playOption !== undefined && processing.playOption.id !== "normal";
  return otherWay || paying ? locateAbilityText(card, lang, "play", 0, 1) : null;
}
