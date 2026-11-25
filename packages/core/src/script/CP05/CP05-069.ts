// CP05-069 灰白の豹・アイル — Dragoncraft follower, 2, 3/2. グラブル・土属性.
// 【突進】
// 【攻撃時】1枚引く。
// ファンファーレ自分のエボルヴデッキの裏向きの土属性・エボルヴフォロワー1枚を表向きにしてよい。自分のエボルヴデッキの表向きの土属性・
// エボルヴフォロワーが4枚以上なら、これは攻撃力+2して、【指定攻撃】を持つ。
// (Rush. Strike - Draw a card. Fanfare - You may turn a facedown earth evolved follower in your evolve deck faceup (CR 4.6.3; 全属性
// ones are earth too, CR JP 14.6.2.2). Then, if at least 4 earth evolved followers there are faceup — counted after that
// (CR 10.6.2.8.2) — this gets +2/+0 and Assail, both under the condition, for as long as it stays on the field (no duration,
// CR 10.2.1.2).)
import { defineCard, fanfare, strike } from "../helpers";
import { faceUpEarthEvolved } from "./shared";
import { turnEarthEvolvedFaceup } from "./dragon-shared";

export default defineCard({
  keywords: ["rush"],
  abilities: [
    strike({
      *resolve(fx) {
        yield* fx.draw(1);
      },
    }),
    fanfare({
      *resolve(fx) {
        yield* turnEarthEvolvedFaceup(fx, 1);
        if (faceUpEarthEvolved(fx.game, fx.controller) < 4 || fx.game.card(fx.self)?.zone !== "field") return;
        yield* fx.giveStats(fx.self, 2, 0);
        yield* fx.giveKeyword(fx.self, "assail");
      },
    }),
  ],
});
