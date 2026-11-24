import type { CardId } from "../../model/ids";
import type { UncapKind } from "../../model/state";
import type { G } from "../runtime/context";
import type { Env } from "../state/access";
import { hasKeyword, isFollowerOnField } from "../state/characteristics";
import { uncapMaterials, uncapStateOf } from "../state/links";
import { thisTurn } from "../state/turn-counts";
import { moveCards } from "../state/zones";

/**
 * CR JP 14.6.4 (Granblue Fantasy; the English rules don't have it yet) — uncapping and final uncapping. A treasure's
 * ability (CR JP 14.6.1) moves the treasure into the uncap zone (CR JP 4.17) linked to the follower: while it is linked,
 * the follower is uncapped (+1 attack, CR JP 14.6.4.1.1) or final-uncapped (+1 attack and +1 defense, CR JP 14.6.4.2.1;
 * state/characteristics.ts adds them).
 */
export { uncapMaterials, uncapStateOf };

/**
 * CR JP 14.6.4.1 / JP 14.6.4.2 — would uncapping (final uncapping) this card be performed now: a follower on the field that is
 * not uncapped (final-uncapped); to final-uncap, it has Final Uncap (CR JP 14.6.3.1), which it loses with its abilities
 * (CP05-T15 ruling Q2930). Being uncapped is no condition for a final uncap (an element's "if it was uncapped" is its text).
 */
export function canUncap(env: Env, card: CardId, kind: UncapKind): boolean {
  if (!isFollowerOnField(env, card)) return false;
  const state = uncapStateOf(env, card);
  return kind === "uncap" ? !state.uncapped : !state.final && hasKeyword(env, card, "finalUncap");
}

/**
 * CR JP 14.6.4.1 / JP 14.6.4.2 — `material` (the treasure whose ability this is) uncaps or final-uncaps `follower`: it moves
 * from the EX area into its owner's uncap zone (CR 4.1.6, CR JP 4.17.1), linked to the follower; when that is done, the
 * follower "uncapped" ("final-uncapped"), counted for this turn (rulings Q2873, Q2886). A treasure already in the uncap zone
 * linked to that follower (ヒヒイロカネ: "it uncaps; if it has Final Uncap, it also final-uncaps" — one card does both,
 * ruling Q2868) adds the state without moving again. Returns the treasure's id in the uncap zone, or null when nothing was
 * done (CR 1.3.2: the treasure then stays where it is).
 */
export function uncap(g: G, material: CardId, follower: CardId, kind: UncapKind): CardId | null {
  const m = g.state.cards[material];
  if (!m || g.db.get(m.def).type !== "treasure") return null;
  if (!canUncap(g, follower, kind)) return null;
  let id: CardId;
  if (m.zone === "ex") {
    const [moved] = moveCards(g, [{ card: material, to: "uncapZone", linkTo: follower, uncaps: [kind] }], "effect");
    if (moved === undefined || g.state.cards[moved]?.zone !== "uncapZone") return null; // not done (CR 1.3.2)
    id = moved;
  } else if (m.zone === "uncapZone" && m.linkedTo === follower) {
    id = material;
    m.uncaps = [...(m.uncaps ?? []), kind];
  } else {
    return null;
  }
  const player = g.state.cards[follower]!.controller;
  thisTurn(g.state, player).uncaps += 1;
  g.emit({ type: "uncapped", player, follower, material: id, final: kind === "final" });
  return id;
}
