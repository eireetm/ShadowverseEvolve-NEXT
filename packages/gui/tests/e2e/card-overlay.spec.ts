import { expect, test, type Page } from "@playwright/test";
import type { Keyword, ManualOp } from "@sve/core";
import { startGame, toMainPhase, useSettings } from "./helpers";

async function boot(page: Page) {
  await page.route("**/api/decks/samples/sd01.json", route => route.fulfill({ json: {
    format: "sve-deck", version: 1, name: "Overlay", leader: "SD03-LD01",
    main: { "BP01-170": 20, "BP13-060": 8, "BP15-041": 8, "BP05-070": 8, "BP03-038": 8, "BP14-046": 8, "BP01-001": 20 }, evolve: {},
  } }));
  await useSettings(page, { uiLang: "en", cardLang: "en", format: "unlimited", manualDebug: true, animations: false, revealAll: true,
    setupControllers: ["human", "human"], setupTurnOrder: "player1", setupDecks: ["samples/sd01.json", "samples/sd01.json"] });
  await startGame(page, "overlay-ui");
  await toMainPhase(page);
  await page.evaluate(async () => {
    const path = "/src/app/store.ts";
    (await import(/* @vite-ignore */ path)).engine.send({ kind: "settings", settings: { revealAll: true, announceQuick: false } });
  });
  await expect.poll(() => page.evaluate(async () => {
    const path = "/src/app/store.ts";
    return (await import(/* @vite-ignore */ path)).getApp().update.view.players[1].hand.every((c: { hidden: boolean }) => !c.hidden);
  })).toBe(true);
  await manual(page, { kind: "points", player: 0, playPoints: 30, maxPlayPoints: 10 });
}
async function inputs(page: Page) {
  return page.evaluate(async () => {
    const path = "/src/app/store.ts";
    return (await import(/* @vite-ignore */ path)).getApp().update.inputCount as number;
  });
}
async function manual(page: Page, op: ManualOp) {
  const before = await inputs(page);
  await page.evaluate(async op => {
    const path = "/src/app/store.ts";
    const { engine, getApp } = await import(/* @vite-ignore */ path);
    engine.send({ kind: "answer", seat: getApp().update.decision.decision.player, answer: { type: "mainPhase", action: { type: "manual", op } } });
  }, op);
  await expect.poll(() => inputs(page)).toBeGreaterThan(before);
  await toMainPhase(page);
}
async function cardId(page: Page, def: string, zone = "hand", player = 0): Promise<string> {
  return page.evaluate(async ({ def, zone, player }) => {
    const path = "/src/app/store.ts";
    return (await import(/* @vite-ignore */ path)).getApp().update.view.players[player][zone].find((c: { def: string }) => c.def === def)?.id ?? "";
  }, { def, zone, player });
}
async function getCard(page: Page, def: string, player = 0): Promise<string> {
  if (!await cardId(page, def, "hand", player)) await manual(page, { kind: "search", player: player as 0 | 1, def });
  return cardId(page, def, "hand", player);
}
async function action(page: Page, card: string, type: "play" | "activate", settle = true) {
  const before = await inputs(page);
  await page.evaluate(async ({ card, type }) => {
    const path = "/src/app/store.ts";
    const { engine, getApp } = await import(/* @vite-ignore */ path);
    const decision = getApp().update.decision.decision;
    const action = decision.actions.find((a: { type: string; card?: string }) => a.type === type && a.card === card);
    if (!action) throw new Error(`Missing ${type} for ${card}`);
    engine.send({ kind: "answer", seat: decision.player, answer: { type: "mainPhase", action } });
  }, { card, type });
  await expect.poll(() => inputs(page)).toBeGreaterThan(before);
  if (settle) await toMainPhase(page);
}
const tile = (page: Page, id: string) => page.locator(`.sve-table .sve-card[data-card="${id}"]`);
async function openZone(page: Page, zone: string, player = 0) {
  await page.evaluate(async ({ zone, player }) => {
    const path = "/src/game/board/zone-browser.ts";
    (await import(/* @vite-ignore */ path)).openZone({ zone, player });
  }, { zone, player });
}

test("costs follow normal taxes and next-card consumption across table, browser, drag ghost and details", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await boot(page);
  const base = await getCard(page, "BP13-060");
  await expect(tile(page, base).locator(".sve-stat-cost")).toHaveText("2");
  const optional = await getCard(page, "BP15-041");
  await expect(tile(page, optional).locator(".sve-stat-cost")).toHaveText("5");
  const tax = await getCard(page, "BP05-070", 1);
  await manual(page, { kind: "move", card: tax, to: "field" });
  await expect(tile(page, base).locator(".sve-stat-cost")).toHaveText("3↑");
  const originalColor = await tile(page, base).locator(".sve-stat-cost").evaluate(el => getComputedStyle(el).color);
  const exSource = await getCard(page, "BP01-170");
  await manual(page, { kind: "move", card: exSource, to: "ex" });
  const ex = await cardId(page, "BP01-170", "ex");
  const hand = await getCard(page, "BP01-170");
  const oz = await getCard(page, "BP03-038");
  await manual(page, { kind: "move", card: oz, to: "field" });
  const fieldOz = await cardId(page, "BP03-038", "field");
  await manual(page, { kind: "token", player: 0, token: "BP01-T10", to: "field" });
  await action(page, fieldOz, "activate");
  for (const id of [base, hand, ex]) await expect(tile(page, id).locator(".sve-stat-cost")).toHaveText("0↓");
  expect(await tile(page, base).locator(".sve-stat-cost").evaluate(el => getComputedStyle(el).color)).toBe(originalColor);
  await expect(tile(page, base).locator(".sve-stat-cost")).not.toHaveClass(/sve-up|sve-down/);

  await tile(page, hand).hover();
  const detail = page.getByTestId("details-play-cost");
  await expect(detail).toContainText("Current play cost");
  await expect(detail.locator("strong")).toHaveText("0");
  await expect(page.locator(".sve-details-stat").filter({ hasText: "Card cost" }).locator("strong")).toHaveText("2");
  await openZone(page, "ex");
  await expect(page.locator(`.sve-modal .sve-card[data-card="${ex}"] .sve-stat-cost`)).toHaveText("0↓");
  await page.keyboard.press("Escape");
  const box = (await tile(page, hand).boundingBox())!;
  await page.mouse.move(box.x + 10, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + 80, box.y - 40, { steps: 5 });
  await expect(page.locator(".sve-drag-ghost .sve-stat-cost")).toHaveText("0↓");
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await expect(tile(page, ex).locator(".sve-stat-cost")).toHaveText("0↓");

  // Keep another candidate's detail and EX browser open while a normal play consumes the offer.
  await tile(page, base).hover();
  await openZone(page, "ex");
  await action(page, hand, "play");
  await expect(tile(page, base).locator(".sve-stat-cost")).toHaveText("3↑");
  await expect(page.locator(`.sve-modal .sve-card[data-card="${ex}"] .sve-stat-cost`)).toHaveText("3↑");
  await expect(detail.locator("strong")).toHaveText("3");
  await page.keyboard.press("Escape");
  for (const [uiLang, label] of [["zh", "当前 play 费用"], ["zh-Hant", "當前 play 費用"], ["ja", "現在のプレイコスト"], ["en", "Current play cost"]]) {
    const before = await inputs(page);
    await page.evaluate(async uiLang => {
      const path = "/src/app/settings.ts";
      (await import(/* @vite-ignore */ path)).updateSettings({ uiLang });
    }, uiLang);
    await expect(detail).toContainText(label!);
    expect(await inputs(page)).toBe(before);
  }
  await manual(page, { kind: "move", card: ex, to: "cemetery" });
  await openZone(page, "cemetery");
  await expect(page.locator('.sve-modal .sve-card[data-def="BP01-170"] .sve-stat-cost').first()).toHaveText("2");
  expect(errors).toEqual([]);
});

test("BP14-046 previews all shared-group members and refreshes the others after one normal play", async ({ page }) => {
  await boot(page);
  const spell = await getCard(page, "BP14-046");
  await action(page, spell, "play");
  const members: { id: string; cost: number; type: string }[] = await page.evaluate(async () => {
    const path = "/src/app/store.ts";
    return (await import(/* @vite-ignore */ path)).getApp().update.view.players[0].ex;
  });
  expect(members.length).toBe(5);
  for (const member of members) await expect(tile(page, member.id).locator(".sve-stat-cost")).toHaveText("0↓");
  const playable = members.find(c => c.type === "follower" || c.type === "amulet") ?? members.find(c => c.cost === 2)!;
  await tile(page, members.find(c => c.id !== playable.id)!.id).hover();
  await openZone(page, "ex");
  await action(page, playable.id, "play");
  for (const member of members.filter(c => c.id !== playable.id)) {
    await expect(tile(page, member.id).locator(".sve-stat-cost")).toHaveText(String(member.cost));
    await expect(page.locator(`.sve-modal .sve-card[data-card="${member.id}"] .sve-stat-cost`)).toHaveText(String(member.cost));
  }
  await expect(page.getByTestId("details-play-cost").locator("strong")).not.toHaveText("0");
});

test("keyword expansion isolates clicks, selection, touch and back, and follows live keywords and language", async ({ page }) => {
  await boot(page);
  await manual(page, { kind: "token", player: 0, token: "BP01-T03", to: "field" });
  const id = await cardId(page, "BP01-T03", "field");
  const card = tile(page, id);
  const more = card.getByRole("button", { name: "Show all keywords" });
  await expect(card.locator(".sve-card-keywords")).toHaveCount(0);
  const keywords: Keyword[] = ["ward", "bane", "rush", "storm", "assail", "intimidate", "drain"];
  for (const keyword of keywords.slice(0, 3)) await manual(page, { kind: "keyword", card: id, keyword });
  await expect(card.locator(".sve-card-keywords .sve-kw")).toHaveCount(3);
  await expect(more).toHaveCount(0);
  await manual(page, { kind: "keyword", card: id, keyword: keywords[3]! });
  await expect(more).toHaveText("+1");
  const before = await inputs(page);
  await more.click();
  const popup = page.getByTestId("keyword-popover");
  await expect(popup.locator("li")).toHaveCount(4);
  await expect(more).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByTestId("manual-dialog")).toHaveCount(0);
  await expect(page.getByTestId("card-menu")).toHaveCount(0);
  expect(await inputs(page)).toBe(before);
  await popup.locator("li").last().click();
  expect(await inputs(page)).toBe(before);
  await page.keyboard.press("Escape");
  await expect(popup).toHaveCount(0);
  await expect(more).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(popup).toBeVisible();
  for (const keyword of keywords.slice(4)) await manual(page, { kind: "keyword", card: id, keyword });
  await expect(popup.locator("li")).toHaveCount(7);
  await expect(more).toHaveText("+4");
  await page.evaluate(async () => {
    const path = "/src/app/settings.ts";
    (await import(/* @vite-ignore */ path)).updateSettings({ uiLang: "zh-Hant" });
  });
  await expect(popup).toHaveAttribute("aria-label", "關鍵詞");
  await expect(popup.locator("li")).toContainText(["守護", "毀滅", "突進", "疾馳"]);
  await page.keyboard.press("Escape");
  await openZone(page, "field");
  const browser = page.locator(`.sve-modal .sve-card[data-card="${id}"]`);
  await browser.locator(".sve-keyword-more").click();
  await expect(popup.locator("li")).toHaveCount(7);
  await page.keyboard.press("Escape");
  await expect(popup).toHaveCount(0);
  await expect(browser).toBeVisible(); // Escape must not also close the containing zone browser.
  await page.keyboard.press("Escape");

  await page.setViewportSize({ width: 915, height: 412 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  const compactMore = card.locator(".sve-keyword-more");
  // A captured long press must ignore this button even when the touch listener is installed.
  await page.evaluate(async () => {
    const path = "/src/game/long-press.ts";
    (window as any).stopOverlayLongPress = (await import(/* @vite-ignore */ path)).installLongPress(document.querySelector(".sve-game"));
  });
  await compactMore.dispatchEvent("pointerdown", { pointerType: "touch", pointerId: 11, button: 0 });
  await page.waitForTimeout(550);
  await compactMore.dispatchEvent("pointerup", { pointerType: "touch", pointerId: 11, button: 0 });
  await compactMore.click();
  await expect(popup).toBeVisible();
  await expect(page.getByTestId("details-hide")).toHaveCount(0);
  const bounds = (await popup.boundingBox())!;
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(915);
  expect(bounds.y).toBeGreaterThanOrEqual(0);
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(412);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath("keywords-narrow.png") });
  await page.evaluate(async () => {
    const path = "/src/app/back.ts";
    (await import(/* @vite-ignore */ path)).goBack();
    (window as any).stopOverlayLongPress();
  });
  await expect(popup).toHaveCount(0);
  await page.setViewportSize({ width: 1600, height: 900 });
  await card.locator(".sve-keyword-more").click();
  await manual(page, { kind: "move", card: id, to: "cemetery" });
  await expect(popup).toHaveCount(0);
});

test("keyword buttons switch a single popover and do not answer a pending target selection", async ({ page }) => {
  await boot(page);
  for (let i = 0; i < 2; i++) await manual(page, { kind: "token", player: 1, token: "BP01-T03", to: "field" });
  const ids: string[] = await page.evaluate(async () => {
    const path = "/src/app/store.ts";
    return (await import(/* @vite-ignore */ path)).getApp().update.view.players[1].field.map((c: { id: string }) => c.id);
  });
  for (const id of ids) {
    for (const keyword of ["ward", "rush", "storm", "bane"] as const) await manual(page, { kind: "keyword", card: id, keyword });
  }
  const spell = await getCard(page, "BP13-060");
  await action(page, spell, "play", false);
  await expect(page.locator(".sve-decision")).toHaveAttribute("data-decision", "choose");
  await page.evaluate(async () => {
    const path = "/src/app/store.ts";
    const { engine, getApp } = await import(/* @vite-ignore */ path);
    engine.send({ kind: "answer", seat: getApp().update.decision.decision.player, answer: { type: "choose", ids: ["normal"] } });
  });
  await expect(page.locator(".sve-decision")).toHaveAttribute("data-decision", "selectCards");
  const before = await inputs(page);
  for (const id of ids) {
    await tile(page, id).locator(".sve-keyword-more").click();
    await expect(page.getByTestId("keyword-popover")).toHaveCount(1);
    await expect(page.getByTestId("keyword-popover").locator("li")).toHaveCount(4);
    await expect(tile(page, id).locator(".sve-keyword-more")).toHaveAttribute("aria-expanded", "true");
    expect(await inputs(page)).toBe(before);
    await expect(page.locator(".sve-decision")).toHaveAttribute("data-decision", "selectCards");
  }
  await page.keyboard.press("Escape");
  // Other parts of the same card still select it normally.
  const box = (await tile(page, ids[0]!).boundingBox())!;
  await tile(page, ids[0]!).click({ position: { x: 10, y: box.height * 0.7 } });
  await expect.poll(() => inputs(page)).toBeGreaterThan(before);
});
