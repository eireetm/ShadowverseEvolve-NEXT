import { createEngine, type MainAction } from "@sve/core";
import { ALL_CARDS, ALL_SCRIPTS } from "@sve/core/sets";
import { drive, type Driver } from "@sve/core/testing";
import { describe, expect, it } from "vitest";
import { Catalog } from "../src/app/catalog";
import { summarizeAbility } from "../src/engine/game-host";
import type { DecisionInfo, GameUpdate } from "../src/engine/protocol";
import { actionLabel } from "../src/game/labels";
import { translate } from "../src/i18n";

// A card's menu items (game/labels.ts): a card that can evolve more than one way now says each way's cost. BP19-082 has
// "Evolve (1)" and, once summoned from the cemetery, "Evolve (0)" (BP19-080 summons it from there).

const engine = createEngine({ cards: ALL_CARDS, scripts: ALL_SCRIPTS });
const catalog = new Catalog(engine.db.all().map((def) => ({ ...def, status: engine.implementationStatus(def.id) })));

/** The Chinese menu items of a card's evolve actions (by play points), with the abilities summed up as the worker does. */
function evolveItems(t: Driver, ref: string): string[] {
  const decision = t.game.decision!;
  if (decision.type !== "mainPhase") throw new Error(`expected a main phase, got ${decision.type}`);
  const card = t.id(ref);
  const actions = decision.actions.filter((a): a is Extract<MainAction, { type: "evolve" }> => a.type === "evolve" && a.card === card && !a.useEvolutionPoint);
  const info: DecisionInfo = { decision, cards: {}, abilities: {} };
  for (const a of actions) {
    const ref = t.game.reader().info(a.card).abilities[a.ability];
    info.abilities[`${a.card}:${a.ability}`] = summarizeAbility(ref?.ability, ref?.def ?? "");
    info.cards[a.evolveCard] = { def: t.game.state.cards[a.evolveCard]!.def, printing: null };
  }
  return actions.map((a) => actionLabel(a, info, {} as GameUpdate, catalog, "cn", (key, params) => translate("zh", key, params)));
}

describe("an evolve menu item", () => {
  it("says which way when there are two: each one's cost", () => {
    const t = drive(engine, { me: { field: ["BP19-080"], cemetery: ["BP19-082"], evolveDeck: ["BP19-083"], playPoints: 1 } }).activate("BP19-080").pick("BP19-082").flush();
    expect(evolveItems(t, "BP19-082")).toEqual(["进化 （1） → 冥府中尉", "进化 （0） → 冥府中尉"]);
  });

  it("is just 'Evolve' with one way", () => {
    expect(evolveItems(drive(engine, { me: { field: ["BP19-082"], evolveDeck: ["BP19-083"], playPoints: 1 } }), "BP19-082")).toEqual(["进化 → 冥府中尉"]);
  });
});
