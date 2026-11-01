import { useLayoutEffect, useState, type RefObject } from "react";
import { computeLayout, type TableLayout, type TableMode } from "./layout";

/**
 * The table's layout, following the element's size. The sizes a phone's columns need (they lie over the table, outside
 * it) are set on the game's element too.
 */
export function useTableLayout(ref: RefObject<HTMLElement | null>, mode: TableMode = "wide"): TableLayout {
  const [layout, setLayout] = useState<TableLayout>(() => computeLayout(1000, 800, mode));
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const update = () => {
      const next = computeLayout(element.clientWidth, element.clientHeight, mode);
      setLayout(next);
      const game = element.closest<HTMLElement>(".sve-game");
      if (game) {
        game.style.setProperty("--side-width", `${next.sideWidth}px`);
        game.style.setProperty("--hand-height", `${next.handHeight}px`);
        game.style.setProperty("--opponent-hand-height", `${next.opponentHandHeight}px`);
      }
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref, mode]);
  return layout;
}
