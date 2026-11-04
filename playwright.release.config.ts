import { defineConfig } from "@playwright/test";
import browser from "./playwright.config";

const projects = browser.projects!.map((project, index) => ({
  ...project,
  use: { ...project.use, baseURL: `http://127.0.0.1:${3210 + index}` },
}));

export default defineConfig({
  ...browser,
  projects,
  testDir: "./tests/release",
  testMatch: "**/*.spec.ts",
  reporter: "list",
  outputDir: "test-results/release",
  webServer: projects.map(({ use: { baseURL } }) => ({
    command:
      process.platform === "win32"
        ? `pwsh -NoProfile -File scripts/start-demo.ps1 -StartOnly -Port ${new URL(baseURL).port}`
        : `npm run demo -- --port ${new URL(baseURL).port}`,
    url: baseURL,
    reuseExistingServer: false,
    timeout: 120_000,
  })),
});
