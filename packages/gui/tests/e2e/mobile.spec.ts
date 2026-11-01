import { expect, test, type CDPSession, type Page } from "@playwright/test";
import { pressAnnouncementOk, startGame, tokenByHand, toMainPhase, useSettings } from "./helpers";

// A phone held sideways (the Android app is this web app in the phone's WebView): the menus fit; in a game the mats take
// the screen's height between two columns (the card panel on the left; the players, the buttons and your folded hand on
// the right), a tap spreads the hand, cards are played by tapping; the deck builder has a deck tab and a pool tab, a tap
// adds or removes, a long press reads.
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

/** A finger moved from one point to another, with the touch events a phone sends (a drag). */
async function fingerDrag(page: Page, cdp: CDPSession, from: { x: number; y: number }, to: { x: number; y: number }): Promise<void> {
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [from] });
  for (let i = 1; i <= 20; i++) {
    const point = { x: from.x + ((to.x - from.x) * i) / 20, y: from.y + ((to.y - from.y) * i) / 20 };
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [point] });
    await page.waitForTimeout(16);
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}

/** Tap a card of the hand where it shows (the cards overlap: its left part). */
async function tapCard(page: Page, selector: string): Promise<void> {
  const box = (await page.locator(selector).first().boundingBox())!;
  await page.touchscreen.tap(box.x + 8, box.y + box.height / 2);
}

test("a phone held sideways: the menus fit, the mats take the height between two columns, the hand spreads on a tap", async ({ page }) => {
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
  // Bot-Medium v2's is the longest; then back to the level this game is played against.
  const opponent = page.getByTestId("setup-controller-1");
  await opponent.selectOption("medium-v2");
  const longest = (await page.getByTestId("setup-controller-hint").boundingBox())!;
  expect(longest.x + longest.width).toBeLessThanOrEqual(915);
  expect(await page.evaluate("document.documentElement.scrollWidth <= window.innerWidth")).toBe(true);
  await opponent.selectOption("medium");
  await page.getByTestId("start-game").tap();
  const table = page.locator(".sve-table[data-phone]");
  await expect(table).toBeVisible();
  // The mats are as tall as the screen; the card panel is the left column, the players are in the right one.
  const mats = (await page.locator(".sve-mats").boundingBox())!;
  const left = (await page.getByTestId("game-left").boundingBox())!;
  const right = (await page.getByTestId("phone-right").boundingBox())!;
  expect(mats.height).toBeGreaterThan(412 - 4);
  expect(left.x + left.width).toBeLessThanOrEqual(mats.x + 1);
  expect(right.x).toBeGreaterThanOrEqual(mats.x + mats.width - 1);
  await expect(page.getByTestId("phone-panel")).toHaveAttribute("data-panel", "card");
  await expect(page.getByTestId("player-panel-0")).toBeVisible();
  await expect(page.getByTestId("player-panel-1")).toBeVisible();

  // Keep the hand, go first when asked, until your main phase.
  const bar = page.locator(".sve-decision");
  for (let i = 0; i < 40; i++) {
    const kind = await bar.getAttribute("data-decision");
    if (kind === "mainPhase") break;
    if (kind === "mulligan") await page.getByTestId("table-keep").tap();
    else if (kind === "chooseTurnOrder") await page.getByTestId("table-first").tap();
    else if (kind === "quick") await page.getByTestId("table-pass").tap();
    else if (kind === "announcement") await pressAnnouncementOk(page, true);
    await page.waitForTimeout(150);
  }
  await expect(bar).toHaveAttribute("data-decision", "mainPhase");
  // Who goes first and who second, on the players.
  expect([await page.getByTestId("player-order-0").innerText(), await page.getByTestId("player-order-1").innerText()].sort()).toEqual(["1st", "2nd"]);
  // The log takes the card panel's place; a long press on a card brings the card back, showing that card (while nothing
  // moves on the table: a long press waits half a second).
  await page.getByTestId("phone-log").tap();
  await expect(page.getByTestId("phone-panel")).toHaveAttribute("data-panel", "log");
  const held = await longPress(page, ".sve-mat-opponent [data-card]");
  expect(held).not.toBe("");
  await expect(page.getByTestId("phone-panel")).toHaveAttribute("data-panel", "card");
  await expect(page.getByTestId("phone-panel")).toContainText(held);
  // Your hand is folded in the right column's bottom corner; a tap spreads it along the bottom of the screen, a tap
  // elsewhere folds it again.
  const folded = (await page.locator(".sve-hand-own").boundingBox())!;
  expect(folded.x).toBeGreaterThanOrEqual(mats.x + mats.width - 1);
  expect(folded.y + folded.height).toBeLessThanOrEqual(412 + 1);
  await page.getByTestId("hand-spread").tap();
  await expect(table).toHaveAttribute("data-hand-spread", "");
  const spread = (await page.locator(".sve-hand-own .sve-hand-cards").boundingBox())!;
  expect(spread.width).toBeGreaterThan(folded.width);
  await page.touchscreen.tap(mats.x + mats.width / 2, mats.y + mats.height / 2);
  await expect(table).not.toHaveAttribute("data-hand-spread", "");

  // Spread, a tap on a card the main phase lets you play opens its menu (a tap elsewhere closes it and folds the hand);
  // spread again, a finger drags the card onto your field: it is played, and the hand folds again.
  const lit = page.locator(".sve-hand-own .sve-card-action");
  if ((await lit.count()) > 0) {
    await page.getByTestId("hand-spread").tap();
    await tapCard(page, ".sve-hand-own .sve-card-action");
    await expect(page.getByTestId("card-menu").getByRole("menuitem").first()).toBeVisible();
    await page.touchscreen.tap(mats.x + mats.width / 2, mats.y + 20);
    await expect(page.getByTestId("card-menu")).toHaveCount(0);
    await expect(table).not.toHaveAttribute("data-hand-spread", "");
    await page.getByTestId("hand-spread").tap();
    const hand = await page.locator(".sve-hand-own [data-card]").count();
    const card = (await lit.first().boundingBox())!;
    const slot = (await page.locator(".sve-mat-own .sve-field-slot").nth(2).boundingBox())!;
    const cdp = await page.context().newCDPSession(page);
    await fingerDrag(page, cdp, { x: card.x + card.width / 2, y: card.y + card.height / 3 }, { x: slot.x + slot.width / 2, y: slot.y + slot.height / 2 });
    await expect(page.locator(".sve-hand-own [data-card]")).toHaveCount(hand - 1);
    await expect(table).not.toHaveAttribute("data-hand-spread", "");
  }

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
  // The debug tab is in the card panel's place, as the log is.
  await page.getByTestId("phone-log").tap();
  await page.getByTestId("tab-debug").tap();
  await page.getByTestId("debug-manual").uncheck();
  await page.getByTestId("phone-log-close").tap();

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
  const defense = page.getByTestId("leader-1").locator(".sve-leader-defense");
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
