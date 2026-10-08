import { expect, test } from "@playwright/test";
import { toMainPhase, useSettings } from "./helpers";

// Token art (the settings, TokenArtWindow.tsx): a token is shown with another of its printings, chosen in a window of every
// token and a second one of that token's printings. The look only: the token the game makes keeps its own printing.

test("token art: a printing chosen in the settings is the Fairy made in a game", async ({ page }) => {
  const problems: string[] = [];
  page.on("pageerror", (e) => problems.push(e.message));
  await useSettings(page, { uiLang: "en", botDelayMs: 0, manualDebug: true, setupControllers: ["human", "greedy"], setupDecks: ["samples/sd01.json", "samples/sd02.json"] });
  await page.goto("/");
  await page.getByTestId("menu-settings").click();
  const choose = page.getByTestId("settings-token-art");
  const help = page.getByTestId("settings-token-art-help");
  // The window waits for the card list, which comes with the engine.
  await expect(choose).toBeEnabled({ timeout: 120_000 });
  await expect(help).toContainText("Changed: 0.");
  await choose.click();

  // Every token with the printing it is shown with; a number finds the token any of its printings belong to.
  const window = page.getByTestId("token-art");
  await window.getByPlaceholder("Name or number").fill("SD01-T01");
  const fairy = window.locator('[data-token="BP01-T03"]');
  await expect(window.locator("[data-token]")).toHaveCount(1);
  await expect(fairy.locator(".sve-printing-label")).toHaveText("BP01-T03");
  await fairy.click();
  const printings = page.getByTestId("token-art-printings");
  await expect(printings.locator('.sve-token-art-option[data-printing="BP01-T03"]')).toHaveClass(/sve-token-art-current/);
  // "View": that printing large, beside what the card panel says of it; it chooses nothing.
  await printings.locator('.sve-token-art-option[data-printing="SD01-T01"]').getByTestId("token-art-view").click();
  const preview = page.getByTestId("token-art-preview");
  await expect(preview.locator(".sve-token-art-preview-art [data-printing]")).toHaveAttribute("data-printing", "SD01-T01");
  await expect(preview.locator(".sve-details-name")).toHaveText("Fairy");
  await expect(preview.locator(".sve-details-meta")).toContainText("SD01-T01");
  await expect(preview.locator(".sve-details-printings .sve-current")).toContainText("SD01-T01");
  await page.keyboard.press("Escape");
  await expect(preview).toHaveCount(0);
  await expect(printings.locator('.sve-token-art-option[data-printing="BP01-T03"]')).toHaveClass(/sve-token-art-current/);
  await printings.locator('.sve-token-art-option[data-printing="SD01-T01"]').click();
  await expect(printings).toHaveCount(0);
  await expect(fairy.locator(".sve-printing-label")).toHaveText("SD01-T01");
  await page.keyboard.press("Escape");
  await expect(window).toHaveCount(0);
  await expect(help).toContainText("Changed: 1.");

  // In a game (from the main menu: a reload would bring back the test's first settings): a Fairy made by hand shows
  // SD01-T01, and the card panel names the printing shown.
  await page.getByRole("button", { name: /^Back$/ }).click();
  await page.getByTestId("menu-play").click();
  await page.locator(".sve-advanced summary").click();
  await page.getByTestId("setup-seed").fill("token-art");
  await page.getByTestId("start-game").click();
  await toMainPhase(page);
  await page.getByTestId("player-panel-0").click();
  const manual = page.getByTestId("manual-dialog");
  await manual.getByPlaceholder("Token name").fill("Fairy");
  await manual.locator(".sve-manual-token").filter({ has: page.getByText("Fairy", { exact: true }) }).getByRole("button", { name: "Field" }).click();
  await page.keyboard.press("Escape");
  const token = page.locator('.sve-mat-own .sve-field-slot .sve-card[data-def="BP01-T03"]');
  await expect(token).toHaveCount(1);
  await expect(token.locator("[data-printing]")).toHaveAttribute("data-printing", "SD01-T01");
  await token.hover();
  await expect(page.locator(".sve-details-meta")).toBeHidden();
  await expect(page.getByTestId("details-printings")).toBeHidden();
  expect(problems).toEqual([]);
});

test("token art: a token's own printing again, and \"Reset all\"", async ({ page }) => {
  await useSettings(page, { uiLang: "en", tokenArt: { "BP01-T03": "SD01-T01", "BP01-T05": "SD02-T01" } });
  await page.goto("/");
  await page.getByTestId("menu-settings").click();
  await expect(page.getByTestId("settings-token-art")).toBeEnabled({ timeout: 120_000 });
  await expect(page.getByTestId("settings-token-art-help")).toContainText("Changed: 2.");
  await page.getByTestId("settings-token-art").click();
  const window = page.getByTestId("token-art");
  // The Fairy back to its own printing: no choice is kept for it.
  await window.locator('[data-token="BP01-T03"]').click();
  await page.getByTestId("token-art-printings").locator('.sve-token-art-option[data-printing="BP01-T03"]').click();
  await expect(page.getByTestId("settings-token-art-help")).toContainText("Changed: 1.");
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("sve-gui-settings")!).tokenArt)).toEqual({ "BP01-T05": "SD02-T01" });
  await page.getByTestId("token-art-reset").click();
  await expect(page.getByTestId("settings-token-art-help")).toContainText("Changed: 0.");
  await expect(window.locator('[data-token="BP01-T05"] .sve-printing-label')).toHaveText("BP01-T05");
});
