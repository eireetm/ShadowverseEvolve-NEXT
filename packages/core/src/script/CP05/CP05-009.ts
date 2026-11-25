// CP05-009 清新なる銃設計士・ククル — Forestcraft follower, 2, 2/2. グラブル・水属性.
// 進化コスト1：これは進化する。
// ファンファーレ自分の墓場のQ起動能力を持つフォロワーが7枚以上なら、『ガンパウダーミキサー・クムユ』1体を場に出す。
// Q起動コスト1手札のこれを捨てる：相手のリーダーすべてに2ダメージ。
// (Evolve (1). Fanfare - If there are at least 7 followers with a quick activated ability in your cemetery (counted as it
// resolves, this card on the field not among them), summon a ガンパウダーミキサー・クムユ — none with a full field, CR 4.4.4.2.
// Quick activate (1), discard this card from your hand: deal 2 damage to each enemy leader — valid in the hand, ruling Q2876,
// CR 10.3.5. The text after the line describes the token, CR 2.9.2.)
import { discardThis } from "../costs";
import { activated, defineCard, evolveAbility, fanfare } from "../helpers";
import { KUMUYU, quickFollowersInCemetery } from "./shared";

export default defineCard({
  abilities: [
    evolveAbility(1),
    fanfare({
      condition: (g, p) => quickFollowersInCemetery(g, p) >= 7,
      *resolve(fx) {
        yield* fx.summon([KUMUYU]);
      },
    }),
    activated(
      { playPoints: 1, custom: discardThis },
      {
        quick: true,
        validIn: ["hand"],
        *resolve(fx) {
          yield* fx.dealDamage(fx.game.leader(fx.game.opponent(fx.controller)), 2);
        },
      },
    ),
  ],
});
