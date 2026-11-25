// CP05-026 ドラゴンナイツ — Swordcraft spell, 5. グラブル・火属性・水属性・風属性・土属性.
// これをプレイする際、コストを+2してよい。
// 下記から2つまでチョイスする。コストを+2したなら、代わりに4つまで。
// 【1】『俊英の双剣士・ランスロット』1体を場に出す。【2】『不撓不屈の騎士・ヴェイン』1体を場に出す。【3】『竜殺しの騎士・ジークフリート』1体を場に
// 出す。【4】『炎帝・パーシヴァル』1体を場に出す。
// (You may play this for 2 more play points — an optional cost chosen while playing it (CR 10.6.2.2.2). Choose up to 2, or up
// to 4 if you did (CR 5.18.2.1, 10.6.2.2.3: the number is set when it is played, 5.18.3.1), each option once (ruling Q2885):
// summon a 俊英の双剣士・ランスロット (CP05-T03), a 不撓不屈の騎士・ヴェイン (T04), a 竜殺しの騎士・ジークフリート (T05), a
// 炎帝・パーシヴァル (T06) — tokens created on your field (CR 5.5.2.1, 9.1.2.2), in the listed order; a full field takes no more
// (CR 4.4.4.2), which doesn't make an option unperformable. Their Fanfares trigger and resolve once the spell has (CR 12.4.3,
// 10.5.2.2); Siegfried and Percival's need an enemy follower to select (rulings Q2927, Q2928).)
import type { EffectContext } from "../../engine/effects/context";
import { defineCard, spell } from "../helpers";
import { LANCELOT, PERCIVAL, SIEGFRIED, VANE } from "./shared";

/** An option summoning one knight: its label is the token's name (the interface shows it in the card language). */
const knight = (id: string, name: string) => ({
  id,
  label: name,
  *resolve(fx: EffectContext) {
    yield* fx.summon([name]);
  },
});

export default defineCard({
  playOptions: [{ id: "plus2", label: "Play for 2 more play points", canPay: () => true, *pay() {}, costDelta: 2 }],
  abilities: [
    spell({
      modeCount: (_g, _c, _self, playOption) => (playOption === "plus2" ? 4 : 2),
      modes: [knight("lancelot", LANCELOT), knight("vane", VANE), knight("siegfried", SIEGFRIED), knight("percival", PERCIVAL)],
    }),
  ],
});
