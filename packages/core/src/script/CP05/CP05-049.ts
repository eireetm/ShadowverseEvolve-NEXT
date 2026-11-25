// CP05-049 妄想少女A・ルナール — Runecraft follower, 2, 2/2. グラブル・闇属性.
// 進化コスト2：これは進化する。
// これが上限解放したとき、自分の墓場のグラブル・フォロワー1枚を選ぶ。それを手札に加える。
// (Evolve {[cost02]}. When this uncaps (CR JP 14.6.4.1), select a Granblue follower card in your cemetery and put it into your
// hand; not played without one (CR 10.6.2.3.3). It has no Final Uncap: ヒヒイロカネ only uncaps it. Evolved, it stays uncapped
// (CR 5.16.2), so CP05-050's same ability doesn't trigger again.)
import { defineCard, evolveAbility } from "../helpers";
import { uncappedReturnsGranblue } from "./rune-shared";

export default defineCard({
  abilities: [evolveAbility(2), uncappedReturnsGranblue],
});
