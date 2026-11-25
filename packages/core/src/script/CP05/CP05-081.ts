// CP05-081 降魔の操者・ダヌア (evolved) — Abysscraft, 2/2. グラブル・光属性.
// 【進化時】自分のデッキから元のコスト5のグラブル・フォロワー1枚を探し、手札に加える。
// (On Evolve - Search your deck for a Granblue follower whose original cost (元のコスト, CR 5.24.1) is 5 and put it into your hand. A
// search with a condition: the card may be left unfound (CR 4.1.2.2), is revealed (CR 5.8.1.2), then the deck is shuffled (CR 5.8.2).)
import { defineCard, onEvolve } from "../helpers";
import { granblueCost5 } from "./shared";

export default defineCard({
  abilities: [
    onEvolve({
      *resolve(fx) {
        yield* fx.search((id) => granblueCost5(fx.game, id), { to: "hand" });
      },
    }),
  ],
});
