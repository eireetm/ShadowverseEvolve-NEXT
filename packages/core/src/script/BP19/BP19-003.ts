// BP19-003 Wimael, Redolent Enforcer — Forestcraft follower, 6, 4/5. 八獄・植物族・虫族.
// {[fanfare]} Select an enemy follower on the field and deal it 4 damage.
// {[lastwords]} Summon this. (The card in the cemetery, CR 4.1.4.1; its Fanfare triggers again, CR 12.4.3. Onto its owner's
// field: "onto the field" names no player, CR 4.1.6, as the same Japanese text's official English says on BP04-047.)
import { defineCard, fanfare, lastWords } from "../helpers";
import { enemyFollower } from "../targets";

export default defineCard({
  abilities: [
    fanfare({
      targets: [enemyFollower()],
      *resolve(fx) {
        yield* fx.dealDamage(fx.targets[0]![0]!, 4);
      },
    }),
    lastWords({
      *resolve(fx) {
        const c = fx.game.card(fx.self);
        if (c?.zone === "cemetery") yield* fx.putOntoField([fx.self], c.owner);
      },
    }),
  ],
});
