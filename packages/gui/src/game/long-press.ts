// A long press on a card with a finger shows it in the card panel (the press already pointed at the card, CardTile). In the
// wide layout and the deck builder on a phone the panel is a drawer, opened here; a phone's game keeps it on screen
// (game/phone/), and `onLongPress` brings it back over the log. That press then neither clicks nor drags
// (board/pointer.ts; the click that follows is swallowed: a tile of the deck builder isn't added or removed), and the
// browser's own long-press menu stays away.
import { markLongPress } from "./board/pointer";
import { setDetailsOpen } from "./details";

const HOLD_MS = 480;
const SLOP = 8;

/**
 * Watch the presses inside `root`; returns the function that stops it. `drawer`: open the card panel's drawer;
 * `onLongPress`: what else a long press does.
 */
export function installLongPress(root: HTMLElement, { drawer = true, onLongPress }: { drawer?: boolean; onLongPress?: () => void } = {}): () => void {
  let timer: number | null = null;
  let start: { x: number; y: number; id: number } | null = null;
  const clear = () => {
    if (timer !== null) window.clearTimeout(timer);
    timer = null;
    start = null;
  };
  const down = (e: PointerEvent) => {
    clear();
    if (e.pointerType !== "touch" || !(e.target instanceof Element) || !e.target.closest("[data-card], [data-printing]")) return;
    start = { x: e.clientX, y: e.clientY, id: e.pointerId };
    timer = window.setTimeout(() => {
      timer = null;
      markLongPress();
      if (drawer) setDetailsOpen(true);
      onLongPress?.();
      swallowClick();
    }, HOLD_MS);
  };
  const move = (e: PointerEvent) => {
    if (start && e.pointerId === start.id && Math.hypot(e.clientX - start.x, e.clientY - start.y) > SLOP) clear();
  };
  const menu = (e: Event) => e.preventDefault();
  // The click the lifted finger makes, right after a long press.
  const swallowClick = () => {
    const swallow = (e: Event) => {
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener("click", swallow, { capture: true, once: true });
    window.setTimeout(() => window.removeEventListener("click", swallow, { capture: true }), 800);
  };
  root.addEventListener("pointerdown", down, true);
  window.addEventListener("pointermove", move, true);
  window.addEventListener("pointerup", clear, true);
  window.addEventListener("pointercancel", clear, true);
  root.addEventListener("contextmenu", menu);
  return () => {
    clear();
    root.removeEventListener("pointerdown", down, true);
    window.removeEventListener("pointermove", move, true);
    window.removeEventListener("pointerup", clear, true);
    window.removeEventListener("pointercancel", clear, true);
    root.removeEventListener("contextmenu", menu);
  };
}
