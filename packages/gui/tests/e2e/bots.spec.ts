import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { answer, openSetup, showSidebar, startGame, useSettings } from "./helpers";

// The bot levels: the setup screen offers them, and a game is played by the levels chosen. Checked by what
// the choices are (the values settings and replays store, engine/protocol.ts SeatController), not by how they are worded.

test("the setup screen offers the bot levels, Bot-Medium chosen at first, each described in its own way", async ({ page }) => {
  await useSettings(page, { uiLang: "en" });
  await openSetup(page);
  const select = page.getByTestId("setup-controller-1");
  const values: (string | null)[] = [];
  for (const option of await select.locator("option").all()) values.push(await option.getAttribute("value"));
  expect(values).toEqual(["greedy", "medium", "medium-v2", "hard", "random", "human"]);
  await expect(select).toHaveValue("medium");
  // The description under the choice follows it: there is one for each level, and they differ.
  const hint = page.getByTestId("setup-controller-hint");
  const descriptions = new Set<string>();
  for (const level of ["greedy", "medium", "medium-v2", "hard"]) {
    await select.selectOption(level);
    await expect(hint).not.toBeEmpty();
    descriptions.add((await hint.textContent()) ?? "");
  }
  expect(descriptions.size).toBe(4);
});

test("a game against Bot-Medium v2 (Chinese): it goes first, keeps or redraws, plays its turn, and this player's turn 2 comes", async ({ page }) => {
  // Two turns ahead on a PC: its first turn takes some seconds, the more so while other tests run.
  test.setTimeout(180_000);
  await useSettings(page, { uiLang: "zh", cardLang: "cn", botDelayMs: 0, setupControllers: ["human", "medium-v2"], setupTurnOrder: "player2", setupDecks: ["samples/sd01.json", "samples/sd02.json"] });
  await startGame(page, "medium-v2-e2e");
  await expect(page.getByTestId("turn-order").locator("span")).toContainText("玩家 2（Bot-中等v2）先手", { timeout: 30_000 });
  const bar = page.locator(".sve-decision");
  // The first player (the bot) keeps or redraws first (CR 6.2.1.8), then this player.
  await expect(bar).toHaveAttribute("data-decision", "mulligan", { timeout: 60_000 });
  await answer(page, "mulligan");
  await expect(bar).toHaveAttribute("data-decision", "mainPhase", { timeout: 150_000 });
  await expect(page.locator(".sve-center-status")).toContainText("第 2 回合");
  await expect(page.locator(".sve-toast")).toHaveCount(0);
});

test("Bot-Medium against Bot-Hard (saved as the removed Bot-Hard beta): a game to the end, its bug report file names the levels", async ({ page }) => {
  // Hard looks two turns ahead on a PC: a whole game takes a while, the more so while other tests run.
  test.setTimeout(360_000);
  await useSettings(page, { uiLang: "en", botDelayMs: 0, setupControllers: ["medium", "hard-beta"], setupDecks: ["samples/sd01.json", "samples/sd02.json"] });
  await startGame(page, "bot-levels");
  await expect(page.locator(".sve-decision")).toHaveAttribute("data-decision", "over", { timeout: 300_000 });
  // The file holds the game's options as the engine's worker got them.
  await showSidebar(page);
  await page.getByRole("button", { name: /^Debug$/ }).click();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: /^Save a bug report file$/ }).click();
  const report = JSON.parse(readFileSync((await (await download).path())!, "utf8")) as { options: { controllers: string[] } };
  expect(report.options.controllers).toEqual(["medium", "hard"]);
  await expect(page.locator(".sve-toast")).toHaveCount(0);
});
