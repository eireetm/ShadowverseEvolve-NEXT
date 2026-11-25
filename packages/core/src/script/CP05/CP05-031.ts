// CP05-031 花開く筋肉・フィオリト — Swordcraft follower, 2, 1/3. グラブル・土属性.
// 進化コスト0：これは進化する。この能力は自分のエボルヴデッキの表向きの土属性・エボルヴフォロワーが4枚以上なら使える。
// 【守護】
// ファンファーレ『土晶のエレメント』1枚をEXエリアに置く。自分のエボルヴデッキの裏向きの土属性・エボルヴフォロワー1枚を表向きにしてよい。
// (Evolve (0), only with at least 4 faceup earth (or 全属性, CR JP 14.6.2.2) evolved followers in your evolve deck — not evolved
// amulets or advanced cards (BP22-026 rulings). Ward. Fanfare - Put a 土晶のエレメント (CP05-T11) into your EX area (none when it is
// full, CR 4.8.3.2); then you may turn a facedown earth evolved follower in your evolve deck faceup — its player's pick, not a
// selection, done even without the element (two sentences); a faceup one can't be used to evolve any more (CR 4.6.3).)
import { defineCard, evolveAbility, fanfare } from "../helpers";
import { hasTrait, isEvolvedFollower } from "../targets";
import { EARTH_ELEMENT, faceUpEarthEvolved } from "./shared";

export default defineCard({
  keywords: ["ward"],
  abilities: [
    evolveAbility(0, { condition: (g, c) => faceUpEarthEvolved(g, c) >= 4 }),
    fanfare({
      *resolve(fx) {
        yield* fx.tokensToEx([EARTH_ELEMENT]);
        const earth = fx.game.faceDownEvolveDeck(fx.controller).filter((id) => isEvolvedFollower(fx.game, id) && hasTrait("土属性")(fx.game, id));
        const chosen = yield* fx.chooseCards(earth, 0, 1);
        if (chosen.length > 0) yield* fx.turnFaceup(chosen);
      },
    }),
  ],
});
