import { expect, test, type Page } from "@playwright/test";
import { hasCardTexts, clickCard, showSidebar, startGame, toMainPhase, tokenByHand, useSettings } from "./helpers";

// What a decision is part of (the engine worker follows it, engine/processing.ts): the decision window and the table name the
// card or ability being played and show its text. And the card panel shows what playing a card in the hand costs now when
// that isn't its cost (the core reckons it). Here Mysteria, Magic Founder (BP06-037): its Fanfare's optional cost and target,
// then its "any Academic follower you play costs 1 less" for a Palla, Student Teacher in the hand.

const handCard = (page: Page, name: string) => page.locator(`.sve-hand-own .sve-card[title="${name}"]`).first();

test("the ability being processed, in the decision window and beside the table; a hand card's play cost", async ({ page }) => {
  const problems: string[] = [];
  page.on("pageerror", (e) => problems.push(e.message));
  await useSettings(page, { uiLang: "en", cardLang: "en", botDelayMs: 0, manualDebug: true, setupControllers: ["human", "greedy"], setupDecks: ["samples/dsd01a.json", "samples/sd02.json"] });
  await startGame(page, "processing-e2e");
  await toMainPhase(page);
  // The turn beside the table: the game's, and under it the active player's own (CR 3.3).
  await expect(page.getByTestId("center-active-player")).toContainText(/turn \d+/);

  // By hand: Mysteria and Palla into the hand, 10 play points, two Knights on the opponent's field; then manual debugging off.
  const manual = page.getByTestId("manual-dialog");
  for (const name of ["Mysteria, Magic Founder", "Palla, Student Teacher"]) {
    await page.getByTestId("deck-0").click();
    await manual.getByTestId("manual-search").filter({ hasText: name }).first().click();
    await page.keyboard.press("Escape");
    await expect(handCard(page, name)).toHaveCount(1);
  }
  await page.getByTestId("player-panel-0").click();
  await page.getByTestId("manual-playPoints").fill("10");
  await page.getByTestId("manual-maxPlayPoints").fill("10");
  await page.getByTestId("manual-points").click();
  await page.keyboard.press("Escape");
  await tokenByHand(page, 1, "Knight", "field");
  await tokenByHand(page, 1, "Knight", "field");
  await showSidebar(page);
  await page.getByRole("button", { name: /^Debug$/ }).click();
  await page.getByTestId("debug-manual").uncheck();
  await page.getByTestId("sidebar-hide").click();

  // Palla costs what it says: no play cost beside it.
  await handCard(page, "Palla, Student Teacher").hover();
  await expect(page.locator(".sve-details-name")).toHaveText("Palla, Student Teacher");
  await expect(page.getByTestId("details-play-cost")).toHaveCount(0);

  // Mysteria played: its Fanfare asks whether to pay its cost (reveal an Academic follower) — in the window, under what it is part of.
  await clickCard(handCard(page, "Mysteria, Magic Founder"));
  await page.getByTestId("card-menu").getByRole("menuitem").first().click();
  const dialog = page.getByTestId("decision-dialog");
  await expect(dialog.getByTestId("processing")).toContainText("Processing Mysteria, Magic Founder — Fanfare");
  // Its paragraph of the card text (this machine's texts, which a clone of the repository hasn't).
  if (hasCardTexts) await expect(dialog.locator(".sve-processing-text")).toContainText("Reveal an Academic follower from your hand");
  await dialog.getByRole("button", { name: "Yes" }).click();

  // Its target is chosen on the table: beside it, one line that opens the same text.
  const table = page.getByTestId("table-processing");
  await expect(table).toContainText("Processing Mysteria, Magic Founder — Fanfare");
  if (hasCardTexts) {
    await table.locator("summary").click();
    await expect(table.locator(".sve-processing-text")).toContainText("deal it 2 damage");
  }
  await clickCard(page.locator(".sve-mat-opponent .sve-field-slot .sve-card-candidate").first());
  // Then its cost: which Academic follower to reveal (Palla, among the hand's) — still part of the Fanfare.
  await expect(table).toContainText("Processing Mysteria, Magic Founder — Fanfare");
  await clickCard(page.locator('.sve-hand-own .sve-card-candidate[title="Palla, Student Teacher"]').first());
  await expect(table).toHaveCount(0);

  // With Mysteria on the field, an Academic follower costs 1 less to play: the card panel shows it beside its cost.
  await handCard(page, "Palla, Student Teacher").hover();
  await expect(page.locator(".sve-details-name")).toHaveText("Palla, Student Teacher");
  await expect(page.getByTestId("details-play-cost")).toHaveText("Play cost2");
  expect(problems).toEqual([]);
});
