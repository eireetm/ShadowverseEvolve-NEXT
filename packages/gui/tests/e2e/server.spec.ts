import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { constants, gunzipSync } from "node:zlib";
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

/** The games the test relay kept (tests/e2e/relay.ini: [records] dir), one JSON line each. */
function keptGames(): { key: string; record: { format: string; replay: { options: { seed: string }; inputs: unknown[] } } }[] {
  const dir = fileURLToPath(new URL("../../.e2e-relay-records", import.meta.url));
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".jsonl.gz"))
    .flatMap((f) => gunzipSync(readFileSync(join(dir, f)), { finishFlush: constants.Z_SYNC_FLUSH }).toString("utf8").split("\n"))
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line));
}

test("names, the lobby, and a game the server keeps: a public room joined from the lobby, played, conceded", async ({ browser }) => {
  test.setTimeout(300_000);
  const problems: string[] = [];
  const host = await openOnline(browser, SERVER, { playerName: "小明", setupDecks: ["samples/sd01.json", "samples/sd02.json"] });
  const guest = await openOnline(browser, SERVER, { setupDecks: ["samples/sd03.json", "samples/sd02.json"] });
  watchProblems([host, guest], problems);
  // The guest gives a name here (the online screen keeps it in the settings).
  await guest.getByTestId("online-name").fill("小红");
  await expect(host.getByTestId("online-name")).toHaveValue("小明");
  await expect(host.getByTestId("online-server-public")).toBeChecked();
  await host.getByTestId("online-server-host").click();
  const code = (await host.getByTestId("online-room-code").innerText({ timeout: 30_000 })).trim();

  // The lobby lists the host's room: its name, the rules, waiting; one click joins it.
  const listed = guest.locator(`[data-testid="online-lobby-room"][data-code="${code}"]`);
  await expect(listed).toContainText("小明's room", { timeout: 15_000 });
  await expect(listed).toContainText("waiting for a player");
  await listed.getByTestId("online-lobby-join").click();
  for (const page of [host, guest]) await expect(page.getByTestId("online-connected")).toBeVisible({ timeout: 30_000 });
  await expect(host.getByTestId("online-peer-name")).toHaveText("Opponent: 小红");
  await expect(guest.getByTestId("online-peer-name")).toHaveText("Opponent: 小明");
  // Both allow the server to keep their games (the setting's default): said so.
  for (const page of [host, guest]) await expect(page.getByTestId("online-share")).toHaveAttribute("data-kept", "yes");

  // In the game, the players' boxes show the names.
  await readyBoth(host, guest);
  await expect(host.getByTestId("player-panel-0").locator(".sve-player-name")).toHaveText("小明 · You");
  await expect(host.getByTestId("player-panel-1").locator(".sve-player-name")).toHaveText("小红");
  await expect(guest.getByTestId("player-panel-1").locator(".sve-player-name")).toHaveText("小红 · You");
  const before = keptGames().length;
  await playAtRandom(host, guest, 12, problems, 31);
  if ((await host.locator(".sve-decision").getAttribute("data-decision")) !== "over") {
    host.once("dialog", (dialog) => void dialog.accept());
    await host.getByTestId("game-concede").click();
  }
  for (const page of [host, guest]) await expect(page.getByTestId("result-new-game")).toBeVisible({ timeout: 30_000 });
  // The server kept the game once (both programs sent it): the replay of it, with every answer.
  await expect.poll(() => keptGames().length, { timeout: 15_000 }).toBe(before + 1);
  const kept = keptGames().at(-1)!;
  expect(kept.key).toBe("e2e");
  expect(kept.record.format).toBe("sve-online-record");
  expect(kept.record.replay.inputs.length).toBeGreaterThan(12);
  expect(problems).toEqual([]);
});

test("a room that allows taking answers back: the debug tab's undo, on both sides; the seed and the bug report file after the game", async ({ browser }) => {
  test.setTimeout(240_000);
  const problems: string[] = [];
  const host = await openOnline(browser, SERVER, { allowUndo: true, setupTurnOrder: "player1", setupDecks: ["samples/sd01.json", "samples/sd02.json"] });
  const guest = await openOnline(browser, SERVER, { setupDecks: ["samples/sd03.json", "samples/sd02.json"] });
  watchProblems([host, guest], problems);
  await expect(host.getByTestId("online-server-undo")).toBeChecked();
  await host.getByTestId("online-server-host").click();
  const code = (await host.getByTestId("online-room-code").innerText({ timeout: 30_000 })).trim();
  await guest.getByTestId("online-server-code").fill(code);
  await guest.getByTestId("online-server-join").click();
  await expect(guest.getByTestId("online-rules")).toHaveText("Standard · restriction list: None · first player: Player 1 goes first · taking back allowed", { timeout: 30_000 });
  await readyBoth(host, guest);
  const inputs = (page: Page) => page.locator(".sve-decision").getAttribute("data-inputs");

  // Player 1 keeps its hand; player 2 hasn't answered yet: player 1 takes it back (the debug tab's undo), on both sides.
  await expect(host.locator(".sve-decision")).toHaveAttribute("data-decision", "mulligan", { timeout: 30_000 });
  await host.getByTestId("table-keep").click();
  for (const page of [host, guest]) await expect(page.locator(".sve-decision")).toHaveAttribute("data-inputs", "1");
  await host.getByTestId("sidebar-show").click();
  await host.getByTestId("tab-debug").click();
  // Online, no seed and no bug report file while the game goes on.
  await expect(host.getByTestId("debug-seed")).toHaveCount(0);
  await expect(host.getByTestId("debug-export")).toHaveCount(0);
  await host.getByTestId("debug-undo").click();
  for (const page of [host, guest]) await expect(page.locator(".sve-decision")).toHaveAttribute("data-inputs", "0");
  await expect(host.locator(".sve-decision")).toHaveAttribute("data-decision", "mulligan");
  // (The sidebar covers the right of the table, where the decision's buttons are.)
  await host.getByTestId("sidebar-hide").click();
  // Answered again, and player 2 answers: nothing to take back for player 1 any more.
  await host.getByTestId("table-keep").click();
  await expect(guest.locator(".sve-decision")).toHaveAttribute("data-decision", "mulligan");
  await guest.getByTestId("table-keep").click();
  for (const page of [host, guest]) await expect(page.locator(".sve-decision")).toHaveAttribute("data-inputs", "2");
  await host.getByTestId("sidebar-show").click();
  await host.getByTestId("tab-debug").click();
  await expect(host.getByTestId("debug-undo")).toBeDisabled();
  expect(await inputs(host)).toBe(await inputs(guest));

  // The game over (a concession), the seed and the bug report file are there.
  host.once("dialog", (dialog) => void dialog.accept());
  await host.getByTestId("game-concede").click();
  await expect(host.getByTestId("result-new-game")).toBeVisible({ timeout: 30_000 });
  await host.getByTestId("tab-debug").click();
  await expect(host.getByTestId("debug-seed")).toHaveText(/\S/);
  await expect(host.getByTestId("debug-export")).toBeVisible();
  expect(problems).toEqual([]);
});

test("the Chinese online screen has the three boxes at its bottom; the other languages don't", async ({ browser }) => {
  const zh = await openOnline(browser, SERVER, { uiLang: "zh" });
  await expect(zh.getByTestId("online-thanks").locator("div")).toHaveText(["广告位招租", "广告位招租", "感谢熊爸卡牌"]);
  const en = await openOnline(browser, SERVER);
  await expect(en.getByTestId("online-thanks")).toHaveCount(0);
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
