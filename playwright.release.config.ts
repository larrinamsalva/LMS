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
    command: `npm run demo -- --port ${new URL(baseURL).port}`,
    url: baseURL,
    reuseExistingServer: false,
    timeout: 120_000,
  })),
});
