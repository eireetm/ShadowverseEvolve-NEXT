import type { CardView } from "@sve/core";
import type { GameUpdate } from "../../presentation/protocol";
import { zoneOf } from "../../engine/view-utils";

/** Use only this update's visible hand/EX membership, never a tile's side or stale details. */
export function normalPlayCost(update: GameUpdate | null, card: CardView | undefined): number | undefined {
  if (!update || !card || card.cost === null) return undefined;
  const location = zoneOf(update.view, card.id);
  if (location?.zone !== "hand" && location?.zone !== "ex") return undefined;
  return update.cardDetails?.[card.id]?.normalPlayCost;
}

export function costArrow(cost: number | undefined, base: number | null): string {
  return cost === undefined || base === null || cost === base ? "" : cost < base ? "↓" : "↑";
}
