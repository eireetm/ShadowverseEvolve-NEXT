// The order a hand is drawn in on this screen (the button over the table, HandOrderButton.tsx): by cost, then shuffled, as a
// person moves the cards about in their hand. Only the table's drawing: the game keeps its own order, which the rules read (a
// random discard draws by place) and both programs compare. Online, the other programs are only told that the hand was moved
// (NetMessage "handMoved"): each draws its backs in a new order of its own, so where a card leaves from no longer tells which
// card it was. How the hand was arranged isn't told: cards sorted by cost would give their costs away.
import type { CardId, CardView, HiddenCardView, PlayerId } from "@sve/core";
import { useSyncExternalStore } from "react";
import type { GameUpdate } from "../engine/protocol";
import { sendHandMoved } from "../net/state";

type HandCard = CardView | HiddenCardView;

/** A hand as it is drawn: its cards' order, and whether they are moving to it now. */
export interface ShownHand {
  order: readonly CardId[];
  arranging: boolean;
}

const AS_DEALT: ShownHand = { order: [], arranging: false };

/** How long the cards take to reach their new places (the hand's transition in app.css). */
const ARRANGE_MS = 300;

/** Online: at most this often (the online server closes a connection over its rate, and a shuffle is a shuffle). */
const TELL_EVERY_MS = 500;

let game: string | null = null;
let hands: [ShownHand, ShownHand] = [AS_DEALT, AS_DEALT];
const settling: [ReturnType<typeof setTimeout> | null, ReturnType<typeof setTimeout> | null] = [null, null];
const listeners = new Set<() => void>();

const changed = (): void => {
  for (const listener of listeners) listener();
};

/** A hand's cards in `order`; those it doesn't list (new in the hand) after them, on the right, as the game has them. */
export function arrangedIds(ids: readonly CardId[], order: readonly CardId[]): CardId[] {
  const place = new Map(order.map((id, i) => [id, i]));
  const kept = ids.filter((id) => place.has(id)).sort((a, b) => place.get(a)! - place.get(b)!);
  return [...kept, ...ids.filter((id) => !place.has(id))];
}

export function arranged<T extends HandCard>(cards: readonly T[], order: readonly CardId[]): T[] {
  const byId = new Map(cards.map((card) => [card.id, card]));
  return arrangedIds([...byId.keys()], order).map((id) => byId.get(id)!);
}

/** The cost on the card, lowest on the left; the same cost: the same card together. Without a cost, or hidden: last. */
export function byCost<T extends HandCard>(cards: readonly T[]): T[] {
  const cost = (card: T): number => (card.hidden ? Infinity : (card.cost ?? Infinity));
  const def = (card: T): string => (card.hidden ? "" : card.def);
  return [...cards].sort((a, b) => cost(a) - cost(b) || def(a).localeCompare(def(b)));
}

/** The same things in another order, at random (when there are two or more). */
export function shuffled<T>(items: readonly T[], random: () => number = Math.random): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  if (out.length > 1 && out.every((item, i) => item === items[i])) out.push(out.shift()!);
  return out;
}

/** How a player's hand is drawn in this game (`seed` null: as the game has it, a replay being watched). */
export function shownHand(seed: string | null, player: PlayerId): ShownHand {
  return seed !== null && seed === game ? hands[player] : AS_DEALT;
}

export function useShownHand(seed: string | null, player: PlayerId): ShownHand {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => shownHand(seed, player),
  );
}

/** A new order: the cards go there, and a moment later are simply there. A new game starts as the game has its hands. */
function show(seed: string, player: PlayerId, order: readonly CardId[]): void {
  if (seed !== game) {
    game = seed;
    hands = [AS_DEALT, AS_DEALT];
  }
  const hand: ShownHand = { order, arranging: true };
  hands = player === 0 ? [hand, hands[1]] : [hands[0], hand];
  const timer = settling[player];
  if (timer !== null) clearTimeout(timer);
  settling[player] = setTimeout(() => {
    settling[player] = null;
    if (hands[player] !== hand) return;
    const settled: ShownHand = { order, arranging: false };
    hands = player === 0 ? [settled, hands[1]] : [hands[0], settled];
    changed();
  }, ARRANGE_MS);
  changed();
}

let toldAt = -Infinity;
let telling: ReturnType<typeof setTimeout> | null = null;

/** Tell the other programs this person moved their hand, as soon as the last time allows. */
function tell(): void {
  if (telling !== null) return;
  const wait = toldAt + TELL_EVERY_MS - performance.now();
  const now = () => {
    telling = null;
    toldAt = performance.now();
    sendHandMoved();
  };
  if (wait <= 0) now();
  else telling = setTimeout(now, wait);
}

/** The button: the hand by cost; when it already is, shuffled. Nothing in the game changes. */
export function arrangeHand(update: GameUpdate, player: PlayerId): void {
  const shown = arranged(update.view.players[player].hand, shownHand(update.seed, player).order);
  const sorted = byCost(shown);
  const next = sorted.every((card, i) => card === shown[i]) ? shuffled(shown) : sorted;
  show(update.seed, player, next.map((card) => card.id));
  if (update.online) tell();
}

/** Online: the player at another program moved their hand ("handMoved"): its backs in a new order of this program's own. */
export function otherHandMoved(update: GameUpdate, player: PlayerId): void {
  const shown = arranged(update.view.players[player].hand, shownHand(update.seed, player).order);
  show(update.seed, player, shuffled(shown).map((card) => card.id));
}
