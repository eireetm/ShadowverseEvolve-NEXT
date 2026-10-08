import { expect, test } from "@playwright/test";
import { useSettings } from "./helpers";

// Settings, "检查版本更新": only where the program can update itself (the PC release's /api/update, played here by the test;
// the dev server has none). A newer version opens a window offering it: "以后再说" closes it, "更新" follows the update
// (downloading, restarting) and loads the page again once the new version answers; a failed one says why.

test("the update check offers a newer version in a window, and updating loads the new version", async ({ page }) => {
  await useSettings(page, { uiLang: "zh" });
  await page.goto("/");
  await page.getByTestId("menu-settings").click();
  await expect(page.getByTestId("settings-version")).toBeVisible();
  await expect(page.getByTestId("settings-check-update")).toHaveCount(0);

  // The PC release's server.
  let version = "0.4.1";
  let latest = "0.4.1";
  let job: Record<string, unknown> = { state: "idle" };
  let installs = 0;
  await page.route("**/api/update/status", (route) => route.fulfill({ json: { version, job } }));
  await page.route("**/api/update/check", (route) =>
    route.fulfill({ json: { ok: true, current: "0.4.1", latest, newer: latest !== "0.4.1", page: "https://github.com/eireetm/ShadowverseEvolve-NEXT/releases/tag/v0.4.2" } }),
  );
  await page.route("**/api/update/install", (route) => {
    installs++;
    job = installs === 1 ? { state: "failed", why: "download", detail: "github.com: no answer in 30 s" } : { state: "downloading", received: 512 * 1024, total: 1024 * 1024 };
    return route.fulfill({ status: 202, json: { version, job } });
  });
  await page.reload();
  await page.getByTestId("menu-settings").click();
  const check = page.getByTestId("settings-check-update");
  await expect(check).toHaveText("检查版本更新");

  // The latest already.
  await check.click();
  await expect(page.getByTestId("settings-update-result")).toHaveText("已经是最新版本。");
  await expect(page.getByTestId("update-window")).toHaveCount(0);

  // A newer one: the window; "以后再说" closes it.
  latest = "0.4.2";
  await check.click();
  await expect(page.getByTestId("update-offer")).toHaveText("有新版本 0.4.2（现在 0.4.1）");
  await expect(page.getByTestId("update-install")).toHaveText("更新");
  await expect(page.getByTestId("update-later")).toHaveText("以后再说");
  await page.getByTestId("update-later").click();
  await expect(page.getByTestId("update-window")).toHaveCount(0);
  await expect(page.getByTestId("settings-update-result")).toHaveText("有新版本 0.4.2（现在 0.4.1）");

  // Updating fails: why, and where to download it by hand.
  await check.click();
  await page.getByTestId("update-install").click();
  await expect(page.getByTestId("update-failed")).toHaveText("更新失败：从 GitHub 下载失败，可能是这里连不上 GitHub。");
  await expect(page.getByTestId("update-manual")).toHaveAttribute("href", /releases\/tag\/v0\.4\.2$/);
  await page.getByTestId("update-close").click();
  await expect(page.getByTestId("update-window")).toHaveCount(0);

  // Updating: downloading, restarting (the window stays), then the page again as the new version answers.
  job = { state: "idle" };
  await check.click();
  await page.evaluate(() => ((window as unknown as { beforeUpdate: boolean }).beforeUpdate = true));
  await page.getByTestId("update-install").click();
  await expect(page.getByTestId("update-progress")).toHaveText("正在从 GitHub 下载新版本… 50%");
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("update-window")).toBeVisible();
  job = { state: "restarting", version: "0.4.2" };
  await expect(page.getByTestId("update-progress")).toHaveText("更新完成，正在重启…");
  version = "0.4.2";
  job = { state: "idle" };
  await page.waitForFunction(() => (window as unknown as { beforeUpdate?: boolean }).beforeUpdate === undefined);
  await expect(page.getByTestId("menu-settings")).toBeVisible();
});
