import { expect, test } from "@playwright/test";
import { startGame, toMainPhase, useSettings } from "./helpers";

// Build a real end-phase choice with multiple unmarked abilities and multiline Choice text.
test("pending abilities retain the full paragraph and choices in every card language and compact layout", async ({ page }) => {
  const problems: string[] = [];
  page.on("pageerror", (e) => problems.push(e.message));
  await useSettings(page, {
    uiLang: "en", cardLang: "ja", animations: false,
    setupControllers: ["human", "human"], setupTurnOrder: "player1",
    setupDecks: ["samples/sd01.json", "samples/sd02.json"],
  });
  await startGame(page, "ability-text-bootstrap");
  await page.evaluate(async () => {
    const path = "/src/app/store.ts";
    const { engine } = await import(/* @vite-ignore */ path);
    const deck = { main: Array(20).fill("BP19-092"), evolve: [] };
    engine.send({
      kind: "start",
      options: {
        seed: "ability-text-complete", decks: [deck, deck], deckNames: ["Ability text", "Ability text"],
        controllers: ["human", "human"], deckRestrictions: false, manualActions: true,
        showEveryMainPhase: true, turnOrder: "player1",
      },
    });
  });
  await expect.poll(async () => page.evaluate(async () => {
    const path = "/src/app/store.ts";
    return (await import(/* @vite-ignore */ path)).getApp().update?.seed;
  })).toBe("ability-text-complete");
  await toMainPhase(page);
  for (let i = 0; i < 2; i++) {
    const before = await page.locator(".sve-decision").getAttribute("data-inputs");
    await page.evaluate(async () => {
      const path = "/src/app/store.ts";
      const { engine, getApp } = await import(/* @vite-ignore */ path);
      const update = getApp().update;
      const card = update.view.players[0].hand.find((c: { def?: string }) => c.def === "BP19-092");
      engine.send({ kind: "answer", seat: 0, answer: { type: "mainPhase", action: { type: "manual", op: { kind: "move", card: card.id, to: "field" } } } });
    });
    await expect(page.locator(".sve-decision")).not.toHaveAttribute("data-inputs", before!);
  }
  await page.getByTestId("table-end").click();
  await expect(page.locator(".sve-decision")).toHaveAttribute("data-decision", "selectPending");
  const options = page.locator(".sve-pending-option");
  await expect(options).toHaveCount(6); // Two end-phase multipliers produce three instances for each card.
  for (const [lang, trigger, lastOption] of [
    ["ja", "自分のエンドフェイズが来たとき", "【3】1枚引く。"],
    ["cn", "当自己的结束阶段到来时", "【3】抽取1张卡。"],
    ["en", "At the start of your end phase", "(3) Draw a card."],
  ]) {
    await page.evaluate(async (cardLang) => {
      const path = "/src/app/settings.ts";
      (await import(/* @vite-ignore */ path)).updateSettings({ cardLang });
    }, lang);
    const text = options.first().locator(".sve-pending-text");
    await expect(text).toHaveAttribute("lang", lang === "cn" ? "zh-CN" : lang!);
    await expect(text).toContainText(trigger!);
    await expect(text).toContainText(lastOption!);
    expect(await text.evaluate((el) => getComputedStyle(el).webkitLineClamp)).not.toBe("2");
    expect(await text.evaluate((el) => el.scrollHeight <= el.clientHeight + 1)).toBe(true);
  }
  await page.evaluate(async () => {
    const path = "/src/app/settings.ts";
    (await import(/* @vite-ignore */ path)).updateSettings({ cardLang: "cn" });
  });
  await expect(options.first().locator(".sve-pending-text")).toHaveAttribute("lang", "zh-CN");
  const notice = page.getByTestId("turn-order");
  if (await notice.isVisible()) await notice.click();
  await page.screenshot({ path: test.info().outputPath("pending-desktop.png") });
  await page.setViewportSize({ width: 915, height: 412 });
  await options.last().scrollIntoViewIfNeeded();
  await expect(options.last()).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath("pending-compact.png") });
  // Only the pending list gains text in this change; resolution prompts keep their current presentation.
  await options.first().click();
  await expect(page.locator(".sve-decision")).toHaveAttribute("data-decision", "choose");
  await expect(page.locator(".sve-pending-text")).toHaveCount(0);
  expect(problems).toEqual([]);
});
