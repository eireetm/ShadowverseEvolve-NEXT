import { expect, test, type Page } from "@playwright/test";
import { pressAnnouncementOk, useSettings } from "./helpers";

// A phone held upright: from the top a bar, the card panel, the players with the turn between them, the table (its mats
// as wide as the screen, your hand a row under them, played by tapping as anywhere) and the bar of buttons; the log takes
// the card panel's place.
test.use({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });

/** A long press of a finger on a card (the pointer events of a touch, held longer than long-press.ts waits): its name. */
async function longPress(page: Page, selector: string): Promise<string> {
  const outer = page.locator(selector).first();
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

test("a phone held upright: bars above and under the table, the mats as wide as the screen, a game played by tapping", async ({ page }) => {
  const problems: string[] = [];
  page.on("pageerror", (e) => problems.push(e.message));
  await useSettings(page, { uiLang: "en", botDelayMs: 0, setupDecks: ["samples/sd01.json", "samples/sd02.json"], setupControllers: ["human", "greedy"] });
  await page.goto("/");
  const play = page.getByTestId("menu-play");
  await expect(play).toBeEnabled({ timeout: 120_000 });
  await play.tap();
  await expect(page.getByTestId("start-game")).toBeEnabled({ timeout: 60_000 });
  await page.getByTestId("start-game").tap();
  const table = page.locator('.sve-table[data-phone="portrait"]');
  await expect(table).toBeVisible();

  // From the top: the bar, the card panel, the players, the table, the bar of buttons, one under the other, all on the screen.
  const boxes = [];
  for (const part of [page.getByTestId("phone-tools"), page.getByTestId("game-left"), page.getByTestId("phone-right"), table, page.getByTestId("phone-bottom")]) {
    boxes.push((await part.boundingBox())!);
  }
  for (let i = 1; i < boxes.length; i++) expect(boxes[i]!.y).toBeGreaterThanOrEqual(boxes[i - 1]!.y + boxes[i - 1]!.height - 1);
  const bottom = boxes[boxes.length - 1]!;
  expect(bottom.y + bottom.height).toBeLessThanOrEqual(844 + 1);
  // The mats are as wide as the screen (nearly), your hand is under them.
  const mats = (await page.locator(".sve-mats").boundingBox())!;
  expect(mats.width).toBeGreaterThan(390 * 0.9);
  const hand = (await page.locator(".sve-hand-own").boundingBox())!;
  expect(hand.y).toBeGreaterThanOrEqual(mats.y + mats.height - 1);
  await expect(page.getByTestId("player-panel-0")).toBeVisible();
  await expect(page.getByTestId("player-panel-1")).toBeVisible();

  // Keep the hand, go first when asked, until your main phase: the buttons are in the bar under the table.
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
  await expect(page.getByTestId("phone-bottom").getByTestId("table-end")).toBeVisible();
  expect([await page.getByTestId("player-order-0").innerText(), await page.getByTestId("player-order-1").innerText()].sort()).toEqual(["1st", "2nd"]);

  // The log takes the card panel's place; a long press on a card brings the card back, showing that card.
  await page.getByTestId("phone-log").tap();
  await expect(page.getByTestId("phone-panel")).toHaveAttribute("data-panel", "log");
  const held = await longPress(page, ".sve-mat-opponent [data-card]");
  expect(held).not.toBe("");
  await expect(page.getByTestId("phone-panel")).toHaveAttribute("data-panel", "card");
  await expect(page.getByTestId("phone-panel")).toContainText(held);

  // A tap on a card the main phase lets you play (your hand isn't folded upright): its menu; tap "Play".
  const lit = page.locator(".sve-hand-own .sve-card-action");
  if ((await lit.count()) > 0) {
    const before = Number(await bar.getAttribute("data-inputs"));
    const card = (await lit.first().boundingBox())!;
    await page.touchscreen.tap(card.x + 8, card.y + card.height / 2);
    const item = page.getByTestId("card-menu").getByRole("menuitem").first();
    await expect(item).toBeVisible();
    await item.tap();
    await expect.poll(async () => Number(await bar.getAttribute("data-inputs"))).toBeGreaterThan(before);
  }
  expect(problems).toEqual([]);
});
