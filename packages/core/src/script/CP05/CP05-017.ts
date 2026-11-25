// CP05-017 カワイイ花マル・マナマル — Forestcraft follower, 2, 1/1. グラブル・闇属性.
// これが上限解放したとき、手札の闇属性・カード1枚を捨てる：1枚引く。
// 自分のエンドフェイズが来たとき、相手の場のフォロワー1体を選ぶ。このターン、自分の手札の闇属性・カードを捨てていたなら、それに2ダメージ。
// それのリーダーに1ダメージ。
// (When this is uncapped, discard a dark card from your hand: draw a card — the controller may decline, CR 10.4.7.4. At the start
// of your end phase, select an enemy follower on the field; if you discarded a dark card (a 全属性 one too, CR JP 14.6.2.2) from
// your hand this turn, deal it 2 damage and 1 damage to its leader — the leader damage is under the condition too (the project's
// reading of 「…なら、X。Y。」, confirmed by its owner; the set's ruling Q2912 on CP05-070 and BP21-029's official English say
// the same of the same shape). The selection comes first, outside the condition: without an enemy follower it can't be played —
// ruling Q2879, CR 10.6.2.3.3. Any dark card discarded from your hand earlier this turn counts, as it was in the hand, whatever
// made you discard it: a cost (this card's own, CP05-012's; CP05-074 ruling Q2916 on the same words), an effect, an opponent's
// ability (Q2914); the hand-limit discard comes after this, CR 7.4.7.)
import { traitMatches } from "../../model/traits";
import { discardA } from "../costs";
import { atStartOfYourEndPhase, defineCard, whenThisIsUncapped } from "../helpers";
import { enemyFollower, hasTrait } from "../targets";

export default defineCard({
  abilities: [
    whenThisIsUncapped({
      cost: discardA(hasTrait("闇属性")),
      *resolve(fx) {
        yield* fx.draw(1);
      },
    }),
    atStartOfYourEndPhase({
      targets: [enemyFollower()],
      *resolve(fx) {
        if (!fx.game.discardedCardsThisTurn(fx.controller).some((c) => traitMatches(c.traits, "闇属性"))) return;
        const target = fx.targets[0]![0]!;
        const leader = fx.game.leader(fx.game.controller(target));
        yield* fx.dealDamage(target, 2);
        yield* fx.dealDamage(leader, 1);
      },
    }),
  ],
});
