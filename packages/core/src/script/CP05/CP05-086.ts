// CP05-086 自由を駆ける漢・スカル — Abysscraft follower, 1, 2/2. グラブル・土属性.
// 自分のエボルヴデッキの表向きの土属性・エボルヴフォロワーが4枚以上である限り、これは【疾走】を持つ。
// ファンファーレ自分のエボルヴデッキの裏向きの土属性・エボルヴフォロワー1枚を表向きにしてよい。
// (While there are at least 4 faceup earth (or 全属性, CR JP 14.6.2.2) evolved follower cards in your evolve deck area, this has Storm:
// a passive of a follower, valid on the field only (CR 10.3.5; the exception of CR 12.3.6 is for Quick), so not in the hand or the
// deck; it applies as soon as the count is reached, so a follower that entered this turn may attack at once (CR 12.9.2). An evolved
// amulet or an advanced card isn't an evolved follower (BP06-018, BP17-116 rulings). Fanfare - You may turn a facedown earth evolved
// follower in your evolve deck faceup: no longer part of the evolve deck, it can't be evolved into (CR 4.6.3); a choice, not a
// selection by the ability. The count reads types without the cards' full information, which would compute this card's keywords
// again.)
import { defineCard, fanfare } from "../helpers";
import { earthEvolvedFollower, faceUpEarthEvolved } from "./shared";

export default defineCard({
  // The shared count reads types and traits only, not `info` (which would compute these keywords again).
  selfKeywords: (g, self) => (g.card(self)?.zone === "field" && faceUpEarthEvolved(g, g.controller(self)) >= 4 ? ["storm"] : []),
  abilities: [
    fanfare({
      *resolve(fx) {
        const g = fx.game;
        const facedown = g.faceDownEvolveDeck(fx.controller).filter((id) => earthEvolvedFollower(g, id));
        yield* fx.turnFaceup(yield* fx.chooseCards(facedown, 0, 1));
      },
    }),
  ],
});
