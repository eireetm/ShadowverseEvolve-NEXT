// CP05-099 星界の艇人・ノア — Havencraft follower, 5, 1/1. グラブル・光属性.
// 【守護】（これが場に出たときか、自分のエンドフェイズにこれをアクトできる。相手は、アクト状態の【守護】を持つフォロワー以外を攻撃できない）
// ファンファーレこれは攻撃力+X/体力+Xする。Xは「自分のPP最大値」である。
// (Ward (the parenthesis is reminder text, CR 2.6.2). Fanfare - Give this +X/+X, X = your maximum play points as it resolves
// (CR 5.2.1.1); with no duration it lasts while this stays on the field (CR 10.2.1.2, 4.1.4). Gone from the field by then:
// nothing (CR 1.3.2).)
import { defineCard, fanfare } from "../helpers";

export default defineCard({
  keywords: ["ward"],
  abilities: [
    fanfare({
      *resolve(fx) {
        if (fx.game.card(fx.self)?.zone !== "field") return;
        const x = fx.game.state.players[fx.controller].maxPlayPoints;
        yield* fx.giveStats(fx.self, x, x);
      },
    }),
  ],
});
