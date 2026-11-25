// Shared pieces of the CP05 Havencraft card scripts (not a card: the file name has no set prefix).
import type { CardId, PlayerId } from "../../model/ids";
import type { EffectContext } from "../../engine/effects/context";
import type { GameReader } from "../../engine/query";
import type { Proc } from "../../engine/runtime/proc";
import { granblueCost5, LIGHT_ELEMENT } from "./shared";

/**
 * "自分の場の元のコスト5のグラブル・フォロワー" (CP05-095, 096, 097, 098): how many there are on `player`'s field — a card that
 * counts them counts itself when it is one (it is on the field then), an evolved one by its base card's cost (CR 5.16.1.2).
 */
export function granblueCost5OnField(g: GameReader, player: PlayerId): number {
  return g.followers(player).filter((id) => granblueCost5(g, id)).length;
}

/**
 * CP05-093 / 094 "自分のPP最大値が7以上である限り、これが受けるダメージを-1する": while its controller's maximum play points are
 * 7 or more, it takes 1 less damage, of every kind (the text doesn't say which; BP01-134's ruling on the same sentence). A
 * replacement effect (CR 5.14.2, 10.2.1.3.2): 1 damage becomes 0, which is no damage (CR 1.3.2.2). It is the number Overflow
 * needs (CR 13.4.1.2), but the card doesn't say Overflow, so it is read as written.
 */
export function viraDamageTaken(g: GameReader, self: CardId): number {
  return g.state.players[g.controller(self)].maxPlayPoints >= 7 ? -1 : 0;
}

/**
 * CP05-097 Fanfare / 098 On Evolve: "『光晶のエレメント』1枚をEXエリアに置く。自分の場に元のコスト5のグラブル・フォロワーが
 * いるなら、自分のリーダーは体力+2する。" The element has no condition (the "if" comes after it); the +2 needs one such follower on
 * your field when it is done, after the element, as the text is performed in its written order (CR 10.6.2.8.2) — not this
 * one, whose original cost is 1 even evolved (CR 5.16.1.2).
 */
export function* tikoEffect(fx: EffectContext): Proc<void> {
  yield* fx.tokensToEx([LIGHT_ELEMENT]);
  if (granblueCost5OnField(fx.game, fx.controller) >= 1) yield* fx.giveLeaderDefense(fx.controller, 2);
}
