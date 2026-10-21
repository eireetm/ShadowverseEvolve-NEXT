import { expect, test, type Locator, type Page } from "@playwright/test";
import { showSidebar, startGame, toMainPhase, useSettings } from "./helpers";

// A die rolled (game/board/DiceRoll.tsx): a window over the table, the die tumbling onto the number the log says, "骰子掷出了
// N" under it; it goes by itself, or at a click. A deck of BP21-081 (1-cost follower, Fanfare: roll a 6-sided die), served
// here as a deck file, in the unlimited format.

const DICE_DECK = { format: "sve-deck", version: 1, name: "骰子", leader: "SD05-LD01", main: { "BP21-081": 40 }, evolve: {} };

async function center(locator: Locator): Promise<{ x: number; y: number }> {
  const box = (await locator.boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/**
 * Answer the game up to the person's first main phase (they go first): a card of their hand can then be played. (Answering
 * as fast as the decision bar reads may read a decision just answered again: toMainPhase waits a moment after each.)
 */
async function toPlayable(page: Page): Promise<Locator> {
  await toMainPhase(page);
  const lit = page.locator(".sve-hand-own .sve-card-action").first();
  await expect(lit).toBeVisible();
  return lit;
}

/** Drag a card of the hand onto the person's field. */
async function play(page: Page, card: Locator): Promise<void> {
  const a = await center(card);
  const b = await center(page.locator(".sve-mat-own .sve-field-slot").nth(2));
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(a.x + ((b.x - a.x) * i) / 10, a.y + ((b.y - a.y) * i) / 10);
  await page.mouse.up();
}

test("a die rolled shows in a window: it tumbles onto the number the log says, then goes by itself", async ({ page }) => {
  const problems: string[] = [];
  page.on("pageerror", (e) => problems.push(e.message));
  await useSettings(page, {
    uiLang: "zh",
    botDelayMs: 0,
    format: "unlimited",
    setupDecks: ["dice.json", "samples/sd02.json"],
    setupControllers: ["human", "greedy"],
    setupTurnOrder: "player1",
  });
  await page.route("**/api/decks/dice.json", (route) => route.fulfill({ json: DICE_DECK }));
  await startGame(page, "dice");
  await play(page, await toPlayable(page));

  const dice = page.getByTestId("dice-roll");
  await expect(dice).toBeVisible();
  await expect(dice.locator(".sve-dice-who")).toHaveText("玩家 1掷骰子"); // as the log names the player
  // It tumbles first, then says its number.
  await expect(page.getByTestId("dice-result")).toHaveText(/^骰子掷出了 [1-6]$/);
  const n = await dice.getAttribute("data-result");
  await showSidebar(page);
  await expect(page.locator(".sve-log-line").filter({ hasText: `掷出 ${n}。` })).toHaveCount(1);
  // It goes by itself (a moment after it has landed).
  await expect(dice).toHaveCount(0, { timeout: 5_000 });
  expect(problems).toEqual([]);
});

test("the debug tab's option turns the dice window off (it is on at first): the roll is in the log only", async ({ page }) => {
  const problems: string[] = [];
  page.on("pageerror", (e) => problems.push(e.message));
  await useSettings(page, {
    uiLang: "zh",
    botDelayMs: 0,
    format: "unlimited",
    setupDecks: ["dice.json", "samples/sd02.json"],
    setupControllers: ["human", "greedy"],
    setupTurnOrder: "player1",
  });
  await page.route("**/api/decks/dice.json", (route) => route.fulfill({ json: DICE_DECK }));
  await startGame(page, "dice-off");
  await showSidebar(page);
  await page.getByTestId("tab-debug").click();
  const off = page.getByTestId("debug-dice-off");
  await expect(off.locator("..")).toHaveText("关闭骰子动画");
  await expect(off).not.toBeChecked();
  await off.check();
  await page.getByTestId("sidebar-hide").click();
  await play(page, await toPlayable(page));
  await showSidebar(page);
  await page.getByTestId("tab-log").click();
  await expect(page.locator(".sve-log-line").filter({ hasText: /掷出 [1-6]。/ })).toHaveCount(1);
  await expect(page.getByTestId("dice-roll")).toHaveCount(0);
  expect(problems).toEqual([]);
});

test("without animations the die shows its number at once, and a click sends the window away", async ({ page }) => {
  await useSettings(page, {
    uiLang: "zh",
    botDelayMs: 0,
    animations: false,
    format: "unlimited",
    setupDecks: ["dice.json", "samples/sd02.json"],
    setupControllers: ["human", "greedy"],
    setupTurnOrder: "player1",
  });
  await page.route("**/api/decks/dice.json", (route) => route.fulfill({ json: DICE_DECK }));
  await startGame(page, "dice-still");
  await play(page, await toPlayable(page));
  const dice = page.getByTestId("dice-roll");
  await expect(page.getByTestId("dice-result")).toHaveText(/^骰子掷出了 [1-6]$/, { timeout: 500 });
  await expect(dice.locator(".sve-die-rolling")).toHaveCount(0);
  await dice.click();
  await expect(dice).toHaveCount(0);
});
