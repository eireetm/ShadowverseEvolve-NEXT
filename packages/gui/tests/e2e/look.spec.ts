import { expect, test } from "@playwright/test";
import { clickCard, startGame, toMainPhase, useSettings } from "./helpers";

// Looking at cards (CR 5.11.1) that no decision shows: the game waits with a window of the cards until the player has seen
// them. CSD02c-005 Suzuho Ueda: Fanfare, look at the top card of your deck (it stays there). Put into the hand and played by
// hand (manual debugging), so the test needs no particular deal.

test("a look at the top card of one's deck: the cards are shown until OK, then the game goes on", async ({ page }) => {
  const problems: string[] = [];
  page.on("pageerror", (e) => problems.push(e.message));
  await useSettings(page, { uiLang: "zh", cardLang: "cn", botDelayMs: 0, manualDebug: true, setupControllers: ["human", "greedy"], setupDecks: ["samples/csd02c.json", "samples/sd02.json"] });
  await startGame(page, "look-e2e");
  await toMainPhase(page);
  const manual = page.getByTestId("manual-dialog");

  // From the deck into the hand, then played by hand: its Fanfare looks at the top card.
  await page.getByTestId("deck-0").click();
  await manual.getByTestId("manual-search").filter({ hasText: "上田铃帆" }).click();
  await page.keyboard.press("Escape");
  const card = page.locator(".sve-hand-own .sve-card").filter({ has: page.locator('[data-printing^="CSD02c-005"]') }).first();
  await clickCard(card);
  await manual.getByTestId("manual-play").click();

  const looked = page.getByTestId("looked");
  await expect(looked).toBeVisible();
  await expect(looked.getByTestId("looked-card")).toHaveCount(1);
  await expect(looked).toContainText("只有你能看到");
  await page.screenshot({ path: test.info().outputPath("looked.png") });
  // The deck still has it on top (nothing moved), and the log tells the look.
  const deckCount = await page.getByTestId("deck-0").innerText();
  await looked.getByTestId("looked-ok").click();
  await expect(looked).toHaveCount(0);
  await expect(page.getByTestId("deck-0")).toHaveText(deckCount);
  await expect(page.locator(".sve-decision")).toHaveAttribute("data-decision", "mainPhase");
  await page.getByTestId("sidebar-show").click();
  await expect(page.locator(".sve-log")).toContainText("查看");
  expect(problems).toEqual([]);
});
