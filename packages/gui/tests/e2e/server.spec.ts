import { expect, test, type Browser, type Page } from "@playwright/test";
import { useSettings } from "./helpers";
import { expectSameInputs, playAtRandom, readyBoth, watchProblems } from "./online-helpers";

// Online play through the online server ("use the server"): the server's relay runs on this machine for the tests
// (playwright.config.ts, tests/e2e/relay.ini: plain ws://, three spectator seats a room, a test key). Each page is one
// program; its server configuration is what the settings' window keeps in the browser.

const SERVER = "[server]\nname = e2e\naddress = ws://127.0.0.1:5198\nkey = e2e-test-key-0001\n";

/** A program at its online screen, with this server configuration ("" : none). */
async function openOnline(browser: Browser, config: string, settings: Record<string, unknown> = {}, prepare?: (page: Page) => Promise<void>): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await useSettings(page, { uiLang: "en", botDelayMs: 0, ...settings });
  await page.addInitScript(([key, value]) => localStorage.setItem(key, value), ["sve-online-server", config] as const);
  await prepare?.(page);
  await page.goto("/");
  await expect(page.getByTestId("menu-online")).toBeEnabled({ timeout: 120_000 });
  await page.getByTestId("menu-online").click();
  await expect(page.getByTestId("online")).toHaveAttribute("data-phase", "idle");
  return page;
}

test("through the online server: a room made with its rules, joined by code, watched, played; a wrong code", async ({ browser }) => {
  test.setTimeout(300_000);
  const problems: string[] = [];
  const host = await openOnline(browser, SERVER, { setupDecks: ["samples/sd01.json", "samples/sd02.json"] });
  const guest = await openOnline(browser, SERVER, { setupDecks: ["samples/sd03.json", "samples/sd02.json"] });
  watchProblems([host, guest], problems);
  // The server's part comes first, named after the server.
  await expect(host.getByTestId("online-server").locator("h3")).toHaveText("Use the server (e2e)");

  // A code nobody made: said at once.
  await guest.getByTestId("online-server-code").fill("ZZZZZZ");
  await guest.getByTestId("online-server-join").click();
  await expect(guest.getByTestId("online-closed")).toHaveText("There is no room of that code: check the code, or the host has left.");
  await guest.getByTestId("online-again").click();

  // The host chooses the rules, then makes the room.
  await host.getByTestId("online-server-turn-order").selectOption("player1");
  await host.getByTestId("online-server-host").click();
  const code = (await host.getByTestId("online-room-code").innerText({ timeout: 30_000 })).trim();
  expect(code).toMatch(/^[A-Z0-9]{6}$/);
  await guest.getByTestId("online-server-code").fill(code.toLowerCase());
  await guest.getByTestId("online-server-join").click();
  for (const page of [host, guest]) {
    await expect(page.getByTestId("online-connected")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("online-via")).toHaveText("the online server");
    await expect(page.locator(".sve-online-facts")).toContainText("Connection: through the server");
    await expect(page.getByTestId("online-rtt")).toHaveText(/\d+ ms/, { timeout: 15_000 });
  }
  await expect(guest.getByTestId("online-rules")).toHaveText("Standard · restriction list: None · first player: Player 1 goes first");
  // The host can still change them in the room.
  await host.getByTestId("online-turn-order").selectOption("player2");
  await expect(guest.getByTestId("online-rules")).toHaveText("Standard · restriction list: None · first player: Player 2 goes first");

  // A spectator: the server's seats (three here).
  const spectator = await openOnline(browser, SERVER);
  watchProblems([spectator], problems);
  await spectator.getByTestId("online-server-code").fill(code);
  await spectator.getByTestId("online-server-watch").click();
  await expect(spectator.getByTestId("online-watching")).toBeVisible({ timeout: 30_000 });
  for (const page of [host, guest, spectator]) await expect(page.getByTestId("online-watchers")).toHaveText("Spectators: 1 of 3");

  // The chat goes through the server too.
  await guest.getByTestId("online-chat-input").fill("hello through the server");
  await guest.getByTestId("online-send").click();
  await expect(host.getByTestId("online-chat")).toContainText("hello through the server");
  await expect(spectator.getByTestId("online-chat")).toContainText("hello through the server");

  await readyBoth(host, guest);
  await expect(spectator.locator(".sve-table")).toBeVisible({ timeout: 30_000 });
  await playAtRandom(host, guest, 40, problems, 11);
  await expectSameInputs(host, guest);
  await expect
    .poll(async () => {
      const counts = await Promise.all([host, guest, spectator].map((p) => p.locator(".sve-decision").getAttribute("data-inputs")));
      return counts[0] === counts[1] && counts[1] === counts[2];
    })
    .toBe(true);
  expect(problems).toEqual([]);
});

/**
 * The page's connections to the server, to cut them the way a network would (only the server's: the dev server's own
 * socket stays). A script as text: the tests are type-checked without the browser's types.
 */
async function recordServerSockets(page: Page): Promise<void> {
  await page.addInitScript({
    content: `(() => {
      window.sveSockets = [];
      const Native = window.WebSocket;
      window.WebSocket = class extends Native {
        constructor(url, ...rest) {
          super(url, ...rest);
          if (String(url).includes(":5198")) window.sveSockets.push(this);
        }
      };
    })();`,
  });
}

test("through the online server, a lost connection: the game waits, the other player comes back to the room, it goes on", async ({ browser }) => {
  test.setTimeout(300_000);
  const problems: string[] = [];
  const host = await openOnline(browser, SERVER, { setupDecks: ["samples/sd02.json", "samples/sd01.json"] });
  const guest = await openOnline(browser, SERVER, { setupDecks: ["samples/sd07.json", "samples/sd01.json"] }, recordServerSockets);
  watchProblems([host, guest], problems);
  await host.getByTestId("online-server-host").click();
  const code = (await host.getByTestId("online-room-code").innerText({ timeout: 30_000 })).trim();
  await guest.getByTestId("online-server-code").fill(code);
  await guest.getByTestId("online-server-join").click();
  await readyBoth(host, guest);
  await playAtRandom(host, guest, 16, problems, 21);

  // The guest's network drops: both are told (the server tells the host), and the game waits.
  await guest.evaluate("window.sveSockets.forEach((socket) => socket.close())");
  for (const page of [host, guest]) await expect(page.getByTestId("game-online")).toHaveAttribute("data-connected", "no");
  const meanwhile = await playAtRandom(host, guest, 3, problems, 22);
  const inputs = async (page: Page) => Number(await page.locator(".sve-decision").getAttribute("data-inputs"));
  const before = await inputs(host);

  // The guest connects again to the same room on the server (the host stayed in it): the game goes on.
  await guest.getByTestId("game-reconnect").click();
  await guest.getByTestId("online-reconnect").click();
  await expect(guest.getByTestId("online-game")).toBeVisible({ timeout: 30_000 });
  await guest.getByTestId("online-to-game").click();
  for (const page of [host, guest]) await expect(page.getByTestId("game-online")).toHaveAttribute("data-connected", "yes", { timeout: 30_000 });
  const after = await playAtRandom(host, guest, 30, problems, 23);
  await expectSameInputs(host, guest);
  if ((await host.locator(".sve-decision").getAttribute("data-decision")) !== "over") expect(after).toBe(30);
  expect(await inputs(host)).toBeGreaterThan(before);
  console.log(`answers while cut off: ${meanwhile}; after reconnecting: ${after}`);
  expect(problems).toEqual([]);
});

test("the server's configuration: none, pasted in the settings' window, tested; a wrong key is said", async ({ browser }) => {
  test.setTimeout(120_000);
  const page = await openOnline(browser, "");
  // No server: what it is, and the window to set one.
  const part = page.getByTestId("online-server");
  await expect(part.locator("h3")).toHaveText("Use the server");
  await expect(page.getByTestId("online-server-host")).toHaveCount(0);
  await page.getByTestId("online-server-configure").click();
  await expect(page.getByTestId("server-config-status")).toHaveText("No server configured.");
  await page.getByTestId("server-config-text").fill("address = example.com\nkey = x");
  await expect(page.getByTestId("server-config-status")).toHaveText(/must start with wss:\/\/.*The key is missing/);
  await expect(page.getByTestId("server-config-save")).toBeDisabled();
  // A wrong key: the test says so.
  await page.getByTestId("server-config-text").fill(SERVER.replace("e2e-test-key-0001", "not-the-key-0001"));
  await page.getByTestId("server-config-test").click();
  await expect(page.getByTestId("server-config-check")).toHaveText(/^Not connected: The server refused this program: its key is wrong/);
  // The right one: connected, then saved; the online screen offers the server.
  await page.getByTestId("server-config-text").fill(SERVER);
  await expect(page.getByTestId("server-config-status")).toHaveText("Server: e2e (ws://127.0.0.1:5198)");
  await page.getByTestId("server-config-test").click();
  await expect(page.getByTestId("server-config-check")).toHaveText(/^Connected: the server takes this key \(\d+ ms; 3 spectator seats a room\)\.$/);
  await page.getByTestId("server-config-save").click();
  await expect(page.getByTestId("server-config-save")).toBeDisabled();
  await page.getByTestId("server-config-close").click();
  await expect(part.locator("h3")).toHaveText("Use the server (e2e)");
  await expect(page.getByTestId("online-server-host")).toBeVisible();
  // Kept: the settings say which server.
  await page.getByTestId("online-back").click();
  await page.getByTestId("menu-settings").click();
  await expect(page.getByTestId("settings-server")).toHaveText("e2e");
});
