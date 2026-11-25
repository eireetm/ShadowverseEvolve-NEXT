// CP05-091 土の理・ガレヲン — Havencraft follower, 2, 2/2. グラブル・六竜・土属性.
// 進化コスト1：これは進化する。
// ファンファーレ自分のエボルヴデッキの裏向きの土属性・エボルヴフォロワー1枚を表向きにしてよい。自分のエボルヴデッキの表向きの土属性・エボ
// ルヴフォロワーが4枚以上なら、1枚引く。
// (Evolve (1). Fanfare - You may turn a facedown earth evolved follower in your evolve deck faceup (a 全属性 one is earth too,
// CR JP 14.6.2.2; not an evolved amulet nor an advanced card, CR 9.2 and BP08-110's ruling; CP05-092 itself may be it, and
// then it can't be used, CR 4.6.3). Then, if at least 4 faceup earth evolved followers are in your evolve deck (that one
// too), draw a card.)
import { defineCard, evolveAbility, fanfare } from "../helpers";
import { hasTrait, isEvolvedFollower } from "../targets";
import { faceUpEarthEvolved } from "./shared";

export default defineCard({
  abilities: [
    evolveAbility(1),
    fanfare({
      *resolve(fx) {
        const g = fx.game;
        const facedown = g.faceDownEvolveDeck(fx.controller).filter((id) => isEvolvedFollower(g, id) && hasTrait("土属性")(g, id));
        yield* fx.turnFaceup(yield* fx.chooseCards(facedown, 0, 1));
        if (faceUpEarthEvolved(fx.game, fx.controller) >= 4) yield* fx.draw(1);
      },
    }),
  ],
});
