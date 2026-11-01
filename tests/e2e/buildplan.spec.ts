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
test("guided cleaning plan resolves dependencies, customizes, previews the real workspace, saves, exports and safely reopens", async ({
  page,
  context,
}, info) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Build My Business System", exact: true })
    .click();
  await expect(
    page.getByRole("heading", {
      name: "Build My Business System",
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Start Cleaning Business", exact: true })
    .click();
  await step(page, "2 · Features");
  await page.getByRole("checkbox", { name: /Employees & crews/ }).uncheck();
  await page.getByRole("checkbox", { name: /Shared scheduling/ }).uncheck();
  await page.getByRole("checkbox", { name: /Employees & crews/ }).check();
  await expect(
    page.getByRole("checkbox", { name: /Shared scheduling/ }),
  ).toBeChecked();
  await expect(
    page.getByRole("checkbox", { name: /Shared scheduling/ }),
  ).toBeDisabled();
  await expect(
    page.getByRole("checkbox", { name: /Services & estimates/ }),
  ).toBeChecked();
  await expect(
    page.getByRole("checkbox", { name: /Inventory & stock/ }),
  ).toBeChecked();
  await fits(page);
  await step(page, "3 · Customize");
  await page
    .getByLabel("Business name", { exact: true })
    .fill("Fictional Spark Studio");
  await page
    .getByLabel("Singular term for Customers", { exact: true })
    .fill("Client");
  await page
    .getByLabel("Plural term for Customers", { exact: true })
    .fill("Clients");
  await page
    .getByLabel("Navigation label for Customers", { exact: true })
    .fill("My clients");
  await page
    .getByLabel("New field label", { exact: true })
    .fill("Access notes");
  await page
    .getByRole("button", { name: "Add optional field", exact: true })
    .click();
  await fits(page);
  await step(page, "4 · Review & try");
  await expect(
    page.getByText(/This starter has a different project identity/),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Prepare workspace preview", exact: true })
    .click();
  const ready = page.getByRole("link", {
    name: "Open interactive workspace preview (new tab)",
    exact: true,
  });
  await expect(ready).toBeVisible();
  const popup = context.waitForEvent("page");
  await ready.click();
  const preview = await popup;
  await expect(
    preview.getByRole("heading", {
      name: "Fictional Spark Studio",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    preview.getByRole("button", { name: /^My clients/ }),
  ).toBeVisible();
  await preview
    .getByRole("button", { name: "+ Add client", exact: true })
    .click();
  await preview
    .getByLabel("Name *", { exact: true })
    .fill("Preview Client Only");
  await preview
    .getByLabel("Access notes", { exact: true })
    .fill("Fictional gate note");
  await fits(preview);
  await preview
    .getByRole("button", { name: "Save record", exact: true })
    .click();
  await expect(
    preview.getByRole("heading", { name: "Preview Client Only", exact: true }),
  ).toBeVisible();
  await preview.reload();
  await expect(
    preview.getByRole("heading", { name: "Preview Client Only", exact: true }),
  ).toBeVisible();
  await fits(preview);
  await preview.screenshot({
    path: info.outputPath("cleaning-generated-workspace.png"),
    fullPage: true,
  });
  await preview.close();
  await page
    .getByRole("button", { name: "Save BuildPlan draft", exact: true })
    .click();
  await expect(
    page.getByText(
      "BuildPlan draft saved. No workspace configuration was published.",
      { exact: true },
    ),
  ).toBeVisible();
  const pendingDownload = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Export BuildPlan JSON", exact: true })
    .click();
  const download = await pendingDownload;
  expect(download.suggestedFilename()).toBe("lms-build-plan.json");
  const bytes = await readFile((await download.path())!);
  const exported = JSON.parse(bytes.toString());
  expect(exported.version).toBe(1);
  expect(exported.configuration.name).toBe("Fictional Spark Studio");
  expect(
    exported.configuration.entities[0].fields.some(
      (f: { label: string }) => f.label === "Access notes",
    ),
  ).toBe(true);
  await page.reload();
  await page
    .getByRole("button", { name: "BuildPlan Studio", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Reopen Fictional Spark Studio", exact: true })
    .click();
  await step(page, "3 · Customize");
  await expect(page.getByLabel("Business name", { exact: true })).toHaveValue(
    "Fictional Spark Studio",
  );
  await expect(
    page.getByLabel("Navigation label for Customers", { exact: true }),
  ).toHaveValue("My clients");
  await expect(
    page.getByRole("button", {
      name: "Remove optional field Access notes",
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByLabel("Load an exported BuildPlan JSON file", { exact: true })
    .setInputFiles({
      name: "saved-plan.json",
      mimeType: "application/json",
      buffer: bytes,
    });
  await expect(page.getByText(/Loaded a validated BuildPlan/)).toBeVisible();
  const bad = JSON.stringify({ ...exported, version: 99 });
  await page
    .getByLabel("Load an exported BuildPlan JSON file", { exact: true })
    .setInputFiles({
      name: "unsafe.json",
      mimeType: "application/json",
      buffer: Buffer.from(bad),
    });
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: "This BuildPlan is invalid or unsupported." }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Switch to dark theme", exact: true })
    .click();
  await fits(page);
  await page.screenshot({
    path: info.outputPath("buildplan-review-dark.png"),
    fullPage: true,
  });
  const denied = await page.evaluate(async () => {
    const r = await fetch("/api/demo", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "save-plan",
        organizationId: crypto.randomUUID(),
        id: crypto.randomUUID(),
        revision: 0,
        baseRevision: 1,
        document: {},
      }),
    });
    return r.status;
  });
  expect(denied).toBe(403);
});
test("property publication protects populated schemas and history; custom template uses the shared forms", async ({
  page,
  context,
}, info) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Build My Business System", exact: true })
    .click();
  await step(page, "3 · Customize");
  await page
    .getByLabel("Business name", { exact: true })
    .fill("Fictional Property Studio");
  await page
    .getByLabel("New field label", { exact: true })
    .fill("Migration test note");
  await page
    .getByRole("button", { name: "Add optional field", exact: true })
    .click();
  await step(page, "4 · Review & try");
  await expect(
    page.getByText(/Database migration review required/),
  ).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: "Publish reviewed BuildPlan",
      exact: true,
    }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "Save BuildPlan draft", exact: true })
    .click();
  await step(page, "3 · Customize");
  await page
    .getByRole("button", {
      name: "Remove optional field Migration test note",
      exact: true,
    })
    .click();
  await step(page, "4 · Review & try");
  await page
    .getByRole("button", { name: "Save BuildPlan draft", exact: true })
    .click();
  await page
    .getByLabel(
      "I reviewed this saved plan and want to publish a fictional configuration revision.",
      { exact: true },
    )
    .check();
  await page
    .getByRole("button", { name: "Publish reviewed BuildPlan", exact: true })
    .click();
  await expect(
    page.getByRole("heading", {
      name: "Fictional Property Studio",
      exact: true,
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Project & modules" }).click();
  await page
    .getByRole("button", { name: "Restore revision 1", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Cedar Grove Property", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "BuildPlan Studio", exact: true })
    .click();
  await page
    .getByRole("button", {
      name: "Reopen Fictional Property Studio",
      exact: true,
    })
    .click();
  await expect(page.getByText(/current revision is 3/)).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: "Publish reviewed BuildPlan",
      exact: true,
    }),
  ).toBeDisabled();
  await page
    .getByRole("button", {
      name: "Review against current revision",
      exact: true,
    })
    .click();
  await page
    .getByRole("button", { name: "Save BuildPlan draft", exact: true })
    .click();
  await step(page, "1 · Start");
  await page
    .getByRole("button", { name: "Start Custom Business", exact: true })
    .click();
  await step(page, "3 · Customize");
  await page
    .getByLabel("Business name", { exact: true })
    .fill("Fictional Custom Workshop");
  await step(page, "4 · Review & try");
  await page
    .getByRole("button", { name: "Prepare workspace preview", exact: true })
    .click();
  const popup = context.waitForEvent("page");
  await page
    .getByRole("link", {
      name: "Open interactive workspace preview (new tab)",
      exact: true,
    })
    .click();
  const preview = await popup;
  await expect(
    preview.getByRole("heading", {
      name: "Fictional Custom Workshop",
      exact: true,
    }),
  ).toBeVisible();
  await preview.getByRole("button", { name: /^Work items/ }).click();
  await preview
    .getByRole("button", { name: "+ Add work item", exact: true })
    .click();
  await preview
    .getByLabel("Task title *", { exact: true })
    .fill("Fictional custom repair");
  await preview.getByLabel("Status *", { exact: true }).selectOption("Open");
  await preview
    .getByRole("button", { name: "Save record", exact: true })
    .click();
  await expect(
    preview.getByRole("heading", {
      name: "Fictional custom repair",
      exact: true,
    }),
  ).toBeVisible();
  await preview
    .getByRole("button", { name: "Switch to dark theme", exact: true })
    .click();
  await fits(preview);
  await preview.screenshot({
    path: info.outputPath("custom-generated-workspace-dark.png"),
    fullPage: true,
  });
  await preview.close();
});
