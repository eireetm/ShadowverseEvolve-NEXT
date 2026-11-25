// CP05-053 アルス･グローリア — Runecraft spell, 1. グラブル・土属性・光属性・闇属性.
// 自分のデッキの上4枚を見る。その中から、土属性・カードか光属性・カードか闇属性・カード1枚を公開して手札に加えてよい。残りを好きな順にデッキの
// 下に置く。
// (Look at the top 4 cards of your deck; you may reveal an earth, light or dark card among them (any of the three; 全属性 ones too,
// CR JP 14.6.2.2) and add it to your hand; put the rest on the bottom of your deck in any order (CR 5.11, 5.21).)
import type { CardId } from "../../model/ids";
import type { GameReader } from "../../engine/query";
import { defineCard, lookAtTopCards, spell } from "../helpers";
import { hasTrait } from "../targets";

const earthLightOrDark = (g: GameReader, id: CardId) => hasTrait("土属性")(g, id) || hasTrait("光属性")(g, id) || hasTrait("闇属性")(g, id);

export default defineCard({
  abilities: [
    spell({
      *resolve(fx) {
        yield* lookAtTopCards(fx, 4, { filter: earthLightOrDark, to: "hand" });
      },
    }),
  ],
});
