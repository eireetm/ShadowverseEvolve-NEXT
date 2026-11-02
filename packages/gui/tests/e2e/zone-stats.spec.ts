import { expect, test, type Page } from "@playwright/test";
import { startGame, toMainPhase, useSettings } from "./helpers";

// A cemetery's window: its stats, folded out by the button beside "close". The cards put there by hand (manual debugging).

const SHOTS = process.env.SVE_ZONE_STATS_SHOTS;

/** A game against a bot, with `n` cards of each deck put into its player's cemetery. */
async function gameWithCemeteries(page: Page, n: number, uiLang: string): Promise<void> {
  await useSettings(page, { uiLang, cardLang: "cn", botDelayMs: 0, manualDebug: true, setupControllers: ["human", "greedy"], setupDecks: ["samples/sd01.json", "samples/sd02.json"] });
  await startGame(page, "zone-stats");
  await toMainPhase(page);
  for (const seat of [0, 1]) {
    await page.getByTestId(`deck-${seat}`).click();
    await page.getByTestId("manual-mill-value").fill(String(n));
    await page.getByTestId("manual-mill").click();
    await page.keyboard.press("Escape");
  }
}

/** The numbers an item's text ends with, in a row of the stats ("2费 3张" -> 3). */
const counts = (page: Page, row: string) =>
  page
    .getByTestId(row)
    .locator(".sve-zone-stats-item strong")
    .evaluateAll((items) => items.map((i) => parseInt(/(\d+)/.exec(i.textContent ?? "")![1]!, 10)));

const sum = (ns: number[]) => ns.reduce((a, b) => a + b, 0);

test("the stats of a cemetery fold out and back; every count adds up; only a cemetery has them", async ({ page }) => {
  const problems: string[] = [];
  page.on("pageerror", (e) => problems.push(e.message));
  await gameWithCemeteries(page, 12, "zh");
  await page.locator('[data-zone="0:cemetery"]').click();
  const toggle = page.getByTestId("zone-stats-toggle");
  const stats = page.getByTestId("zone-stats");
  const close = page.getByTestId("zone-close");
  await expect(toggle).toHaveText("墓场统计");
  await expect(stats).toHaveCount(0);
  // To the left of "close".
  const [a, b] = [(await toggle.boundingBox())!, (await close.boundingBox())!];
  expect(a.x + a.width).toBeLessThanOrEqual(b.x);
  expect(a.y).toBe(b.y);

  await toggle.click();
  await expect(stats).toBeVisible();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByTestId("zone-stats-total")).toHaveText("共12张");
  // At the top right of the box.
  const [total, box] = [(await page.getByTestId("zone-stats-total").boundingBox())!, (await stats.boundingBox())!];
  expect(box.x + box.width - (total.x + total.width)).toBeLessThan(20);
  expect(total.y - box.y).toBeLessThan(20);
  // The same number of cards in the window; each of the first three lines adds up to them.
  await expect(page.locator(".sve-modal-cards .sve-card")).toHaveCount(12);
  for (const row of ["zone-stats-cost", "zone-stats-class", "zone-stats-type"]) expect(sum(await counts(page, row))).toBe(12);
  await expect(page.getByTestId("zone-stats-cost").locator(".sve-zone-stats-item").first()).toHaveText(/^\d+费 \d+张$/);
  // A trait: how many, and how many of each card type.
  const traits = page.getByTestId("zone-stats-traits").locator(".sve-zone-stats-trait");
  expect(await traits.count()).toBeGreaterThan(0);
  for (const text of await traits.allInnerTexts()) {
    const m = /^.+ (\d+)张（(.+)）$/.exec(text.trim());
    expect(m, text).not.toBeNull();
    const parts = m![2]!.split("，").map((part) => /^(\d+)张(从者|法术|护符)$/.exec(part));
    expect(parts.every(Boolean), text).toBe(true);
    expect(sum(parts.map((part) => Number(part![1])))).toBe(Number(m![1]));
  }
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/zone-stats-wide.png` });

  // A click inside doesn't close the window; the same button folds it back.
  await stats.click({ position: { x: 4, y: 4 } });
  await expect(stats).toBeVisible();
  await toggle.click();
  await expect(stats).toHaveCount(0);
  await expect(close).toBeVisible();

  // Out again: still out in the other player's cemetery, with its own numbers.
  await toggle.click();
  await close.click();
  await page.locator('[data-zone="1:cemetery"]').click();
  await expect(page.getByTestId("zone-stats-total")).toHaveText("共12张");

  // Not in another pile.
  await close.click();
  await page.locator('[data-zone="0:evolveDeck"]').click();
  await expect(close).toBeVisible();
  await expect(toggle).toHaveCount(0);
  await expect(stats).toHaveCount(0);
  expect(problems).toEqual([]);
});

test("the other languages: English words", async ({ page }) => {
  await gameWithCemeteries(page, 6, "en");
  await page.locator('[data-zone="0:cemetery"]').click();
  await page.getByTestId("zone-stats-toggle").click();
  await expect(page.getByTestId("zone-stats-total")).toHaveText("6 in all");
  await expect(page.getByTestId("zone-stats-cost").locator(".sve-zone-stats-item").first()).toHaveText(/^Cost \d+: \d+$/);
  await expect(page.getByTestId("zone-stats-type").locator(".sve-zone-stats-item").first()).toHaveText(/^Follower \d+$/);
});

test("the other languages: Japanese words", async ({ page }) => {
  await gameWithCemeteries(page, 6, "ja");
  await page.locator('[data-zone="0:cemetery"]').click();
  await expect(page.getByTestId("zone-stats-toggle")).toHaveText("墓場の統計");
  await page.getByTestId("zone-stats-toggle").click();
  await expect(page.getByTestId("zone-stats-total")).toHaveText("計6枚");
  await expect(page.getByTestId("zone-stats-cost").locator(".sve-zone-stats-item").first()).toHaveText(/^コスト\d+ \d+枚$/);
  await expect(page.getByTestId("zone-stats-type").locator(".sve-zone-stats-item").first()).toHaveText(/^フォロワー \d+枚$/);
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 800, height: 360 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });

  test("the window's buttons and the stats stay on the screen", async ({ page }) => {
    await gameWithCemeteries(page, 12, "zh");
    await page.locator('[data-zone="0:cemetery"]').click();
    await page.getByTestId("zone-stats-toggle").tap();
    const stats = page.getByTestId("zone-stats");
    await expect(stats).toBeVisible();
    const box = (await stats.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(800);
    await expect(page.getByTestId("zone-close")).toBeInViewport();
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/zone-stats-phone.png` });
  });
});
