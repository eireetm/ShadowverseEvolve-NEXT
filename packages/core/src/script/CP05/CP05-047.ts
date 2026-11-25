// CP05-047 楽隠居の元国王・フォリア — Runecraft follower, 4, 3/5. グラブル・水属性.
// ファンファーレ自分の墓場のQ起動能力を持つフォロワーが7枚以上なら、『ハクタク』1体を場に出す。
// Q起動コスト0：このターン、次に自分がQ起動能力をプレイする際、コストを-1する。この能力は1ターンに1回使える。
// (Fanfare - If there are at least 7 followers with a quick activated ability in your cemetery (printed, CR 12.3.3; those valid
// only in the hand too) when it resolves, summon a ハクタク (CP05-T07); a full field creates none (CR 4.4.4.2). {[q]} {[act]}
// {[cost00]}: the next quick activated ability you play this turn costs 1 less (never below 0, CR 1.3.2.2.1) — used up by that
// one even when it costs nothing anyway, as BP03-038's "the next spell you play this turn" is (its ruling Q5), so two of these
// don't make one ability cost 2 less; not by a treasure's activated ability, which isn't quick. With CP05-040's passive both
// apply: two cost changes, each applied once (CR 10.2.1.3.3, 10.10.2.3). Once per turn.)
import { activated, defineCard, fanfare } from "../helpers";
import { HAKUTAKU, quickFollowersInCemetery } from "./shared";

export default defineCard({
  abilities: [
    fanfare({
      condition: (g, c) => quickFollowersInCemetery(g, c) >= 7,
      *resolve(fx) {
        yield* fx.summon([HAKUTAKU]);
      },
    }),
    activated(
      { playPoints: 0 },
      {
        quick: true,
        oncePerTurn: true,
        *resolve(fx) {
          yield* fx.nextQuickAbilityCostsLess(1);
        },
      },
    ),
  ],
});
