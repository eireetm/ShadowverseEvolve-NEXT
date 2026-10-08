// Where the menu of a clicked card goes (CardMenu.tsx). Pure: test/menu-place.test.ts.

/** A card's box on the screen (getBoundingClientRect). */
export interface Anchor {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export interface MenuPlace {
  /** The menu's middle (it is centred there). */
  left: number;
  /** From the window's top (below the card) or from its bottom (above it). */
  top?: number;
  bottom?: number;
  /** The room on that side of the card: a longer menu scrolls (a phone held sideways has room for a few items). */
  maxHeight: number;
}

/** Between the card and its menu, and between the menu and the window's edge. */
const GAP = 8;
/** Half the menu's widest (app.css): it stays inside the window. */
const HALF_WIDTH = 140;

/** Above the card in the lower half of the window (your hand and field), below it otherwise; never past the window's edge. */
export function placeMenu(anchor: Anchor, width: number, height: number): MenuPlace {
  const left = Math.min(Math.max((anchor.left + anchor.right) / 2, HALF_WIDTH), width - HALF_WIDTH);
  if (anchor.top > height / 2) return { left, bottom: height - anchor.top + GAP, maxHeight: Math.max(anchor.top - 2 * GAP, 0) };
  return { left, top: anchor.bottom + GAP, maxHeight: Math.max(height - anchor.bottom - 2 * GAP, 0) };
}
