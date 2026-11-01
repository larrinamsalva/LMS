import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { readFile } from "node:fs/promises";
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
  const id = await page
    .getByLabel("Business workspace", { exact: true })
    .inputValue();
  return page.evaluate(
    async (org) =>
      (await (await fetch(`/api/demo?organizationId=${org}`)).json()).workspace,
    id,
  );
}
async function command(page: Page, body: unknown) {
  return page.evaluate(async (input) => {
    const r = await fetch("/api/demo", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    return { status: r.status, value: await r.json() };
  }, body);
}
async function open(page: Page) {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Build My Business System", exact: true })
    .click();
}
test("populated field plans explain impact, export no records and preview the real empty Engine while preserving saved choices", async ({
  page,
  context,
}, info) => {
  await open(page);
  await step(page, "3 · Customize");
  await page
    .getByLabel("Business name", { exact: true })
    .fill("Fictional planning workspace");
  await page
    .getByLabel("New field label", { exact: true })
    .fill("Planning access notes");
  await page
    .getByRole("button", { name: "Add optional field", exact: true })
    .click();
  await step(page, "4 · Review & try");
  await page
    .getByRole("button", { name: "Save BuildPlan draft", exact: true })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: "BuildPlan draft saved" }),
  ).toBeVisible();
  const before = await snapshot(page);
  await page
    .getByRole("button", { name: "Review Data Impact", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Review Data Impact", exact: true }),
  ).toBeFocused();
  await expect(
    page.getByRole("heading", {
      name: "Requires additional migration review",
      exact: true,
    }),
  ).toBeVisible();
  const customer = page.getByRole("article", {
    name: "customers record presence",
    exact: true,
  });
  await expect(customer).toContainText("Active records");
  await expect(customer).toContainText("Archived records");
  const field = page.getByRole("article", {
    name: "customers: Field: Planning access notes",
    exact: true,
  });
  await expect(field).toContainText("Additive optional fields are not exempt");
  await expect(field).toContainText("separately authorized migration design");
  await fits(page);
  await page.screenshot({
    path: info.outputPath("impact-review-desktop.png"),
    fullPage: true,
    scale: "css",
  });
  await page
    .getByRole("button", { name: "Switch to dark theme", exact: true })
    .click();
  await fits(page);
  await field.screenshot({
    path: info.outputPath("impact-review-phone-dark.png"),
    scale: "css",
  });
  const download = page.waitForEvent("download");
  await page
    .getByRole("button", {
      name: "Export Migration Planning Report",
      exact: true,
    })
    .click();
  const report = JSON.parse(
    await readFile((await (await download).path())!, "utf8"),
  );
  expect(report.format).toBe("lms-migration-impact-report");
  expect(report.overall).toBe("migration-review");
  expect(report.configurations.proposed.configuration.name).toBe(
    "Fictional planning workspace",
  );
  for (const record of before.records)
    expect(JSON.stringify(report)).not.toContain(record.id);
  expect(JSON.stringify(report)).not.toContain(before.organizationId);
  expect(JSON.stringify(report)).not.toContain("stateDigest");
  expect(JSON.stringify(report)).not.toContain(
    before.records.find((r: any) => r.entity === "customers").data.name,
  );
  expect(await snapshot(page)).toEqual(before);
  await page
    .getByRole("button", {
      name: "Preview Changes Without Applying",
      exact: true,
    })
    .click();
  const previewLink = page.getByRole("link", {
    name: "Open data impact preview (new tab)",
    exact: true,
  });
  await expect(previewLink).toBeVisible();
  const opened = context.waitForEvent("page");
  await previewLink.click();
  const preview = await opened;
  await expect(
    preview.getByRole("heading", {
      name: "Fictional planning workspace",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    preview.getByRole("button", { name: "Customers 0", exact: true }),
  ).toBeVisible();
  await preview
    .getByRole("button", { name: "+ Add customer", exact: true })
    .click();
  await preview
    .getByLabel("Name *", { exact: true })
    .fill("Preview planning customer only");
  await preview
    .getByLabel("Planning access notes", { exact: true })
    .fill("Fictional preview notes");
  await fits(preview);
  await preview
    .getByRole("button", { name: "Save record", exact: true })
    .click();
  await expect(
    preview.getByRole("heading", {
      name: "Preview planning customer only",
      exact: true,
    }),
  ).toBeVisible();
  await preview.close();
  expect(await snapshot(page)).toEqual(before);
  await page
    .getByRole("button", { name: "Keep editing my plan", exact: true })
    .click();
  await expect(
    page.getByRole("button", {
      name: "Publish reviewed BuildPlan",
      exact: true,
    }),
  ).toBeDisabled();
  await step(page, "3 · Customize");
  await expect(page.getByLabel("Business name", { exact: true })).toHaveValue(
    "Fictional planning workspace",
  );
});
test("module plans retain stock and detect concurrent, unavailable and unauthorized review states before output", async ({
  page,
}) => {
  await open(page);
  await step(page, "2 · Features");
  await page.getByRole("checkbox", { name: /Inventory & stock/ }).uncheck();
  const before = await snapshot(page);
  await page
    .getByRole("button", { name: "Review Data Impact", exact: true })
    .click();
  await expect(
    page.getByRole("heading", {
      name: "Compatible under existing rules",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("article", { name: "items record presence", exact: true }),
  ).toContainText("Disabled · records retained");
  await expect(
    page.getByRole("article", {
      name: "Business: Module: inventory",
      exact: true,
    }),
  ).toContainText("does not cancel bookings");
  expect(await snapshot(page)).toEqual(before);
  const record = before.records.find((r: any) => r.entity === "customers");
  const changed = await command(page, {
    action: "save",
    organizationId: before.organizationId,
    entity: "customers",
    data: { ...record.data, name: "PRIVATE concurrent fictional edit" },
    existing: { id: record.id, revision: record.revision },
  });
  expect(changed.status).toBe(200);
  await page
    .getByRole("button", { name: "Verify Review Is Current", exact: true })
    .click();
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: "This review is stale or freshness is unverified" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: "Export Migration Planning Report",
      exact: true,
    }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", {
      name: "Preview Changes Without Applying",
      exact: true,
    }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "Refresh Data Impact", exact: true })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: "Review refreshed" }),
  ).toBeVisible();
  await page.route("**/api/demo", async (route) => {
    if (route.request().postDataJSON()?.action === "review-impact")
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: "Fictional verification unavailable" }),
      });
    else await route.continue();
  });
  await page
    .getByRole("button", { name: "Verify Review Is Current", exact: true })
    .click();
  await expect(
    page.getByRole("button", {
      name: "Export Migration Planning Report",
      exact: true,
    }),
  ).toBeDisabled();
  await page.unroute("**/api/demo");
  await page
    .getByRole("button", { name: "Refresh Data Impact", exact: true })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: "Review refreshed" }),
  ).toBeVisible();
  expect(
    (
      await command(page, {
        action: "review-impact",
        organizationId: crypto.randomUUID(),
        input: { document: {} },
      })
    ).status,
  ).toBe(403);
  expect(
    (
      await command(page, {
        action: "review-impact",
        organizationId: before.organizationId,
        input: { document: { version: 999 } },
      })
    ).status,
  ).toBe(400);
  await page
    .getByRole("button", { name: "Keep editing my plan", exact: true })
    .click();
  await step(page, "4 · Review & try");
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
  const after = await snapshot(page);
  expect(after.config.revision).toBe(2);
  expect(after.stockBalances).toEqual(before.stockBalances);
  expect(after.stockMovements).toEqual(before.stockMovements);
  expect(after.records.find((r: any) => r.id === record.id).data.name).toBe(
    "PRIVATE concurrent fictional edit",
  );
  await page.getByRole("button", { name: /Project & modules/ }).click();
  await page
    .getByRole("button", { name: "Restore revision 1", exact: true })
    .click();
  const restored = await snapshot(page);
  expect(restored.records).toHaveLength(before.records.length);
  expect(restored.stockMovements).toEqual(before.stockMovements);
});
