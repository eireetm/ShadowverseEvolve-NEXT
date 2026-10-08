import { createEngine, type CardMove, type GameEvent, type ZoneName } from "@sve/core";
import { ALL_CARDS, ALL_SCRIPTS } from "@sve/core/sets";
import { describe, expect, it } from "vitest";
import { Catalog } from "../src/app/catalog";
import type { GameUpdate, LogEntry } from "../src/engine/protocol";
import { describeEntry, shuffledPlacements } from "../src/game/log/format";
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
    expect(lines(entries({ type: "cardsMoved", moves: [intoDeck("bottom")] }))).toEqual(["1 张卡：牌组 → 牌组底"]);
    expect(lines(entries({ type: "cardsMoved", moves: [intoDeck("top", "hand")] }))).toEqual(["1 张卡：手牌 → 牌组顶"]);
    expect(lines(entries({ type: "cardsMoved", moves: [intoDeck(2, "cemetery")] }))).toEqual(["1 张卡：墓场 → 牌组顶起第3张"]);
    expect(lines(entries({ type: "cardsMoved", moves: [intoDeck(0, "cemetery")] }))).toEqual(["1 张卡：墓场 → 牌组顶"]);
    // Two places in one move: two parts.
    expect(lines(entries({ type: "cardsMoved", moves: [intoDeck("top", "hand"), intoDeck("bottom", "hand")] }))).toEqual(["1 张卡：手牌 → 牌组顶 · 1 张卡：手牌 → 牌组底"]);
  });

  it("says only the deck when that deck is shuffled right after, not when it is used or something is played first", () => {
    const shuffle: GameEvent = { type: "deckShuffled", player: 0 };
    expect(lines(entries({ type: "cardsMoved", moves: [intoDeck("top", "hand")] }, shuffle))).toEqual(["1 张卡：手牌 → 牌组"]);
    // The other player's deck shuffled: this one's place stands.
    expect(lines(entries({ type: "cardsMoved", moves: [intoDeck("top", "hand")] }, { type: "deckShuffled", player: 1 }))).toEqual(["1 张卡：手牌 → 牌组顶"]);
    const played: GameEvent = { type: "cardPlayed", player: 1, card: "x", def: "V1", from: "hand" };
    expect(lines(entries({ type: "cardsMoved", moves: [intoDeck("bottom")] }, played, shuffle))[0]).toBe("1 张卡：牌组 → 牌组底");
    const drawn: GameEvent = { type: "cardsMoved", moves: [{ ...intoDeck(undefined), from: { player: 0, zone: "deck", faceUp: false }, to: { player: 0, zone: "hand", faceUp: false }, reason: "draw" }] };
    expect(lines(entries({ type: "cardsMoved", moves: [intoDeck("top", "hand")] }, drawn, shuffle))[0]).toBe("1 张卡：手牌 → 牌组顶");
  });
});
