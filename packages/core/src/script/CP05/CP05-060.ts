// CP05-060 天穿の銃槍騎・ラスティナ — Dragoncraft follower, 3, 1/5. グラブル・土属性.
// これが上限解放したとき、相手の場のフォロワー1体を選ぶ。それにXダメージ。Xは「自分のエボルヴデッキの表向きの土属性・エボルヴフォロワーの
// 枚数」である。Xが4以上なら、それのリーダーに2ダメージ。
// ファンファーレ1枚引く。自分のエボルヴデッキの裏向きの土属性・エボルヴフォロワー1枚を表向きにしてよい。
// (When this uncaps (CR JP 14.6.4.1), select an enemy follower on the field and deal it X damage, X being the faceup earth
// evolved followers in your evolve deck as it resolves (全属性 ones too, CR JP 14.6.2.2). If X is at least 4, then deal 2 damage
// to its leader: another damage, after it (CR 10.6.2.8.2) — a follower the X damage took to 0 is still on the field until the
// rules are checked (CR 11.1.2); had it left, the leader of its last controller (CR 10.11.1). Without an enemy follower to
// select it can't be played, so no damage to the leader either (ruling Q2908). It has no Final Uncap: it uncaps once
// (CR JP 14.6.4.1, JP 14.6.4.2). Fanfare - Draw a card. You may turn a facedown earth evolved follower in your evolve deck
// faceup (CR 4.6.3).)
import { defineCard, fanfare, whenThisIsUncapped } from "../helpers";
import { enemyFollower } from "../targets";
import { faceUpEarthEvolved } from "./shared";
import { leaderOf, turnEarthEvolvedFaceup } from "./dragon-shared";

export default defineCard({
  abilities: [
    whenThisIsUncapped({
      targets: [enemyFollower()],
      *resolve(fx) {
        const target = fx.targets[0]![0]!;
        const leader = leaderOf(fx, target);
        const x = faceUpEarthEvolved(fx.game, fx.controller);
        yield* fx.dealDamage(target, x);
        if (x >= 4) yield* fx.dealDamage(leader, 2);
      },
    }),
    fanfare({
      *resolve(fx) {
        yield* fx.draw(1);
        yield* turnEarthEvolvedFaceup(fx, 1);
      },
    }),
  ],
});
