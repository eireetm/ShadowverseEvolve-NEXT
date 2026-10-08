import { expect, test } from "@playwright/test";
import { clickCard, showSidebar, startGame, toMainPhase, tokenByHand, useSettings } from "./helpers";

// The card panel shows the abilities given to a card below its text, as the text of the card that gave it quotes it
// (game/card/gifts.ts): here a Wings of Desire (BP15-PR14) played on a follower gives it its Strike.

test("the card panel: an ability given to a follower, quoted from the card that gave it", async ({ page }) => {
  const problems: string[] = [];
  page.on("pageerror", (e) => problems.push(e.message));
  await useSettings(page, { uiLang: "en", cardLang: "en", botDelayMs: 0, manualDebug: true, setupControllers: ["human", "greedy"], setupDecks: ["samples/sd01.json", "samples/sd02.json"] });
  await startGame(page, "gifts-e2e");
  await toMainPhase(page);
  // By hand: a Knight of yours on the field, a Wings of Desire in your EX area; then manual debugging off.
  const knight = page.locator(".sve-mat-own .sve-field-slot .sve-card");
  await tokenByHand(page, 0, "Knight", "field");
  await expect(knight).toHaveCount(1);
  await tokenByHand(page, 0, "Wings of Desire", "ex");
  await showSidebar(page);
  await page.getByRole("button", { name: /^Debug$/ }).click();
  await page.getByTestId("debug-manual").uncheck();
  await page.getByTestId("sidebar-hide").click();

  // The Knight has nothing given yet: no such lines.
  await knight.hover();
  await expect(page.locator(".sve-details-name")).toHaveText("Knight");
  await expect(page.getByTestId("details-gifts")).toHaveCount(0);
  // Played (its only follower is the one it selects), the Wings give the Knight their Strike.
  await clickCard(page.locator('.sve-ex-card[title="Wings of Desire"]').first());
  await page.getByTestId("card-menu").getByRole("menuitem").first().click();
  await expect(page.getByTestId("player-panel-0").locator(".sve-player-defense")).toHaveText("19");
  await knight.hover();
  await expect(page.locator(".sve-details-name")).toHaveText("Knight");
  await expect(page.getByTestId("details-gifts")).toHaveText(
    'Gained abilities: "Strike - Deal each enemy follower on the field damage equal to the number of times your leader has lost defense this turn"',
  );
  expect(problems).toEqual([]);
});
