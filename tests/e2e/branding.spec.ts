import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { readFile } from "node:fs/promises";
import { importBlueprintPackage } from "../../src/core/blueprint";
async function step(page: Page, name: string) {
  await page
    .getByRole("navigation", { name: "BuildPlan steps", exact: true })
    .getByRole("button", { name, exact: true })
    .click();
}
async function fits(page: Page) {
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
}
async function snapshot(page: Page) {
  return page.evaluate(
    async () => (await (await fetch("/api/demo")).json()).workspace,
  );
}
test("Gallery branding previews accessibly and survives draft, JSON and package reuse without automatic publication", async ({
  page,
  context,
}, info) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Build My Business System", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Browse Business Templates", exact: true })
    .click();
  await page
    .getByRole("article", { name: "Cleaning Crew & Scheduling", exact: true })
    .getByRole("button", { name: "Customize This Template", exact: true })
    .click();
  const before = await snapshot(page);
  await page
    .getByLabel("Business name", { exact: true })
    .fill("Fictional Bright Crew");
  await page
    .getByRole("checkbox", {
      name: "Include business branding in this BuildPlan",
      exact: true,
    })
    .check();
  await page
    .getByLabel("Tagline or slogan (optional)", { exact: true })
    .fill("<script>window.__brandPwned=true</script>");
  await expect(
    page.getByRole("alert").filter({ hasText: "plain single-line tagline" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: "Download Blueprint Package",
      exact: true,
    }),
  ).toBeDisabled();
  expect(
    await page.evaluate(
      () => (window as typeof window & { __brandPwned?: boolean }).__brandPwned,
    ),
  ).toBeUndefined();
  await page
    .getByLabel("Tagline or slogan (optional)", { exact: true })
    .fill("Fictional care. A brighter day.");
  await page.getByLabel("Monogram or initials", { exact: true }).fill("WWWW");
  expect(
    await page
      .locator(".brand-example .business-mark")
      .evaluateAll((elements) =>
        elements.every((e) => e.scrollWidth <= e.clientWidth),
      ),
  ).toBe(true);
  await page.getByLabel("Monogram or initials", { exact: true }).fill("bc");
  await expect(
    page.getByLabel("Monogram or initials", { exact: true }),
  ).toHaveValue("BC");
  await page.getByLabel("Logo mark", { exact: true }).selectOption("sparkle");
  await page
    .getByLabel("Default workspace appearance", { exact: true })
    .selectOption("dark");
  for (const name of [
    "Forest & linen",
    "Ocean & cloud",
    "Plum & pearl",
    "Copper & sage",
  ]) {
    await page.getByRole("radio", { name: new RegExp(name) }).check();
    await fits(page); // Both immediate light/dark samples are present and checked.
  }
  await page.getByRole("radio", { name: /Plum & pearl/ }).check();
  await page.locator(".branding-studio").screenshot({ path: info.outputPath("branding-studio.png"), scale: "css" });
  await expect(page.locator('input[type="file"][accept*="image"]')).toHaveCount(
    0,
  );
  await step(page, "4 · Review & try");
  await expect(
    page.getByText(/Branding changes\. Operational records/),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Save BuildPlan draft", exact: true })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: "BuildPlan draft saved" }),
  ).toBeVisible();
  const pendingJson = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Export BuildPlan JSON", exact: true })
    .click();
  const jsonBytes = await readFile((await (await pendingJson).path())!);
  expect(JSON.parse(jsonBytes.toString()).version).toBe(2);
  const pendingZip = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Download Blueprint Package", exact: true })
    .click();
  const zipBytes = await readFile((await (await pendingZip).path())!),
    blueprint = await importBlueprintPackage(zipBytes);
  expect(blueprint.manifest.version).toBe(2);
  expect(blueprint.plan.configuration.branding).toMatchObject({
    monogram: "BC",
    mark: "sparkle",
    palette: "plum-v1",
    appearance: "dark",
  });
  await page
    .getByRole("button", { name: "Prepare workspace preview", exact: true })
    .click();
  const opened = context.waitForEvent("page");
  await page
    .getByRole("link", {
      name: "Open interactive workspace preview (new tab)",
      exact: true,
    })
    .click();
  const preview = await opened;
  await expect(
    preview.getByRole("heading", {
      name: "Fictional Bright Crew",
      exact: true,
    }),
  ).toBeVisible();
  await expect(preview.locator(".app")).toHaveAttribute(
    "data-brand",
    "plum-v1",
  );
  await expect(preview.locator(".app")).toHaveAttribute("data-theme", "dark");
  await expect(preview.locator(".topbar")).toContainText(
    "Fictional care. A brighter day.",
  );
  await expect(preview.locator(".business-mark svg").first()).toBeVisible();
  await fits(preview);
  await preview.screenshot({
    path: info.outputPath("branded-workspace-dark.png"),
    fullPage: true,
    scale: "css",
  });
  await preview
    .getByRole("button", { name: "Switch to light theme", exact: true })
    .click();
  await fits(preview);
  await preview.screenshot({
    path: info.outputPath("branded-workspace-light.png"),
    fullPage: true,
    scale: "css",
  });
  await preview.close();
  const saved = await snapshot(page);
  expect(saved.records).toEqual(before.records);
  expect(saved.history).toEqual(before.history);
  await page.reload();
  await page
    .getByRole("button", { name: "BuildPlan Studio", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Reopen Fictional Bright Crew", exact: true })
    .click();
  await step(page, "3 · Customize");
  await expect(
    page.getByLabel("Tagline or slogan (optional)", { exact: true }),
  ).toHaveValue("Fictional care. A brighter day.");
  await expect(page.getByLabel("Logo mark", { exact: true })).toHaveValue(
    "sparkle",
  );
  await page
    .getByLabel("Load an exported BuildPlan JSON file", { exact: true })
    .setInputFiles({
      name: "branded.json",
      mimeType: "application/json",
      buffer: jsonBytes,
    });
  await expect(page.getByText(/Loaded a validated BuildPlan/)).toBeVisible();
  await page
    .getByLabel("Import Blueprint Package", { exact: true })
    .setInputFiles({
      name: "branded.zip",
      mimeType: "application/zip",
      buffer: zipBytes,
    });
  await expect(
    page.getByRole("heading", { name: "Review Blueprint", exact: true }),
  ).toBeFocused();
  await expect(
    page.getByText(
      /BuildPlan 2 · Engine API 1 · Template 1 · Configuration schema 2/,
    ),
  ).toBeVisible();
  expect(await snapshot(page)).toEqual(saved);
  await expect(page.locator(".app")).not.toHaveAttribute("data-brand");
  await page
    .getByRole("button", { name: "Use as unsaved Studio choices", exact: true })
    .click();
  await step(page, "3 · Customize");
  await expect(
    page.getByLabel("Monogram or initials", { exact: true }),
  ).toHaveValue("BC");
  await expect(page.getByRole("radio", { name: /Plum & pearl/ })).toBeChecked();
  await page.getByLabel("Logo mark", { exact: true }).selectOption("monogram");
  await page
    .getByRole("button", { name: "Switch to dark theme", exact: true })
    .click();
  await fits(page);
});
test("compatible branding requires saved explicit publication and rollback preserves records and organizations", async ({
  page,
}, info) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Build My Business System", exact: true })
    .click();
  await step(page, "3 · Customize");
  const original = await snapshot(page);
  await page
    .getByLabel("Business name", { exact: true })
    .fill("Fictional Cedar Identity");
  await page
    .getByRole("checkbox", {
      name: "Include business branding in this BuildPlan",
      exact: true,
    })
    .check();
  await page
    .getByLabel("Tagline or slogan (optional)", { exact: true })
    .fill("A fictional place to belong.");
  await page.getByLabel("Logo mark", { exact: true }).selectOption("home");
  await page.getByLabel("Monogram or initials", { exact: true }).fill("CG");
  await page
    .getByLabel("Default workspace appearance", { exact: true })
    .selectOption("dark");
  await step(page, "4 · Review & try");
  await expect(
    page.getByRole("button", {
      name: "Publish reviewed BuildPlan",
      exact: true,
    }),
  ).toBeDisabled();
  expect((await snapshot(page)).config.revision).toBe(1);
  await page
    .getByRole("button", { name: "Save BuildPlan draft", exact: true })
    .click();
  const confirmation = page.getByRole("checkbox", {
    name: /I reviewed this saved plan/,
  });
  await expect(confirmation).toBeEnabled();
  await confirmation.focus();
  await page.keyboard.press("Space");
  await page
    .getByRole("button", { name: "Publish reviewed BuildPlan", exact: true })
    .click();
  await expect(page.locator(".app")).toHaveAttribute("data-brand", "forest-v1");
  await expect(page.locator(".app")).toHaveAttribute("data-theme", "dark");
  await expect(page.locator(".topbar")).toContainText(
    "Fictional Cedar Identity",
  );
  await fits(page);
  await page
    .getByRole("button", { name: "Switch to light theme", exact: true })
    .click();
  await fits(page);
  const published = await snapshot(page);
  expect(published.records).toEqual(original.records);
  expect(published.stockBalances).toEqual(original.stockBalances);
  await step(page, "3 · Customize");
  await page.getByRole("radio", { name: /Copper & sage/ }).check();
  await step(page, "4 · Review & try");
  await page
    .getByRole("button", { name: "Save BuildPlan draft", exact: true })
    .click();
  await confirmation.check();
  await page
    .getByRole("button", { name: "Publish reviewed BuildPlan", exact: true })
    .click();
  await expect(page.locator(".app")).toHaveAttribute("data-brand", "copper-v1");
  await fits(page);
  await page.screenshot({
    path: info.outputPath("branding-publication-light.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: /Project & modules/ }).click();
  await page
    .getByRole("button", { name: "Restore revision 2", exact: true })
    .click();
  await expect(page.locator(".app")).toHaveAttribute("data-brand", "forest-v1");
  await expect(page.locator(".app")).toHaveAttribute("data-theme", "light"); // Viewer preference wins over restored default.
  await page
    .getByRole("button", { name: "Restore revision 1", exact: true })
    .click();
  await expect(page.locator(".app")).not.toHaveAttribute("data-brand");
  const restored = await snapshot(page);
  expect(restored.config.document).toEqual(original.config.document);
  expect(restored.config.revision).toBe(5);
  expect(restored.records).toEqual(original.records);
  expect(restored.stockBalances).toEqual(original.stockBalances);
  expect(restored.buildPlans).toHaveLength(2);
  await page
    .getByLabel("Business workspace", { exact: true })
    .selectOption({ label: "Cleaning Company" });
  await expect(page.locator(".app")).not.toHaveAttribute("data-brand");
  await expect(
    page.getByRole("heading", { name: "Bright Path Cleaning", exact: true }),
  ).toBeVisible();
  await fits(page);
});
