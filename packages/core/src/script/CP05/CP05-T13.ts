// CP05-T13 光晶のエレメント — Neutral treasure token (CR JP 14.6.1). グラブル・光属性.
// 起動コスト0：自分の場の光属性・フォロワー1体を選ぶ。それは上限解放する。それが【最終上限解放可能】を持ち、上限解放していたなら、
// 代わりに最終上限解放する。
// ({[act]} {[cost00]}: select a light (or 全属性, CR JP 14.6.2.2) follower on your field; it uncaps; if it has Final Uncap and was
// uncapped, it final-uncaps instead (CR JP 14.6.4). Its ability works in the EX area only, CR JP 14.6.1.1.3.)
import { defineCard, uncapAbility } from "../helpers";

export default defineCard({
  abilities: [uncapAbility("光属性", "instead")],
});
