// On a small screen (app/compact.ts) the deck builder's card panel is a drawer, shown on request: its button, or a long
// press on a card (long-press.ts), which shows that card. (A phone's game keeps its card panel on screen: game/phone/.)
import { useSyncExternalStore } from "react";

let open = false;
const listeners = new Set<() => void>();

export function setDetailsOpen(value: boolean): void {
  if (open === value) return;
  open = value;
  for (const listener of listeners) listener();
}

export function useDetailsOpen(): boolean {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => open,
  );
}
