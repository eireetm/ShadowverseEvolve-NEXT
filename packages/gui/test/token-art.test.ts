import { createEngine } from "@sve/core";
import { ALL_CARDS, ALL_SCRIPTS } from "@sve/core/sets";
import { describe, expect, it } from "vitest";
import { Catalog } from "../src/app/catalog";
import { changedTokens, shownPrinting, withTokenArt } from "../src/app/token-art";

// Token art: the printing a token is shown with (the settings' choice; the look only, the game's token keeps its own).

const engine = createEngine({ cards: ALL_CARDS, scripts: ALL_SCRIPTS });
const catalog = new Catalog(engine.db.all().map((def) => ({ ...def, status: engine.implementationStatus(def.id) })));

describe("token art", () => {
  it("shows a token with the chosen printing, and nothing else changes", () => {
    const art = { "BP01-T03": "SD01-T01", "BP01-001": "PR-001", "BP01-T05": "BP01-T03" };
    // The Fairy token: the chosen printing, whatever the game gave it.
    expect(shownPrinting(catalog, art, "BP01-T03", "BP01-T03")).toBe("SD01-T01");
    // Not a token, or a printing that isn't the token's: as it is.
    expect(shownPrinting(catalog, art, "BP01-001", "BP01-001")).toBe("BP01-001");
    expect(shownPrinting(catalog, art, "BP01-T05", "BP01-T05")).toBe("BP01-T05");
    expect(shownPrinting(catalog, {}, "BP01-T03", "BP01-T03")).toBe("BP01-T03");
    expect(changedTokens(catalog, art)).toBe(1);
  });

  it("keeps no choice for a token's own printing", () => {
    expect(withTokenArt({ "BP01-T05": "SD02-T01" }, "BP01-T03", "SD01-T01", "BP01-T03")).toEqual({ "BP01-T05": "SD02-T01", "BP01-T03": "SD01-T01" });
    expect(withTokenArt({ "BP01-T03": "SD01-T01" }, "BP01-T03", "BP01-T03", "BP01-T03")).toEqual({});
  });

  it("lists every token with its printings: a reprint joins its token's definition", () => {
    const tokens = catalog.cards.filter((card) => card.token);
    expect(tokens.length).toBeGreaterThan(100);
    expect(tokens.every((card) => card.printings[0] === card.id)).toBe(true);
    expect(catalog.def("BP01-T03")!.printings).toEqual(expect.arrayContaining(["BP01-T03", "SD01-T01", "SP01-T01", "PR-108"]));
  });
});
