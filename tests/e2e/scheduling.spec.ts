import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
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
async function save(page: Page) {
  await page.getByRole("button", { name: "Save record", exact: true }).click();
}
async function book(
  page: Page,
  industry: "property" | "cleaning",
  title: string,
  customer: string,
  work: string,
  resource: string,
  start = "2026-11-06T10:00",
  end = "2026-11-06T11:00",
) {
  await page.getByRole("button", { name: "Schedule", exact: true }).click();
  await page
    .getByRole("button", { name: "+ Add appointment", exact: true })
    .click();
  await page.getByLabel("Appointment title *", { exact: true }).fill(title);
  await page
    .getByLabel("Customer *", { exact: true })
    .selectOption({ label: customer });
  await page
    .getByLabel(
      industry === "cleaning" ? "Cleaning job *" : "Maintenance request *",
      { exact: true },
    )
    .selectOption({ label: work });
  await page
    .getByLabel(
      industry === "cleaning"
        ? "Assigned crew / resource *"
        : "Assigned worker / resource *",
      { exact: true },
    )
    .selectOption({ label: resource });
  await page.getByLabel("Start time *", { exact: true }).fill(start);
  await page.getByLabel("End time *", { exact: true }).fill(end);
}
test("customer-linked cleaning and maintenance share conflict-aware, accessible scheduling and retained history", async ({
  page,
}, testInfo) => {
  await start(page);
  for (const industry of ["cleaning", "property"] as const) {
    await page.getByLabel("Business workspace", { exact: true }).selectOption({
      label: industry === "cleaning" ? "Cleaning Company" : "Property Manager",
    });
    const customer = `Schedule ${industry} customer`,
      work = `Schedule ${industry} work`,
      resource = `Schedule ${industry} resource`,
      title = `Schedule ${industry} appointment`;
    await page
      .getByRole("button", { name: "+ Add customer", exact: true })
      .click();
    await page.getByLabel("Name *", { exact: true }).fill(customer);
    await save(page);
    await expect(
      page.getByRole("heading", { name: customer, exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", {
        name:
          industry === "cleaning"
            ? /^Cleaning jobs/
            : /^(Maintenance requests|Tasks)/,
      })
      .click();
    await page
      .getByRole("button", {
        name:
          industry === "cleaning"
            ? "+ Add cleaning job"
            : /^\+ Add (maintenance request|task)$/,
      })
      .click();
    await page
      .getByLabel(industry === "cleaning" ? "Job title *" : "Task title *", {
        exact: true,
      })
      .fill(work);
    await page
      .getByLabel("Customer", { exact: true })
      .selectOption({ label: customer });
    if (industry === "cleaning") {
      await page
        .getByLabel("Service *", { exact: true })
        .selectOption("Deep clean");
      await page
        .getByLabel("Service date *", { exact: true })
        .fill("2026-11-06");
      await page
        .getByLabel("Status *", { exact: true })
        .selectOption("Planned");
    } else {
      await page.getByLabel("Status *", { exact: true }).selectOption("Open");
      await page
        .getByLabel("Site or unit", { exact: true })
        .selectOption({ label: "Cabin 02" });
    }
    await save(page);
    await expect(
      page.getByRole("heading", { name: work, exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", {
        name:
          industry === "cleaning"
            ? /^Crews & resources/
            : /^Workers & resources/,
      })
      .click();
    await page
      .getByRole("button", {
        name:
          industry === "cleaning"
            ? "+ Add crew or resource"
            : "+ Add worker or resource",
        exact: true,
      })
      .click();
    await page.getByLabel("Resource name *", { exact: true }).fill(resource);
    await page
      .getByLabel("Resource type *", { exact: true })
      .selectOption(industry === "cleaning" ? "Crew" : "Worker");
    await save(page);
    await expect(
      page.getByRole("heading", { name: resource, exact: true }),
    ).toBeVisible();
    await book(page, industry, title, customer, work, resource);
    await fits(page);
    expect(
      (
        await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
          .analyze()
      ).violations,
    ).toEqual([]);
    await save(page);
    await expect(
      page.getByRole("heading", { name: title, exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Schedule", exact: true }).click();
    await page.getByLabel("Schedule date", { exact: true }).fill("2026-11-06");
    const card = page.getByRole("article", { name: title, exact: true });
    await expect(card).toBeVisible();
    await expect(card.getByText(customer, { exact: true })).toBeVisible();
    await expect(card.getByText(resource, { exact: true })).toBeVisible();
    if (industry === "property")
      await expect(card.getByText("Cabin 02", { exact: true })).toBeVisible();
    await fits(page);
    await book(
      page,
      industry,
      "Rejected overlap",
      customer,
      work,
      resource,
      "2026-11-06T10:30",
      "2026-11-06T11:30",
    );
    await save(page);
    await expect(
      page.getByText(/already has an appointment during that time/).first(),
    ).toBeVisible();
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await page.getByRole("button", { name: "Schedule", exact: true }).click();
    await page.getByLabel("Schedule date", { exact: true }).fill("2026-11-06");
    await page
      .getByRole("button", { name: `Edit ${title}`, exact: true })
      .click();
    await page
      .getByLabel("Start time *", { exact: true })
      .fill("2026-11-06T14:00");
    await page
      .getByLabel("End time *", { exact: true })
      .fill("2026-11-06T15:00");
    await save(page);
    await expect(
      page.getByRole("heading", { name: title, exact: true }),
    ).toBeVisible();
    const organizationId = await page
      .getByLabel("Business workspace", { exact: true })
      .inputValue();
    const before = await page.request
      .get("/api/demo?organizationId=" + organizationId)
      .then((r) => r.json());
    const stored = before.workspace.records.find(
      (r: { data: { title?: string } }) => r.data.title === title,
    );
    await page.getByRole("button", { name: "Project & modules" }).click();
    await page.getByLabel("Business time zone", { exact: true }).fill("UTC");
    await page
      .getByRole("button", { name: "Apply configuration", exact: true })
      .click();
    await expect(page.locator(".revision-label")).toContainText(
      "Configuration v2",
    );
    const after = await page.request
      .get("/api/demo?organizationId=" + organizationId)
      .then((r) => r.json());
    expect(
      after.workspace.records.find((r: { id: string }) => r.id === stored.id)
        .data.start,
    ).toBe(stored.data.start);
    await page.getByRole("button", { name: "Schedule", exact: true }).click();
    await page.getByLabel("Schedule date", { exact: true }).fill("2026-11-06");
    await expect(
      page.getByRole("article", { name: title, exact: true }),
    ).toContainText("22:00+00:00");
    if (industry === "property")
      await page.screenshot({
        path: testInfo.outputPath("property-schedule.png"),
        fullPage: true,
      });
    await page
      .getByRole("button", { name: `Archive ${title}`, exact: true })
      .click();
    await page
      .getByRole("button", { name: "Confirm archive", exact: true })
      .click();
    await page.getByRole("button", { name: "Schedule", exact: true }).click();
    await page.getByLabel("Schedule date", { exact: true }).fill("2026-11-06");
    await expect(
      page.getByRole("article", { name: title, exact: true }),
    ).toHaveCount(0);
    await page
      .getByLabel("Show archived appointments", { exact: true })
      .check();
    await expect(
      page.getByRole("article", { name: title, exact: true }),
    ).toBeVisible();
    await fits(page);
  }
});
test("DST repeats require a choice, gaps are refused and a saved occurrence survives an ordinary edit in dark mode", async ({
  page,
}) => {
  await start(page);
  await page
    .getByRole("button", { name: "Switch to dark theme", exact: true })
    .click();
  await book(
    page,
    "property",
    "Autumn clock visit",
    "Alex Example",
    "Inspect porch light",
    "Garden worker",
    "2026-11-01T01:30",
    "2026-11-01T02:30",
  );
  await save(page);
  await expect(page.getByText(/This local time repeats/)).toBeVisible();
  await page
    .getByLabel("Start time clock occurrence", { exact: true })
    .selectOption("later");
  await save(page);
  await expect(
    page.getByRole("heading", { name: "Autumn clock visit", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Edit Autumn clock visit", exact: true })
    .click();
  await page
    .getByLabel("Appointment notes", { exact: true })
    .fill("Same confirmed occurrence; notes only.");
  await save(page);
  await expect(
    page.getByRole("heading", { name: "Autumn clock visit", exact: true }),
  ).toBeVisible();
  const snapshot = await page.request.get("/api/demo").then((r) => r.json());
  expect(
    snapshot.workspace.records.find(
      (r: { data: { title?: string } }) =>
        r.data.title === "Autumn clock visit",
    ).data.start,
  ).toBe("2026-11-01T09:30:00Z");
  await book(
    page,
    "property",
    "Impossible spring visit",
    "Alex Example",
    "Inspect porch light",
    "Garden worker",
    "2026-03-08T02:30",
    "2026-03-08T03:30",
  );
  await page
    .getByLabel("Start time clock occurrence", { exact: true })
    .selectOption("earlier");
  await save(page);
  await expect(page.getByText(/This local time does not exist/)).toBeVisible();
  await fits(page);
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
});
