import { defineConfig } from "@playwright/test";

// End-to-end tests of the GUI (`npm run test:gui` at the repository root). They start their own dev server and drive the
// browser installed on this machine (Chrome by default; SVE_E2E_CHANNEL=msedge for Edge), so no browser download is needed.
const port = Number(process.env.SVE_E2E_PORT ?? 5199);
// The online server's relay for the tests of "use the server" (tests/e2e/relay.ini: plain ws:// on this port, a test key).
const relayPort = 5198;

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 180_000,
  expect: { timeout: 30_000 },
  reporter: "list",
  use: {
    baseURL: `http://localhost:${port}`,
    channel: process.env.SVE_E2E_CHANNEL ?? "chrome",
    headless: process.env.SVE_E2E_HEADED !== "1",
    viewport: { width: 1600, height: 900 },
  },
  webServer: [
    {
      command: `npx vite --port ${port} --strictPort`,
      url: `http://localhost:${port}`,
      reuseExistingServer: false,
      timeout: 180_000,
    },
    {
      command: "npx tsx ../server/src/main.ts --config tests/e2e/relay.ini",
      url: `http://127.0.0.1:${relayPort}/`,
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
});
