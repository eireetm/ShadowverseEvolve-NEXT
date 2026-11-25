import { expect, test, type Page } from "@playwright/test";
import { useSettings } from "./helpers";

// The deck builder sizes its cards to the width of the deck and of the pool (DeckBuilder.tsx). Where a scrollbar takes
// room (a computer's browser), that width must not change with the scrollbar, or a deck about as tall as the window never
// settles: the scrollbar narrows the cards, the narrower cards fit, the scrollbar goes, the cards widen and overflow again,
// every frame (styles/app.css keeps the scrollbar's room: scrollbar-gutter). Playwright's headless Chrome hides scrollbars
// (--hide-scrollbars), and then nothing of this can show: this file's browser keeps them.
test.use({ launchOptions: { ignoreDefaultArgs: ["--hide-scrollbars"] } });

const DECK = '[data-testid="builder-deck"]';
const POOL = '[data-testid="builder-pool"]';

async function openBuilder(page: Page): Promise<void> {
  await page.goto("/");
  const decks = page.getByTestId("menu-decks");
  await expect(decks).toBeEnabled({ timeout: 120_000 });
  await decks.click();
  await expect(page.locator(".sve-pool-tile").first()).toBeVisible();
}

const frames = (page: Page, n: number) =>
  page.evaluate(async (n) => {
    for (let i = 0; i < n; i++) await new Promise((r) => requestAnimationFrame(r));
  }, n);

/**
 * The window heights (at the window's width) at which the builder would never settle if the scrollbar's room weren't
 * kept: from the content's height with the cards a scrollbar's width narrower up to its height with the cards at full
 * width. Measured with the room taken off and the scrollbar forced off (overflow-y: hidden), then on (scroll).
 */
async function band(page: Page, scroller: string): Promise<{ from: number; to: number }> {
  const measure = (overflow: string) =>
    page.evaluate(
      async ([selector, overflow]) => {
        const style = document.createElement("style");
        style.textContent = `${selector} { overflow-y: ${overflow} !important; scrollbar-gutter: auto !important; }`;
        document.head.append(style);
        for (let i = 0; i < 6; i++) await new Promise((r) => requestAnimationFrame(r));
        const box = document.querySelector(selector)!;
        const last = [...box.children].filter((child) => getComputedStyle(child).display !== "none").pop()!;
        const content =
          last.getBoundingClientRect().bottom + parseFloat(getComputedStyle(last).marginBottom) - box.getBoundingClientRect().top - box.clientTop + box.scrollTop + parseFloat(getComputedStyle(box).paddingBottom);
        const around = window.innerHeight - box.clientHeight;
        style.remove();
        for (let i = 0; i < 4; i++) await new Promise((r) => requestAnimationFrame(r));
        return { content, around };
      },
      [scroller, overflow] as const,
    );
  const full = await measure("hidden");
  const narrow = await measure("scroll");
  return { from: Math.ceil(narrow.content) + full.around, to: Math.ceil(full.content) - 1 + full.around };
}

/** What 20 frames in a row show of the deck or the pool: its width, its scroll container's size, its cards' width. */
const frameStates = (page: Page, box: string, scroller: string) =>
  page.evaluate(
    async ([box, scroller]) => {
      const seen = new Set<string>();
      for (let i = 0; i < 20; i++) {
        await new Promise((r) => requestAnimationFrame(r));
        const element = document.querySelector(box)!;
        const scroll = document.querySelector(scroller)!;
        const tile = element.querySelector(".sve-deck-tile, .sve-pool-tile");
        seen.add(`${element.clientWidth} ${scroll.clientWidth}x${scroll.clientHeight} ${tile?.getBoundingClientRect().width}`);
      }
      return [...seen];
    },
    [box, scroller] as const,
  );

test("the deck and the pool keep still at the window heights where their scrollbar comes and goes", async ({ page }) => {
  const problems: string[] = [];
  page.on("pageerror", (e) => problems.push(e.message));
  page.on("dialog", (d) => void d.dismiss());
  await useSettings(page, { uiLang: "en", builderDeck: "samples/sd01.json" });
  await page.setViewportSize({ width: 1600, height: 1400 });
  await openBuilder(page);
  await expect(page.locator(".sve-deck-tile")).toHaveCount(48);
  // This browser's scrollbars take room (else nothing here would be checked).
  const scrollbar = await page.evaluate(() => {
    const probe = document.createElement("div");
    probe.style.cssText = "position: absolute; width: 100px; height: 100px; overflow: scroll";
    document.body.append(probe);
    const width = probe.offsetWidth - probe.clientWidth;
    probe.remove();
    return width;
  });
  expect(scrollbar).toBeGreaterThan(0);

  const cases = [
    { name: "the deck", width: 1600, box: DECK, scroller: DECK },
    { name: "the pool, a search leaving a few cards", width: 1600, box: POOL, scroller: POOL, search: "SD01-01" },
    { name: "a small window's deck tab (it scrolls as a whole)", width: 700, box: DECK, scroller: ".sve-builder-center" },
    // The same search as the wide pool's (still in the box): a few rows, so the tab's scrollbar comes and goes.
    { name: "a small window's pool tab (it scrolls as a whole)", width: 700, box: POOL, scroller: ".sve-builder-pool", tab: "builder-tab-pool" },
  ];
  for (const c of cases) {
    if (c.tab) {
      await page.setViewportSize({ width: c.width, height: 1400 });
      await page.getByTestId(c.tab).click();
    }
    if (c.search) {
      await page.getByTestId("builder-search").fill(c.search);
      await expect(page.getByTestId("builder-pool")).not.toHaveAttribute("data-stale");
    }
    await page.setViewportSize({ width: c.width, height: 1400 });
    await frames(page, 4);
    const { from, to } = await band(page, c.scroller);
    expect(to, `${c.name} at ${c.width} wide: a band of heights to check`).toBeGreaterThanOrEqual(from);
    for (const height of [from, Math.floor((from + to) / 2), to]) {
      await page.setViewportSize({ width: c.width, height });
      await frames(page, 4);
      expect(await frameStates(page, c.box, c.scroller), `${c.name}, window ${c.width}x${height}`).toHaveLength(1);
    }
  }
  expect(problems).toEqual([]);
});
