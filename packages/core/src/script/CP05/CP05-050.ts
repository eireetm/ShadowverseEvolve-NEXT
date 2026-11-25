// CP05-050 妄想少女A・ルナール (evolved) — Runecraft, 3/3. グラブル・闇属性.
// これが上限解放したとき、自分の墓場のグラブル・フォロワー1枚を選ぶ。それを手札に加える。
// 【進化時】自分の場の他のグラブル・フォロワー1体を選ぶ。自分のデッキから「それと同名のカード」1枚を探し、場に出す。それは「自分のエンドフェイズが
// 来たとき、これは消滅する」を持つ。
// (When this uncaps (CR JP 14.6.4.1), select a Granblue follower card in your cemetery and put it into your hand (CP05-049's).
// On Evolve - Select another Granblue follower on your field (not played without one, CR 10.6.2.3.3). Search your deck for a
// card with the same name as it has (CR 10.9.1.1.1 for an evolved one) and put it onto your field: one may not be found (CR
// 4.1.2.2), the found card is revealed and the deck shuffled (CR 5.8.1.2, 5.8.2), and with a full field it stays in the deck
// (CR 4.4.4.2); a token selected has no such card. The card put there gains "At the start of your end phase, banish this" — its
// own ability while it stays on the field (CR 10.2.1.2, 10.9.2), also when this card has left the field (ruling Q2904), "your"
// being its controller; with its own end-phase ability both trigger, in either order, and banishing it first doesn't stop the
// other (Q2903, CR 10.7.7).)
import { defineCard, onEvolve } from "../helpers";
import { anotherYourFollower, hasTrait } from "../targets";
import { uncappedReturnsGranblue } from "./rune-shared";

export default defineCard({
  abilities: [
    uncappedReturnsGranblue,
    onEvolve({
      targets: [anotherYourFollower({ filter: hasTrait("グラブル") })],
      *resolve(fx) {
        const follower = fx.targets[0]![0]!;
        if (fx.game.card(follower)?.zone !== "field") return;
        const names = fx.game.info(follower).names;
        const found = yield* fx.search((id) => fx.game.info(id).names.some((n) => names.includes(n)), { max: 1, to: "field" });
        for (const card of found) if (fx.game.card(card)?.zone === "field") yield* fx.grant(card, "banishAtEnd");
      },
    }),
  ],
});
