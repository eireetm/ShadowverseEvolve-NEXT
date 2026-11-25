// CP05-029 不滅の群青・ベアトリクス — Swordcraft follower, 6, 2/2. グラブル・土属性.
// 【疾走】
// これが上限解放したとき、下記から1つチョイスする。【1】自分のデッキから『真紅の穿光・ゼタ』1枚を探し、場に出す。【2】自分のPPを4回復する。
// (Storm. When this uncaps (CR JP 14.6.4.1), choose one (CR 5.18): (1) search your deck for a 真紅の穿光・ゼタ (CP05-025), put it
// onto your field, then shuffle — it need not be found (CR 4.1.2.2), and with a full field it stays in the deck (CR 4.4.4.2),
// which doesn't make the option unperformable; (2) recover 4 play points, not above the maximum (CR 5.15.1.1). It has no Final
// Uncap: ヒヒイロカネ only uncaps it (CR JP 14.6.4.2), and once uncapped nothing uncaps it again (CR JP 14.6.4.1).)
import { defineCard, whenThisIsUncapped } from "../helpers";
import { named } from "../targets";
import { ZETA } from "./shared";

export default defineCard({
  keywords: ["storm"],
  abilities: [
    whenThisIsUncapped({
      modes: [
        {
          id: "zeta",
          label: `Summon a ${ZETA} from your deck`,
          *resolve(fx) {
            yield* fx.search((id) => named(ZETA)(fx.game, id), { to: "field" });
          },
        },
        {
          id: "pp",
          label: "Recover 4 play points",
          *resolve(fx) {
            yield* fx.recoverPlayPoints(4);
          },
        },
      ],
    }),
  ],
});
