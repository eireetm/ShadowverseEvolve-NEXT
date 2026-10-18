import { readCardTextFile, type CardTextFile } from "@sve/core";
import { ALL_CARDS as CORE_CARDS } from "@sve/core/sets";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cardText, Catalog } from "../src/app/catalog";
import type { CatalogCard } from "../src/engine/protocol";
import { serverHost, setHost, type Host } from "../src/host/api";
import { cardTextProblems, loadCardTexts, withShownTexts } from "../src/resources/card-texts";
import { hasDataTexts, withDataTexts } from "../../../tools/lib/card-texts";

// The card texts the page shows (resources/card-texts.ts): the engine has none; the player's public/text/<SET>_<lang>.json,
// else this machine's (the dev server's packages/core/data/<SET>_<lang>.json), each file a set's texts in its language as a
// whole. The card text shown falls back to the next language for a card a file doesn't list.

const core: CatalogCard[] = CORE_CARDS.map((def) => ({ ...def, status: "scripted" }));
/** The cards with this machine's texts (not in the repository): what the dev server's page shows without files of its own. */
const cards: CatalogCard[] = withDataTexts(core);
const text = (catalog: Catalog, id: string, lang: "en" | "cn" | "ja") => cardText(catalog.def(id)!, lang);
const file = (set: string, lang: CardTextFile["lang"], texts: Record<string, string>): CardTextFile =>
  readCardTextFile({ format: 1, set, lang, cards: texts }, { set, lang });

describe("the card texts shown", () => {
  it.skipIf(!hasDataTexts())("a file replaces its set's texts in its language as a whole", () => {
    const mine = new Catalog(withShownTexts(cards, [file("BP22", "cn", { "BP22-001": "我的译文。" })]));
    expect(text(mine, "BP22-001", "cn")).toBe("我的译文。");
    // A BP22 card the file doesn't list: no Chinese text, the English one shows.
    expect(mine.def("BP22-002")!.text.cn).toBeNull();
    expect(text(mine, "BP22-002", "cn")).toBe(cardText(new Catalog(cards).def("BP22-002")!, "en"));
    // The other languages of BP22, and other sets, keep the texts they had.
    expect(text(mine, "BP22-001", "ja")).toBe(text(new Catalog(cards), "BP22-001", "ja"));
    expect(text(mine, "BP01-001", "cn")).toBe(text(new Catalog(cards), "BP01-001", "cn"));
  });

  it.skipIf(!hasDataTexts())("can be a data file itself: then nothing changes", () => {
    const data = Object.fromEntries(cards.filter((c) => c.id.startsWith("BP22-")).map((c) => [c.id, c.text.en]));
    expect(withShownTexts(cards, [file("BP22", "en", data)])).toEqual(cards);
  });

  it("give an English text a file leaves out as empty, and reach a set's back faces; the engine's cards have none", () => {
    expect(core.find((c) => c.id === "BP22-001")!.text).toEqual({ en: "", cn: null, ja: null });
    const [english] = withShownTexts(
      cards.filter((c) => c.id === "BP22-001"),
      [file("BP22", "en", {})],
    );
    expect(english!.text.en).toBe("");
    const back = core.find((c) => c.id === "BP09-005_back")!;
    expect(withShownTexts([back], [file("BP09", "cn", { "BP09-005_back": "背面。" })])[0]!.text.cn).toBe("背面。");
  });

  it("are checked as the data's are: format, set and language as the file's name says, texts as strings", () => {
    expect(() => readCardTextFile({ format: 1, set: "BP22", lang: "cn", cards: {} }, { set: "BP22", lang: "ja" })).toThrow(/language cn/);
    expect(() => readCardTextFile({ format: 2, set: "BP22", lang: "cn", cards: {} })).toThrow(/format/);
    expect(() => readCardTextFile({ format: 1, set: "BP22", lang: "cn", cards: { "BP22-001": 3 } })).toThrow(/BP22-001/);
    expect(() => readCardTextFile({ format: 1, set: "BP22", lang: "cn", cards: [] })).toThrow(/not a card text file/);
  });
});

describe("reading the card texts", () => {
  afterEach(() => {
    setHost(serverHost);
    vi.unstubAllGlobals();
  });

  it("takes the player's file of a set and language over this machine's, and this machine's others", async () => {
    const machine = [
      { format: 1, set: "BP22", lang: "cn", cards: { "BP22-001": "本机的中文。", "BP22-002": "本机的另一张。" } },
      { format: 1, set: "BP22", lang: "ja", cards: { "BP22-001": "この機械の日本語。" } },
    ];
    const player: Record<string, unknown> = {
      "/text/BP22_cn.json": { format: 1, set: "BP22", lang: "cn", cards: { "BP22-001": "我的中文。" } },
      "/text/BP01_cn.json": { format: 1, set: "BP22", lang: "cn", cards: {} }, // named BP01: not used, told
    };
    setHost({ ...serverHost, builtInCardTexts: async () => machine, resourceUrl: (path: string) => `/${path}` } as Host);
    vi.stubGlobal("fetch", async (url: string) => (url in player ? new Response(JSON.stringify(player[url])) : new Response("", { status: 404 })));
    await loadCardTexts(["images/cards/BP01-001.png", "text/BP22_cn.json", "text/BP01_cn.json"]);
    const shown = new Catalog(withShownTexts(core));
    expect([text(shown, "BP22-001", "cn"), shown.def("BP22-002")!.text.cn, text(shown, "BP22-001", "ja")]).toEqual(["我的中文。", null, "この機械の日本語。"]);
    expect(cardTextProblems()).toEqual(["public/text/BP01_cn.json"]);
  });
});
