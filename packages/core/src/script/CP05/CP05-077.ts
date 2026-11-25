// CP05-077 幽想の少女・フェリ (evolved) — Abysscraft, 1/1. グラブル・闇属性.
// 【最終上限解放可能】
// これが最終上限解放したとき、コスト3：自分の場の他の闇属性・フォロワー2体まで選ぶ。それをスタンドする。
// 【進化時】1枚引く。
// (Final Uncap (CR JP 14.6.3). When this final-uncaps (CR JP 14.6.4.2), {[cost03]}: refresh up to 2 other dark (or 全属性) followers on
// your field — as CP05-076. An uncapped CP05-076 stays uncapped when it evolves (CR 5.16.2), so an element final-uncaps it then
// (CR JP 14.6.4.2). On Evolve - Draw a card.)
import { defineCard, onEvolve } from "../helpers";
import { feriRefreshes } from "./abyss-shared";

export default defineCard({
  keywords: ["finalUncap"],
  abilities: [
    feriRefreshes,
    onEvolve({
      *resolve(fx) {
        yield* fx.draw(1);
      },
    }),
  ],
});
