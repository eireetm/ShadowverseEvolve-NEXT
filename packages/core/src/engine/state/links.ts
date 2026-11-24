import type { CardId, PlayerId } from "../../model/ids";
import type { LinkZone } from "../../model/state";
import type { Env } from "./access";

/**
 * Links of the collaboration zones (CR 14): Carrot cards in the race zone (14.2.1.1), Drive Point cards in the drive
 * zone (14.4.9.2), equipment tokens (14.5.2.2.2) and treasures in the uncap zone (CR JP 14.6.4.1) are linked to a card on
 * the field (`CardInstance.linkedTo`). A card whose control changed stays linked to the cards in its previous controller's
 * zone (links are lost only when it leaves the field), so both players' zones are searched.
 */
export function linkedCards(env: Env, id: CardId, zone: LinkZone): CardId[] {
  return [0, 1].flatMap((p) => env.state.players[p as PlayerId].zones[zone].filter((x) => env.state.cards[x]!.linkedTo === id));
}

/** The treasures linked to a card in the uncap zones (CR JP 14.6.4.1; both players', as above). */
export function uncapMaterials(env: Env, card: CardId): CardId[] {
  const players = env.state.players;
  if (players[0].zones.uncapZone.length === 0 && players[1].zones.uncapZone.length === 0) return [];
  return linkedCards(env, card, "uncapZone");
}

/**
 * CR JP 14.6.4.1.1 / JP 14.6.4.2.1 — is a card uncapped, final-uncapped: a treasure that did it is linked to it. The states are
 * the treasures' (`CardInstance.uncaps`): a rule, not an ability, so they stay when the card loses its abilities (CP05-T15
 * ruling Q2930), and they end with the link (CR JP 11.12.1).
 */
export function uncapStateOf(env: Env, card: CardId): { uncapped: boolean; final: boolean } {
  let uncapped = false;
  let final = false;
  for (const m of uncapMaterials(env, card)) {
    const kinds = env.state.cards[m]!.uncaps ?? [];
    if (kinds.includes("uncap")) uncapped = true;
    if (kinds.includes("final")) final = true;
  }
  return { uncapped, final };
}

/** "A racing follower" (CP01-034): it has raced and is still linked to a race-zone card (CR 14.2.3.1). */
export function isRacing(env: Env, id: CardId): boolean {
  const c = env.state.cards[id];
  return c !== undefined && c.zone === "field" && (c.raced ?? 0) > 0 && linkedCards(env, id, "raceZone").length > 0;
}
