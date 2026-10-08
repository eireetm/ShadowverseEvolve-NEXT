import { describe, expect, it } from "vitest";
import { placeMenu } from "../src/game/board/menu-place";

// The menu of a clicked card (board/menu-place.ts): above the card in the lower half of the window, below it otherwise, never
// higher than the room there (a longer menu scrolls) nor past the window's sides. A phone held sideways is 915 x 412.

describe("a card's menu", () => {
  it("above a card in the lower half: as high as the room above it", () => {
    expect(placeMenu({ top: 260, bottom: 340, left: 400, right: 460 }, 915, 412)).toEqual({ left: 430, bottom: 160, maxHeight: 244 });
  });

  it("below a card in the upper half: as high as the room below it", () => {
    expect(placeMenu({ top: 60, bottom: 140, left: 400, right: 460 }, 915, 412)).toEqual({ left: 430, top: 148, maxHeight: 256 });
  });

  it("inside the window's sides", () => {
    expect(placeMenu({ top: 60, bottom: 140, left: 0, right: 60 }, 915, 412).left).toBe(140);
    expect(placeMenu({ top: 60, bottom: 140, left: 880, right: 915 }, 915, 412).left).toBe(775);
  });
});
