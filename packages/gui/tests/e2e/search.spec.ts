import { expect, test, type Page } from "@playwright/test";
import { clickCard, dialogBody, playedSounds, recordSounds, startGame, toMainPhase, useSettings } from "./helpers";

// A card put into a hand in public (revealed from the deck, CR 5.21.1; taken from a cemetery, 4.9.2) is shown a moment where
// it went: the other player's turns face up in their hand, shakes and turns back; one's own shakes. Done by hand (manual
// debugging), so the test needs no particular deal: a card of the opponent's cemetery back into their hand, and CSD03a-009
// Little Sage, Marron, whose Fanfare looks at the top 5 cards and may reveal a Royal Paladin card into the hand.

type Seen = { __seen: Record<string, boolean> };

/** Note on the page whether these ever match (each is there for under a second). */
async function watchFor(page: Page, selectors: string[]): Promise<void> {
  await page.evaluate((list) => {
    const seen: Record<string, boolean> = {};
    (window as unknown as Seen).__seen = seen;
    const check = () => {
      for (const s of list) if (document.querySelector(s)) seen[s] = true;
    };
    new MutationObserver(check).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["class"] });
  }, selectors);
}

const seen = (page: Page, selector: string) => page.evaluate((s) => (window as unknown as Seen).__seen[s] === true, selector);

test("a card put into a hand in public: the opponent's turns face up a moment, one's own shakes", async ({ page }) => {
  const problems: string[] = [];
  page.on("pageerror", (e) => problems.push(e.message));
  await useSettings(page, { uiLang: "en", cardLang: "en", botDelayMs: 0, manualDebug: true, setupControllers: ["human", "greedy"], setupDecks: ["samples/csd03a.json", "samples/sd02.json"] });
  await startGame(page, "search-e2e");
  await toMainPhase(page);
  const manual = page.getByTestId("manual-dialog");
  await watchFor(page, [".sve-hand-own .sve-card-searched", ".sve-hand-opponent .sve-card-revealed"]);
  await recordSounds(page, ["audio/sfx/search.mp3"]);

  // The opponent's: three cards of their deck into their cemetery, one of them back into their hand; its sound as it shows.
  const theirs = page.locator(".sve-hand-opponent .sve-card");
  const before = await theirs.count();
  await page.getByTestId("deck-1").click();
  await page.getByTestId("manual-mill-value").fill("3");
  await page.getByTestId("manual-mill").click();
  await page.keyboard.press("Escape");
  await page.locator('[data-zone="1:cemetery"]').click();
  await page.locator(".sve-zone-action").first().click();
  await manual.getByTestId("manual-move-hand").click();
  const revealed = page.locator(".sve-hand-opponent .sve-card-revealed");
  await expect(page.locator('.sve-hand-opponent .sve-card-revealed[data-def^="SD02-"]')).toHaveCount(1);
  await page.screenshot({ path: test.info().outputPath("revealed.png") });
  await expect.poll(() => playedSounds(page)).toContain("search.mp3");
  // Then a back again, like the rest of their hand.
  await expect(revealed).toHaveCount(0, { timeout: 5_000 });
  await expect(theirs).toHaveCount(before + 1);
  await expect(page.locator('.sve-hand-opponent .sve-card[data-hidden="true"]')).toHaveCount(before + 1);

  // One's own: Marron from the deck into the hand by hand (no one sees which: not shown), played by hand.
  await page.getByTestId("deck-0").click();
  await manual.getByTestId("manual-search").filter({ hasText: "Little Sage, Marron" }).click();
  await page.keyboard.press("Escape");
  await clickCard(page.locator(".sve-hand-own .sve-card").filter({ has: page.locator('[data-printing^="CSD03a-009"]') }).first());
  await manual.getByTestId("manual-play").click();
  // A Ward follower may come onto the field engaged: not. Its Fanfare: a Royal Paladin card of the top 5 revealed into the
  // hand; the rest go to the bottom.
  await expect(page.locator(".sve-decision")).toHaveAttribute("data-decision", "selectCards");
  await page.getByTestId("table-none").click();
  await expect(page.getByTestId("decision-dialog")).toBeVisible();
  const body = (await dialogBody(page))!;
  await body.locator(".sve-choice-cards .sve-card").first().click();
  await body.getByRole("button", { name: /^Confirm$/ }).click();
  await toMainPhase(page);
  await expect.poll(() => seen(page, ".sve-hand-own .sve-card-searched")).toBe(true);
  expect(await seen(page, ".sve-hand-opponent .sve-card-revealed")).toBe(true);

  expect(problems).toEqual([]);
});

/** Note on the page whether a card of one's hand shakes while it can be seen (not while its flight still hides it). */
async function watchShake(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { __shakeSeen: boolean };
    w.__shakeSeen = false;
    const end = performance.now() + 60_000;
    const frame = () => {
      const card = document.querySelector<HTMLElement>(".sve-hand-own .sve-card-searched");
      if (card && card.style.opacity !== "0") w.__shakeSeen = true;
      if (performance.now() < end) requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  });
}

test("a card an effect selects in the cemetery: the table points at it, it flies, and it shakes once it is in the hand", async ({ page }) => {
  const problems: string[] = [];
  page.on("pageerror", (e) => problems.push(e.message));
  await useSettings(page, { uiLang: "en", cardLang: "en", botDelayMs: 0, manualDebug: true, setupControllers: ["human", "greedy"], setupDecks: ["samples/csd02c.json", "samples/sd02.json"] });
  await startGame(page, "search-selected-e2e");
  await toMainPhase(page);
  const manual = page.getByTestId("manual-dialog");
  // CSD02c-004 Kaoru Ryuzaki: if there are at least 5 Passion cards in your cemetery, select a follower in your cemetery and
  // add it to your hand. Taken from the deck, most of the deck into the cemetery, Kaoru onto the field, activated by hand.
  await page.getByTestId("deck-0").click();
  await manual.getByTestId("manual-search").filter({ hasText: "Kaoru Ryuzaki" }).click();
  await page.getByTestId("manual-mill-value").fill("20");
  await page.getByTestId("manual-mill").click();
  await page.keyboard.press("Escape");
  await clickCard(page.locator(".sve-hand-own .sve-card").filter({ has: page.locator('[data-printing^="CSD02c-004"]') }).first());
  await manual.getByTestId("manual-move-field").click();
  await page.locator(".sve-mat-own .sve-field-slot .sve-card").filter({ has: page.locator('[data-printing^="CSD02c-004"]') }).first().click();
  // The sounds: the activated ability's as it is played, then the card's as it shows in the hand.
  await recordSounds(page, ["audio/sfx/search.mp3", "audio/sfx/activated.mp3"]);
  await manual.getByRole("button", { name: /^Activate for free/ }).click();
  // Its target, the first follower offered: the last answer before the card goes (the arrow, then the flight, in one update).
  await expect(page.locator(".sve-decision")).toHaveAttribute("data-decision", "selectCards");
  await watchShake(page);
  const body = (await dialogBody(page))!;
  await body.locator(".sve-choice-cards .sve-card").first().click();
  const ok = body.getByRole("button", { name: /^Confirm$/ });
  if ((await ok.count()) > 0 && (await ok.isEnabled())) await ok.click();
  await expect(page.locator(".sve-decision")).toHaveAttribute("data-decision", "mainPhase");
  await expect.poll(() => page.evaluate(() => (window as unknown as { __shakeSeen: boolean }).__shakeSeen)).toBe(true);
  await expect.poll(() => playedSounds(page)).toEqual(["activated.mp3", "search.mp3"]);
  expect(problems).toEqual([]);
});
