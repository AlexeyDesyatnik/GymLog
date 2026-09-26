import { defineConfig, devices } from "@playwright/test";

const port = 4175;

/** End-to-end flows (seam 3): the real app in a phone-sized Chromium, each test on an empty IndexedDB. */
export default defineConfig({
  testDir: "e2e",
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://localhost:${port}`,
    trace: "retain-on-failure",
  },
  // The owner's phone is an Android one, so Chromium on a Pixel is the closest stand-in.
  projects: [{ name: "mobile", use: { ...devices["Pixel 7"] } }],
  webServer: {
    command: `npm run dev -w @gymlog/client -- --port ${port} --strictPort`,
    url: `http://localhost:${port}`,
    reuseExistingServer: !process.env.CI,
  },
});
