import { createEngine, type MainAction } from "@sve/core";
import { ALL_CARDS as CORE_CARDS, ALL_SCRIPTS } from "@sve/core/sets";
import { drive, type Driver } from "@sve/core/testing";
import { describe, expect, it } from "vitest";
import { Catalog } from "../src/app/catalog";
import { summarizeAbility } from "../src/engine/game-host";
import type { DecisionInfo, GameUpdate } from "../src/engine/protocol";
import { abilityLabel, actionLabel } from "../src/game/labels";
import { translate } from "../src/i18n";
import { withDataTexts } from "../../../tools/lib/card-texts";

// The cards with this machine's texts (not in the repository; the core has none): the checks of texts need them.
const ALL_CARDS = withDataTexts(CORE_CARDS);

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

describe("an advanced ability's menu item", () => {
  // The scripts write serve and Ride abilities as advanced ones: the item says the icon the card text prints, in its words.
  const label = (def: string, lang: "zh" | "en" | "ja"): string => {
    const ability = (ALL_SCRIPTS[def]?.abilities ?? []).find((a) => a.kind === "activated" && a.advanced);
    return abilityLabel(summarizeAbility(ability, def, engine), (key, params) => translate(lang, key, params));
  };

  it("says 高等起动 / 吃饭 / 凭依 as the Chinese card texts do", () => {
    // BP14-018 《高等起动》《消费4》将这张卡消失, BP22-117 《吃饭》《消费1》, CP03-008 《凭依》《消费1》.
    expect(["BP14-018", "BP22-117", "CP03-008"].map((def) => label(def, "zh"))).toEqual(["高等起动 （4） 卡面上的cost", "吃饭 （1）", "凭依 （1）"]);
    expect(["BP14-018", "BP22-117", "CP03-008"].map((def) => label(def, "ja"))).toEqual(["アドバンス起動 （4） カードに書かれたコスト", "食事 （1）", "憑依 （1）"]);
    expect(label("BP22-117", "en")).toBe("Feed (1)");
  });

  it("finds every advanced ability's icon in its card text", () => {
    const icons = new Map<string, number>();
    for (const [def, script] of Object.entries(ALL_SCRIPTS)) {
      for (const a of script.abilities ?? []) {
        if (a.kind !== "activated" || !a.advanced) continue;
        const icon = summarizeAbility(a, def, engine).advancedIcon ?? "adv";
        icons.set(icon, (icons.get(icon) ?? 0) + 1);
        // The words of its icon are in each of its card's texts (the token explanations after "―" left out).
        const text = engine.db.get(def).text;
        const words = { adv: ["{[adv]}", "高等起动", "アドバンス起動"], feed: ["{[feed]}", "吃饭", "食事"], ride: ["{[ride]}", "凭依", "憑依"] }[icon]!;
        for (const lang of ["en", "cn", "ja"] as const) {
          const t = (text[lang] ?? "").split("―")[0]!;
          if (t && !words.some((w) => t.includes(w))) throw new Error(`${def} ${lang}: no ${icon} icon`);
        }
      }
    }
    expect(Object.fromEntries(icons)).toEqual({ adv: 4, feed: 110, ride: 26 });
  });
});
