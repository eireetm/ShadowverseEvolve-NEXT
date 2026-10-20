import { expect, test } from "@playwright/test";
import { clickCard, startGame, toMainPhase, tokenByHand, useSettings } from "./helpers";

// The card panel shows what playing a card costs now where that isn't its cost (the core reckons it, GameUpdate.playCosts):
// for the other player's cards in their EX area too, a public zone. Here Rulenye, Omen of Silence (BP05-070: "any spell an
// opponent plays costs 1 more") put by hand onto the person's field, and a Glittering Gold (a spell token that costs 0) into
// the opponent's EX area. The person's deck is a deck file served here, in the unlimited format.

const RULENYE_DECK = { format: "sve-deck", version: 1, name: "Rulenye", leader: "SD05-LD01", main: { "BP05-070": 40 }, evolve: {} };

test("an opponent's card in their EX area: the card panel shows what playing it costs them now", async ({ page }) => {
  const problems: string[] = [];
  page.on("pageerror", (e) => problems.push(e.message));
  await useSettings(page, {
    uiLang: "en",
    cardLang: "en",
    botDelayMs: 0,
    manualDebug: true,
    format: "unlimited",
    setupDecks: ["rulenye.json", "samples/sd02.json"],
    setupControllers: ["human", "greedy"],
    setupTurnOrder: "player1",
  });
  await page.route("**/api/decks/rulenye.json", (route) => route.fulfill({ json: RULENYE_DECK }));
  await startGame(page, "play-costs-e2e");
  await toMainPhase(page);

  // By hand: a Rulenye onto the field, a Glittering Gold into the opponent's EX area.
  await clickCard(page.locator(".sve-hand-own .sve-card").first());
  await page.getByTestId("manual-move-field").click();
  await expect(page.locator(".sve-mat-own .sve-field-slot .sve-card")).toHaveCount(1);
  await tokenByHand(page, 1, "Glittering Gold", "ex");

  // It costs the opponent 1 more to play: 1 beside its cost 0.
  await page.locator('.sve-ex-card[title="Glittering Gold"]').first().hover();
  await expect(page.locator(".sve-details-name")).toHaveText("Glittering Gold");
  await expect(page.getByTestId("details-play-cost")).toHaveText("Play cost1");
  // A Rulenye in the person's hand costs what it says (it raises the opponent's spells only).
  await page.locator(".sve-hand-own .sve-card").first().hover();
  await expect(page.locator(".sve-details-name")).toHaveText("Rulenye, Omen of Silence");
  await expect(page.getByTestId("details-play-cost")).toHaveCount(0);
  expect(problems).toEqual([]);
});
