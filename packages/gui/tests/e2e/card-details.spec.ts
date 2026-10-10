import { expect, test } from "@playwright/test";
import { clickCard, startGame, toMainPhase, useSettings } from "./helpers";

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
  await expect(panel.locator(".sve-details-type").first()).toContainText("Current: Follower (Original: Amulet)");
  await expect(stats.locator("strong")).toHaveText(["2", "3", "3"]);
  await expect(panel.locator(".sve-card-text")).toHaveText(originalText, { useInnerText: true });
  // Existing ability text remains below the printed card text.
  await expect(page.getByTestId("details-gifts")).toHaveCount(0);
  expect(await panel.evaluate((el) => {
    const y = (selector: string) => el.querySelector(selector)!.getBoundingClientRect().top;
    return y(".sve-details-stats") < y('[data-testid="details-state"]') && y('[data-testid="details-state"]') < y(".sve-card-text");
  })).toBe(true);
  await page.screenshot({ path: test.info().outputPath("details-desktop.png") });

  await page.setViewportSize({ width: 915, height: 412 });
  await vehicle.hover();
  await page.getByTestId("details-show").click();
  for (const [uiLang, cardLang, label] of [["zh", "cn", "当前状态"], ["zh-Hant", "zh-Hant", "當前狀態"], ["ja", "ja", "現在の状態"], ["en", "en", "Current state"]]) {
    // Change settings through the app's normal store; this must not require a new engine input.
    await page.evaluate(async ({ uiLang, cardLang }) => {
      const path = "/src/app/settings.ts";
      const { updateSettings } = await import(/* @vite-ignore */ path);
      updateSettings({ uiLang, cardLang });
    }, { uiLang, cardLang });
    await expect(page.getByTestId("details-state")).toHaveAttribute("aria-label", label!);
    await expect(page.getByTestId("details-state").locator("h4")).toHaveCount(0);
    await page.getByTestId("details-state").scrollIntoViewIfNeeded();
    await expect(page.getByTestId("details-state")).toBeInViewport();
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
  await expect(page.getByTestId("details-state")).toHaveCount(0);
  await vehicle.click();
  await manual.getByTestId("manual-move-cemetery").click();
  await expect(page.getByTestId("details-state")).toHaveCount(0);
  await expect(panel.locator(".sve-details-name")).toBeVisible();
  await expect(panel.locator(".sve-details-state")).toHaveCount(0);
  expect(problems).toEqual([]);
});

test("a transformed follower hides null stats while keeping lost and subsequently gained abilities", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("**/api/decks/samples/sd01.json", (route) => route.fulfill({ json: {
    format: "sve-deck", version: 1, name: "Type and abilities", leader: "SD01-LD01",
    main: { "BP05-001": 10, "BP05-004": 20, "BP05-060": 10 }, evolve: { "BP05-061": 3 },
  } }));
  await useSettings(page, {
    uiLang: "en", cardLang: "en", format: "unlimited", manualDebug: true, animations: false,
    setupControllers: ["human", "human"], setupTurnOrder: "player1",
    setupDecks: ["samples/sd01.json", "samples/sd02.json"],
  });
  await startGame(page, "type-and-abilities");
  await toMainPhase(page);
  const manual = page.getByTestId("manual-dialog");
  const fromDeck = async (def: string, name: string) => {
    await page.getByTestId("deck-0").click();
    await manual.getByTestId("manual-search").filter({ hasText: name }).click();
    await page.keyboard.press("Escape");
    await clickCard(page.locator(`.sve-hand-own .sve-card[data-def="${def}"]`).last());
  };
  // Give Izudia three Hunters in the cemetery and exactly one opposing target.
  for (let i = 0; i < 3; i++) {
    await fromDeck("BP05-004", "Apostle of Unkilling");
    await manual.getByTestId("manual-move-cemetery").click();
  }
  await page.getByTestId("player-panel-1").click();
  await manual.getByPlaceholder("Token name").fill("BP01-T03");
  await manual.locator(".sve-manual-token").getByRole("button", { name: "Field", exact: true }).click();
  await page.keyboard.press("Escape");
  const fairy = page.locator('.sve-mat-opponent .sve-field-slot .sve-card[data-def="BP01-T03"]');
  await fromDeck("BP05-060", "Cursed Stone");
  await manual.getByTestId("manual-move-field").click();
  await page.locator('.sve-field-slot .sve-card[data-def="BP05-060"]').click();
  await manual.getByRole("button", { name: /^Evolve →/ }).last().click();
  await fairy.hover();
  await expect(page.getByTestId("details-lost")).toContainText("all of them");
  await expect(page.getByTestId("details-state")).toContainText("Cannot attack");

  await fromDeck("BP05-001", "Izudia, Omen of Unkilling");
  await manual.getByTestId("manual-play").click();
  await fairy.hover();
  const panel = page.locator(".sve-details");
  await expect(panel.locator(".sve-details-type")).toContainText("Current: Amulet (Original: Follower)");
  await expect(panel.locator(".sve-details-stat")).toHaveCount(1);
  await expect(page.getByTestId("details-state")).not.toContainText("Cannot attack"); // No longer a follower.
  await expect(page.getByTestId("details-gifts")).toContainText("Gained abilities:");
  await expect(page.getByTestId("details-lost")).toContainText("all of them");
  await expect(panel.locator(".sve-details-gift")).toContainText("cemetery");
  await page.screenshot({ path: test.info().outputPath("transformed-with-gifts.png") });

  await fairy.click();
  await manual.getByTestId("manual-move-cemetery").click();
  await expect(panel.locator(".sve-details-type")).not.toContainText("Current:");
  await expect(panel.locator(".sve-details-stat")).toHaveCount(3); // Static printing after the instance leaves.
  await expect(page.getByTestId("details-state")).toHaveCount(0);
  await expect(page.getByTestId("details-gifts")).toHaveCount(0);
  expect(errors).toEqual([]);
});
