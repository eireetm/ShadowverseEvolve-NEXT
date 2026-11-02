import { expect, test, type Page } from "@playwright/test";
import { showSidebar, startGame, useSettings } from "./helpers";

// The log's card names: a click (a tap) opens the card in the card panel. A game of two bots to its end has plenty of them.

/** A game of two bots played to its end, the table looked at. */
async function finishedGame(page: Page, problems: string[]): Promise<void> {
  page.on("pageerror", (e) => problems.push(e.message));
  await useSettings(page, { uiLang: "en", cardLang: "en", botDelayMs: 0, setupControllers: ["greedy", "greedy"], setupDecks: ["samples/sd01.json", "samples/sd02.json"] });
  await startGame(page, "log-links");
  await expect(page.locator(".sve-decision")).toHaveAttribute("data-decision", "over", { timeout: 150_000 });
  await page.getByTestId("result-view-board").click();
}

test("the log's card names open the cards in the panel on the left, by click or by keys", async ({ page }) => {
  const problems: string[] = [];
  await finishedGame(page, problems);
  await showSidebar(page);
  const links = page.getByTestId("log-card-link");
  await expect(links.first()).toBeVisible();
  expect(await links.count()).toBeGreaterThan(10);
  // Their look is that of the card text's links; the line's words are as they were.
  await expect(links.first()).toHaveClass("sve-card-link");
  const lines = await page.locator(".sve-log-lines").innerText();
  expect(lines).not.toMatch(/[-]/);
  expect(lines).toMatch(/draws|plays|attacks/);

  const details = page.getByTestId("game-left").locator(".sve-details-name");
  const clicked = links.last();
  const name = await clicked.innerText();
  await clicked.click();
  await expect(details).toHaveText(name);
  await expect(page.getByTestId("details-art")).toBeVisible();
  // The sidebar stays where it is; another card, by the keys.
  await expect(page.getByTestId("game-sidebar")).toBeVisible();
  const other = links.filter({ hasNotText: name }).last();
  const otherName = await other.innerText();
  await other.focus();
  await page.keyboard.press("Enter");
  await expect(details).toHaveText(otherName);
  expect(problems).toEqual([]);
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 915, height: 412 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });

  test("the log is where the card panel goes: a tap on a name shows the card there, and the log comes back where it was", async ({ page }) => {
    const problems: string[] = [];
    await finishedGame(page, problems);
    await page.getByTestId("phone-log").tap();
    const panel = page.getByTestId("phone-panel");
    await expect(panel).toHaveAttribute("data-panel", "log");
    const list = page.locator(".sve-log-lines");
    // A name some way up the log.
    const links = page.getByTestId("log-card-link");
    const count = await links.count();
    expect(count).toBeGreaterThan(10);
    const link = links.nth(Math.floor(count / 2));
    await link.scrollIntoViewIfNeeded();
    const name = await link.innerText();
    const at = await list.evaluate((e) => e.scrollTop);
    expect(at).toBeLessThan(await list.evaluate((e) => e.scrollHeight - e.clientHeight));
    await link.tap();
    await expect(panel).toHaveAttribute("data-panel", "card");
    await expect(panel.locator(".sve-details-name")).toHaveText(name);
    await page.getByTestId("phone-log").tap();
    await expect(panel).toHaveAttribute("data-panel", "log");
    expect(Math.abs((await list.evaluate((e) => e.scrollTop)) - at)).toBeLessThanOrEqual(1);
    // Closed and opened otherwise, it is at its end again.
    await page.getByTestId("phone-log-close").tap();
    await page.getByTestId("phone-log").tap();
    await expect.poll(() => list.evaluate((e) => e.scrollHeight - e.clientHeight - e.scrollTop)).toBeLessThanOrEqual(1);
    expect(problems).toEqual([]);
  });
});
