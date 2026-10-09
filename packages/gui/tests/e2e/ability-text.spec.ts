import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { startGame, toMainPhase, useSettings } from "./helpers";

test("real replay hands evolve over to discard triggers, and spell play costs show full text", async ({ page }) => {
  await useSettings(page, { uiLang: "en", cardLang: "ja", animations: false, setupControllers: ["human", "human"],
    setupTurnOrder: "player1", setupDecks: ["samples/sd01.json", "samples/sd02.json"] });
  await startGame(page, "ability-handoff-bootstrap");
  const replay = JSON.parse(readFileSync(new URL("../../test/fixtures/bp11-070-context.json", import.meta.url), "utf8"));
  replay.options.controllers = ["human", "human"];
  await page.evaluate(async (replay) => {
    const path = "/src/app/store.ts";
    (await import(/* @vite-ignore */ path)).engine.send({ kind: "loadReplay", replay, inputs: 70 });
  }, replay);
  const decision = page.locator(".sve-decision");
  await expect(decision).toHaveAttribute("data-inputs", "70");
  const notice = page.getByTestId("turn-order");
  if (await notice.isVisible()) await notice.click();
  const text = page.getByTestId("prompt-ability").locator(".sve-ability-text");
  await expect(text).toContainText("【進化時】");
  for (const index of [70, 71, 72]) {
    await page.evaluate(async (record) => {
      const path = "/src/app/store.ts";
      (await import(/* @vite-ignore */ path)).engine.send({ kind: "answer", seat: record.by, answer: record.input });
    }, replay.inputs[index]);
    await expect(decision).toHaveAttribute("data-inputs", String(index + 1));
    const fold = page.getByTestId("decision-fold");
    if (await fold.isVisible()) await fold.click();
    const table = page.getByTestId("table-ability");
    const summary = table.locator("summary");
    if ((await table.locator("details").getAttribute("open")) === null) await summary.click();
    await expect(table.locator(".sve-ability-text")).toContainText(index === 72 ? "自分のターン中、いずれかのプレイヤー" : "【進化時】");
    if (index === 72) await expect(table.locator(".sve-ability-text")).not.toContainText("【進化時】");
  }
  await page.screenshot({ path: test.info().outputPath("bp11-070-discard-trigger.png") });

  await page.evaluate(async () => {
    const path = "/src/app/store.ts";
    const deck = { main: Array(20).fill("BP21-026"), evolve: [] };
    (await import(/* @vite-ignore */ path)).engine.send({ kind: "start", options: {
      seed: "spell-text-ui", decks: [deck, deck], deckNames: ["Spell", "Spell"], controllers: ["human", "human"],
      deckRestrictions: false, manualActions: true, showEveryMainPhase: true, turnOrder: "player1",
    } });
  });
  await expect.poll(() => page.evaluate(async () => {
    const path = "/src/app/store.ts";
    return (await import(/* @vite-ignore */ path)).getApp().update?.seed;
  })).toBe("spell-text-ui");
  await toMainPhase(page);
  const before = await decision.getAttribute("data-inputs");
  await page.evaluate(async () => {
    const path = "/src/app/store.ts";
    (await import(/* @vite-ignore */ path)).engine.send({ kind: "answer", seat: 0, answer: { type: "mainPhase", action: {
      type: "manual", op: { kind: "points", player: 0, playPoints: 10, maxPlayPoints: 10 },
    } } });
  });
  await expect(decision).not.toHaveAttribute("data-inputs", before!);
  await page.evaluate(async () => {
    const path = "/src/app/store.ts";
    const { engine, getApp } = await import(/* @vite-ignore */ path);
    const update = getApp().update;
    const action = update.decision.decision.actions.find((a: { type: string }) => a.type === "play");
    engine.send({ kind: "answer", seat: 0, answer: { type: "mainPhase", action } });
  });
  await expect(decision).toHaveAttribute("data-decision", "choose");
  const unfold = page.getByTestId("decision-unfold");
  if (await unfold.isVisible()) await unfold.click();
  await expect(page.getByTestId("prompt-ability")).toContainText("Spell");
  await expect(page.getByTestId("prompt-ability")).toContainText("Full card text");
  await expect(text).toContainText("コストを+2してよい");
  await expect(text).toContainText("【2】");
  if (await notice.isVisible()) await notice.click();
  await page.setViewportSize({ width: 915, height: 412 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath("spell-play-option-compact.png") });
  await page.getByRole("button", { name: "コストを+2する", exact: true }).click();
  await expect(page.getByTestId("prompt-ability")).toContainText("Selected play method: コストを+2する");
  await expect(text).toContainText("【2】");
});

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
