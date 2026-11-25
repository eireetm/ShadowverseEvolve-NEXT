// CP05-019 天星剣王・シエテ — Swordcraft follower, 5, 3/3. グラブル・十天衆・風属性.
// 【最終上限解放可能】
// これが上限解放したとき、2枚引く。自分の手札1枚をデッキの下に置く。
// これが最終上限解放したとき、自分のデッキから元のコスト2以下のフォロワーをカード名が異なるように2枚まで探し、場に出す。
// (Final Uncap (CR JP 14.6.3). When this uncaps (CR JP 14.6.4.1): draw 2 cards, then put a card from your hand on the bottom of
// your deck — any card of the hand, its player's pick, not a selection (as BP22-022's same sentence). When this final-uncaps
// (CR JP 14.6.4.2): search your deck for up to 2 followers that originally cost 2 or less with different names, put them onto
// your field, then shuffle — names compared among the found cards only; with a condition they are revealed (CR 5.8.1.2) and
// need not be found (CR 4.1.2.2); with room for one, the player picks which (CR 4.4.4.2). ヒヒイロカネ doing both triggers both,
// resolved in any order (rulings Q2867, Q2868). Two partners found together both trigger their Fanfares, and each then sees
// the other on the field (CP05-033 rulings Q2889, Q2891).)
import { defineCard, whenThisIsFinalUncapped, whenThisIsUncapped } from "../helpers";
import { costAtMost, isFollower } from "../targets";

export default defineCard({
  keywords: ["finalUncap"],
  abilities: [
    whenThisIsUncapped({
      *resolve(fx) {
        yield* fx.draw(2);
        const [card] = yield* fx.chooseCards(fx.game.cards(fx.controller, "hand"), 1, 1);
        if (card !== undefined) yield* fx.putOnDeck([card], "bottom");
      },
    }),
    whenThisIsFinalUncapped({
      *resolve(fx) {
        yield* fx.search((id) => isFollower(fx.game, id) && costAtMost(2)(fx.game, id), { max: 2, to: "field", distinctNames: true });
      },
    }),
  ],
});
