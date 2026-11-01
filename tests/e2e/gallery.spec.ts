import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { readFile } from "node:fs/promises";
async function fits(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
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
async function step(page: Page, name: string) {
  await page
    .getByRole("navigation", { name: "BuildPlan steps", exact: true })
    .getByRole("button", { name, exact: true })
    .click();
}
test("curated gallery filters, previews, remixes and preserves draft choices within the shared quota", async ({
  page,
  context,
}, info) => {
  let previewRequests = 0;
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      request.url().endsWith("/api/demo") &&
      request.postDataJSON().action === "preview-plan"
    )
      previewRequests++;
  });
  await page.goto("/");
  await page
    .getByRole("button", { name: "Build My Business System", exact: true })
    .click();
  await step(page, "3 · Customize");
  await page
    .getByLabel("Business name", { exact: true })
    .fill("Keep these unsaved choices");
  await page
    .getByRole("button", { name: "Browse Business Templates", exact: true })
    .click();
  await expect(
    page.getByRole("heading", {
      name: "Browse Business Templates",
      exact: true,
    }),
  ).toBeFocused();
  await expect(page.getByRole("article")).toHaveCount(5);
  await page
    .getByLabel("Search business templates", { exact: true })
    .fill("cleaning");
  await page
    .getByLabel("Business type", { exact: true })
    .selectOption("cleaning");
  await page
    .getByLabel("Includes feature", { exact: true })
    .selectOption("workforce");
  await expect(page.getByRole("article")).toHaveCount(1);
  await expect(
    page.getByRole("article", {
      name: "Cleaning Crew & Scheduling",
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByLabel("Includes feature", { exact: true })
    .selectOption("estimates");
  await expect(
    page.getByRole("heading", {
      name: "No reviewed starter matches these choices.",
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Clear template filters", exact: true })
    .click();
  await expect(page.getByRole("article")).toHaveCount(5);
  await fits(page);
  const basic = () =>
    page.getByRole("article", { name: "Basic Cleaning Business", exact: true });
  await basic()
    .getByRole("button", { name: "Preview Template", exact: true })
    .click();
  const link = () =>
    page.getByRole("link", {
      name: "Open Basic Cleaning Business preview (new tab)",
      exact: true,
    });
  await expect(link()).toBeVisible();
  const originalLink = await link().getAttribute("href");
  const opened = context.waitForEvent("page");
  await link().click();
  const preview = await opened;
  await expect(
    preview.getByRole("heading", {
      name: "Fictional Basic Cleaning Business",
      exact: true,
    }),
  ).toBeVisible();
  for (const name of [
    "Schedule",
    "Services & Rates",
    "Inventory & stock",
    "Crews & availability",
  ])
    await expect(
      preview.getByRole("button", { name, exact: true }),
    ).toHaveCount(0);
  await preview
    .getByRole("button", { name: "+ Add customer", exact: true })
    .click();
  await preview
    .getByLabel("Name *", { exact: true })
    .fill("Gallery-only fictional client");
  await preview
    .getByRole("button", { name: "Save record", exact: true })
    .click();
  await expect(
    preview.getByRole("heading", {
      name: "Gallery-only fictional client",
      exact: true,
    }),
  ).toBeVisible();
  await fits(preview);
  await preview.close();
  expect(previewRequests).toBe(1);
  const original = await page.evaluate(async () => {
    const response = await fetch("/api/demo");
    return (await response.json()).workspace;
  });
  expect(original.config.revision).toBe(1);
  expect(original.buildPlans).toHaveLength(0);
  expect(
    original.records.some(
      (r: { data: { name?: string } }) =>
        r.data.name === "Gallery-only fictional client",
    ),
  ).toBe(false);
  await page
    .getByRole("button", { name: "Return to my Studio choices", exact: true })
    .click();
  await expect(page.getByLabel("Business name", { exact: true })).toHaveValue(
    "Keep these unsaved choices",
  );
  await page
    .getByRole("button", { name: "Browse Business Templates", exact: true })
    .click();
  await basic()
    .getByRole("button", { name: "Customize This Template", exact: true })
    .click();
  await expect(page.getByLabel("Business name", { exact: true })).toHaveValue(
    "Fictional Basic Cleaning Business",
  );
  await step(page, "4 · Review & try");
  await page
    .getByRole("button", { name: "Prepare workspace preview", exact: true })
    .click();
  await expect(
    page.getByRole("link", {
      name: "Open interactive workspace preview (new tab)",
      exact: true,
    }),
  ).toHaveAttribute("href", originalLink!);
  expect(previewRequests).toBe(1);
  await step(page, "2 · Features");
  await expect(
    page.getByRole("checkbox", { name: "Shared scheduling", exact: true }),
  ).not.toBeChecked();
  await page
    .getByRole("checkbox", { name: "Employees & crews", exact: true })
    .check();
  await expect(
    page.getByRole("checkbox", { name: "Shared scheduling", exact: true }),
  ).toBeChecked();
  await page
    .getByRole("checkbox", { name: "Services & estimates", exact: true })
    .check();
  await page
    .getByRole("checkbox", { name: "Inventory & stock", exact: true })
    .check();
  await step(page, "3 · Customize");
  await page
    .getByLabel("Business name", { exact: true })
    .fill("My fictional gallery remix");
  await page
    .getByLabel("Navigation label for Customers", { exact: true })
    .fill("My clients");
  await page
    .getByLabel("New field label", { exact: true })
    .fill("Access instructions");
  await page
    .getByRole("button", { name: "Add optional field", exact: true })
    .click();
  await step(page, "4 · Review & try");
  await expect(page.getByText(/different project identity/)).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: "Publish reviewed BuildPlan",
      exact: true,
    }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "Prepare workspace preview", exact: true })
    .click();
  expect(previewRequests).toBe(2);
  await page
    .getByRole("button", { name: "Save BuildPlan draft", exact: true })
    .click();
  const pending = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Export BuildPlan JSON", exact: true })
    .click();
  const download = await pending,
    bytes = await readFile((await download.path())!);
  const exported = JSON.parse(bytes.toString());
  expect(exported.version).toBe(1);
  expect(exported.metadata).toBeUndefined();
  expect(exported.configuration.name).toBe("My fictional gallery remix");
  await page.reload();
  await page
    .getByRole("button", { name: "BuildPlan Studio", exact: true })
    .click();
  await page
    .getByRole("button", {
      name: "Reopen My fictional gallery remix",
      exact: true,
    })
    .click();
  await step(page, "3 · Customize");
  await expect(page.getByLabel("Business name", { exact: true })).toHaveValue(
    "My fictional gallery remix",
  );
  await expect(
    page.getByLabel("Navigation label for Customers", { exact: true }),
  ).toHaveValue("My clients");
  await expect(
    page.getByRole("button", {
      name: "Remove optional field Access instructions",
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByLabel("Load an exported BuildPlan JSON file", { exact: true })
    .setInputFiles({
      name: "gallery-remix.json",
      mimeType: "application/json",
      buffer: bytes,
    });
  await expect(page.getByText(/Loaded a validated BuildPlan/)).toBeVisible();
  await page
    .getByRole("button", { name: "Browse Business Templates", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Switch to dark theme", exact: true })
    .click();
  await fits(page);
  await page.screenshot({
    path: info.outputPath("gallery-dark.png"),
    fullPage: true,
  });
  const rv = page.getByRole("article", {
    name: "RV Park / Property Management",
    exact: true,
  });
  await rv.getByText("Scope and limitations", { exact: true }).click();
  await expect(rv).toContainText(
    "Reservations, occupancy, leases, rent, meters and utility billing are not implemented.",
  );
  await rv
    .getByRole("button", { name: "Preview Template", exact: true })
    .click();
  await expect(
    page.getByRole("link", {
      name: "Open RV Park / Property Management preview (new tab)",
      exact: true,
    }),
  ).toBeVisible();
  const general = page.getByRole("article", {
    name: "General Service Business",
    exact: true,
  });
  await general
    .getByRole("button", { name: "Preview Template", exact: true })
    .click();
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: "supports three fresh previews" })
      .first(),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Return to my Studio choices", exact: true })
    .click();
  await step(page, "3 · Customize");
  await expect(page.getByLabel("Business name", { exact: true })).toHaveValue(
    "My fictional gallery remix",
  );
});
