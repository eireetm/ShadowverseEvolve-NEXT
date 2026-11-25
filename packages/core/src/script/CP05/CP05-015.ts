// CP05-015 フォレストレンジャー・ウェルダー — Forestcraft follower, 1, 2/1. グラブル・土属性.
// 自分のエボルヴデッキの表向きの土属性・エボルヴフォロワーが4枚以上である限り、これは【突進】と「【攻撃時】『土晶のエレメント』1枚を
// EXエリアに置く」を持つ。
// ファンファーレ『土晶のエレメント』1枚をEXエリアに置く。自分のエボルヴデッキの裏向きの土属性・エボルヴフォロワー1枚を表向きにしてよい。
// (While there are at least 4 faceup earth evolved followers in your evolve deck — faceup cards there count where the text
// names them, CR 4.6.3; a 全属性 one is an earth one, CR JP 14.6.2.2; evolved amulets and advanced cards are not evolved
// followers — this has Rush and "Strike - Put a 土晶のエレメント into your EX area": a passive, valid on the field only
// (CR 10.3.5), so the Strike exists, and triggers, only while the condition holds (BP09-049 / BP13-033 rulings). Fanfare - Put
// a 土晶のエレメント into your EX area; you may turn a facedown earth evolved follower in your evolve deck faceup (a choice,
// not a selection).)
import type { CardId, PlayerId } from "../../model/ids";
import type { GameReader } from "../../engine/query";
import { defineCard, fanfare, strike } from "../helpers";
import { EARTH_ELEMENT, earthEvolvedFollower, faceUpEarthEvolved } from "./shared";

/** The count is part of working out this card's keywords (selfKeywords): the shared count doesn't ask `info`. */
const fourEarthFaceUp = (g: GameReader, p: PlayerId): boolean => faceUpEarthEvolved(g, p) >= 4;

/** The passive works on the field only (CR 10.3.5): in the hand or the deck this card has no Rush (e.g. for a search). */
const active = (g: GameReader, self: CardId): boolean => g.card(self)?.zone === "field" && fourEarthFaceUp(g, g.controller(self));

const earthStrike = strike({
  *resolve(fx) {
    yield* fx.tokensToEx([EARTH_ELEMENT]);
  },
});

export default defineCard({
  selfKeywords: (g, self) => (active(g, self) ? ["rush"] : []),
  quotedWhile: active,
  abilities: [
    { ...earthStrike, trigger: (e, me, g) => fourEarthFaceUp(g, me.controller) && earthStrike.trigger(e, me, g) },
    fanfare({
      *resolve(fx) {
        yield* fx.tokensToEx([EARTH_ELEMENT]);
        const facedown = fx.game.faceDownEvolveDeck(fx.controller).filter((id) => earthEvolvedFollower(fx.game, id));
        yield* fx.turnFaceup(yield* fx.chooseCards(facedown, 0, 1));
      },
    }),
  ],
});
