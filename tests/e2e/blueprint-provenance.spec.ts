import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { build } from "esbuild";
import { readFile } from "node:fs/promises";
import {
  blueprintJson,
  createBlueprintPackage,
} from "../../src/core/blueprint";
import { reviewedGallery } from "../../src/core/gallery";
import {
  testAttestation,
  testPublisher,
} from "../helpers/blueprint-provenance";

test("browser WebCrypto verifies explicit ephemeral test trust and renders accurate accessible status without a public trust-enrollment path", async ({
  page,
}, info) => {
  const publisher = testPublisher(),
    bytes = await createBlueprintPackage(reviewedGallery()[0].plan, {
      name: "Fictional browser signature",
      description: "Ephemeral test trust only.",
      gallery: { id: "basic-cleaning", revision: 1 },
    }),
    claim = await testAttestation(bytes, publisher),
    bundle = await build({
      entryPoints: ["tests/fixtures/blueprint-verification-browser.tsx"],
      bundle: true,
      write: false,
      platform: "browser",
      format: "iife",
      globalName: "lmsProvenanceTest",
      jsx: "automatic",
      define: { "process.env.NODE_ENV": '"production"' },
    }),
    css = await readFile("src/app/globals.css", "utf8");
  // No application route, persisted trust switch, private key or demo session is installed for this harness.
  await page.route("**/provenance-test-harness", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Fictional signature test</title><style>${css}</style></head><body><div class="app" data-theme="light"><main class="stack studio"><h1>Test-only publisher verification</h1><p>This isolated harness uses an ephemeral key, not an enrolled real publisher.</p><div id="result"></div></main></div><script>${bundle.outputFiles[0].text}</script></body></html>`,
    }),
  );
  await page.goto("/provenance-test-harness");
  const result = await page.evaluate(
    async ({ zip, claim, registry }) =>
      (window as any).lmsProvenanceTest.inspect(zip, claim, registry),
    {
      zip: Array.from(bytes),
      claim: Array.from(claim),
      registry: publisher.registry,
    },
  );
  expect(result.publisher.status).toBe("verified");
  await expect(
    page.getByText("Verified publisher signature · Fictional test publisher", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByText(/Configuration exactly matches locally reviewed/),
  ).toBeVisible();
  for (const theme of ["light", "dark"]) {
    await page
      .locator(".app")
      .evaluate((el, theme) => el.setAttribute("data-theme", theme), theme);
    await page
      .getByText("Inspect exact package and verification key fingerprints", {
        exact: true,
      })
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
      path: info.outputPath(`publisher-test-key-${theme}.png`),
      fullPage: true,
      scale: "css",
    });
    await page
      .getByText("Inspect exact package and verification key fingerprints", {
        exact: true,
      })
      .click();
  }
  const forged = JSON.parse(new TextDecoder().decode(claim));
  forged.signature = "00".repeat(64);
  await expect(
    page.evaluate(
      async ({ zip, claim, registry }) =>
        (window as any).lmsProvenanceTest.inspect(zip, claim, registry),
      {
        zip: Array.from(bytes),
        claim: Array.from(new TextEncoder().encode(blueprintJson(forged))),
        registry: publisher.registry,
      },
    ),
  ).rejects.toThrow(/Invalid publisher signature/);
  const retired = structuredClone(publisher.registry);
  retired.keys[0].status = "retired";
  await expect(
    page.evaluate(
      async ({ zip, claim, registry }) =>
        (window as any).lmsProvenanceTest.inspect(zip, claim, registry),
      { zip: Array.from(bytes), claim: Array.from(claim), registry: retired },
    ),
  ).rejects.toThrow(/Retired publisher key/);
});
