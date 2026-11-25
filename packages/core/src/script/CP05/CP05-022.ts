// CP05-022 光の理・ル・オー (evolved) — Swordcraft, 4/4. グラブル・六竜・光属性.
// 【進化時】自分の墓場の元のコスト5のグラブル・フォロワー1枚を選ぶ。それを場に出す。
// 【超進化時】これは【オーラ】と「相手の場の【疾走】を持つフォロワーが攻撃したとき、それは攻撃力-5する」を持つ。
// (On Evolve - Select a Granblue follower that originally costs 5 in your cemetery and put it onto your field: without one it
// can't be played (CR 10.6.2.3.3); with a full field it can, and the card stays in the cemetery (CR 4.4.4.2, BP03-024 Q3).
// On Super-Evolve - This gains Aura and "Whenever an enemy follower on the field with Storm attacks, it gets -5 attack" (a gained
// text, as BP22-022, lost with this card's abilities, CR 10.9.1.2): Storm is checked when it attacks, the -5 has no duration
// (CR 10.2.1.2), resolved before the attack deals damage (CR 8.4.6, 8.4.9), also once this has left the field (CR 10.6.2.8.2.1);
// not a selection, so Aura doesn't stop it. Super-evolving triggers On Evolve too, the two in any order (rulings Q2871, Q2872).)
import { defineCard, onEvolve, onSuperEvolve } from "../helpers";
import { inYourZone } from "../targets";
import type { AutomaticAbility } from "../types";
import { granblueCost5 } from "./shared";

const STORM_CURB = "Whenever an enemy follower on the field with Storm attacks, it gets -5 attack.";

/** The gained text: an ability of this card once it has gained it (CR 10.9.1.2); the attacker is the trigger's data. */
const stormCurb: AutomaticAbility = {
  kind: "automatic",
  timing: "other",
  trigger: (e, me, game) =>
    !me.lookBack &&
    e.type === "attackDeclared" &&
    game.controller(e.attacker) !== me.controller &&
    game.hasGainedText(me.card, STORM_CURB) &&
    game.hasKeyword(e.attacker, "storm")
      ? [{ card: e.attacker }]
      : false,
  *resolve(fx) {
    const attacker = fx.data?.card;
    if (attacker !== undefined && fx.game.card(attacker)?.zone === "field") yield* fx.giveStats(attacker, -5, 0);
  },
};

export default defineCard({
  abilities: [
    onEvolve({
      targets: [inYourZone("cemetery", { filter: granblueCost5 })],
      *resolve(fx) {
        yield* fx.putOntoField(fx.targets[0]!);
      },
    }),
    onSuperEvolve({
      *resolve(fx) {
        if (fx.game.card(fx.self)?.zone !== "field") return;
        yield* fx.giveKeyword(fx.self, "aura");
        yield* fx.gainText(fx.self, STORM_CURB);
      },
    }),
    stormCurb,
  ],
});
