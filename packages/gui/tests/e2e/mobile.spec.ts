import { expect, test, type Page } from "@playwright/test";
import { showSidebar, startGame, toMainPhase, tokenByHand, useSettings } from "./helpers";

// A phone held sideways (the Android app is this web app in the phone's WebView): the menus fit, the
// table packs tighter with your hand beside your mat, the card panel is a drawer (its button or a long press opens it),
// cards are played by tapping; the deck builder has a deck tab and a pool tab, a tap adds or removes, a long press reads.
test.use({ viewport: { width: 915, height: 412 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });

/** A long press of a finger on a card (the pointer events of a touch, held longer than long-press.ts waits): its name. */
async function longPress(page: Page, selector: string): Promise<string> {
  const outer = page.locator(selector).first();
  // The finger lands on the card's picture: the events go there (and bubble), as a real touch's do.
  const target = (await outer.locator(".sve-card-art").count()) > 0 ? outer.locator(".sve-card-art").first() : outer;
  const card = (await outer.getAttribute("title")) !== null ? outer : outer.locator(".sve-card[title]").first();
  const name = (await card.getAttribute("title")) ?? "";
  const box = (await target.boundingBox())!;
  const at = { clientX: box.x + box.width / 2, clientY: box.y + box.height / 2, pointerType: "touch", pointerId: 11, isPrimary: true };
  await target.dispatchEvent("pointerover", at);
  await target.dispatchEvent("pointerdown", { ...at, button: 0 });
  await page.waitForTimeout(700);
  await page.evaluate(`window.dispatchEvent(new PointerEvent("pointerup", ${JSON.stringify(at)}))`);
  await target.dispatchEvent("click", at);
  return name;
}

/** Tap a card of the hand where it shows (the cards overlap: its left part). */
async function tapCard(page: Page, selector: string): Promise<void> {
  const box = (await page.locator(selector).first().boundingBox())!;
  await page.touchscreen.tap(box.x + 8, box.y + box.height / 2);
}

test("a phone: the menus fit, a game is played by tapping, the card panel is a drawer", async ({ page }) => {
  const problems: string[] = [];
  page.on("pageerror", (e) => problems.push(e.message));
  await useSettings(page, { uiLang: "en", botDelayMs: 0, setupDecks: ["samples/sd01.json", "samples/sd02.json"] });
  await page.goto("/");
  const play = page.getByTestId("menu-play");
  await expect(play).toBeEnabled({ timeout: 120_000 });
  // The whole menu is on the screen.
  const menu = (await page.locator(".sve-menu-panel").boundingBox())!;
  expect(menu.y).toBeGreaterThanOrEqual(0);
  expect(menu.y + menu.height).toBeLessThanOrEqual(412);
  await play.tap();
  await expect(page.getByTestId("start-game")).toBeEnabled({ timeout: 60_000 });
  // What the opponent's AI does wraps within the phone's width; the page doesn't scroll sideways.
  const hint = (await page.getByTestId("setup-controller-hint").boundingBox())!;
  expect(hint.x + hint.width).toBeLessThanOrEqual(915);
  expect(await page.evaluate("document.documentElement.scrollWidth <= window.innerWidth")).toBe(true);
  await page.getByTestId("start-game").tap();
  await expect(page.locator(".sve-table[data-compact]")).toBeVisible();
  // No left column: the table has the whole width; the drawer opens from its button and hides again.
  await expect(page.getByTestId("game-left")).toHaveCount(0);
  await page.getByTestId("details-show").tap();
  await expect(page.getByTestId("game-left")).toBeVisible();
  await expect(page.getByTestId("game-menu")).toBeVisible();
  await page.getByTestId("details-hide").tap();
  await expect(page.getByTestId("game-left")).toHaveCount(0);

  // Keep the hand, go first when asked, until your main phase.
  const bar = page.locator(".sve-decision");
  for (let i = 0; i < 40; i++) {
    const kind = await bar.getAttribute("data-decision");
    if (kind === "mainPhase") break;
    if (kind === "mulligan") await page.getByTestId("table-keep").tap();
    else if (kind === "chooseTurnOrder") await page.getByTestId("table-first").tap();
    else if (kind === "quick") await page.getByTestId("table-pass").tap();
    else if (kind === "announcement") await page.getByTestId("announcement-ok").tap();
    await page.waitForTimeout(150);
  }
  await expect(bar).toHaveAttribute("data-decision", "mainPhase");
  // Your hand is beside your mat, at the bottom right.
  const hand = (await page.locator(".sve-hand-own").boundingBox())!;
  const mats = (await page.locator(".sve-mats").boundingBox())!;
  expect(hand.x).toBeGreaterThanOrEqual(mats.x + mats.width - 1);

  // Tap a card the main phase lets you play: its menu; tap "Play".
  const lit = ".sve-hand-own .sve-card-action";
  if ((await page.locator(lit).count()) > 0) {
    const before = Number(await bar.getAttribute("data-inputs"));
    await tapCard(page, lit);
    const item = page.getByTestId("card-menu").getByRole("menuitem").first();
    await expect(item).toBeVisible();
    await item.tap();
    await expect.poll(async () => Number(await bar.getAttribute("data-inputs"))).toBeGreaterThan(before);
  }

  // A long press on a card opens the drawer with that card.
  const held = await longPress(page, ".sve-mat-opponent [data-card]");
  expect(held).not.toBe("");
  await expect(page.getByTestId("game-left")).toBeVisible();
  await expect(page.locator(".sve-drawer .sve-sidebar-card")).toContainText(held);
  await page.getByTestId("details-hide").tap();
  expect(problems).toEqual([]);
});

/** A finger from (x, from) to (x, to), the touch events a phone sends (the browser scrolls what is under it). */
async function swipe(page: Page, x: number, from: number, to: number): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y: from }] });
  for (let i = 1; i <= 10; i++) await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y: from + ((to - from) * i) / 10 }] });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await cdp.detach();
}

/** A player's field on the table. */
const fieldOf = (page: Page, player: 0 | 1) => page.locator(`${player === 0 ? ".sve-mat-own" : ".sve-mat-opponent"} .sve-field-slot .sve-card`);

/** By hand (manual debugging): a Knight token (1/1 follower) onto a player's field. */
async function knightOnto(page: Page, player: 0 | 1): Promise<void> {
  const before = await fieldOf(page, player).count();
  await tokenByHand(page, player, "Knight", "field");
  await expect(fieldOf(page, player)).toHaveCount(before + 1);
}

test("a phone: a card's menu longer than the room beside the card scrolls, by finger, to its last item", async ({ page }) => {
  const problems: string[] = [];
  page.on("pageerror", (e) => problems.push(e.message));
  await useSettings(page, { uiLang: "en", botDelayMs: 0, manualDebug: true, setupControllers: ["human", "greedy"], setupDecks: ["samples/sd01.json", "samples/sd02.json"] });
  await startGame(page, "menu-scroll");
  await toMainPhase(page);
  // By hand: enemy Knights until the enemy field is full (5), and a Knight of yours with Storm and Assail (the reserved
  // enemy followers too, CR 12.11.2): it can attack six times.
  while ((await fieldOf(page, 1).count()) < 5) await knightOnto(page, 1);
  await knightOnto(page, 0);
  const mine = fieldOf(page, 0).last();
  await mine.click();
  const dialog = page.getByTestId("manual-dialog");
  for (const keyword of ["storm", "assail"]) {
    await dialog.locator("select").filter({ has: page.locator("option[value=storm]") }).selectOption(keyword);
    await dialog.getByRole("button", { name: "Give a keyword" }).click();
  }
  await expect(mine).toContainText("Assail");
  await page.keyboard.press("Escape");
  await showSidebar(page);
  await page.getByRole("button", { name: /^Debug$/ }).click();
  await page.getByTestId("debug-manual").uncheck();
  await page.getByTestId("sidebar-hide").click();

  // Its menu stays on the screen; the items don't all fit: the list scrolls, its lower edge fades.
  await mine.tap();
  const menu = page.getByTestId("card-menu");
  const items = page.getByTestId("card-menu-items");
  await expect(items.getByRole("menuitem")).toHaveCount(6);
  const box = (await menu.boundingBox())!;
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.y + box.height).toBeLessThanOrEqual(412);
  expect(await items.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
  await expect(items).toHaveAttribute("data-more-below", "");
  // A finger moves the list up: the last item (the enemy leader) comes into view, and a tap attacks with it.
  const list = (await items.boundingBox())!;
  await swipe(page, list.x + list.width / 2, list.y + list.height - 20, list.y + 20);
  await expect.poll(() => items.evaluate((el) => el.scrollTop + el.clientHeight >= el.scrollHeight - 1)).toBe(true);
  await expect(items).toHaveAttribute("data-more-above", "");
  const leader = items.getByRole("menuitem", { name: /leader$/ });
  const last = (await leader.boundingBox())!;
  expect(last.y + last.height).toBeLessThanOrEqual(list.y + list.height + 1);
  const defense = page.getByTestId("player-panel-1").locator(".sve-player-defense");
  const before = Number(await defense.innerText());
  await leader.tap();
  await expect(defense).toHaveText(String(before - 1));
  expect(problems).toEqual([]);
});

test("a phone: the deck builder's deck and pool tabs, tap to add or remove, hold to read", async ({ page }) => {
  const problems: string[] = [];
  page.on("pageerror", (e) => problems.push(e.message));
  await useSettings(page, { uiLang: "en", builderDeck: "samples/sd01.json" });
  await page.goto("/");
  const decks = page.getByTestId("menu-decks");
  await expect(decks).toBeEnabled({ timeout: 120_000 });
  await decks.tap();
  const deckTab = page.getByTestId("builder-tab-deck");
  await expect(deckTab).toHaveText("Deck 40 + 8");
  // The pool isn't shown with the deck, nor the deck with the pool.
  await expect(page.getByTestId("builder-pool")).toBeHidden();
  await page.locator(".sve-deck-tile").first().tap();
  await expect(deckTab).toHaveText("Deck 39 + 8");
  await page.getByTestId("builder-tab-pool").tap();
  await expect(page.getByTestId("builder-pool")).toBeVisible();
  await expect(page.getByTestId("builder-deck")).toBeHidden();
  // The pool tab scrolls as a whole: the filters go up out of sight, the cards get the screen.
  await page.evaluate(`document.querySelector(".sve-builder-pool").scrollBy(0, 400)`);
  await expect.poll(async () => (await page.getByTestId("builder-search").boundingBox())?.y ?? 0).toBeLessThan(0);
  await page.evaluate(`document.querySelector(".sve-builder-pool").scrollTo(0, 0)`);
  await page.locator(".sve-pool-tile").first().tap();
  await expect(deckTab).toHaveText("Deck 40 + 8");
  // A long press reads the card: nothing is added.
  const held = await longPress(page, ".sve-pool-tile >> nth=1");
  await expect(page.locator(".sve-drawer .sve-sidebar-card")).toContainText(held);
  await expect(deckTab).toHaveText("Deck 40 + 8");
  expect(problems).toEqual([]);
});
