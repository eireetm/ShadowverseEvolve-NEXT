// Cards put into a hand in public (GameUpdate.toHand: searched, revealed and taken from a deck, taken from a cemetery) are
// shown a moment where they went. The other player's, hidden in their hand, turns face up there, larger, shakes twice and
// turns back; one's own, face up anyway, shakes twice. Without animations the other player's stays face up as long as the
// game waits for it (REVEAL_PAUSE_MS, plus the time its flight would have waited: flightDelay). Outside React's state of
// the table: the hand asks which cards are being shown.
import type { CardId } from "@sve/core";
import { useSyncExternalStore } from "react";
import type { CardInfo, GameUpdate } from "../../engine/protocol";
import { REVEAL_PAUSE_MS, TIMING } from "./plan";

/**
 * How a card is being shown: turning face up and shaking ("in"), turning away ("out"), its back turning in ("down"), face up
 * without animations ("still"), shaking where it is face up anyway ("shake").
 */
export type RevealPhase = "in" | "out" | "down" | "still" | "shake";

export interface ShownCard {
  card: CardInfo;
  phase: RevealPhase;
}

let shown: ReadonlyMap<CardId, ShownCard> = new Map();
const listeners = new Set<() => void>();
const timers = new Set<number>();
/** The updates already shown (an update is rendered again when the settings change). */
const done = new WeakSet<GameUpdate>();

function set(id: CardId, value: ShownCard | null): void {
  const next = new Map(shown);
  if (value) next.set(id, value);
  else next.delete(id);
  shown = next;
  for (const listener of listeners) listener();
}

function later(ms: number, fn: () => void): void {
  if (ms <= 0) return fn();
  const timer = window.setTimeout(() => {
    timers.delete(timer);
    fn();
  }, ms);
  timers.add(timer);
}

/**
 * Show the cards an update put into a hand in public, each from when it is there: `landing` has when the cards that fly in
 * (AnimationLayer) land, with the animations on.
 */
export function showToHand(update: GameUpdate, animations: boolean, landing: ReadonlyMap<CardId, number>): void {
  if (done.has(update) || !update.toHand) return;
  done.add(update);
  for (const { player, id, card } of update.toHand) {
    const view = update.view.players[player].hand.find((h) => h.id === id);
    if (!view) continue;
    const start = landing.get(id) ?? 0;
    if (!view.hidden) {
      if (!animations) continue;
      later(start, () => set(id, { card, phase: "shake" }));
      later(start + TIMING.revealShake, () => set(id, null));
      continue;
    }
    if (!animations) {
      set(id, { card, phase: "still" });
      later(REVEAL_PAUSE_MS + Math.max(0, start - TIMING.flight), () => set(id, null));
      continue;
    }
    const away = start + TIMING.revealIn + TIMING.revealStay;
    later(start, () => set(id, { card, phase: "in" }));
    later(away, () => set(id, { card, phase: "out" }));
    later(away + TIMING.revealOut, () => set(id, { card, phase: "down" }));
    later(away + 2 * TIMING.revealOut, () => set(id, null));
  }
}

/** Stop showing anything (a new table: another game, a rewind). */
export function clearShown(): void {
  for (const timer of timers) window.clearTimeout(timer);
  timers.clear();
  if (shown.size === 0) return;
  shown = new Map();
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The cards being shown now, by id. */
export function useShownCards(): ReadonlyMap<CardId, ShownCard> {
  return useSyncExternalStore(subscribe, () => shown);
}
