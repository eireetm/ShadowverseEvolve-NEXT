// CP05-059 どこにでもいるフツーの女の子・メグ (evolved) — Dragoncraft, 2/2. グラブル・闇属性.
// 【進化時】自分の墓場の「これと同名を除く元のコスト2以下の闇属性・フォロワー」1枚を選ぶ。それを場に出す。
// (On Evolve - Select a dark follower card (全属性 too, CR JP 14.6.2.2) whose original cost — the printed one, CR 5.24.1 — is 2 or
// less, other than one named どこにでもいるフツーの女の子・メグ, in your cemetery and put it onto your field. Without one it can't
// be played (CR 10.6.2.3.3); with your field full it can, and the card stays in the cemetery (CR 4.4.4.2; BP03-024 ruling). The
// card put there has its Fanfare triggered (CR 12.4.3).)
import { defineCard, onEvolve } from "../helpers";
import { and, costAtMost, hasTrait, inYourZone, isFollower, named } from "../targets";
import { MEG } from "./shared";

export default defineCard({
  abilities: [
    onEvolve({
      targets: [inYourZone("cemetery", { filter: and(isFollower, costAtMost(2), hasTrait("闇属性"), (g, id) => !named(MEG)(g, id)) })],
      *resolve(fx) {
        const card = fx.targets[0]![0]!;
        if (fx.game.card(card)?.zone === "cemetery") yield* fx.putOntoField([card]);
      },
    }),
  ],
});
