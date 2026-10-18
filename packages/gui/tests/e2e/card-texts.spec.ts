import { expect, test, type Page } from "@playwright/test";
import { hasCardTexts, useSettings } from "./helpers";

// The player's own card texts (public/text/<SET>_<lang>.json, resources/card-texts.ts): the host lists the file among the
// player's resources, the page reads it and shows its texts in place of the data's — for the whole set in that language.

const OWN_FILE = "text/BP22_cn.json";

/** The host's list of public/ files with OWN_FILE added, and OWN_FILE's content. */
async function ownTextFile(page: Page, body: string): Promise<void> {
  await page.route("**/api/resources", async (route) => {
    const listed = (await (await route.fetch()).json()) as { files: string[] };
    await route.fulfill({ json: { files: [...listed.files, OWN_FILE] } });
  });
  await page.route(`**/${OWN_FILE}`, (route) => route.fulfill({ contentType: "application/json", body }));
}

/** The deck builder's card panel for the card the search finds first. */
async function details(page: Page, search: string): Promise<string> {
  await page.getByTestId("builder-search").fill(search);
  // Off the pool first: the next card's tile may come under the mouse where the last one was.
  await page.getByTestId("builder-search").hover();
  await page.locator(".sve-pool-tile").first().hover();
  return page.locator(".sve-details").first().innerText();
}

async function openBuilder(page: Page): Promise<void> {
  await page.goto("/");
  const decks = page.getByTestId("menu-decks");
  await expect(decks).toBeEnabled({ timeout: 120_000 });
  await decks.click();
  await expect(page.locator(".sve-pool-tile").first()).toBeVisible();
}

test("a card text file in public/text replaces its set's texts in its language", async ({ page }) => {
  await useSettings(page, { uiLang: "zh", cardLang: "cn", builderDeck: null });
  await ownTextFile(page, JSON.stringify({ format: 1, set: "BP22", lang: "cn", cards: { "BP22-001": "这是我自己的译文。" } }));
  await openBuilder(page);
  await expect.poll(() => details(page, "璀璨妖精")).toContain("这是我自己的译文。");
  // This machine's texts (a clone of the repository hasn't them): a BP22 card the file doesn't list has no Chinese text now,
  // the English one shows; another set keeps this machine's Chinese text.
  if (hasCardTexts) {
    await expect.poll(() => details(page, "死噬精灵")).toContain("Bane.");
    await expect.poll(() => details(page, "玫瑰皇后")).toContain("《入场曲》");
  }
});

test("a card text file that can't be read is told, and the data's texts stay", async ({ page }) => {
  await useSettings(page, { uiLang: "zh", cardLang: "cn", builderDeck: null });
  await ownTextFile(page, JSON.stringify({ format: 1, set: "BP21", lang: "cn", cards: {} }));
  await openBuilder(page);
  await expect(page.locator(".sve-toast")).toContainText(`读不了你的卡牌文本文件 public/${OWN_FILE}`);
  if (hasCardTexts) await expect.poll(() => details(page, "璀璨妖精")).toContain("《起动》《消费0》");
});
