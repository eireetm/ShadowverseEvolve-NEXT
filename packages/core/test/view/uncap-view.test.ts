import { describe, expect, it } from "vitest";
import { createEngine, type CardId, type CardView, type HiddenCardView, type PlayerId } from "../../src";
import { CP05_CARDS, CP05_SCRIPTS } from "../../src/sets/cp05";
import { drive, type DriveSpec } from "../../src/testing";
import { TEST_CARDS, TEST_SCRIPTS } from "../helpers";

// The uncap state in the players' views (view/player-view.ts: `uncapped`, `finalUncapped`), which the GUI marks on the card.
// CP05-110 蒼の少女・ルリア has Final Uncap; CP05-T13 is an element, CP05-T15 ヒヒイロカネ; QUICK-SAC destroys a follower of yours.
const E = createEngine({ cards: [...TEST_CARDS, ...CP05_CARDS], scripts: { ...TEST_SCRIPTS, ...CP05_SCRIPTS } });
const d = (spec: DriveSpec) => drive(E, spec);
type T = ReturnType<typeof d>;
const VIEWERS: readonly PlayerId[] = [0, 1];

/** Player 0's card `id` in `zone` as `viewer` sees it (a public zone: never hidden). */
function seen(t: T, viewer: PlayerId, zone: "field" | "cemetery", id: CardId): CardView {
  const card: CardView | HiddenCardView | undefined = t.game.view(viewer).players[0][zone].find((c) => c.id === id);
  if (!card || card.hidden) throw new Error(`player ${viewer} doesn't see ${id} in ${zone}`);
  return card;
}

/** The uncap flags a card's view carries: only those present (the view leaves them out when not so). */
const flags = (card: CardView) => Object.fromEntries((["uncapped", "finalUncapped"] as const).filter((k) => k in card).map((k) => [k, card[k]]));

describe("the uncap state in the players' views", () => {
  it("CR JP 14.6.4.1.1 / JP 14.6.4.2.1 — both players see a field follower uncapped, then final-uncapped (ヒヒイロカネ); its treasures carry only what they did", () => {
    const t = d({ me: { field: [{ card: "CP05-110", uncappedWith: [{ card: "CP05-T13", uncaps: ["uncap"] }] }], ex: ["CP05-T15"] } });
    const lyria = t.id("CP05-110");
    for (const viewer of VIEWERS) expect(flags(seen(t, viewer, "field", lyria)), `viewer ${viewer}`).toStrictEqual({ uncapped: true });
    // Already uncapped, with Final Uncap: ヒヒイロカネ only final-uncaps her.
    t.activate("CP05-T15");
    expect(t.game.reader().isFinalUncapped(lyria)).toBe(true);
    for (const viewer of VIEWERS) {
      expect(flags(seen(t, viewer, "field", lyria)), `viewer ${viewer}`).toStrictEqual({ uncapped: true, finalUncapped: true });
      const treasures = t.game.view(viewer).players[0].uncapZone.map((c) => [c.def, c.linkedTo, c.uncaps, flags(c)]);
      expect(treasures, `viewer ${viewer}`).toEqual([
        ["CP05-T13", lyria, ["uncap"], {}],
        ["CP05-T15", lyria, ["final"], {}],
      ]);
    }
  });

  it("CR 4.1.4 / CR JP 11.12.1 — once the follower has left the field (a new card, its treasures gone), neither player sees either flag", () => {
    const t = d({ me: { field: [{ card: "CP05-110", uncappedWith: [{ card: "CP05-T15", uncaps: ["uncap", "final"] }] }], hand: ["QUICK-SAC"] } });
    for (const viewer of VIEWERS) expect(flags(seen(t, viewer, "field", t.id("CP05-110"))), `viewer ${viewer}`).toStrictEqual({ uncapped: true, finalUncapped: true });
    t.play("QUICK-SAC");
    expect([t.field(), t.zone("me", "uncapZone"), t.cemetery()]).toEqual([[], [], ["CP05-110", "QUICK-SAC"]]);
    const gone = t.id("CP05-110@cemetery");
    for (const viewer of VIEWERS) expect(flags(seen(t, viewer, "cemetery", gone)), `viewer ${viewer}`).toStrictEqual({});
  });
});
