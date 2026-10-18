import { expect, test, type Locator } from "@playwright/test";
import { answer, playedSounds, recordSounds, startGame, toMainPhase, useSettings } from "./helpers";

// The quick chat (game/quick-chat.ts), in a game against a bot: its button left of the sidebar's (of the sidebar when it is
// shown), seven lines, each shown as who said what and said by the player's leader (public/audio/cards/<leader>-<line>);
// a turn begins with its player's leader's voice (-start) instead of the common sound; blocked, it is off.

/** Whether `a` is left of `b` on the screen (not overlapping it). */
async function leftOf(a: Locator, b: Locator): Promise<boolean> {
  const [x, y] = [(await a.boundingBox())!, (await b.boundingBox())!];
  return x.x + x.width <= y.x;
}

test("the quick chat: seven lines, shown and said by the leader; a turn's leader voice; blocking it", async ({ page }) => {
  const problems: string[] = [];
  page.on("pageerror", (e) => problems.push(e.message));
  await useSettings(page, { uiLang: "zh", cardLang: "cn", botDelayMs: 0, setupControllers: ["human", "greedy"], setupDecks: ["samples/sd01.json", "samples/sd02.json"], setupTurnOrder: "player1" });
  await startGame(page, "quick-chat-e2e");
  await toMainPhase(page);
  // Player 1's leader (SD01-LD01) has a greeting and a turn's voice; player 2's has none: its turn sounds as usual.
  await recordSounds(page, ["audio/cards/SD01-LD01-greet.mp3", "audio/cards/SD01-LD01-start.mp3", "audio/sfx/turn.mp3"]);

  const button = page.getByTestId("quick-chat");
  expect(await leftOf(button, page.getByTestId("sidebar-show"))).toBe(true);
  await button.click();
  await expect(page.getByTestId("quick-chat-menu").getByRole("menuitem")).toHaveText(["你好。", "谢谢你。", "对不起……", "真棒！", "怎么回事？", "令人困惑……", "我必将胜利！"]);
  await page.getByTestId("quick-chat-greet").click();
  await expect(page.getByTestId("quick-chat-menu")).toHaveCount(0);
  await expect(page.getByTestId("chat-notice")).toHaveText("玩家 1发送了：你好。");
  await expect.poll(() => playedSounds(page)).toEqual(["SD01-LD01-greet.mp3"]);

  // The bot's turn begins with the common sound, ours with our leader's voice instead.
  await answer(page, "mainPhase");
  await toMainPhase(page);
  await expect.poll(() => playedSounds(page)).toEqual(["SD01-LD01-greet.mp3", "turn.mp3", "SD01-LD01-start.mp3"]);

  // Blocked (the sidebar's debug tab): off. The button stays left of the sidebar while it is shown.
  await page.getByTestId("sidebar-show").click();
  await page.getByTestId("tab-debug").click();
  expect(await leftOf(button, page.getByTestId("game-sidebar"))).toBe(true);
  await page.getByTestId("debug-block-quick-chat").check();
  await expect(button).toBeDisabled();
  await page.getByTestId("debug-block-quick-chat").uncheck();
  await expect(button).toBeEnabled();
  expect(problems).toEqual([]);
});
