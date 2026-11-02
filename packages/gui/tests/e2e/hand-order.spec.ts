import { expect, test, type Page } from "@playwright/test";
import { answer, startGame, toMainPhase, useSettings } from "./helpers";

// The button that arranges the person's hand: only how this screen draws it, nothing in the game changes.

interface Drawn {
  id: string;
  cost: number;
  left: number;
}

/** The person's hand as the table draws it, left to right. */
const drawn = (page: Page): Promise<Drawn[]> =>
  page.locator(".sve-hand-own .sve-hand-card").evaluateAll((cards) =>
    cards.map((c) => ({
      id: (c as HTMLElement).dataset.card!,
      cost: Number(c.querySelector(".sve-stat-cost")?.textContent ?? "99"),
      left: parseFloat((c as HTMLElement).style.left),
    })),
  );

const ids = (hand: readonly Drawn[]) => hand.map((c) => c.id);
const isByCost = (hand: readonly Drawn[]) => hand.every((c, i) => i === 0 || hand[i - 1]!.cost <= c.cost);

/** A game against a bot, the person's first. */
async function gameAgainstBot(page: Page, problems: string[], seed = "hand-order-3"): Promise<void> {
  page.on("pageerror", (e) => problems.push(e.message));
  await useSettings(page, { uiLang: "en", cardLang: "en", botDelayMs: 0, setupControllers: ["human", "greedy"], setupTurnOrder: "player1", setupDecks: ["samples/sd01.json", "samples/sd02.json"] });
  await startGame(page, seed);
}

test("by cost, shuffled, by cost: the same cards, no answer given; a card drawn goes on the right; gone with the game", async ({ page }) => {
  const problems: string[] = [];
  await gameAgainstBot(page, problems);
  await toMainPhase(page);
  const bar = page.locator(".sve-decision");
  const inputs = await bar.getAttribute("data-inputs");
  const button = page.getByTestId("hand-order");
  const dealt = await drawn(page);
  expect(dealt.length).toBeGreaterThan(1);
  expect(isByCost(dealt)).toBe(false);

  await button.click();
  await expect.poll(async () => isByCost(await drawn(page))).toBe(true);
  const sorted = await drawn(page);
  expect([...ids(sorted)].sort()).toEqual([...ids(dealt)].sort());
  // The cards stand where they are drawn, left to right.
  await expect.poll(async () => (await drawn(page)).every((c, i, all) => i === 0 || all[i - 1]!.left < c.left)).toBe(true);

  await button.click();
  await expect.poll(async () => ids(await drawn(page))).not.toEqual(ids(sorted));
  expect([...ids(await drawn(page))].sort()).toEqual([...ids(dealt)].sort());
  // Again (a shuffle may fall by cost, with cards of the same cost: then the press after it shuffles again).
  for (let i = 0; i < 6 && ids(await drawn(page)).join() !== ids(sorted).join(); i++) await button.click();
  await expect.poll(async () => ids(await drawn(page))).toEqual(ids(sorted));
  // Nothing in the game happened.
  await expect(bar).toHaveAttribute("data-inputs", inputs!);
  await expect(bar).toHaveAttribute("data-decision", "mainPhase");

  // The game goes on; the next turn's card is on the right.
  await answer(page, "mainPhase");
  await expect.poll(async () => (await bar.getAttribute("data-inputs")) !== inputs).toBe(true);
  await toMainPhase(page);
  await expect.poll(async () => (await drawn(page)).length).toBe(sorted.length + 1);
  const next = await drawn(page);
  expect(ids(next).slice(0, -1)).toEqual(ids(sorted));

  // Over: no more of it.
  page.on("dialog", (d) => void d.accept());
  await page.getByTestId("game-concede").click();
  await expect(page.getByTestId("result-overlay")).toBeVisible();
  await expect(button).toHaveCount(0);
  expect(problems).toEqual([]);
});

test("the window for redrawing starts as the table draws the hand", async ({ page }) => {
  const problems: string[] = [];
  await gameAgainstBot(page, problems);
  const bar = page.locator(".sve-decision");
  await expect(bar).toHaveAttribute("data-decision", "mulligan", { timeout: 60_000 });
  await page.getByTestId("hand-order").click();
  await expect.poll(async () => isByCost(await drawn(page))).toBe(true);
  const hand = ids(await drawn(page));
  await page.getByTestId("table-redraw").click();
  const order = await page.getByTestId("card-order").locator("[data-card-order]").evaluateAll((items) => items.map((i) => (i as HTMLElement).dataset.cardOrder!));
  expect(order).toEqual(hand);
  await page.getByTestId("mulligan-cancel").click();
  expect(problems).toEqual([]);
});

test("two bots play: nobody's hand to arrange", async ({ page }) => {
  await useSettings(page, { uiLang: "en", botDelayMs: 0, setupControllers: ["greedy", "greedy"], setupDecks: ["samples/sd01.json", "samples/sd02.json"] });
  await startGame(page, "hand-order-bots");
  await expect(page.getByTestId("game-menu")).toBeVisible();
  await expect(page.getByTestId("hand-order")).toHaveCount(0);
});

test.describe("a phone held sideways", () => {
  test.use({ viewport: { width: 800, height: 360 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });

  test("the button is beside conceding, in its column; pressed, the spread hand stays spread", async ({ page }) => {
    const problems: string[] = [];
    await gameAgainstBot(page, problems);
    await toMainPhase(page);
    const button = page.getByTestId("hand-order");
    await expect(button).toHaveText("Sort");
    const box = (await button.boundingBox())!;
    const row = (await page.locator(".sve-phone-topright").boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(row.x);
    expect(box.x + box.width).toBeLessThanOrEqual(row.x + row.width);
    await page.getByTestId("hand-spread").tap();
    await expect(page.locator(".sve-table[data-hand-spread]")).toHaveCount(1);
    const before = await page.locator(".sve-hand-own .sve-hand-card").evaluateAll((cards) => cards.map((c) => (c as HTMLElement).dataset.card!));
    await button.tap();
    await expect.poll(() => page.locator(".sve-hand-own .sve-hand-card").evaluateAll((cards) => cards.map((c) => (c as HTMLElement).dataset.card!))).not.toEqual(before);
    await expect(page.locator(".sve-table[data-hand-spread]")).toHaveCount(1);
    expect(problems).toEqual([]);
  });
});

test.describe("a phone held upright", () => {
  test.use({ viewport: { width: 360, height: 780 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });

  test("the button is in the bar under the table, whose buttons all fit", async ({ page }) => {
    const problems: string[] = [];
    await gameAgainstBot(page, problems);
    const bar = page.getByTestId("phone-bottom");
    const fits = async () => {
      await expect(page.getByTestId("hand-order")).toBeVisible();
      const sizes = await bar.evaluate((e) => ({ scroll: e.scrollWidth, client: e.clientWidth }));
      expect(sizes.scroll).toBeLessThanOrEqual(sizes.client);
    };
    await expect(page.locator(".sve-decision")).toHaveAttribute("data-decision", "mulligan", { timeout: 60_000 });
    await fits();
    await expect(page.getByTestId("hand-order")).toHaveText("Sort");
    await toMainPhase(page);
    await fits();
    expect(problems).toEqual([]);
  });
});
