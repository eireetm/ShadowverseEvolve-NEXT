import { expect, test } from "@playwright/test";
import { startGame, toMainPhase, useSettings } from "./helpers";

test("runtime details follow maneuver, language changes, expiry and moved instances, including the narrow drawer", async ({ page }) => {
  const problems: string[] = [];
  page.on("pageerror", (e) => problems.push(e.message));
  await useSettings(page, {
    uiLang: "en", cardLang: "en", manualDebug: true, animations: false, revealAll: true,
    setupControllers: ["human", "human"], setupTurnOrder: "player1",
    setupDecks: ["samples/sd01.json", "samples/sd02.json"],
  });
  await startGame(page, "runtime-details");
  await toMainPhase(page);
  await page.getByTestId("player-panel-0").click();
  const manual = page.getByTestId("manual-dialog");
  // Maneuver needs two followers even in the manual ability menu.
  await manual.getByPlaceholder("Token name").fill("BP01-T03");
  await manual.locator(".sve-manual-token").getByRole("button", { name: "Field", exact: true }).click();
  await expect(page.locator('.sve-field-slot .sve-card[data-def="BP01-T03"]')).toHaveCount(1);
  await manual.locator(".sve-manual-token").getByRole("button", { name: "Field", exact: true }).click();
  await expect(page.locator('.sve-field-slot .sve-card[data-def="BP01-T03"]')).toHaveCount(2);
  await manual.getByPlaceholder("Token name").fill("BP11-T01");
  await manual.locator(".sve-manual-token").getByRole("button", { name: "Field", exact: true }).click();
  await page.keyboard.press("Escape");
  const vehicle = page.locator('.sve-field-slot .sve-card[data-def="BP11-T01"]');
  await expect(vehicle).toHaveCount(1);
  await vehicle.hover();
  const panel = page.locator(".sve-details");
  const stats = panel.locator(".sve-details-stat");
  await expect(panel.locator(".sve-details-type")).toContainText("Amulet");
  await expect(stats).toHaveCount(1); // The printed 3/3 must not show while it is an amulet.
  await expect(page.getByTestId("details-state").locator(".sve-details-flags span")).toHaveText(["Entered the field this turn"]);
  const originalText = await panel.locator(".sve-card-text").innerText();

  await vehicle.click();
  const activate = manual.getByRole("button", { name: /^Activate for free:/ }).first();
  await expect(activate).toBeVisible();
  await activate.click();
  await expect(panel.locator(".sve-details-type").first()).toContainText("Current: Follower · Original: Amulet");
  await expect(stats.locator("strong")).toHaveText(["2", "3", "3"]);
  await expect(panel.locator(".sve-card-text")).toHaveText(originalText, { useInnerText: true });
  // The reserved area does not claim that there are no gained abilities.
  await expect(page.getByTestId("details-gained")).toHaveText("Gained abilities");
  expect(await panel.evaluate((el) => {
    const y = (selector: string) => el.querySelector(selector)!.getBoundingClientRect().top;
    return y(".sve-details-stats") < y(".sve-card-text") && y(".sve-card-text") < y('[data-testid="details-state"]')
      && y('[data-testid="details-state"]') < y('[data-testid="details-gained"]');
  })).toBe(true);
  await page.screenshot({ path: test.info().outputPath("details-desktop.png") });

  await page.setViewportSize({ width: 915, height: 412 });
  await vehicle.hover();
  await page.getByTestId("details-show").click();
  for (const [uiLang, cardLang, heading] of [["zh", "cn", "当前状态"], ["ja", "ja", "現在の状態"], ["en", "en", "Current state"]]) {
    // Change settings through the app's normal store; this must not require a new engine input.
    await page.evaluate(async ({ uiLang, cardLang }) => {
      const path = "/src/app/settings.ts";
      const { updateSettings } = await import(/* @vite-ignore */ path);
      updateSettings({ uiLang, cardLang });
    }, { uiLang, cardLang });
    await expect(page.getByTestId("details-state").locator("h4")).toHaveText(heading!);
    await page.getByTestId("details-gained").scrollIntoViewIfNeeded();
    await expect(page.getByTestId("details-gained")).toBeInViewport();
    expect(await page.getByTestId("game-left").evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await page.screenshot({ path: test.info().outputPath("details-narrow.png") });
  await page.getByTestId("details-hide").click();
  await page.setViewportSize({ width: 1600, height: 900 });
  await vehicle.hover();
  await page.getByTestId("table-end").click();
  await toMainPhase(page);
  await expect(panel.locator(".sve-details-type")).toHaveCount(1);
  await expect(panel.locator(".sve-details-type")).toContainText("Amulet");
  await expect(stats).toHaveCount(1);
  await expect(panel).not.toContainText("Maneuver · Until the end of this turn");
  await expect(page.getByTestId("details-state").locator(".sve-details-flags span")).toHaveCount(0);
  await vehicle.click();
  await manual.getByTestId("manual-move-cemetery").click();
  await expect(page.getByTestId("details-state")).toHaveCount(0);
  await expect(page.getByTestId("game-left")).toContainText("Point at a card to see it here.");
  expect(problems).toEqual([]);
});
