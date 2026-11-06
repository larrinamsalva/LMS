import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { readFile } from "node:fs/promises";
async function start(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Explore the working demo" }).click();
  await expect(
    page.getByRole("heading", { name: "Cedar Grove Property" }),
  ).toBeVisible();
}
async function fits(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
}
test("shared workspace creates, edits, archives, restores and isolates two business configurations", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await start(page);
  await page
    .getByRole("button", { name: "+ Add customer", exact: true })
    .click();
  await page.getByLabel("Name *", { exact: true }).fill("Taylor Fictional");
  await page.getByLabel("Email", { exact: true }).fill("taylor@example.test");
  await page.getByRole("button", { name: "Save record", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Taylor Fictional", exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Taylor Fictional", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Edit Taylor Fictional", exact: true })
    .click();
  await page.getByLabel("Name *", { exact: true }).fill("Taylor Edited");
  await page.getByRole("button", { name: "Save record", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Taylor Edited", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Archive Taylor Edited", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Confirm archive", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Taylor Edited", exact: true }),
  ).toHaveCount(0);
  await page.getByLabel("Show archived", { exact: true }).check();
  await page
    .getByRole("button", { name: "Restore Taylor Edited", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Confirm restore", exact: true })
    .click();
  await page.getByLabel("Show archived", { exact: true }).uncheck();
  await expect(
    page.getByRole("heading", { name: "Taylor Edited", exact: true }),
  ).toBeVisible();
  await fits(page);
  await page
    .getByLabel("Business workspace", { exact: true })
    .selectOption({ label: "Cleaning Company" });
  await expect(
    page.getByRole("heading", { name: "Bright Path Cleaning" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Taylor Edited", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: /^Cleaning jobs/ }).click();
  await page
    .getByRole("button", { name: "+ Add cleaning job", exact: true })
    .click();
  await page
    .getByLabel("Job title *", { exact: true })
    .fill("Fictional kitchen clean");
  await page
    .getByLabel("Service *", { exact: true })
    .selectOption("Deep clean");
  await page.getByLabel("Service date *", { exact: true }).fill("2026-11-06");
  await page.getByLabel("Status *", { exact: true }).selectOption("Planned");
  await page.getByRole("button", { name: "Save record", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Fictional kitchen clean", exact: true }),
  ).toBeVisible();
  // Add fictional work through the same authorized demo API, then reload
  // the existing cookie-bound session. Never consume an extra session slot.
  const orgId = await page.getByLabel("Business workspace", { exact: true }).inputValue();
  const statuses = await page.evaluate(async (organizationId) => {
    const results: number[] = [];
    for (let i = 1; i <= 4; i++) {
      const response = await fetch("/api/demo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "save",
          organizationId,
          entity: "jobs",
          data: {
            title: `Fictional overflow job ${i}`,
            service: "Deep clean",
            date: "2026-11-06",
            status: "Planned",
          },
        }),
      });
      results.push(response.status);
    }
    return results;
  }, orgId);
  expect(statuses).toEqual([200, 200, 200, 200]);
  await page.reload();
  await page.getByLabel("Business workspace", { exact: true })
    .selectOption({ label: "Cleaning Company" });
  await expect(page.getByRole("heading", { name: "Bright Path Cleaning" })).toBeVisible();
  // Reuse the existing session rather than adding a new one (24-slot demo limit).
  const operations = page.getByRole("region", { name: "Daily operations" });
  await operations.getByLabel("Operations date", { exact: true }).fill("2026-11-06");
  await expect(
    operations.getByRole("region", { name: "Unfinished work due or overdue" }),
  ).toContainText("Fictional kitchen clean");
  await expect(
    operations.getByRole("region", { name: "Unfinished work due or overdue" }),
  ).toContainText("Due on date");
  const dueWork = operations.getByRole("region", {
    name: "Unfinished work due or overdue", exact: true,
  });
  await expect(dueWork.getByText(/^Showing 4 of \d+ work items$/)).toBeVisible();
  await expect(dueWork.locator("li")).toHaveCount(4);
  await dueWork.getByRole("button", { name: /^Show \d+ more work items$/ }).click();
  expect(await dueWork.locator("li").count()).toBeGreaterThan(4);
  await dueWork.getByRole("button", { name: "Show fewer work items", exact: true }).click();
  await expect(dueWork.locator("li")).toHaveCount(4);
  await dueWork.getByRole("button", { name: /^Show \d+ more work items$/ }).click();
  await operations.getByLabel("Operations date", { exact: true }).fill("2026-11-05");
  await operations.getByLabel("Operations date", { exact: true }).fill("2026-11-06");
  await expect(dueWork.locator("li")).toHaveCount(4);
  // Calendar shortcuts use the business-local day and reset expanded rows.
  const dayInput = operations.getByLabel("Operations date", { exact: true });
  await operations.getByRole("button", { name: "Previous operations day", exact: true }).click();
  await expect(dayInput).toHaveValue("2026-11-05");
  await operations.getByRole("button", { name: "Next operations day", exact: true }).click();
  await expect(dayInput).toHaveValue("2026-11-06");
  await expect(dueWork.locator("li")).toHaveCount(4);
  // Derive today's calendar date in the business zone, not the CI host zone.
  const businessToday = await page.evaluate(() => {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Los_Angeles",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(new Date());
    const part = (type: string) => parts.find((p) => p.type === type)!.value;
    return `${part("year")}-${part("month")}-${part("day")}`;
  });
  await dayInput.fill("2020-01-02");
  await operations.getByRole("button", { name: "Today in business time zone", exact: true }).click();
  await expect(dayInput).toHaveValue(businessToday);
  await dayInput.fill("2026-11-06");
  // Export all organization-scoped work rows, including ones beyond the first
  // four, without creating a new session or sending data to another service.
  const savedDownload = page.waitForEvent("download");
  await operations.getByRole("button", {
    name: "Download daily plan CSV", exact: true,
  }).click();
  const download = await savedDownload;
  expect(download.suggestedFilename()).toBe("lms-daily-operations-2026-11-06.csv");
  const csvText = (await readFile((await download.path())!)).toString("utf8");
  expect(csvText).toContain("Fictional overflow job 4");
  expect(csvText).toContain("Fictional kitchen clean");
  expect(csvText).not.toContain("Taylor Edited");
  expect(csvText).toContain("America/Los_Angeles");
  await dayInput.fill("");
  await expect(operations.getByRole("button", {
    name: "Download daily plan CSV", exact: true,
  })).toBeDisabled();
  await dayInput.fill("2026-11-06");
  // Focus the exact work record without opening an editor or writing data.
  await operations.getByRole("button", {
    name: "Find Fictional kitchen clean in cleaning jobs",
    exact: true,
  }).click();
  await expect(page.getByRole("status").filter({
    hasText: "Showing the specific work record selected in Daily Operations.",
  })).toBeVisible();
  await expect(page.locator(".record-list > .record-row")).toHaveCount(1);
  await expect(page.getByRole("heading", {
    name: "Fictional kitchen clean", exact: true,
  })).toBeVisible();
  await page.getByRole("button", { name: "Show all cleaning jobs", exact: true }).click();
  await expect(page.getByRole("status").filter({
    hasText: "Showing the specific work record selected in Daily Operations.",
  })).toHaveCount(0);
  await expect(
    operations.getByRole("button", { name: "Open Schedule for 2026-11-06" }),
  ).toBeVisible();
  await operations.getByRole("button", { name: "Open Schedule for 2026-11-06" }).click();
  await expect(page.getByLabel("Schedule date", { exact: true })).toHaveValue("2026-11-06");
  await expect(page.getByRole("heading", { name: "Schedule", exact: true })).toBeVisible();
  // A normal sidebar visit is not a second cross-screen handoff. The date
  // remains editable using the established calendar controls.
  await page.getByRole("button", { name: "Next day", exact: true }).click();
  await expect(page.getByLabel("Schedule date", { exact: true })).toHaveValue("2026-11-07");
  await fits(page);
  expect(errors).toEqual([]);
});
test("configuration validation, retained module data, rollback and export work through API and UI", async ({
  page,
}) => {
  await start(page);
  await page.getByRole("button", { name: "Project & modules" }).click();
  await page
    .getByLabel("Business name", { exact: true })
    .fill("Cedar Grove Fictional");
  await page.getByRole("checkbox", { name: "Inventory & stock" }).uncheck();
  await page
    .getByRole("button", { name: "Apply configuration", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Cedar Grove Fictional", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /^Supply catalog/ }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Restore revision 1", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Cedar Grove Property", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: /^Supply catalog/ }).click();
  await expect(
    page.getByRole("heading", { name: "Water fittings", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Project & modules" }).click();
  const projectDownload = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Save project JSON", exact: true })
    .click();
  expect((await projectDownload).suggestedFilename()).toBe("lms-project.json");
  const exportDownload = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Export workspace JSON", exact: true })
    .click();
  expect((await exportDownload).suggestedFilename()).toBe(
    "lms-demo-workspace.json",
  );
  await page.getByRole("button", { name: "Audit history" }).click();
  await expect(
    page.getByText("configuration · insert", { exact: true }).first(),
  ).toBeVisible();
  await fits(page);
});
test("light and dark themes have accessible labels, contrast and responsive forms", async ({
  page,
}, testInfo) => {
  await page.goto("/");
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("link", { name: "Skip to workspace" }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "Explore the working demo" }).click();
  await expect(
    page.getByRole("heading", { name: "Cedar Grove Property" }),
  ).toBeVisible();
  await fits(page);
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
  await page
    .getByRole("button", { name: "Switch to dark theme", exact: true })
    .click();
  await expect(page.locator(".app")).toHaveAttribute("data-theme", "dark");
  await page
    .getByRole("button", { name: "+ Add customer", exact: true })
    .click();
  await fits(page);
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
  await page.screenshot({
    path: testInfo.outputPath("workspace-dark.png"),
    fullPage: true,
  });
  await page.reload();
  await expect(page.locator(".app")).toHaveAttribute("data-theme", "dark");
});
test("HTTP boundary rejects CSRF, forged scope, missing sessions and unavailable actions", async ({
  page,
  request,
  baseURL,
}) => {
  expect((await request.get("/api/demo")).status()).toBe(401);
  expect((await request.get("/api/local-auth/get-session")).status()).toBe(404);
  expect(
    (
      await request.post("/api/local-auth/sign-in/email", {
        data: { email: "owner@example.test", password: "fictional" },
      })
    ).status(),
  ).toBe(404);
  expect((await request.get("/api/records")).status()).toBe(404);
  expect((await request.post("/api/recovery", { data: {} })).status()).toBe(
    404,
  );
  expect(
    (await request.post("/api/local-auth/recovery", { data: {} })).status(),
  ).toBe(404);
  expect(
    (
      await request.post("/api/local-auth/change-password", { data: {} })
    ).status(),
  ).toBe(404);
  expect(
    (
      await request.post("/api/local-auth/reset-password", { data: {} })
    ).status(),
  ).toBe(404);
  expect((await request.get("/api/access/members")).status()).toBe(404);
  expect(
    (
      await request.post("/api/access/confirm", {
        data: { confirmation: "CONFIRM ACCESS CHANGE" },
      })
    ).status(),
  ).toBe(404);
  expect(
    (
      await request.post("/api/demo", {
        data: { action: "start" },
        headers: { Origin: "https://attacker.invalid" },
      })
    ).status(),
  ).toBe(403);
  await start(page);
  const session = await page.request.get("/api/demo").then((r) => r.json());
  const organizationId = session.workspace.organizationId;
  expect(
    (
      await page.request.get(
        "/api/demo?organizationId=10000000-0000-4000-8000-000000000001",
      )
    ).status(),
  ).toBe(403);
  expect(
    (
      await page.request.post("/api/demo", {
        headers: { Origin: baseURL! },
        data: { action: "send-invoice", organizationId },
      })
    ).status(),
  ).toBe(400);
  const second = await request.post("/api/demo", {
    headers: { Origin: baseURL! },
    data: { action: "start" },
  });
  expect(second.status()).toBe(200);
  expect(
    (await request.get(`/api/demo?organizationId=${organizationId}`)).status(),
  ).toBe(403);
  const pageResponse = await page.goto("/");
  const csp = pageResponse!.headers()["content-security-policy"];
  expect(csp).toContain("'nonce-");
  expect(csp).not.toContain("script-src 'self' 'unsafe-inline'");
});
