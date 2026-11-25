// CP05-102 星跡の巡礼者・ソフィア (evolved) — Havencraft, 4/4. グラブル・水属性.
// 【守護】（これが場に出たときか、自分のエンドフェイズにこれをアクトできる。相手は、アクト状態の【守護】を持つフォロワー以外を攻撃できない）
// 【進化時】自分のデッキから元のコスト3以下のQ起動能力を持つフォロワー1枚を探し、場に出す。
// (Ward (reminder text, CR 2.6.2). On Evolve - Search your deck for a follower of original cost 3 or less (CR 5.24.1) with a
// {[q]} activated ability (CR 12.3.3) and put it onto your field. "Has" is the printed one, wherever it works: one valid only in
// the hand counts, and Quick alone (CR 12.3.2) doesn't (GameReader.hasQuickActivatedAbility). With a condition besides the
// number it may go unfound (CR 4.1.2.2) and the found card is revealed (CR 5.8.1.2); the deck is shuffled either way
// (CR 5.8.2). Its Fanfare triggers (CR 12.4.3). Super-evolving triggers it too (CP05-092's ruling Q2872).)
import { defineCard, onEvolve } from "../helpers";
import { costAtMost, isQuickActivatedFollower } from "../targets";

export default defineCard({
  keywords: ["ward"],
  abilities: [
    onEvolve({
      *resolve(fx) {
        const g = fx.game;
        yield* fx.search((id) => isQuickActivatedFollower(g, id) && costAtMost(3)(g, id), { to: "field" });
      },
    }),
  ],
});
