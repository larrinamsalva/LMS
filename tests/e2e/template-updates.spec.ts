import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { readFile } from "node:fs/promises";
import { createBlueprintPackage } from "../../src/core/blueprint";
import { validateBuildPlan } from "../../src/core/buildplan";
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
  const organizationId = await page
    .getByLabel("Business workspace", { exact: true })
    .inputValue();
  return page.evaluate(
    async (id) =>
      (await (await fetch(`/api/demo?organizationId=${id}`)).json()).workspace,
    organizationId,
  );
}
test("saved reviewed baselines support deliberate three-way updates while retaining business and branding customizations", async ({
  page,
  context,
}, info) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Explore the working demo →", exact: true })
    .click();
  await page
    .getByLabel("Business workspace", { exact: true })
    .selectOption({ label: "Cleaning Company" });
  await expect(
    page.getByRole("heading", { name: "Bright Path Cleaning", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "BuildPlan Studio", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Browse Business Templates", exact: true })
    .click();
  await page
    .getByRole("article", { name: "Basic Cleaning Business", exact: true })
    .getByRole("button", { name: "Customize This Template", exact: true })
    .click();
  await page
    .getByLabel("Business name", { exact: true })
    .fill("My fictional retained company");
  await page
    .getByLabel("Singular term for Customers", { exact: true })
    .fill("Patron");
  await page
    .getByLabel("Plural term for Customers", { exact: true })
    .fill("My clients");
  await page
    .getByLabel("Navigation label for Customers", { exact: true })
    .fill("Client desk");
  await page
    .getByRole("checkbox", {
      name: "Include business branding in this BuildPlan",
      exact: true,
    })
    .check();
  await page.getByRole("radio", { name: /Plum & pearl/ }).check();
  await page
    .getByLabel("Tagline or slogan (optional)", { exact: true })
    .fill("My retained fictional identity.");
  await page
    .getByRole("button", { name: "Save reviewed starting point", exact: true })
    .click();
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: "Reviewed starting point saved as revision one" }),
  ).toBeVisible();
  await expect(page.getByLabel("Business name", { exact: true })).toHaveValue(
    "My fictional retained company",
  );
  await step(page, "4 · Review & try");
  await page
    .getByRole("button", { name: "Save BuildPlan draft", exact: true })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: "BuildPlan draft saved" }),
  ).toBeVisible();
  const before = await snapshot(page);
  expect(before.buildPlans).toHaveLength(2);
  await page
    .getByRole("button", { name: "Check for Template Updates", exact: true })
    .click();
  await expect(
    page.getByRole("heading", {
      name: "Check for Template Updates",
      exact: true,
    }),
  ).toBeFocused();
  await expect(
    page.getByText("Verified saved baseline:", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("A newer locally reviewed version is available.", {
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Keep My Version", exact: true })
    .click();
  expect(await snapshot(page)).toEqual(before);
  await page
    .getByRole("button", { name: "Check for Template Updates", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Review New Version", exact: true })
    .click();
  await expect(page.locator('input[type="checkbox"]:checked')).toHaveCount(0);
  await expect(
    page.getByRole("article", {
      name: "customers: singular term",
      exact: true,
    }),
  ).toContainText("Conflict · both versions changed");
  await page
    .getByRole("checkbox", { name: /Use new .*Arrival instructions/ })
    .check();
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: /Database migration review required/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Use Reviewed Changes", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("checkbox", { name: /Use new .*Arrival instructions/ })
    .uncheck();
  await page
    .getByRole("checkbox", { name: "Use new Shared scheduling", exact: true })
    .check();
  await page
    .getByText("Local template history and content digests", { exact: true })
    .click();
  await fits(page);
  await page.screenshot({
    path: info.outputPath("template-review-light.png"),
    fullPage: true,
    scale: "css",
  });
  await page
    .getByRole("button", { name: "Switch to dark theme", exact: true })
    .click();
  await fits(page);
  await page
    .getByRole("button", { name: "Preview selected choices", exact: true })
    .click();
  const link = page.getByRole("link", {
    name: "Open template update preview (new tab)",
    exact: true,
  });
  await expect(link).toBeVisible();
  const opened = context.waitForEvent("page");
  await link.click();
  const preview = await opened;
  await expect(
    preview.getByRole("heading", {
      name: "My fictional retained company",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    preview.getByRole("button", { name: "Client desk 0", exact: true }),
  ).toBeVisible();
  await expect(
    preview.getByRole("button", { name: "Schedule", exact: true }),
  ).toBeVisible();
  await expect(preview.locator(".app")).toHaveAttribute(
    "data-brand",
    "plum-v1",
  );
  await fits(preview);
  await preview.close();
  await page
    .getByRole("checkbox", { name: /I reviewed these selected replacements/ })
    .check();
  await page
    .getByRole("button", { name: "Use Reviewed Changes", exact: true })
    .click();
  await expect(
    page.getByText(/Reviewed replacements loaded as unsaved/),
  ).toBeVisible();
  expect(await snapshot(page)).toEqual(before);
  await page
    .getByRole("button", { name: "Save BuildPlan draft", exact: true })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: "BuildPlan draft saved" }),
  ).toBeVisible();
  const after = await snapshot(page);
  expect(after.buildPlans).toHaveLength(3);
  expect(after.records).toEqual(before.records);
  expect(after.history).toEqual(before.history);
  expect(
    after.buildPlans.find((p: { revision: number }) => p.revision === 1)
      .document,
  ).toEqual(
    before.buildPlans.find((p: { revision: number }) => p.revision === 1)
      .document,
  );
  const pending = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Export BuildPlan JSON", exact: true })
    .click();
  const exported = JSON.parse(
    (await readFile((await (await pending).path())!)).toString(),
  );
  expect(exported.version).toBe(2);
  expect(exported.configuration.name).toBe("My fictional retained company");
  expect(exported.configuration.branding.palette).toBe("plum-v1");
  expect(exported.configuration.entities[0].singular).toBe("Patron");
  expect(exported.configuration.entities[0].plural).toBe("My clients");
  await page.reload();
  await page
    .getByLabel("Business workspace", { exact: true })
    .selectOption({ label: "Cleaning Company" });
  await expect(
    page.getByRole("heading", { name: "Bright Path Cleaning", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "BuildPlan Studio", exact: true })
    .click();
  await page
    .getByRole("button", {
      name: "Reopen My fictional retained company",
      exact: true,
    })
    .click();
  await page
    .getByRole("button", { name: "Check for Template Updates", exact: true })
    .click();
  await expect(
    page.getByText("Verified saved baseline:", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Keep My Version", exact: true })
    .click();
});
test("imported hints stay informational and branded updates require explicit format approval and publication", async ({
  page,
}, info) => {
  const base = {
    entry: {
      plan: validateBuildPlan(
        JSON.parse(
          await readFile(
            "src/templates/history/property-maintenance.1.json",
            "utf8",
          ),
        ).entry.plan,
      ),
    },
  };
  const bytes = await createBlueprintPackage(base.entry.plan, {
    name: "Unverified fictional package",
    description: "Hint is not ancestry.",
    gallery: { id: "property-maintenance", revision: 999 },
  });
  await page.goto("/");
  await page
    .getByRole("button", { name: "Build My Business System", exact: true })
    .click();
  await step(page, "3 · Customize");
  const before = await snapshot(page);
  await page
    .getByLabel("Import Blueprint Package", { exact: true })
    .setInputFiles({
      name: "hint.zip",
      mimeType: "application/zip",
      buffer: Buffer.from(bytes),
    });
  await page
    .getByRole("button", { name: "Verify Blueprint", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Use as unsaved Studio choices", exact: true })
    .click();
  await expect(
    page.getByRole("button", {
      name: "Save reviewed starting point",
      exact: true,
    }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Check for Template Updates", exact: true })
    .click();
  await expect(
    page.getByText("Starting point not verified.", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(/Unverified hint: property-maintenance, revision 999/),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Review New Version", exact: true })
    .click();
  await page
    .getByRole("checkbox", { name: "Use new Branding", exact: true })
    .check();
  await expect(
    page.getByRole("alert").filter({
      hasText: /Explicitly approve the BuildPlan\/package version change/,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Use Reviewed Changes", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("checkbox", {
      name: /I explicitly approve changing BuildPlan\/package version 1 to 2/,
    })
    .check();
  await page
    .getByRole("checkbox", { name: /I reviewed these selected replacements/ })
    .check();
  await fits(page);
  await page
    .getByRole("button", { name: "Switch to dark theme", exact: true })
    .click();
  await fits(page);
  await page.screenshot({
    path: info.outputPath("template-review-dark.png"),
    fullPage: true,
    scale: "css",
  });
  await page
    .getByRole("button", { name: "Use Reviewed Changes", exact: true })
    .click();
  expect(await snapshot(page)).toEqual(before);
  await expect(page.locator(".app")).not.toHaveAttribute("data-brand");
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
  const after = await snapshot(page);
  expect(after.config.revision).toBe(2);
  expect(after.records).toEqual(
    before.records.filter((r: { entity: string }) =>
      base.entry.plan.configuration.modules.some((m) =>
        base.entry.plan.configuration.entities.some(
          (e) => e.id === r.entity && e.module === m.id,
        ),
      ),
    ),
  );
  await page.getByRole("button", { name: /Project & modules/ }).click();
  await page
    .getByRole("button", { name: "Restore revision 1", exact: true })
    .click();
  await expect(page.locator(".app")).not.toHaveAttribute("data-brand");
  expect((await snapshot(page)).records).toEqual(before.records);
});
