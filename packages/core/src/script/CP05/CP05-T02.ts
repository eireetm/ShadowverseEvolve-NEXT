// CP05-T02 フィル — Forestcraft spell token, 0. グラブル・風属性.
// 自分の場のグラブル・フォロワー1体を選ぶ。それは攻撃力+2/体力+2する。
// (Select a Granblue follower on your field and give it +2/+2 — for as long as it stays there, CR 10.2.1.2, 4.1.4. Played from
// the EX area, CR 8.2.1; not playable without one, CR 10.6.2.3.3.)
import { defineCard, spell } from "../helpers";
import { hasTrait, yourFollower } from "../targets";

export default defineCard({
  abilities: [
    spell({
      targets: [yourFollower({ filter: hasTrait("グラブル") })],
      *resolve(fx) {
        yield* fx.giveStats(fx.targets[0]![0]!, 2, 2);
      },
    }),
  ],
});
