import type { CardView } from "@sve/core";
import { describe, expect, it } from "vitest";
import { Catalog } from "../src/app/catalog";
import type { CatalogCard } from "../src/engine/protocol";
import { cemeteryStats } from "../src/game/board/cemetery-stats";

// A cemetery's cards counted: printed values, each of a card's traits, in the order the window shows them.

const def = (id: string, cost: number | null, cls: string, type: string, traits: string[] = [], extra: Partial<CatalogCard> = {}): CatalogCard =>
  ({ id, printings: [id], names: {}, cost, class: cls, type, traits, ...extra }) as unknown as CatalogCard;

const catalog = new Catalog([
  def("f1", 1, "Dragoncraft", "follower", ["指揮官"]),
  def("f2", 2, "Dragoncraft", "follower", ["指揮官", "レヴィオン"]),
  def("s1", 2, "Neutral", "spell", ["指揮官"]),
  def("a1", 5, "Neutral", "amulet", ["指揮官"]),
  def("s2", 1, "Swordcraft", "spell", ["レヴィオン"]),
  def("bare", 3, "Swordcraft", "follower"),
  def("evolved", null, "Dragoncraft", "follower", ["指揮官"], { evolved: true }),
  def("front", 4, "Runecraft", "follower", ["学院"], { backFace: "back" } as Partial<CatalogCard>),
  def("back", 7, "Runecraft", "spell", ["魔界"], { frontFace: "front" } as Partial<CatalogCard>),
]);

const card = (id: string, cardDef: string, backFace = false): CardView => ({ id, hidden: false, def: cardDef, printing: cardDef, backFace, evolvedWith: null, cost: 99 }) as unknown as CardView;
const cards = (...defs: string[]): CardView[] => defs.map((d, i) => card(`c${i}`, d));

describe("a cemetery's stats", () => {
  it("count each cost, class, card type and trait, the card's printed ones (not the view's cost)", () => {
    const stats = cemeteryStats(cards("f1", "f1", "f2", "s1", "a1", "s2"), catalog);
    expect(stats.total).toBe(6);
    expect(stats.costs).toEqual([
      { key: 1, n: 3 },
      { key: 2, n: 2 },
      { key: 5, n: 1 },
    ]);
    expect(stats.classes).toEqual([
      { key: "Dragoncraft", n: 3 },
      { key: "Neutral", n: 2 },
      { key: "Swordcraft", n: 1 },
    ]);
    expect(stats.types).toEqual([
      { key: "follower", n: 3 },
      { key: "spell", n: 2 },
      { key: "amulet", n: 1 },
    ]);
  });

  it("a trait says how many of each card type; a card of two traits counts in both", () => {
    const { traits } = cemeteryStats(cards("f1", "f1", "f2", "s1", "a1", "s2"), catalog);
    expect(traits).toEqual([
      {
        key: "指揮官",
        n: 5,
        types: [
          { key: "follower", n: 3 },
          { key: "spell", n: 1 },
          { key: "amulet", n: 1 },
        ],
      },
      {
        key: "レヴィオン",
        n: 2,
        types: [
          { key: "follower", n: 1 },
          { key: "spell", n: 1 },
        ],
      },
    ]);
  });

  it("the most first; card types always followers, spells, amulets; only what is there", () => {
    const stats = cemeteryStats(cards("s1", "a1", "a1", "a1", "f1"), catalog);
    expect(stats.types.map((t) => t.key)).toEqual(["follower", "spell", "amulet"]);
    expect(stats.classes.map((c) => c.key)).toEqual(["Neutral", "Dragoncraft"]);
    expect(cemeteryStats(cards("a1"), catalog).traits[0]!.types).toEqual([{ key: "amulet", n: 1 }]);
  });

  it("a card without a cost comes last; one without a trait counts everywhere else", () => {
    const stats = cemeteryStats(cards("evolved", "f1", "bare"), catalog);
    expect(stats.costs).toEqual([
      { key: 1, n: 1 },
      { key: 3, n: 1 },
      { key: null, n: 1 },
    ]);
    expect(stats.traits).toEqual([{ key: "指揮官", n: 2, types: [{ key: "follower", n: 2 }] }]);
    expect(stats.total).toBe(3);
  });

  it("a double-faced card with its back up counts as its back; a card of no known definition only in the total", () => {
    const stats = cemeteryStats([card("a", "front", true), card("b", "front"), card("c", "nowhere")], catalog);
    expect(stats.total).toBe(3);
    expect(stats.costs).toEqual([
      { key: 4, n: 1 },
      { key: 7, n: 1 },
    ]);
    expect(stats.traits.map((t) => t.key).sort()).toEqual(["学院", "魔界"].sort());
  });

  it("an empty cemetery", () => {
    expect(cemeteryStats([], catalog)).toEqual({ total: 0, costs: [], classes: [], types: [], traits: [] });
  });
});
