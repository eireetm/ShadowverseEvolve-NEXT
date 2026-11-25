// CP05-083 コラプション — Abysscraft spell, 5. グラブル・闇属性.
// これをプレイする際、追加コストとして手札の闇属性・カード1枚を捨てる。（追加コストを支払わなければプレイできない）
// 場のフォロワーすべてに5ダメージ。相手のリーダーすべてに2ダメージ。
// (As an additional cost to play this card, discard a dark (or 全属性, CR JP 14.6.2.2) card from your hand — another card: this one
// is in the resolution zone then (CR 10.6.2.1, 10.6.2.5); it can't be played without one. Deal 5 damage to each follower on the field,
// both sides, then 2 damage to each enemy leader (in that order, CR 10.6.2.8.2). The discarded card is discarded by this dark card's
// ability (the additional cost is part of the spell's text, CR 10.1.1.4; decided by the project owner, 2026-11-24): CP05-072 / 076 /
// 082 trigger, and resolve after this spell (CR 10.5). A follower whose "when you discard a dark card" ability triggered on the cost
// and that this spell then destroys still has it resolve (ruling Q2916, CR 10.6.2.8.2.1).)
import { discardA } from "../costs";
import { defineCard, spell } from "../helpers";
import { darkCard } from "./abyss-shared";

export default defineCard({
  playOptionsRequired: true,
  playOptions: [{ id: "discardDark", label: "Discard a Dark card", ...discardA(darkCard) }],
  abilities: [
    spell({
      *resolve(fx) {
        const opponent = fx.game.opponent(fx.controller);
        yield* fx.dealDamageEach([...fx.game.followers(fx.controller), ...fx.game.followers(opponent)], 5);
        yield* fx.dealDamage(fx.game.leader(opponent), 2);
      },
    }),
  ],
});
