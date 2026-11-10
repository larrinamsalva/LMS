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
    // This uses the same authorized demo session and adds one future job
    // for the seven-day overview; no new session is allocated.
    const future = await fetch("/api/demo", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "save",
        organizationId,
        entity: "jobs",
        data: {
          title: "Fictional upcoming window clean",
          service: "Deep clean",
          date: "2026-11-09",
          status: "Planned",
        },
      }),
    });
    results.push(future.status);
    // An intentionally undated task stays visible in Needs scheduling, not
    // the selected-day or upcoming schedule. Same demo session and workspace.
    const undated = await fetch("/api/demo", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "save",
        organizationId,
        entity: "tasks",
        data: {
          title: "Fictional inspect filters",
          status: "Open",
        },
      }),
    });
    results.push(undated.status);
    return results;
  }, orgId);
  expect(statuses).toEqual([200, 200, 200, 200, 200, 200]);
  await page.reload();
  await page.getByLabel("Business workspace", { exact: true })
    .selectOption({ label: "Cleaning Company" });
  await expect(page.getByRole("heading", { name: "Bright Path Cleaning" })).toBeVisible();
  // Reuse the existing session rather than adding a new one (24-slot demo limit).
  const operations = page.getByRole("region", { name: "Daily operations" });
  await operations.getByLabel("Operations date", { exact: true }).fill("2026-11-06");
  const undatedQueue = operations.getByRole("region", {
    name: "Undated work needing scheduling", exact: true,
  });
  await expect(undatedQueue).toContainText("Fictional inspect filters");
  await expect(operations.getByText("Work needing a date")).toBeVisible();
  await expect(undatedQueue).toContainText("No due date");
  // Download the separate undated review list in this same existing demo
  // session. It is deliberately not the daily or weekly dated work plan.
  const undatedDownloadPending = page.waitForEvent("download");
  await undatedQueue.getByRole("button", {
    name: "Download needs scheduling CSV", exact: true,
  }).click();
  const undatedDownload = await undatedDownloadPending;
  expect(undatedDownload.suggestedFilename())
    .toBe("lms-needs-scheduling-reviewed-2026-11-06.csv");
  const undatedCsv = (await readFile((await undatedDownload.path())!))
    .toString("utf8");
  expect(undatedCsv).toContain("Fictional inspect filters");
  expect(undatedCsv).toContain("Due date (not assigned)");
  expect(undatedCsv).not.toContain("Fictional kitchen clean");
  expect(undatedCsv).not.toContain("Fictional upcoming window clean");
  expect(undatedCsv).not.toContain("Taylor Edited");
  expect(undatedCsv).toContain("America/Los_Angeles");
  await undatedQueue.getByRole("button", {
    name: "Find undated Fictional inspect filters in tasks", exact: true,
  }).click();
  await expect(page.getByRole("status").filter({
    hasText: "Showing the specific work record selected in Daily Operations.",
  })).toBeVisible();
  await expect(page.getByRole("heading", {
    name: "Fictional inspect filters", exact: true,
  })).toBeVisible();
  await page.getByRole("button", { name: "Show all tasks", exact: true }).click();
  await page.getByRole("button", { name: /^Cleaning jobs/ }).click();
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
  const futureWork = operations.getByRole("region", {
    name: "Upcoming work next seven days", exact: true,
  });
  await expect(futureWork).toContainText("Fictional upcoming window clean");
  await expect(futureWork).toContainText("Due 2026-11-09");
  // Group the next seven local calendar days, then drill down to the
  // selected day's existing records without editing a job or booking.
  const dailyLoad = operations.getByRole("region", {
    name: "Seven-day workload by date", exact: true,
  });
  await expect(dailyLoad.getByRole("button", {
    name: /^Review \d{4}-\d{2}-\d{2}:/,
  })).toHaveCount(7);
  // The quick shortcut uses the same authorized recorded counts as the seven
  // daily cards, and clicking it is only a date-navigation action.
  const peakDay = dailyLoad.getByRole("group", {
    name: "Busiest recorded day", exact: true,
  });
  await expect(peakDay).toContainText("Most recorded activity:");
  const peakButton = peakDay.getByRole("button", {
    name: /^Review busiest recorded day \d{4}-\d{2}-\d{2}$/,
  });
  const peakLabel = (await peakButton.getAttribute("aria-label"))!;
  const peakDate = peakLabel.slice(-10);
  await peakButton.click();
  await expect(operations.getByLabel("Operations date", { exact: true }))
    .toHaveValue(peakDate);
  await operations.getByLabel("Operations date", { exact: true }).fill("2026-11-06");
  const weeklyTotals = dailyLoad.getByRole("group", {
    name: "Seven-day workload totals", exact: true,
  });
  await expect(weeklyTotals.getByText("Upcoming appointments · 7 days")).toBeVisible();
  await expect(weeklyTotals.getByText("Unfinished work · 7 days")).toBeVisible();
  await expect(weeklyTotals.getByText("Days with saved activity")).toBeVisible();
  await expect(weeklyTotals.getByText("Equipment inspections · 7 days")).toHaveCount(0);
  // Compare the actual seven date-card counts before and after sorting,
  // rather than hard-coding which fictional day happens to be busiest.
  const datedCards = dailyLoad.getByRole("button", {
    name: /^Review \d{4}-\d{2}-\d{2}:/,
  });
  const originalLabels = await datedCards.evaluateAll((elements) =>
    elements.map((element) => element.getAttribute("aria-label") || ""),
  );
  const recorded = (name: string) => {
    const match = name.match(/^Review (\d{4}-\d{2}-\d{2}): (\d+) appointments and (\d+) unfinished work items$/);
    expect(match).not.toBeNull();
    return { name, date: match![1], count: Number(match![2]) + Number(match![3]) };
  };
  const expectedSorted = originalLabels.map(recorded).sort((a, b) =>
    b.count - a.count || a.date.localeCompare(b.date),
  ).map(({ name }) => name);
  await dailyLoad.getByRole("button", {
    name: "Sort by most recorded items", exact: true,
  }).click();
  await expect(dailyLoad.getByText("Order: Most recorded first")).toBeVisible();
  expect(await datedCards.evaluateAll((elements) =>
    elements.map((element) => element.getAttribute("aria-label") || ""),
  )).toEqual(expectedSorted);
  await dailyLoad.getByRole("button", {
    name: "Sort by calendar date", exact: true,
  }).click();
  expect(await datedCards.evaluateAll((elements) =>
    elements.map((element) => element.getAttribute("aria-label") || ""),
  )).toEqual(originalLabels);
  const activeDays = Number(
    (await weeklyTotals.getByText(/^\d+ of 7$/).textContent())!.split(" of ")[0],
  );
  await dailyLoad.getByRole("button", {
    name: "Show active days only", exact: true,
  }).click();
  await expect(dailyLoad.getByText("Showing " + activeDays + " of 7 days"))
    .toBeVisible();
  await expect(dailyLoad.getByRole("button", {
    name: /^Review \d{4}-\d{2}-\d{2}:/,
  })).toHaveCount(activeDays);
  await dailyLoad.getByRole("button", {
    name: "Show all seven days", exact: true,
  }).click();
  await expect(dailyLoad.getByRole("button", {
    name: /^Review \d{4}-\d{2}-\d{2}:/,
  })).toHaveCount(7);
  const csvPending = page.waitForEvent("download");
  await dailyLoad.getByRole("button", {
    name: "Download seven-day workload CSV", exact: true,
  }).click();
  const csvDownload = await csvPending;
  expect(csvDownload.suggestedFilename()).toBe(
    "lms-seven-day-workload-2026-11-06-through-2026-11-13.csv",
  );
  const workloadCsv = (await readFile((await csvDownload.path())!)).toString("utf8");
  expect(workloadCsv.trimEnd().split("\r\n")).toHaveLength(9);
  expect(workloadCsv).toContain("TOTAL (7 days)");
  expect(workloadCsv).not.toContain("Equipment inspections due");
  expect(workloadCsv).not.toContain("Fictional upcoming window clean");
  expect(workloadCsv).not.toContain("Taylor Edited");
  expect(workloadCsv).toContain("America/Los_Angeles");
  await dailyLoad.getByRole("button", { name: /^Review 2026-11-09:/ }).click();
  await expect(operations.getByLabel("Operations date", { exact: true }))
    .toHaveValue("2026-11-09");
  // The drill-down respects the existing first-four pagination; reveal
  // later rows before asserting the future job is visible on its due day.
  await expect(dueWork.getByText(/^Showing 4 of \d+ work items$/)).toBeVisible();
  await dueWork.getByRole("button", { name: /^Show \d+ more work items$/ }).click();
  await expect(dueWork).toContainText("Fictional upcoming window clean");
  await expect(dueWork).toContainText("Due on date · 2026-11-09");
  await operations.getByLabel("Operations date", { exact: true }).fill("2026-11-06");
  await expect(futureWork).toContainText("Fictional upcoming window clean");
  // Future work can be opened by its exact record ID without an edit.
  await futureWork.getByRole("button", {
    name: "Find upcoming Fictional upcoming window clean in cleaning jobs",
    exact: true,
  }).click();
  await expect(page.getByRole("status").filter({
    hasText: "Showing the specific work record selected in Daily Operations.",
  })).toBeVisible();
  await expect(page.getByRole("heading", {
    name: "Fictional upcoming window clean", exact: true,
  })).toBeVisible();
  await page.getByRole("button", {
    name: "Show all cleaning jobs", exact: true,
  }).click();
  // Once its due date is the selected day, it no longer appears as "upcoming".
  await operations.getByLabel("Operations date", { exact: true }).fill("2026-11-09");
  await expect(futureWork).not.toContainText("Fictional upcoming window clean");
  await operations.getByLabel("Operations date", { exact: true }).fill("2026-11-06");
  await expect(futureWork).toContainText("Fictional upcoming window clean");
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
  // The selected-day CSV stays daily-only; upcoming work is not silently added.
  expect(csvText).not.toContain("Fictional upcoming window clean");
  expect(csvText).not.toContain("Fictional inspect filters");
  expect(csvText).toContain("Fictional kitchen clean");
  expect(csvText).not.toContain("Taylor Edited");
  expect(csvText).toContain("America/Los_Angeles");
  // Separate weekly download includes future work but not the selected day's
  // jobs or the older overdue work. Reuse the same demo session.
  const weeklyPending = page.waitForEvent("download");
  await operations.getByRole("button", {
    name: "Download seven-day outlook CSV", exact: true,
  }).click();
  const weekly = await weeklyPending;
  expect(weekly.suggestedFilename()).toBe(
    "lms-seven-day-outlook-2026-11-06-through-2026-11-13.csv",
  );
  const weeklyCsv = (await readFile((await weekly.path())!)).toString("utf8");
  expect(weeklyCsv).toContain("Fictional upcoming window clean");
  expect(weeklyCsv).not.toContain("Fictional inspect filters");
  expect(weeklyCsv).not.toContain("Fictional kitchen clean");
  expect(weeklyCsv).not.toContain("Fictional overflow job 4");
  expect(weeklyCsv).toContain("America/Los_Angeles");
  await dayInput.fill("");
  await expect(operations.getByRole("button", {
    name: "Download daily plan CSV", exact: true,
  })).toBeDisabled();
  await expect(operations.getByRole("button", {
    name: "Download seven-day outlook CSV", exact: true,
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
