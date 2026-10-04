import { expect, type Page } from "@playwright/test";
import { answer } from "./helpers";

// What the online tests share (online.spec.ts: the public networks and codes by hand; server.spec.ts: the online server):
// both players ready, playing at random each on their own side, both games the same.

/** A small deterministic random source (tests/e2e/monkey.spec.ts). */
export function randomSource(seed: number): (n: number) => number {
  let s = seed >>> 0 || 1;
  return (n) => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) % n;
  };
}

/** Both players ready with the decks their settings chose: the game starts on both screens. */
export async function readyBoth(host: Page, guest: Page): Promise<void> {
  await expect(guest.getByTestId("online-ready")).toBeEnabled({ timeout: 30_000 });
  await guest.getByTestId("online-ready").click();
  await expect(host.getByTestId("online-opponent")).toHaveAttribute("data-ready", "yes");
  await expect(host.getByTestId("online-ready")).toBeEnabled({ timeout: 30_000 });
  await host.getByTestId("online-ready").click();
  for (const page of [host, guest]) await expect(page.locator(".sve-table")).toBeVisible({ timeout: 30_000 });
}

/**
 * Page errors and error messages of the console, to be none. A public relay that can't be reached is not one: the browser
 * says so in the console, and the program uses the others.
 */
export function watchProblems(pages: Page[], problems: string[]): void {
  for (const page of pages) {
    page.on("pageerror", (e) => problems.push(`page error: ${e.message}`));
    page.on("console", (m) => {
      if (m.type() === "error" && !/^WebSocket connection to 'wss:\/\/[^']+' failed/.test(m.text())) problems.push(`console: ${m.text()}`);
    });
  }
}

/**
 * Each person answers their own decisions at random, the way a person does, until `answers` answers, the end, or nothing to
 * answer on either side for a while. Nothing may go wrong (a page error, an error message, the two games differing).
 */
export async function playAtRandom(host: Page, guest: Page, answers: number, problems: string[], seed = 7): Promise<number> {
  const pick = randomSource(seed);
  let done = 0;
  let idle = 0;
  for (let round = 0; round < 4000 && done < answers && idle < 80; round++) {
    let acted = false;
    for (const page of [host, guest]) {
      // Exactly that many: when both programs have a decision in the last round, the guest's isn't answered.
      if (done >= answers) break;
      const bar = page.locator(".sve-decision");
      const kind = (await bar.getAttribute("data-decision"))!;
      if (kind === "over" || kind === "waiting" || (await bar.getAttribute("class"))!.includes("sve-busy")) continue;
      if (kind === "announcement") {
        await answer(page, kind, pick);
        acted = true;
        continue;
      }
      const inputs = await bar.getAttribute("data-inputs");
      const did = await answer(page, kind, pick);
      done++;
      acted = true;
      const toast = page.locator(".sve-toast");
      await expect
        .poll(async () => (await bar.getAttribute("data-inputs")) !== inputs || (await toast.count()) > 0, { intervals: [10, 20, 50] })
        .toBe(true);
      if ((await toast.count()) > 0) problems.push(`error message after ${kind} (${did}): ${await toast.first().innerText()}`);
      expect(problems).toEqual([]);
    }
    for (const page of [host, guest]) expect(await page.getByTestId("game-desync").count()).toBe(0);
    if ((await host.locator(".sve-decision").getAttribute("data-decision")) === "over") break;
    idle = acted ? 0 : idle + 1;
    if (!acted) await host.waitForTimeout(30);
  }
  return done;
}

/** Both programs played the same game: the same number of inputs once both wait. */
export async function expectSameInputs(host: Page, guest: Page): Promise<void> {
  await expect
    .poll(async () => {
      const counts = await Promise.all([host, guest].map((p) => p.locator(".sve-decision").getAttribute("data-inputs")));
      return counts[0] === counts[1];
    })
    .toBe(true);
}
