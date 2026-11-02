import { createEngine, type CardMove, type GameEvent, type ZoneName } from "@sve/core";
import { ALL_CARDS, ALL_SCRIPTS } from "@sve/core/sets";
import { describe, expect, it } from "vitest";
import { Catalog, cardName } from "../src/app/catalog";
import type { GameUpdate, LogEntry } from "../src/engine/protocol";
import { describeEntry, shuffledPlacements, type LogLine } from "../src/game/log/format";
import { translate } from "../src/i18n";

// The log's lines for cards put into a deck (game/log/format.ts): where in it — the top, the bottom, its place from the
// top — as everyone sees it (CP01-006 puts its top card on the bottom); not when that deck is then shuffled (BP05-054 puts
// a card on top and shuffles: it went into the deck, nowhere in particular).

const engine = createEngine({ cards: ALL_CARDS, scripts: ALL_SCRIPTS });
const catalog = new Catalog(engine.db.all().map((def) => ({ ...def, status: engine.implementationStatus(def.id) })));

/** A card the viewer can't see moved from a zone of player 0 into their deck, at `position`. */
const intoDeck = (position: "top" | "bottom" | number | undefined, from: ZoneName = "deck"): CardMove => ({
  card: null,
  newCard: null,
  def: "",
  printing: "",
  owner: 0,
  from: { player: 0, zone: from, faceUp: false },
  to: { player: 0, zone: "deck", faceUp: false, ...(position !== undefined ? { position } : {}) },
  reason: "effect",
  before: null,
});

const entries = (...events: GameEvent[]): LogEntry[] => events.map((event, seq) => ({ seq, turn: 3, event, cards: {} }));

/** The lines of a log, in Chinese. */
function lines(log: LogEntry[]): string[] {
  const shuffled = shuffledPlacements(log);
  const ctx = { t: (key: Parameters<typeof translate>[1], params?: Record<string, string | number>) => translate("zh", key, params), catalog, lang: "cn" as const, uiLang: "zh" as const, update: { controllers: ["human", "human"] } as unknown as GameUpdate, shuffled };
  return log.flatMap((entry) => describeEntry(entry, ctx, false)?.text ?? []);
}

describe("the log: cards put into a deck", () => {
  it("says the top, the bottom, or the place from the top", () => {
    expect(lines(entries({ type: "cardsMoved", moves: [intoDeck("bottom")] }))).toEqual(["1 张卡：牌堆 → 牌堆底"]);
    expect(lines(entries({ type: "cardsMoved", moves: [intoDeck("top", "hand")] }))).toEqual(["1 张卡：手牌 → 牌堆顶"]);
    expect(lines(entries({ type: "cardsMoved", moves: [intoDeck(2, "cemetery")] }))).toEqual(["1 张卡：墓场 → 牌堆顶起第3张"]);
    expect(lines(entries({ type: "cardsMoved", moves: [intoDeck(0, "cemetery")] }))).toEqual(["1 张卡：墓场 → 牌堆顶"]);
    // Two places in one move: two parts.
    expect(lines(entries({ type: "cardsMoved", moves: [intoDeck("top", "hand"), intoDeck("bottom", "hand")] }))).toEqual(["1 张卡：手牌 → 牌堆顶 · 1 张卡：手牌 → 牌堆底"]);
  });

  it("says only the deck when that deck is shuffled right after, not when it is used or something is played first", () => {
    const shuffle: GameEvent = { type: "deckShuffled", player: 0 };
    expect(lines(entries({ type: "cardsMoved", moves: [intoDeck("top", "hand")] }, shuffle))).toEqual(["1 张卡：手牌 → 牌堆"]);
    // The other player's deck shuffled: this one's place stands.
    expect(lines(entries({ type: "cardsMoved", moves: [intoDeck("top", "hand")] }, { type: "deckShuffled", player: 1 }))).toEqual(["1 张卡：手牌 → 牌堆顶"]);
    const played: GameEvent = { type: "cardPlayed", player: 1, card: "x", def: "V1", from: "hand" };
    expect(lines(entries({ type: "cardsMoved", moves: [intoDeck("bottom")] }, played, shuffle))[0]).toBe("1 张卡：牌堆 → 牌堆底");
    const drawn: GameEvent = { type: "cardsMoved", moves: [{ ...intoDeck(undefined), from: { player: 0, zone: "deck", faceUp: false }, to: { player: 0, zone: "hand", faceUp: false }, reason: "draw" }] };
    expect(lines(entries({ type: "cardsMoved", moves: [intoDeck("top", "hand")] }, drawn, shuffle))[0]).toBe("1 张卡：手牌 → 牌堆顶");
  });
});

describe("the log: the cards a line names", () => {
  const nameOf = (def: string, lang: "cn" | "en" = "cn") => cardName(catalog.def(def), lang);
  const describeIn = (uiLang: "zh" | "en", event: GameEvent, cards: LogEntry["cards"], showAll = false) =>
    describeEntry(
      { seq: 1, turn: 1, event, cards },
      { t: (key, params) => translate(uiLang, key, params), catalog, lang: uiLang === "zh" ? "cn" : "en", uiLang, update: { controllers: ["human", "human"] } as unknown as GameUpdate },
      showAll,
    )!;
  /** What each link of a line covers, and its card. */
  const linksOf = (line: LogLine) => line.links.map((link) => [line.text.slice(link.start, link.end), link.card]);

  it("are links to them, wherever each language's message puts them; the words have no marks left", () => {
    const attack: GameEvent = { type: "attackDeclared", player: 0, attacker: "a", target: "b" };
    const cards = { a: { def: "BP01-001", printing: "BP01-001" }, b: { def: "BP01-LD01", printing: null } };
    const zh = describeIn("zh", attack, cards);
    expect(zh.text).toBe(`${nameOf("BP01-001")} 攻击 ${nameOf("BP01-LD01")}。`);
    expect(linksOf(zh)).toEqual([
      [nameOf("BP01-001"), { id: "a", def: "BP01-001", printing: "BP01-001" }],
      [nameOf("BP01-LD01"), { id: "b", def: "BP01-LD01", printing: null }],
    ]);
    const en = describeIn("en", attack, cards);
    expect(en.text).toBe(`${nameOf("BP01-001", "en")} attacks ${nameOf("BP01-LD01", "en")}.`);
    expect(linksOf(en).map(([name]) => name)).toEqual([nameOf("BP01-001", "en"), nameOf("BP01-LD01", "en")]);
    // A line whose names come after a player's name; several names of one line.
    const revealed = describeIn("zh", { type: "cardsRevealed", player: 1, cards: [{ id: "a", def: "BP01-001" }, { id: "b", def: "BP01-LD01" }] }, cards);
    expect(revealed.text).toBe(`玩家 2公开 ${nameOf("BP01-001")}, ${nameOf("BP01-LD01")}。`);
    expect(linksOf(revealed).map(([name]) => name)).toEqual([nameOf("BP01-001"), nameOf("BP01-LD01")]);
  });

  it("are no links when the viewer can't name them, and lines without cards have none", () => {
    // The worker tells no card of what the viewer can't see: "a card".
    const played = describeIn("zh", { type: "cardPlayed", player: 1, card: "x", def: "BP01-001", from: "hand" }, {});
    expect(played.text).toBe("玩家 2使用了 一张卡。");
    expect(played.links).toEqual([]);
    const hidden = describeIn("zh", { type: "cardsMoved", moves: [{ ...intoDeck(undefined), to: { player: 0, zone: "hand", faceUp: false }, reason: "draw" }] }, {});
    expect(hidden.links).toEqual([]);
    expect(describeIn("zh", { type: "cardsMoved", moves: [intoDeck("bottom")] }, {}).links).toEqual([]);
    expect(describeIn("zh", { type: "turnStarted", turn: 2, player: 0 }, {}).links).toEqual([]);
    // Shown with "show all", the raw event of a kind without words.
    expect(describeIn("zh", { type: "phaseStarted", phase: "main", player: 0 } as GameEvent, { a: { def: "BP01-001", printing: null } }, true).links).toEqual([]);
  });

  it("a card a manual operation names by its definition; a definition this program doesn't have is only a name", () => {
    const search = describeIn("zh", { type: "manualOp", op: { kind: "search", player: 0, def: "BP01-001" } }, {});
    expect(linksOf(search)).toEqual([[nameOf("BP01-001"), { def: "BP01-001", printing: null }]]);
    expect(search.text).not.toMatch(/[\uE000-\uE002]/);
    const unknown = describeIn("zh", { type: "manualOp", op: { kind: "search", player: 0, def: "NO-SUCH-CARD" } }, {});
    expect(unknown.text).toContain("NO-SUCH-CARD");
    expect(unknown.links).toEqual([]);
    expect(describeIn("zh", { type: "cardPlayed", player: 0, card: "x", def: "NO-SUCH-CARD", from: "hand" }, { x: { def: "NO-SUCH-CARD", printing: null } }).links).toEqual([]);
  });
});
