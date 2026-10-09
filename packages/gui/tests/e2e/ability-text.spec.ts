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
  for (let i = 0; i < 4; i++) {
    const before = await page.locator(".sve-decision").getAttribute("data-inputs");
    await page.evaluate(async (owner) => {
      const path = "/src/app/store.ts";
      const { engine, getApp } = await import(/* @vite-ignore */ path);
      const update = getApp().update;
      const card = owner === 0 ? update.view.players[owner].hand.find((c: { def?: string }) => c.def === "BP19-092") : update.view.players[owner].hand[0];
      engine.send({ kind: "answer", seat: 0, answer: { type: "mainPhase", action: { type: "manual", op: { kind: "move", card: card.id, to: "field" } } } });
    }, i < 2 ? 0 : 1);
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
  const expected = await options.first().locator(".sve-pending-text").innerText();
  await options.first().click();
  await expect(page.locator(".sve-decision")).toHaveAttribute("data-decision", "choose");
  await expect(page.locator(".sve-pending-text")).toHaveCount(0);
  const dialogText = page.getByTestId("prompt-ability").locator(".sve-ability-text");
  await expect(dialogText).toHaveText(expected);
  await expect(page.getByTestId("table-ability")).toContainText("Processing ability:");
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.screenshot({ path: test.info().outputPath("resolution-desktop.png") });
  await page.getByTestId("decision-fold").click();
  await page.getByTestId("table-ability").locator("summary").click();
  const tableText = page.getByTestId("table-ability").locator(".sve-ability-text");
  await expect(tableText).toHaveText(expected);
  await page.evaluate(async () => {
    const path = "/src/app/settings.ts";
    (await import(/* @vite-ignore */ path)).updateSettings({ cardLang: "ja" });
  });
  await expect(tableText).toHaveAttribute("lang", "ja");
  await expect(tableText).toContainText("【3】1枚引く。");
  await page.setViewportSize({ width: 915, height: 412 });
  await expect(page.getByTestId("table-ability").locator("summary")).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath("resolution-compact.png") });
  await page.getByTestId("decision-unfold").click();
  // Answer the current real mode, then the next pending list must hide the finished ability context.
  await page.evaluate(async () => {
    const path = "/src/app/store.ts";
    const { engine, getApp } = await import(/* @vite-ignore */ path);
    const decision = getApp().update.decision.decision;
    engine.send({ kind: "answer", seat: decision.player, answer: { type: "choose", ids: [decision.options.at(-1).id] } });
  });
  await expect(page.locator(".sve-decision")).toHaveAttribute("data-decision", "selectPending");
  await expect(page.getByTestId("prompt-ability")).toHaveCount(0);
  await expect(page.getByTestId("table-ability")).toHaveCount(0);
  await page.locator(".sve-pending-option").first().click();
  await page.evaluate(async () => {
    const path = "/src/app/store.ts";
    const { engine, getApp } = await import(/* @vite-ignore */ path);
    const decision = getApp().update.decision.decision;
    engine.send({ kind: "answer", seat: decision.player, answer: { type: "choose", ids: ["damage"] } });
  });
  await expect(page.locator(".sve-decision")).toHaveAttribute("data-decision", "selectCards");
  await expect(page.getByTestId("decision-dialog")).toHaveCount(0);
  await expect(page.getByTestId("table-ability")).toBeVisible();
  await page.getByTestId("table-ability").locator("summary").click();
  await expect(page.getByTestId("table-ability").locator(".sve-ability-text")).toContainText("【3】1枚引く。");
  await page.screenshot({ path: test.info().outputPath("target-compact.png") });
  await page.evaluate(async () => {
    const path = "/src/app/store.ts";
    const { engine, getApp } = await import(/* @vite-ignore */ path);
    const decision = getApp().update.decision.decision;
    engine.send({ kind: "answer", seat: decision.player, answer: { type: "selectCards", cards: [decision.candidates[0]] } });
  });
  await expect(page.locator(".sve-decision")).toHaveAttribute("data-decision", "selectPending");
  await expect(page.getByTestId("table-ability")).toHaveCount(0);
  expect(problems).toEqual([]);
});
