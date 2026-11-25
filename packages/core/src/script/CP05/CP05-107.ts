// CP05-107 グラン＆ジータ — Neutral follower, 2, 2/3. グラブル・全属性.
// これが上限解放したとき、コスト3：相手の場のフォロワー1体を選ぶ。それに4ダメージ。それのリーダーに2ダメージ。『ヒヒイロカネ』1枚を
// EXエリアに置く。
// ファンファーレ手札のグラブル・カード1枚を捨てる：2枚引く。
// (When this uncaps (CR JP 14.6.4.1) — every element can uncap it, 全属性 being referenced as each attribute (CR JP 14.6.2.2),
// and so can ヒヒイロカネ; without Final Uncap it never final-uncaps, so ヒヒイロカネ triggers this once — {[cost03]}: select an
// enemy follower on the field and deal it 4 damage, deal 2 damage to its leader (that of its controller), and put a ヒヒイロカネ
// into your EX area (none when it is full, CR 4.8.3.2). Without an enemy follower to select it can't be played: no leader damage,
// no ヒヒイロカネ (ruling Q2925, CR 10.6.2.3.3, 10.7.3.2). Paying the 3 play points is the controller's option; not paid, it has
// no effect (CR 10.4.7.4). Fanfare - Discard a Granblue card: draw 2 cards (an optional process too, CR 10.4.7.4); this card being
// 全属性, the card is discarded by a dark card's ability (CR JP 14.6.2.2). Also printed as CP05-U11
// 「十天衆を総べし者・グラン＆ジータ」, an alternate name (CR 2.13).)
import { discardA, playPointsCost } from "../costs";
import { defineCard, fanfare, whenThisIsUncapped } from "../helpers";
import { enemyFollower, hasTrait } from "../targets";
import { HIHIIROKANE } from "./shared";

export default defineCard({
  abilities: [
    whenThisIsUncapped({
      targets: [enemyFollower()],
      cost: playPointsCost(3),
      *resolve(fx) {
        const target = fx.targets[0]![0]!;
        const leader = fx.game.leader(fx.game.controller(target));
        yield* fx.dealDamage(target, 4);
        yield* fx.dealDamage(leader, 2);
        yield* fx.tokensToEx([HIHIIROKANE]);
      },
    }),
    fanfare({
      cost: discardA(hasTrait("グラブル")),
      *resolve(fx) {
        yield* fx.draw(2);
      },
    }),
  ],
});
