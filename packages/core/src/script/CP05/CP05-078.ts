// CP05-078 生滅の技巧・ネハン — Abysscraft follower, 5, 2/3. グラブル・光属性.
// ファンファーレ自分のデッキの上5枚を見る。その中から、「これと同名を除く元のコスト5のグラブル・フォロワー」1枚を場に出してよい。
// 残りを好きな順にデッキの下に置く。
// (Fanfare - Look at the top 5 cards of your deck (CR 5.11; all of them when fewer). You may summon a Granblue follower whose original
// cost (元のコスト, CR 5.24.1) is 5 and that isn't named 生滅の技巧・ネハン (CR 2.1.2) from among them; put the rest on the bottom of your
// deck in any order. With a full field the card isn't summoned (CR 4.4.4.2) and goes to the bottom with the rest; a summoned follower's
// Fanfare triggers (CR 12.4.3).)
import { defineCard, fanfare, lookAtTopCards } from "../helpers";
import { notNamedAs } from "./abyss-shared";
import { granblueCost5 } from "./shared";

export default defineCard({
  abilities: [
    fanfare({
      *resolve(fx) {
        const notThis = notNamedAs(fx.sourceDef);
        yield* lookAtTopCards(fx, 5, { filter: (g, id) => granblueCost5(g, id) && notThis(g, id), to: "field" });
      },
    }),
  ],
});
