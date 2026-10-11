import { expect, test } from "@playwright/test";
import { clickCard, startGame, toMainPhase, useSettings } from "./helpers";

test("effect restriction labels follow real worker effects and UI language without inferring attack eligibility", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  // An unlimited test deck; intercept the file read rather than changing a saved deck.
  await page.route("**/api/decks/samples/sd01.json", (route) => route.fulfill({ json: {
    format: "sve-deck", version: 1, name: "Restriction test", leader: "SD01-LD01",
    main: { "BP01-088": 10, "BP05-057": 10, "BP01-024": 10, "BP01-171": 10 }, evolve: {},
  } }));
  await useSettings(page, {
    uiLang: "en", cardLang: "en", format: "unlimited", manualDebug: true, animations: false,
    setupControllers: ["human", "human"], setupTurnOrder: "player1",
    setupDecks: ["samples/sd01.json", "samples/sd02.json"],
  });
  await startGame(page, "restriction-labels");
  await toMainPhase(page);
  const manual = page.getByTestId("manual-dialog");
  const flags = page.getByTestId("details-state").locator(".sve-details-flags span");
  const fromDeck = async (def: string, name: string) => {
    await page.getByTestId("deck-0").click();
    await manual.getByTestId("manual-search").filter({ hasText: name }).click();
    await page.keyboard.press("Escape");
    const card = page.locator(`.sve-hand-own .sve-card[data-def="${def}"]`).last();
    await clickCard(card);
  };

  await fromDeck("BP01-088", "Imprisoned Dragon");
  await manual.getByTestId("manual-move-field").click();
  const dragon = page.locator('.sve-field-slot .sve-card[data-def="BP01-088"]');
  await dragon.hover();
  await expect(flags).toHaveText(["Entered the field this turn", "Cannot attack"]);

  await fromDeck("BP05-057", "God Bullet Golem");
  await manual.getByTestId("manual-move-field").click();
  const golem = page.locator('.sve-field-slot .sve-card[data-def="BP05-057"]');
  await golem.hover();
  await expect(flags).toHaveText(["Entered the field this turn", "Cannot attack leaders"]);

  await page.getByTestId("player-panel-1").click();
  await manual.getByPlaceholder("Token name").fill("BP01-T03");
  await manual.locator(".sve-manual-token").getByRole("button", { name: "Field", exact: true }).click();
  await page.keyboard.press("Escape");
  const fairy = page.locator('.sve-mat-opponent .sve-field-slot .sve-card[data-def="BP01-T03"]');
  await fairy.hover();
  await expect(flags).toHaveText(["Entered the field this turn"]);
  await fromDeck("BP01-024", "Woodkin Curse");
  await manual.getByTestId("manual-play").click();
  await fairy.hover();
  await expect(flags).toHaveText(["Entered the field this turn", "Cannot deal damage"]);

  for (const [uiLang, attack, leader, damage] of [
    ["zh", "无法攻击", "无法攻击主战者", "无法造成伤害"],
    ["zh-Hant", "無法攻擊", "無法攻擊主戰者", "無法造成傷害"],
    ["ja", "攻撃できない", "リーダーを攻撃できない", "ダメージを与えられない"],
    ["en", "Cannot attack", "Cannot attack leaders", "Cannot deal damage"],
  ]) {
    await page.evaluate(async (uiLang) => {
      const path = "/src/app/settings.ts";
      const { updateSettings } = await import(/* @vite-ignore */ path);
      updateSettings({ uiLang });
    }, uiLang);
    await dragon.hover();
    await expect(flags.last()).toHaveText(attack!);
    await golem.hover();
    await expect(flags.last()).toHaveText(leader!);
    await fairy.hover();
    await expect(flags.last()).toHaveText(damage!);
  }
  await page.setViewportSize({ width: 915, height: 412 });
  await fairy.hover();
  await page.getByTestId("details-show").click();
  await page.getByTestId("details-state").scrollIntoViewIfNeeded();
  await expect(flags.last()).toBeInViewport();
  expect(await page.getByTestId("game-left").evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath("restrictions-narrow.png") });
  expect(errors).toEqual([]);
});
