import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./test/browser",
  fullyParallel: false,
  timeout: 60_000,
  use: {
    ...devices["iPhone 13"],
    browserName: "chromium",
    baseURL: "http://localhost:8082",
    launchOptions: {
      channel:
        process.env.PLAYWRIGHT_CHANNEL ??
        (process.platform === "win32" ? "msedge" : undefined),
    },
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npx expo serve --port 8082",
    url: "http://localhost:8082",
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
