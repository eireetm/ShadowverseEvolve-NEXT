import { expect, test } from "@playwright/test";
import { startGame, useSettings } from "./helpers";

// Who goes first, said as the game begins (board/TurnOrderNotice.tsx): "You go first" / "You go second" for the person
// playing against a bot, for a few seconds over the table; a click sends it away sooner. The log says it too.

for (const [order, text] of [
  ["player1", "You go first"],
  ["player2", "You go second"],
] as const) {
  test(`the first player is told as the game begins: ${order}`, async ({ page }) => {
    await useSettings(page, { uiLang: "en", setupTurnOrder: order, setupControllers: ["human", "greedy"] });
    await startGame(page);
    const notice = page.getByTestId("turn-order");
    await expect(notice.locator("strong")).toHaveText(text, { timeout: 30_000 });
    await expect(notice.locator("span")).toHaveText(order === "player1" ? "Player 1 goes first, Player 2 (Bot-Easy) goes second." : "Player 2 (Bot-Easy) goes first, Player 1 goes second.");
    // It goes by itself (or at a click).
    await notice.click();
    await expect(notice).toHaveCount(0);
  });
}
