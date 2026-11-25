// CP05-016 愛憎の舞手・コウ＆ヨウ — Forestcraft follower, 7, 7/6. グラブル・光属性・闇属性.
// 【突進】【指定攻撃】
// 【攻撃時】自分のデッキの上1枚を公開する。公開したカードが元のコスト5のグラブル・フォロワーなら、それを場に出す。公開したカードが元のコスト5の
// グラブル・フォロワーでないなら、それを手札に加える。
// (Rush. Assail. Strike - Reveal the top card of your deck. If it's a Granblue follower with an original cost of 5 (CR 5.24.1),
// put it onto your field — its Fanfare triggers, CR 12.4.3; otherwise add it to your hand — not a draw, CR 5.10. With a full
// field the follower isn't moved, CR 4.4.4.2, and stays on top of the deck, unrevealed once this resolves, CR 5.21.1.1: the
// second sentence is for a card that isn't one. Nothing with an empty deck.)
import { defineCard, strike } from "../helpers";
import { granblueCost5 } from "./shared";

export default defineCard({
  keywords: ["rush", "assail"],
  abilities: [
    strike({
      *resolve(fx) {
        const [top] = fx.topCards(1);
        if (top === undefined) return;
        yield* fx.reveal([top]);
        if (granblueCost5(fx.game, top)) yield* fx.putOntoField([top]);
        else yield* fx.returnToHand([top]);
      },
    }),
  ],
});
