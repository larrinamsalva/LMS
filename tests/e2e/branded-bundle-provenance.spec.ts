import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { build } from "esbuild";
import { readFile } from "node:fs/promises";
import { blueprintJson } from "../../src/core/blueprint";
import { fictionalBrandedBundle } from "../helpers/branded-logo";
import {
  testPublisher,
  testAttestation,
} from "../helpers/blueprint-provenance";
import { testBundleAttestation } from "../helpers/branded-bundle-provenance";

test("browser WebCrypto distinguishes complete, nested-only, unsigned and refused bundle claims using isolated ephemeral test trust", async ({
  page,
}, info) => {
  const publisher = testPublisher(),
    sample = await fictionalBrandedBundle(),
    claim = await testBundleAttestation(sample.bundle, publisher),
    nested = await testAttestation(sample.zip, publisher),
    entry = await build({
      entryPoints: ["tests/fixtures/branded-bundle-verification-browser.tsx"],
      bundle: true,
      write: false,
      platform: "browser",
      format: "iife",
      globalName: "lmsBundleTest",
      jsx: "automatic",
      define: { "process.env.NODE_ENV": '"production"' },
    }),
    css = await readFile("src/app/globals.css", "utf8");
  await page.route("**/bundle-provenance-test-harness", (r) =>
    r.fulfill({
      contentType: "text/html",
      body: `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Fictional complete-bundle signature test</title><style>${css}</style></head><body><div class="app" data-theme="light"><main class="stack studio"><h1>Test-only complete-bundle verification</h1><p>Isolated ephemeral public trust for automated tests. No real publisher is enrolled. No private signing key, asset, database or demo session is installed.</p><div id="result"></div></main></div><script>${entry.outputFiles[0].text}</script></body></html>`,
    }),
  );
  await page.goto("/bundle-provenance-test-harness");
  const inspect = (
    whole: Uint8Array | null,
    blueprint: Uint8Array | null,
    registry: unknown = publisher.registry,
  ) =>
    page.evaluate(
      async ({ bytes, whole, nested, registry }) =>
        (window as any).lmsBundleTest.inspect(bytes, whole, nested, registry),
      {
        bytes: Array.from(sample.bundle),
        whole: whole === null ? null : Array.from(whole),
        nested: blueprint === null ? null : Array.from(blueprint),
        registry,
      },
    );
  const result = await inspect(claim, null);
  expect(result.publisher.status).toBe("verified");
  expect(result.nested.status).toBe("unsigned");
  await expect(
    page.getByText(
      "Verified complete-bundle signature · Fictional test publisher",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(page.locator("img")).toHaveCount(0);
  for (const theme of ["light", "dark"]) {
    await page
      .locator(".app")
      .evaluate((el, value) => el.setAttribute("data-theme", value), theme);
    const details = page.getByText(
      "Inspect complete-bundle and signing-key fingerprints",
      { exact: true },
    );
    await details.focus();
    await page.keyboard.press("Enter");
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
      path: info.outputPath(`custom-logo-bundle-authenticated-${theme}.png`),
      fullPage: true,
      scale: "css",
    });
    await details.focus();
    await page.keyboard.press("Enter");
  }
  const scoped = await inspect(null, nested);
  expect(scoped.publisher.status).toBe("unsigned");
  expect(scoped.nested.status).toBe("verified");
  await expect(
    page.getByText(
      "Verified nested Blueprint only · Fictional test publisher",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(
    page.getByText(
      "Verified complete-bundle signature · Fictional test publisher",
      { exact: true },
    ),
  ).toHaveCount(0);
  const unsigned = await inspect(null, null);
  expect(unsigned.publisher.status).toBe("unsigned");
  expect(unsigned.nested.status).toBe("unsigned");
  await expect(
    page.getByText(
      "Unsigned / publisher unverified. Integrity checks do not establish a publisher.",
      { exact: true },
    ),
  ).toBeVisible();
  const bad = JSON.parse(new TextDecoder().decode(claim));
  bad.signature = "00".repeat(64);
  await expect(
    inspect(new TextEncoder().encode(blueprintJson(bad)), null),
  ).rejects.toThrow(/Invalid publisher signature/);
  await expect(page.getByRole("alert")).toContainText("No import was accepted");
  await expect(
    page.getByText(
      "Verified complete-bundle signature · Fictional test publisher",
      { exact: true },
    ),
  ).toHaveCount(0);
  const retired = structuredClone(publisher.registry);
  retired.keys[0].status = "retired";
  await expect(inspect(claim, null, retired)).rejects.toThrow(
    /Retired publisher key/,
  );
  await expect(
    inspect(claim, null, {
      format: "lms-blueprint-publisher-registry",
      version: 1,
      keys: [],
    }),
  ).rejects.toThrow(/Unknown publisher key/);
  expect((await inspect(claim, nested)).publisher.status).toBe("verified");
});
