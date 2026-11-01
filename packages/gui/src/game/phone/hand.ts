// A phone held sideways keeps your hand small in the bottom right corner, where it covers nothing; a tap on it spreads it
// into a row of large cards along the bottom of the screen, and only then are its cards played (a tap for a card's menu,
// a drag onto your mat, a long press to read it). A tap anywhere else, any answer, and any new decision fold it back
// (game/GameScreen.tsx).
import { useSyncExternalStore } from "react";

let open = false;
const listeners = new Set<() => void>();

export function setHandOpen(next: boolean): void {
  if (open === next) return;
  open = next;
  for (const listener of listeners) listener();
}

export function handOpen(): boolean {
  return open;
}

export function useHandOpen(): boolean {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => open,
  );
}
