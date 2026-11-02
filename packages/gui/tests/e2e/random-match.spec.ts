import { expect, test, type Browser, type Page } from "@playwright/test";
import { WebSocket, WebSocketServer } from "ws";
import { APP_ID } from "../../src/net/relays";
import { SETTINGS_KEY, useSettings } from "./helpers";
import { watchProblems } from "./online-helpers";

// The random match: a page of the online screen that goes to a game by itself, on the test relay (server.spec.ts). A room
// that doesn't fit is left alone; two people looking meet; a room that doesn't work is left for another; a site's queue takes
// or doesn't take the deck. The relay is shared with the other tests running: each test here plays its own format and
// restriction list (theirs have none), so that it meets nobody else's rooms.

const KEY = "e2e-test-key-0001";
const SERVER = `[server]\nname = e2e\naddress = ws://127.0.0.1:5198\nkey = ${KEY}\n`;
/** The server of a site with a queue (siteRelay below): the test relay's rooms, and its queue. */
const SITE_PORT = 5196;
const SITE = `[server]\nname = site\naddress = ws://127.0.0.1:${SITE_PORT}\nkey = ${KEY}\n`;

const standard = (list: string) => ({ format: "standard", restrictionLists: { standard: list, crossCraft: null }, setupDecks: ["samples/sd01.json", "samples/sd02.json"] });
const crossCraft = (list: string) => ({ format: "crossCraft", restrictionLists: { standard: null, crossCraft: list }, setupDecks: ["samples/cross-sd01-sd02.json", "samples/sd02.json"] });

async function openOnline(browser: Browser, config: string, settings: Record<string, unknown>): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await useSettings(page, { uiLang: "en", botDelayMs: 0, ...settings });
  await page.addInitScript(([key, value]) => localStorage.setItem(key, value), ["sve-online-server", config] as const);
  await page.goto("/");
  await expect(page.getByTestId("menu-online")).toBeEnabled({ timeout: 120_000 });
  await page.getByTestId("menu-online").click();
  await expect(page.getByTestId("online")).toHaveAttribute("data-phase", "idle");
  return page;
}

async function makeRoom(page: Page): Promise<string> {
  await page.getByTestId("online-server-host").click();
  return (await page.getByTestId("online-room-code").innerText({ timeout: 30_000 })).trim();
}

/** The random match's page, and the search begun. */
async function startLooking(page: Page): Promise<void> {
  await page.getByTestId("online-random").click();
  await expect(page.getByTestId("random-match")).toBeVisible();
  await expect(page.getByTestId("random-note")).toBeVisible();
  await expect(page.getByTestId("random-start")).toBeEnabled({ timeout: 60_000 });
  await page.getByTestId("random-start").click();
  await expect(page.getByTestId("random-status")).toBeVisible();
}

test("goes to the room that fits, deck ready at once; the other rooms are left alone", async ({ browser }) => {
  test.setTimeout(240_000);
  const problems: string[] = [];
  // A room with a password, a private one, one of another list; and the one that fits.
  const locked = await openOnline(browser, SERVER, { ...standard("11_26_EN"), roomPassword: true });
  const hidden = await openOnline(browser, SERVER, { ...standard("11_26_EN"), publicRooms: false });
  const other = await openOnline(browser, SERVER, standard("08_26_EN"));
  const fits = await openOnline(browser, SERVER, standard("11_26_EN"));
  const seeker = await openOnline(browser, SERVER, standard("11_26_EN"));
  watchProblems([locked, hidden, other, fits, seeker], problems);
  for (const page of [locked, hidden, other, fits]) await makeRoom(page);
  await startLooking(seeker);

  // In the room, its deck ready without a click, the rules the host's.
  await expect(fits.getByTestId("online-connected")).toBeVisible({ timeout: 30_000 });
  await expect(fits.getByTestId("online-opponent")).toHaveAttribute("data-ready", "yes", { timeout: 30_000 });
  await expect(seeker.getByTestId("random-status")).toHaveAttribute("data-stage", "meeting");
  for (const page of [locked, hidden, other]) await expect(page.getByTestId("online")).toHaveAttribute("data-phase", "hosting");

  // The host gets ready: the game begins on both sides, and the search is over.
  await fits.getByTestId("online-ready").click();
  for (const page of [fits, seeker]) await expect(page.locator(".sve-table")).toBeVisible({ timeout: 30_000 });
  expect(problems).toEqual([]);
});

test("two people looking meet: one makes a room after a while, the other comes to it, and the game begins by itself", async ({ browser }) => {
  test.setTimeout(240_000);
  const problems: string[] = [];
  // Whatever the settings say of rooms: the room made here is public and has no password.
  const rules = { ...standard("10_26_JPN"), roomPassword: true, publicRooms: false };
  const one = await openOnline(browser, SERVER, rules);
  const two = await openOnline(browser, SERVER, rules);
  watchProblems([one, two], problems);
  await startLooking(one);
  await startLooking(two);
  for (const page of [one, two]) await expect(page.locator(".sve-table")).toBeVisible({ timeout: 60_000 });
  // The settings stayed as they were.
  const kept = await one.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? "{}") as Record<string, unknown>, SETTINGS_KEY);
  expect(kept.roomPassword).toBe(true);
  expect(kept.publicRooms).toBe(false);
  expect(problems).toEqual([]);
});

test("stopping leaves the room it made; a host who doesn't get ready is left after a while, and the search goes on", async ({ browser }) => {
  test.setTimeout(300_000);
  const problems: string[] = [];
  const rules = crossCraft("11_26_EN_CROSS");
  const seeker = await openOnline(browser, SERVER, rules);
  const host = await openOnline(browser, SERVER, rules);
  watchProblems([seeker, host], problems);
  const listed = host.locator('[data-testid="online-lobby-room"]', { hasText: "11_26_EN_CROSS" });

  // Nothing there: a room of its own after a while, in the lobby of those who look at it, with no password.
  await startLooking(seeker);
  await expect(seeker.getByTestId("random-status")).toHaveAttribute("data-hosting", "yes", { timeout: 30_000 });
  await expect(listed).toHaveCount(1, { timeout: 15_000 });
  await expect(listed).toHaveAttribute("data-locked", "no");
  await seeker.getByTestId("random-cancel").click();
  await expect(seeker.getByTestId("random-start")).toBeVisible();
  await expect(seeker.getByTestId("online")).toHaveAttribute("data-phase", "idle");
  await expect(listed).toHaveCount(0, { timeout: 15_000 });

  // A host who never gets ready: a minute, then the program goes on looking.
  await makeRoom(host);
  await seeker.getByTestId("random-start").click();
  await expect(host.getByTestId("online-opponent")).toHaveAttribute("data-ready", "yes", { timeout: 30_000 });
  await expect(seeker.getByTestId("random-status")).toHaveAttribute("data-stage", "meeting");
  await expect(seeker.getByTestId("random-status")).toHaveAttribute("data-stage", "searching", { timeout: 90_000 });
  await expect(host.getByTestId("online-closed")).toBeVisible();
  expect(problems).toEqual([]);
});

test("a room of another version of the program is left at once, without a word", async ({ browser }) => {
  test.setTimeout(240_000);
  const problems: string[] = [];
  const seeker = await openOnline(browser, SERVER, crossCraft("09_26_EN_CROSS"));
  watchProblems([seeker], problems);

  // A host of another version, as the relay sees one: it lists its room, takes a program in and says who it is.
  const other = new WebSocket("ws://127.0.0.1:5198");
  const heard: string[] = [];
  const send = (message: object) => other.send(JSON.stringify(message));
  other.on("open", () => send({ t: "hello", v: 1, app: APP_ID, key: KEY }));
  other.on("message", (data) => {
    const m = JSON.parse(String(data)) as Record<string, unknown>;
    heard.push(String(m.t));
    if (m.t === "welcome") send({ t: "join", room: "OTHERV", mode: "create" });
    else if (m.t === "joined") send({ t: "info", name: "other", format: "crossCraft", list: "09_26_EN_CROSS", turnOrder: "choose", public: true, players: 1, watchers: 0, playing: false });
    else if (m.t === "from" && (m.d as Record<string, unknown>).t === "join") {
      send({ t: "to", id: m.id, d: { t: "select" } });
      send({ t: "to", id: m.id, d: { t: "hello", version: "online-0", cards: "other", engine: "other" } });
    }
  });

  try {
    await startLooking(seeker);
    await expect.poll(() => heard.includes("gone"), { timeout: 60_000 }).toBe(true);
    await expect(seeker.getByTestId("random-status")).toHaveAttribute("data-stage", "searching");
    await expect(seeker.getByTestId("random-problem")).toHaveCount(0);
  } finally {
    other.close();
  }
  expect(problems).toEqual([]);
});

/**
 * The server of a site with a queue, in front of the test relay: its lobby lists the queues beside the rooms, and it answers
 * those who go to a queue; everything else is the relay's. The addresses programs came to are noted.
 */
function siteRelay(queues: object[], answer: (seek: Record<string, unknown>) => object): { urls: string[]; close(): void } {
  const server = new WebSocketServer({ port: SITE_PORT });
  const urls: string[] = [];
  server.on("connection", (client, request) => {
    urls.push(request.url ?? "");
    const relay = new WebSocket("ws://127.0.0.1:5198");
    const waiting: string[] = [];
    relay.on("open", () => {
      for (const text of waiting.splice(0)) relay.send(text);
    });
    client.on("message", (data) => {
      const text = String(data);
      const m = JSON.parse(text) as Record<string, unknown>;
      if (m.t === "seek") return client.send(JSON.stringify({ t: "sought", ...answer(m) }));
      if (relay.readyState === WebSocket.OPEN) relay.send(text);
      else waiting.push(text);
    });
    relay.on("message", (data) => {
      const m = JSON.parse(String(data)) as Record<string, unknown>;
      if (m.t === "rooms") m.queues = queues;
      client.send(JSON.stringify(m));
    });
    client.on("close", () => relay.close());
    relay.on("close", () => client.close());
  });
  return { urls, close: () => server.close() };
}

test("a site's queue: a deck it doesn't take doesn't stop the search; a deck it takes goes straight into the game", async ({ browser }) => {
  test.setTimeout(240_000);
  const problems: string[] = [];
  const seeks: Record<string, unknown>[] = [];
  /** The site's answer: no game, until its person has a room. */
  let room: string | null = null;
  const site = siteRelay(
    [
      { id: "jp", format: "standard", list: "10_26_JPN" },
      { id: "cn", format: "standard", list: "08_26_CHN" },
    ],
    (seek) => {
      seeks.push(seek);
      return room ? { room, token: "a-seat-token-0001" } : {};
    },
  );
  const seeker = await openOnline(browser, SITE, { ...standard("08_26_CHN"), playerName: "seeker" });
  // The site's person, in a room as the site makes one for them (not listed), on the relay behind.
  const waiting = await openOnline(browser, SERVER, { ...standard("08_26_CHN"), publicRooms: false });
  watchProblems([seeker, waiting], problems);
  try {
    await startLooking(seeker);
    // Not taken: not a word, and the search goes on.
    await expect.poll(() => seeks.length, { timeout: 30_000 }).toBeGreaterThan(0);
    const seek = seeks[0]!;
    expect(seek.id).toBe("cn");
    expect(seek.name).toBe("seeker");
    expect((seek.deck as { deck: { main: string[] } }).deck.main.length).toBeGreaterThanOrEqual(40);
    expect(seek.engine).toBeTruthy();
    expect(seek.cards).toBeTruthy();
    await expect(seeker.getByTestId("random-status")).toHaveAttribute("data-stage", "searching");
    await expect(seeker.getByTestId("random-problem")).toHaveCount(0);

    // Taken (the program asks again before long): straight into the game, with the seat it was given.
    room = await makeRoom(waiting);
    await expect(waiting.getByTestId("online-opponent")).toHaveAttribute("data-ready", "yes", { timeout: 60_000 });
    expect(site.urls.some((url) => url.includes("lt=a-seat-token-0001"))).toBe(true);
    await waiting.getByTestId("online-ready").click();
    for (const page of [seeker, waiting]) await expect(page.locator(".sve-table")).toBeVisible({ timeout: 30_000 });
    expect(seeks.length).toBe(2);
  } finally {
    site.close();
  }
  expect(problems).toEqual([]);
});
