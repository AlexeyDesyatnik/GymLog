import { defineConfig, devices } from "@playwright/test";
import { E2E_SERVER_PORT } from "./e2e/server.ts";

const port = 4175;

/**
 * End-to-end flows (seam 3): the app as it is deployed, built with its service worker, in a
 * phone-sized Chromium, each test on an empty IndexedDB, syncing with the real server on a clean
 * PostgreSQL in Docker.
 */
export default defineConfig({
  testDir: "e2e",
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  globalSetup: "./e2e/server.ts",
  use: {
    baseURL: `http://localhost:${port}`,
    trace: "retain-on-failure",
  },
  // The owner's phone is an Android one, so Chromium on a Pixel is the closest stand-in.
  projects: [{ name: "mobile", use: { ...devices["Pixel 7"] } }],
  webServer: {
    command: `npm run build && npm run preview -w @gymlog/client -- --port ${port} --strictPort`,
    url: `http://localhost:${port}`,
    // The app passes its /api requests on to the run's own server, not the dev one.
    env: { SERVER_PORT: String(E2E_SERVER_PORT) },
    // A build takes a while.
    timeout: 120_000,
    reuseExistingServer: !process.env.CI,
  },
});
