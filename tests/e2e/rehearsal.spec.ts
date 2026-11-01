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
    async (id) =>
      (await (await fetch(`/api/demo?organizationId=${id}`)).json()).workspace,
    id,
  );
}
async function complete(page: Page) {
  await page
    .getByRole("button", { name: "Run Fictional Rehearsal", exact: true })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: "Fictional checks completed" }),
  ).toBeVisible();
}
test("fictional fixture checks and readiness stay separate from populated data, reports stay private and manual edits invalidate retained evidence", async ({
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
    .fill("Fictional rehearsal business");
  await page
    .getByLabel("New field label", { exact: true })
    .fill("Rehearsal access notes");
  await page
    .getByRole("button", { name: "Add optional field", exact: true })
    .click();
  await page
    .getByRole("checkbox", {
      name: "Include business branding in this BuildPlan",
      exact: true,
    })
    .check();
  await page.getByRole("radio", { name: /Plum & pearl/ }).check();
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
  await page
    .getByRole("button", { name: "Rehearse Business Changes", exact: true })
    .click();
  await expect(
    page.getByRole("heading", {
      name: "Rehearse Business Changes",
      exact: true,
    }),
  ).toBeFocused();
  await expect(
    page.getByRole("article", { name: "Fictional rehearsal", exact: true }),
  ).toContainText("Not run");
  await complete(page);
  await expect(
    page.getByRole("article", { name: "Fictional rehearsal", exact: true }),
  ).toContainText("Completed on generated fixtures");
  await expect(
    page.getByRole("article", {
      name: "Existing data compatibility",
      exact: true,
    }),
  ).toContainText("Blocked");
  await expect(
    page.getByRole("article", {
      name: "Business backup and restore evidence",
      exact: true,
    }),
  ).toContainText("Not verified");
  await expect(
    page.getByRole("article", { name: "Migration authorization", exact: true }),
  ).toContainText("Not granted");
  await expect(
    page.getByRole("article", {
      name: "Production security acceptance",
      exact: true,
    }),
  ).toContainText("Blocked");
  await fits(page);
  await page.screenshot({
    path: info.outputPath("rehearsal-desktop.png"),
    fullPage: true,
    scale: "css",
  });
  await page
    .getByRole("button", { name: "Switch to dark theme", exact: true })
    .click();
  await fits(page);
  await page
    .getByRole("article", { name: "Existing data compatibility", exact: true })
    .screenshot({
      path: info.outputPath("rehearsal-phone-dark.png"),
      scale: "css",
    });
  const download = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Download Rehearsal Report", exact: true })
    .click();
  const report = JSON.parse(
    await readFile((await (await download).path())!, "utf8"),
  );
  expect(report.status).toBe("completed");
  expect(report.format).toBe("lms-fictional-rehearsal-report");
  expect(
    report.plan.configurations.proposed.configuration.branding.palette,
  ).toBe("plum-v1");
  for (const row of before.records)
    expect(JSON.stringify(report)).not.toContain(row.id);
  expect(JSON.stringify(report)).not.toContain(before.organizationId);
  expect(JSON.stringify(report)).not.toContain("stateDigest");
  expect(JSON.stringify(report)).not.toContain(
    before.records.find((r: any) => r.entity === "customers").data.name,
  );
  expect(await snapshot(page)).toEqual(before);
  await page
    .getByRole("button", { name: "Return to Data Impact", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Rehearse Business Changes", exact: true })
    .click();
  await expect(
    page.getByRole("article", { name: "Fictional rehearsal", exact: true }),
  ).toContainText("Completed on generated fixtures");
  await page
    .getByRole("button", { name: "Recheck Retained Rehearsal", exact: true })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: "Fictional checks completed" }),
  ).toBeVisible();
  const opened = context.waitForEvent("page");
  await page
    .getByRole("link", {
      name: "Open generated fictional rehearsal workspace (new tab)",
      exact: true,
    })
    .click();
  const generated = await opened;
  await expect(
    generated.getByRole("heading", {
      name: "Fictional rehearsal business",
      exact: true,
      level: 1,
    }),
  ).toBeVisible();
  await expect(
    generated
      .getByRole("status")
      .filter({ hasText: "Generated test records only" }),
  ).toBeVisible();
  await expect(generated.locator(".app")).toHaveAttribute(
    "data-brand",
    "plum-v1",
  );
  await expect(
    generated.getByRole("button", { name: "BuildPlan Studio", exact: true }),
  ).toHaveCount(0);
  await generated
    .getByRole("button", { name: "+ Add customer", exact: true })
    .click();
  await generated
    .getByLabel("Name *", { exact: true })
    .fill("Fictional manual experiment");
  await generated
    .getByLabel("Rehearsal access notes", { exact: true })
    .fill("Fictional only");
  await fits(generated);
  await generated
    .getByRole("button", { name: "Save record", exact: true })
    .click();
  await expect(
    generated.getByRole("heading", {
      name: "Fictional manual experiment",
      exact: true,
    }),
  ).toBeVisible();
  await generated.close();
  await page
    .getByRole("button", { name: "Download Rehearsal Report", exact: true })
    .click();
  await expect(
    page.getByRole("alert").filter({ hasText: "rehearsal workspace changed" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: "Download Rehearsal Report",
      exact: true,
    }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "Return to Data Impact", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Keep editing my plan", exact: true })
    .click();
  await expect(
    page.getByRole("button", {
      name: "Publish reviewed BuildPlan",
      exact: true,
    }),
  ).toBeDisabled();
  expect(await snapshot(page)).toEqual(before);
});
test("stale source reviews refuse before allocation and disabled features remain explicitly untested in a cleaning rehearsal", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Explore the working demo →", exact: true })
    .click();
  await page
    .getByLabel("Business workspace", { exact: true })
    .selectOption({ label: "Cleaning Company" });
  await expect(
    page.getByRole("heading", {
      name: "Bright Path Cleaning",
      exact: true,
      level: 1,
    }),
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
  const before = await snapshot(page);
  await page
    .getByRole("button", { name: "Review Data Impact", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Rehearse Business Changes", exact: true })
    .click();
  const row = before.records.find((r: any) => r.entity === "customers");
  expect(
    await page.evaluate(
      async ({ org, row }) =>
        (
          await fetch("/api/demo", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: "save",
              organizationId: org,
              entity: "customers",
              data: { ...row.data, name: "PRIVATE concurrent fictional edit" },
              existing: { id: row.id, revision: row.revision },
            }),
          })
        ).status,
      { org: before.organizationId, row },
    ),
  ).toBe(200);
  await page
    .getByRole("button", { name: "Run Fictional Rehearsal", exact: true })
    .click();
  await expect(
    page.getByRole("alert").filter({ hasText: "stale" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: "Download Rehearsal Report",
      exact: true,
    }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "Return to Data Impact", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Refresh Data Impact", exact: true })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: "Review refreshed" }),
  ).toBeVisible();
  const original = await snapshot(page);
  await page
    .getByRole("button", { name: "Rehearse Business Changes", exact: true })
    .click();
  await complete(page);
  for (const label of [
    "Scheduling conflicts and retries",
    "Stock quantities and immutable movements",
    "Estimate pricing snapshots and retries",
  ])
    await expect(
      page.getByRole("article", { name: label, exact: true }),
    ).toContainText("not-applicable");
  await fits(page);
  expect(await snapshot(page)).toEqual(original);
  await page
    .getByRole("button", { name: "Return to Data Impact", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Keep editing my plan", exact: true })
    .click();
  expect((await snapshot(page)).config).toEqual(before.config);
  expect((await snapshot(page)).buildPlans).toEqual(before.buildPlans);
});
