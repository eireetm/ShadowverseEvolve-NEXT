import { expect, test } from "@playwright/test";
import { useSettings } from "./helpers";

// The phone apps in the background (src/resources/sound.ts setInBackground, called on Capacitor's appStateChange): their
// web view would go on playing, so the music pauses where it is and goes on when the app is back, and no sound effect
// plays meanwhile. Played here with stand-in audio elements that only record what is asked of them.

test("in the background the music pauses and nothing plays; back in front, the same music goes on", async ({ page }) => {
  await useSettings(page, { uiLang: "en" });
  await page.goto("/");
  await expect(page.getByTestId("menu-settings")).toBeVisible({ timeout: 120_000 });
  const events = await page.evaluate(`(async () => {
    const events = [];
    const file = (url) => url.split("/").pop();
    window.Audio = class {
      constructor(url) { this.src = url; this.paused = true; this.volume = 1; this.loop = false; events.push("new " + file(url)); }
      play() { this.paused = false; events.push("play " + file(this.src)); return Promise.resolve(); }
      pause() { this.paused = true; events.push("pause " + file(this.src)); }
    };
    const lookup = await import("/src/resources/lookup.ts");
    const sound = await import("/src/resources/sound.ts");
    lookup.setResourceLists(["audio/bgm/battle.mp3", "audio/bgm/deck.mp3", "audio/sfx/click.mp3"], []);
    const step = (name) => { events.push("-- " + name); };
    step("battle");
    sound.playBgm("battle");
    step("away");
    sound.setInBackground(true);
    sound.playSfx("click");
    sound.playBgm("deck");
    step("back");
    sound.setInBackground(false);
    sound.playSfx("click");
    await new Promise((done) => setTimeout(done, 50));
    return events;
  })()`);
  expect(events).toEqual([
    "-- battle",
    "new battle.mp3",
    "play battle.mp3",
    "-- away",
    "pause battle.mp3",
    // A change of screen in the background: the old music is already paused, the new one waits.
    "new deck.mp3",
    "-- back",
    "play deck.mp3",
    "new click.mp3",
    "play click.mp3",
  ]);
});
