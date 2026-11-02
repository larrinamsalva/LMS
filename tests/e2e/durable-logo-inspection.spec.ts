import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { build } from "esbuild";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { logoFixture } from "../helpers/logo-fixtures";
import { sanitizeLogo } from "../../src/server/logo-sanitizer";
import { privateLogoUrl } from "../../src/core/private-logo";
test("test-only private inspection reuses branded rendering, responsive themes and missing-image fallback without persistent routes", async ({
  page,
  request,
}, info) => {
  const clean = await sanitizeLogo(await logoFixture()),
    org = randomUUID(),
    asset = {
      id: randomUUID(),
      width: clean.width,
      height: clean.height,
      bytes: clean.bytes.length,
      display: "rectangle" as const,
      expiresAt: Date.now() + 60000,
    };
  const assetUrl = privateLogoUrl(org, asset.id),
    bundle = await build({
      entryPoints: ["tests/fixtures/private-logo-inspection-browser.tsx"],
      bundle: true,
      write: false,
      platform: "browser",
      format: "iife",
      globalName: "lmsPrivateInspection",
      jsx: "automatic",
      define: { "process.env.NODE_ENV": '"production"' },
    }),
    css = await readFile("src/app/globals.css", "utf8");
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Private inspection fixture</title><style>${css}</style></head><body><div id="result"></div><script>${bundle.outputFiles[0].text}</script></body></html>`;
  await page.route("**/private-logo-inspection-fixture", (route) =>
    route.fulfill({ contentType: "text/html", body: html }),
  );
  // No app route or demo session is installed; this transport exists only in this test's browser context.
  await page.route("**/api/demo/logo?**", (route) =>
    route.fulfill({
      contentType: "image/png",
      body: clean.bytes,
      headers: { "Cache-Control": "private, no-store" },
    }),
  );
  async function open() {
    await page.goto("/private-logo-inspection-fixture");
    await page.evaluate(
      ({ org, asset }) =>
        (window as any).lmsPrivateInspection.render(org, asset),
      { org, asset },
    );
  }
  await open();
  await expect(page.getByRole("img")).toBeVisible();
  for (const theme of ["light", "dark"]) {
    if (theme === "dark")
      await page
        .getByRole("button", { name: "Switch inspection theme", exact: true })
        .click();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect(
      (
        await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
          .analyze()
      ).violations,
    ).toEqual([]);
    await page.screenshot({
      path: info.outputPath(`custom-logo-durable-inspection-${theme}.png`),
      scale: "css",
      fullPage: true,
    });
  }
  expect((await request.get(assetUrl)).status()).toBe(401);
  await page.unroute("**/api/demo/logo?**");
  await open();
  await expect(
    page.getByText("Logo unavailable · built-in fallback", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", {
      name: "Use built-in inspection identity",
      exact: true,
    })
    .focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("img")).toHaveCount(0);
  await expect(
    page.getByText("Fictional Local Cleaners", { exact: true }),
  ).toBeVisible();
});
