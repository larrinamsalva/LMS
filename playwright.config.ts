import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 60000,
  expect: { timeout: 15000 },
  use: {
    baseURL: "http://127.0.0.1:3100",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE }
      : {},
  },
  projects: [
    {
      name: "desktop",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 1000 },
        baseURL: "http://127.0.0.1:3100",
      },
    },
    {
      name: "tablet",
      use: {
        ...devices["iPad (gen 7)"],
        baseURL: "http://127.0.0.1:3101",
        defaultBrowserType: "chromium",
      },
    },
    {
      name: "phone",
      use: {
        ...devices["iPhone 13"],
        baseURL: "http://127.0.0.1:3102",
        defaultBrowserType: "chromium",
      },
    },
  ],
  // Separate bounded demo runtimes per viewport; never raise the production demo session cap for tests.
  webServer: [3100, 3101, 3102].map((port) => ({
    command: `npm run start -- --port ${port}`,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
    env: {
      NEXT_TELEMETRY_DISABLED: "1",
      LMS_APP_ORIGIN: `http://127.0.0.1:${port}`,
    },
  })),
  reporter: [["list"], ["html", { open: "never" }]],
});
