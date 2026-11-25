// CP05-096 シュヴァリエ・マグナ — Havencraft amulet, 3. グラブル・光属性.
// ファンファーレ自分のデッキの上1枚を公開する。光属性・カードを公開したなら、自分のPP最大値を+1する。
// 起動これをアクト墓場に置く：『光晶のエレメント』1枚をEXエリアに置く。1枚引く。この能力は自分の場の元のコスト5のグラブル・フォロワーが3体以
// 上なら使える。
// (Fanfare - Reveal the top card of your deck (it stays there, CR 5.21.1); if it is a light card (or 全属性, CR JP 14.6.2.2), your
// maximum play points +1 (up to 10, CR 3.2.4.1); otherwise nothing (ruling Q2912). {[act]} {[engage]} this, put it into the
// cemetery (BP01-108's wording): put a 光晶のエレメント into your EX area, draw a card — only with at least 3 Granblue followers
// of original cost 5 on your field (CR 5.24.1).)
import { activated, defineCard, fanfare } from "../helpers";
import { hasTrait } from "../targets";
import { granblueCost5OnField } from "./haven-shared";
import { LIGHT_ELEMENT } from "./shared";

export default defineCard({
  abilities: [
    fanfare({
      *resolve(fx) {
        const top = fx.topCards(1);
        yield* fx.reveal(top);
        if (top.some((id) => hasTrait("光属性")(fx.game, id))) yield* fx.increaseMaxPlayPoints(1);
      },
    }),
    activated(
      { engageSelf: true, burySelf: true },
      {
        condition: (g, c) => granblueCost5OnField(g, c) >= 3,
        *resolve(fx) {
          yield* fx.tokensToEx([LIGHT_ELEMENT]);
          yield* fx.draw(1);
        },
      },
    ),
  ],
});
