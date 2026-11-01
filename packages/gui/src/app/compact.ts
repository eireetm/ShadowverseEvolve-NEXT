// Small screens (a phone): a game is a phone's (game/phone/, board/layout.ts): held sideways, the table takes the whole
// screen with columns over its sides; held upright, the table takes the width between bars above and below it. The deck
// builder's card panel is a drawer, and the menus shrink (styles/app.css, the same media query). Touch screens of any
// size (a tablet keeps the wide layout) are used with fingers: useTouch.
import { useSyncExternalStore } from "react";

export const COMPACT_QUERY = "(max-height: 560px), (max-width: 760px)";

/** A small screen held upright (the window's shape, not the device's: a narrow window on a computer too). */
export const PORTRAIT_QUERY = "(orientation: portrait) and (max-width: 760px)";

/**
 * Whether the device is a phone: its screen's shorter side (a tablet's is 600 pixels or more, and it keeps the wide layout,
 * sideways). The apps' "Screen" setting is a phone's.
 */
export function isPhoneScreen(): boolean {
  return typeof screen !== "undefined" && Math.min(screen.width, screen.height) < 600;
}

/** A touch screen as the main way to point (a phone, a tablet), whatever its size. */
export const TOUCH_QUERY = "(pointer: coarse)";

const query = (q: string): MediaQueryList | null => (typeof window !== "undefined" && window.matchMedia ? window.matchMedia(q) : null);

/** Whether a media query matches now (follows resizing and turning the device). */
function useMedia(q: string): boolean {
  return useSyncExternalStore(
    (listener) => {
      const list = query(q);
      list?.addEventListener("change", listener);
      return () => list?.removeEventListener("change", listener);
    },
    () => query(q)?.matches ?? false,
  );
}

/** Whether the screen is small (the phone layout). */
export function useCompact(): boolean {
  return useMedia(COMPACT_QUERY);
}

/** Whether the screen is small and held upright (a phone's portrait table). */
export function usePortrait(): boolean {
  return useMedia(PORTRAIT_QUERY);
}

/**
 * Whether the screen is used with fingers: the phone layout, or a touch screen of any size. A tablet keeps the wide
 * layout, but a tap removes a card from the deck (no right click), a long press reads a card, and the HTML drag and drop
 * of a mouse is off.
 */
export function useTouch(): boolean {
  const compact = useMedia(COMPACT_QUERY);
  const touch = useMedia(TOUCH_QUERY);
  return compact || touch;
}
