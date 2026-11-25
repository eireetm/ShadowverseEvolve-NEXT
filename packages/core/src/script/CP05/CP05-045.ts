// CP05-045 神託の妖童・アルルメイヤ — Runecraft follower, 3, 3/3. グラブル・土属性.
// 進化コスト1：これは進化する。
// ファンファーレ『土晶のエレメント』1枚をEXエリアに置く。自分のリーダーは体力+2する。自分のエボルヴデッキの裏向きの土属性・エボルヴフォロワー1枚
// を表向きにしてよい。
// (Evolve {[cost01]}. Fanfare - Put a 土晶のエレメント (CP05-T11) into your EX area, give your leader {[defense]}+2, then you may
// turn a facedown earth evolved follower in your evolve deck faceup (全属性 ones too, CR JP 14.6.2.2; CR 4.6.3) — not a selection:
// the evolve deck is a non-public zone (CR 4.6.2). This card's own evolved card may be turned, which then can't be used to evolve
// (a faceup card is not part of the evolve deck, CR 4.6.3); evolved amulets and advanced cards aren't evolved followers. With a
// full EX area the element isn't put there and the rest is done (CR 1.3.2).)
import { defineCard, evolveAbility, fanfare } from "../helpers";
import { and, hasTrait, isEvolvedFollower } from "../targets";
import { EARTH_ELEMENT } from "./shared";

const earthEvolvedFollower = and(isEvolvedFollower, hasTrait("土属性"));

export default defineCard({
  abilities: [
    evolveAbility(1),
    fanfare({
      *resolve(fx) {
        yield* fx.tokensToEx([EARTH_ELEMENT]);
        yield* fx.giveLeaderDefense(fx.controller, 2);
        const candidates = fx.game.faceDownEvolveDeck(fx.controller).filter((id) => earthEvolvedFollower(fx.game, id));
        yield* fx.turnFaceup(yield* fx.chooseCards(candidates, 0, 1));
      },
    }),
  ],
});
