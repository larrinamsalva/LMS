import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { build } from "esbuild";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { logoFixture } from "../helpers/logo-fixtures";
import { sanitizeLogo } from "../../src/server/logo-sanitizer";
import { privateLogoUrl } from "../../src/core/private-logo";
import { presets } from "../../src/presets";
import { defaultBranding } from "../../src/core/branding";
test("host-only association presentation shows active, stale and explicit fallback responses with accessible responsive themes", async ({
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
  const association = {
    format: "lms-private-logo-association",
    version: 1,
    organizationId: org,
    revision: 1,
    configurationRevision: 2,
    configurationSha256: "a".repeat(64),
    mode: "image",
    asset: { id: asset.id, revision: 2, sha256: "b".repeat(64) },
    display: "rectangle",
    actorId: randomUUID(),
    operationId: randomUUID(),
    restoredFrom: null,
    occurredAt: "2026-01-01T00:00:00.000Z",
  };
  const active = {
    version: 1,
    organizationId: org,
    configurationRevision: 2,
    configurationSha256: "a".repeat(64),
    configuration: {
      ...presets.property,
      schemaVersion: 2,
      branding: defaultBranding("property"),
    },
    revision: 1,
    status: "active",
    association,
  };
  const states = [
    active,
    { ...active, configurationRevision: 3, status: "configuration-changed" },
    {
      ...active,
      revision: 2,
      status: "builtin",
      association: {
        ...association,
        revision: 2,
        mode: "builtin",
        asset: null,
        display: null,
        operationId: randomUUID(),
      },
    },
  ];
  const bundle = await build({
      entryPoints: ["tests/fixtures/logo-association-inspection-browser.tsx"],
      bundle: true,
      write: false,
      platform: "browser",
      format: "iife",
      globalName: "lmsAssociationInspection",
      jsx: "automatic",
      define: { "process.env.NODE_ENV": '"production"' },
    }),
    css = await readFile("src/app/globals.css", "utf8");
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Private branding association fixture</title><style>${css}</style></head><body><div id="result"></div><script>${bundle.outputFiles[0].text}</script></body></html>`;
  await page.route("**/private-association-fixture", (route) =>
    route.fulfill({ contentType: "text/html", body: html }),
  );
  await page.route("**/api/demo/logo?**", (route) =>
    route.fulfill({
      contentType: "image/png",
      body: clean.bytes,
      headers: { "Cache-Control": "private, no-store" },
    }),
  );
  async function open() {
    await page.goto("/private-association-fixture");
    await page.evaluate(
      ({ org, asset, states }) =>
        (window as any).lmsAssociationInspection.render(org, asset, states),
      { org, asset, states },
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
      path: info.outputPath(`custom-logo-association-${theme}.png`),
      fullPage: true,
      scale: "css",
    });
  }
  await page
    .getByRole("button", {
      name: "Inspect other contained layout",
      exact: true,
    })
    .focus();
  await page.keyboard.press("Enter");
  await expect(page.locator(".private-logo-square")).toBeVisible();
  await page
    .getByRole("button", {
      name: "Show stale-configuration response",
      exact: true,
    })
    .click();
  await expect(page.getByRole("img")).toHaveCount(0);
  await expect(page.getByRole("status")).toContainText("Configuration changed");
  await page.screenshot({
    path: info.outputPath("custom-logo-association-stale.png"),
    fullPage: true,
    scale: "css",
  });
  await page
    .getByRole("button", {
      name: "Show explicit built-in response",
      exact: true,
    })
    .click();
  await expect(page.getByRole("status")).toContainText(
    "retained history preserved",
  );
  expect((await request.get(privateLogoUrl(org, asset.id))).status()).toBe(401);
  await page.unroute("**/api/demo/logo?**");
  await open();
  await expect(
    page.getByText("Logo unavailable · built-in fallback", { exact: true }),
  ).toBeVisible();
});
