import { test, expect, type Page } from "@playwright/test";
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

    // Recurring plans are date-only; previewing must not create bookings or
    // bypass the existing one-appointment resource/conflict validation.
    const previewOrganization = await page
      .getByLabel("Business workspace", { exact: true }).inputValue();
    const savedBeforePreview = await page.request
      .get("/api/demo?organizationId=" + previewOrganization)
      .then((response) => response.json());
    const planner = page.getByRole("region", {
      name: "Repeating visit planner", exact: true,
    });
    await planner.locator("summary").click();
    const exportButton = planner.getByRole("button", {
      name: "Download planned dates CSV", exact: true,
    });
    await expect(exportButton).toBeVisible();
    const plannedDates = planner.getByRole("list", {
      name: "Planned visit dates", exact: true,
    }).locator("li");
    const visitLabels = plannedDates.locator(".recurring-visit-date-text");
    const weekdays = plannedDates.locator(".recurring-visit-weekday");
    await expect(weekdays).toHaveText([
      "Friday", "Friday", "Friday", "Friday",
    ]);
    await expect(visitLabels).toHaveText([
      "Visit 1: 2026-11-06", "Visit 2: 2026-11-13",
      "Visit 3: 2026-11-20", "Visit 4: 2026-11-27",
    ]);
    // The agenda initially reviews the first date of the four-week
    // preview. UI focus is NOT saved/completed/available booking status.
    const reviewedState = planner.locator(".recurring-visit-review-state");
    await expect(reviewedState)
      .toContainText("Currently reviewing planned visit 1 of 4: 2026-11-06");
    await expect(plannedDates.filter({ has: page.locator(".recurring-visit-current-label") }))
      .toHaveCount(1);
    await expect(plannedDates.first()).toHaveAttribute("aria-current", "date");
    await expect(plannedDates.filter({ has: page.locator(".recurring-visit-current-label") }).first())
      .toContainText("Currently reviewing");
    const savedCounts = plannedDates.locator(".recurring-visit-saved-count");
    const savedStatuses = plannedDates.locator(".recurring-visit-status-counts");
    await expect(savedCounts).toHaveCount(4);
    await expect(savedStatuses).toHaveCount(4);
    await expect(savedStatuses.first()).toContainText("Scheduled ");
    await expect(savedStatuses.first()).toContainText("In progress ");
    await expect(savedStatuses.first()).toContainText("Completed ");
    await expect(savedStatuses.first()).toContainText("Cancelled ");
    const savedStatusSummary = await savedStatuses.first().textContent();
    const sumFirstStatuses = [...(savedStatusSummary ?? "").matchAll(
      /(?:Scheduled|In progress|Completed|Cancelled|Other) (\d+)/g,
    )].reduce((sum, match) => sum + Number(match[1]), 0);
    const firstTotal = Number(
      (await savedCounts.first().textContent() ?? "").match(/Already saved: (\d+)/)?.[1],
    );
    expect(sumFirstStatuses).toBe(firstTotal);
    // A freshly created appointment must contribute, but the fictional
    // seed may also contain other already-saved entries on that date.
    await expect(savedCounts.first()).toHaveText(
      /^Already saved: [1-9]\d* non-archived appointments?$/,
    );
    const firstSavedLabel = await savedCounts.first().textContent();
    await expect(savedCounts.nth(1)).toHaveText(
      /^Already saved: \d+ non-archived appointments?$/,
    );
    const savedCountId = await savedCounts.first().getAttribute("id");
    expect(savedCountId).toBeTruthy();
    const savedStatusId = await savedStatuses.first().getAttribute("id");
    expect(savedStatusId).toBeTruthy();
    await expect(plannedDates.first().getByRole("button", {
      name: "Review planned visit 1 on 2026-11-06", exact: true,
    })).toHaveAttribute("aria-describedby", savedCountId + " " + savedStatusId);
    await planner.getByLabel("Repeat visits", { exact: true })
      .selectOption("2");
    await expect(visitLabels).toHaveText([
      "Visit 1: 2026-11-06", "Visit 2: 2026-11-20",
      "Visit 3: 2026-12-04", "Visit 4: 2026-12-18",
    ]);
    await expect(weekdays).toHaveText(["Friday", "Friday", "Friday", "Friday"]);
    await planner.getByLabel("Number of preview visits", { exact: true })
      .selectOption("6");
    await expect(visitLabels).toHaveText([
      "Visit 1: 2026-11-06", "Visit 2: 2026-11-20",
      "Visit 3: 2026-12-04", "Visit 4: 2026-12-18",
      "Visit 5: 2027-01-01", "Visit 6: 2027-01-15",
    ]);
    await planner.getByLabel("Repeat visits", { exact: true })
      .selectOption("4");
    await expect(plannedDates.nth(1)).toContainText("2026-12-04");
    await expect(savedCounts).toHaveCount(6);
    await expect(savedStatuses).toHaveCount(6);
    await expect(weekdays).toHaveText(Array.from({ length: 6 }, () => "Friday"));
    await expect(savedCounts.first()).toHaveText(firstSavedLabel ?? "");
    await expect(savedCounts.nth(1)).toHaveText(
      /^Already saved: \d+ non-archived appointments?$/,
    );
    await expect(planner).toContainText(
      "Preview only — no appointments are created",
    );
    // Every candidate has an accessible, non-writing agenda navigation
    // shortcut. Navigating to a later visit must NOT shift the preview anchor.
    await expect(plannedDates.getByRole("button", {
      name: /Review planned visit /,
    })).toHaveCount(6);
    // Export is local, date-only and never books or exports customer data.
    const [previewDownload] = await Promise.all([
      page.waitForEvent("download"),
      exportButton.click(),
    ]);
    expect(previewDownload.suggestedFilename())
      .toBe("lms-visit-preview-2026-11-06.csv");
    const previewCsv = await readFile(await previewDownload.path(), "utf8");
    const previewRows = previewCsv.trimEnd().split("\r\n");
    expect(previewRows).toHaveLength(7);
    expect(previewRows).toContain(
      "2,2026-12-04,4,Preview only - no appointment booked by export",
    );
    expect(previewRows[0]).toBe("Visit,Proposed date,Repeat every (weeks),Note");
    expect(previewCsv).not.toContain(customer);
    expect(previewCsv).not.toContain(work);
    expect(previewCsv).not.toContain(resource);
    const anchoredVisitLabels = await visitLabels.allTextContents();
    const previousPlanned = planner.getByRole("button", {
      name: "Previous planned visit", exact: true,
    });
    const nextPlanned = planner.getByRole("button", {
      name: "Next planned visit", exact: true,
    });
    // Review shortcuts are independent of recurrence anchor and booking.
    await expect(reviewedState)
      .toContainText("Currently reviewing planned visit 1 of 6: 2026-11-06");
    await expect(planner.locator(".recurring-visit-dates li[aria-current='date']")).toHaveCount(1);
    await expect(previousPlanned).toBeDisabled();
    await nextPlanned.click();
    await expect(page.getByLabel("Schedule date", { exact: true }))
      .toHaveValue("2026-12-04");
    await expect(reviewedState)
      .toContainText("Currently reviewing planned visit 2 of 6: 2026-12-04");
    await expect(plannedDates.nth(1)).toHaveAttribute("aria-current", "date");
    await expect(plannedDates.first()).not.toHaveAttribute("aria-current", "date");
    await expect(planner.locator(".recurring-visit-dates li[aria-current='date']")).toHaveCount(1);
    await expect(previousPlanned).toBeEnabled();
    await previousPlanned.click();
    await expect(page.getByLabel("Schedule date", { exact: true }))
      .toHaveValue("2026-11-06");
    await expect(previousPlanned).toBeDisabled();
    expect(await visitLabels.allTextContents()).toEqual(anchoredVisitLabels);

    // A row review and the next/previous buttons use the same read-only
    // navigation, including the last-date boundary (no wrap or booking).
    await planner.getByRole("button", {
      name: "Review planned visit 6 on 2027-03-26",
      exact: true,
    }).click();
    await expect(reviewedState)
      .toContainText("Currently reviewing planned visit 6 of 6: 2027-03-26");
    await expect(plannedDates.last()).toHaveAttribute("aria-current", "date");
    await expect(planner.locator(".recurring-visit-dates li[aria-current='date']")).toHaveCount(1);
    await expect(nextPlanned).toBeDisabled();
    await previousPlanned.click();
    await expect(page.getByLabel("Schedule date", { exact: true }))
      .toHaveValue("2027-02-26");
    await nextPlanned.click();
    await expect(page.getByLabel("Schedule date", { exact: true }))
      .toHaveValue("2027-03-26");
    expect(await visitLabels.allTextContents()).toEqual(anchoredVisitLabels);

    await planner.getByRole("button", {
      name: "Review planned visit 4 on 2027-01-29",
      exact: true,
    }).click();
    await expect(page.getByLabel("Schedule date", { exact: true }))
      .toHaveValue("2027-01-29");
    expect(await visitLabels.allTextContents()).toEqual(anchoredVisitLabels);
    await expect(savedCounts.first()).toHaveText(firstSavedLabel ?? "");
    await expect(savedStatuses.first()).toHaveText(savedStatusSummary ?? "");
    await expect(page.getByRole("status").filter({
      hasText: "appointments on 2027-01-29",
    })).toBeVisible();
    // A deliberate change to the date picker now becomes the first visit.
    await page.getByLabel("Schedule date", { exact: true }).fill("2026-11-06");
    await expect(visitLabels.first()).toHaveText("Visit 1: 2026-11-06");
    // Do not silently return partial plans if the last date is out of range.
    await page.getByLabel("Schedule date", { exact: true }).fill("2100-12-25");
    await expect(planner.getByRole("status")).toContainText(
      "on or before 2100-12-31",
    );
    await expect(plannedDates).toHaveCount(0);
    await expect(weekdays).toHaveCount(0);
    await expect(savedCounts).toHaveCount(0);
    await expect(savedStatuses).toHaveCount(0);
    await expect(planner.locator(".recurring-visit-review-state")).toHaveCount(0);
    await expect(exportButton).toHaveCount(0);
    await expect(previousPlanned).toHaveCount(0);
    await expect(nextPlanned).toHaveCount(0);
    await page.getByLabel("Schedule date", { exact: true }).fill("2026-11-06");
    await expect(plannedDates).toHaveCount(6);
    await fits(page);
    expect(
      (await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations,
    ).toEqual([]);
    // Deliberately re-anchor to a Saturday: weekend labels are a
    // planning cue, never a closure or availability assertion.
    await page.getByLabel("Schedule date", { exact: true }).fill("2026-11-07");
    await expect(weekdays.first())
      .toHaveText("Saturday · Weekend — verify staffing before booking");
    await expect(weekdays).toHaveCount(6);
    await page.getByLabel("Schedule date", { exact: true }).fill("2026-11-06");
    await expect(weekdays).toHaveText(Array.from({ length: 6 }, () => "Friday"));
    const savedAfterPreview = await page.request
      .get("/api/demo?organizationId=" + previewOrganization)
      .then((response) => response.json());
    expect(savedAfterPreview.workspace.records)
      .toEqual(savedBeforePreview.workspace.records);

    // Exercise a date-only handoff in THIS existing two-business session.
    // A separate test would exhaust the demo's fixed 24-session limit
    // on the final HTTP boundary test. No production caps are changed.
    const preparedDate = "2026-12-04";
    await planner.getByRole("button", {
      name: "Prepare appointment for planned visit 2 on " + preparedDate,
      exact: true,
    }).click();
    await expect(page.getByRole("heading", {
      name: industry === "property"
        ? "Add maintenance appointment"
        : "Add cleaning appointment",
      exact: true,
    })).toBeVisible();
    await expect(page.getByRole("status").filter({
      hasText: "Planned visit date: " + preparedDate,
    })).toContainText("Only the date was carried");
    const prefilledDay = page.locator(".appointment-fields input[type='date']");
    await expect(prefilledDay).toHaveCount(1);
    await expect(prefilledDay).toHaveValue(preparedDate);
    await expect(prefilledDay).toHaveAttribute("readonly", "");
    await expect(page.getByLabel("Start time *", { exact: true })).toHaveValue("");
    await expect(page.getByLabel("End time *", { exact: true })).toHaveValue("");
    await expect(page.getByLabel("Appointment title *", { exact: true }))
      .toHaveValue("");
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    expect((await page.request.get(
      "/api/demo?organizationId=" + previewOrganization,
    ).then((response) => response.json())).workspace.records)
      .toEqual(savedBeforePreview.workspace.records);
    // Cancelling restores the exact same six-date four-week plan, open,
    // with the chosen review date selected, without an additional session.
    const restoredPlanner = page.getByRole("region", {
      name: "Repeating visit planner", exact: true,
    });
    await expect(page.getByLabel("Schedule date", { exact: true }))
      .toHaveValue(preparedDate);
    await expect(restoredPlanner.locator("details")).toHaveAttribute("open", "");
    await expect(restoredPlanner).toContainText("Back to your unsaved recurring visit plan.");
    await expect(restoredPlanner.locator(".recurring-visit-review-state"))
      .toContainText("Currently reviewing planned visit 2 of 6: 2026-12-04");
    await expect(restoredPlanner.locator(".recurring-visit-dates li[aria-current='date']"))
      .toHaveCount(1);
    await expect(restoredPlanner.getByLabel("Repeat visits", { exact: true }))
      .toHaveValue("4");
    await expect(restoredPlanner.getByLabel("Number of preview visits", {
      exact: true,
    })).toHaveValue("6");
    const restoredDates = restoredPlanner.getByRole("list", {
      name: "Planned visit dates", exact: true,
    }).locator(".recurring-visit-date-text");
    await expect(restoredDates).toHaveText(anchoredVisitLabels);
    // A second date can be prepared immediately from the resumed series.
    await restoredPlanner.getByRole("button", {
      name: "Prepare appointment for planned visit 3 on 2027-01-01",
      exact: true,
    }).click();
    await expect(page.locator(".appointment-fields input[type='date']"))
      .toHaveValue("2027-01-01");
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(page.getByLabel("Schedule date", { exact: true }))
      .toHaveValue("2027-01-01");
    await expect(page.getByRole("region", {
      name: "Repeating visit planner", exact: true,
    }).getByRole("list", {
      name: "Planned visit dates", exact: true,
    }).locator(".recurring-visit-date-text")).toHaveText(anchoredVisitLabels);

    // A successful explicit SINGLE appointment save also returns to the
    // same plan, with the updated count. Nothing in the plan bulk-books.
    const nextVisitDate = "2027-01-29";
    await page.getByRole("region", {
      name: "Repeating visit planner", exact: true,
    }).getByRole("button", {
      name: "Prepare appointment for planned visit 4 on " + nextVisitDate,
      exact: true,
    }).click();
    await page.getByLabel("Appointment title *", { exact: true })
      .fill("Schedule " + industry + " recurring manual visit");
    await page.getByLabel("Customer *", { exact: true })
      .selectOption({ label: customer });
    await page.getByLabel(
      industry === "cleaning" ? "Cleaning job *" : "Maintenance request *",
      { exact: true },
    ).selectOption({ label: work });
    await page.getByLabel(
      industry === "cleaning"
        ? "Assigned crew / resource *"
        : "Assigned worker / resource *",
      { exact: true },
    ).selectOption({ label: resource });
    await page.getByLabel("Start time *", { exact: true })
      .fill(nextVisitDate + "T10:00");
    await page.getByLabel("End time *", { exact: true })
      .fill(nextVisitDate + "T11:00");
    await save(page);
    await expect(page.getByLabel("Schedule date", { exact: true }))
      .toHaveValue(nextVisitDate);
    const savedRoutePlanner = page.getByRole("region", {
      name: "Repeating visit planner", exact: true,
    });
    await expect(savedRoutePlanner.locator("details")).toHaveAttribute("open", "");
    await expect(savedRoutePlanner.locator(".recurring-visit-review-state"))
      .toContainText("Currently reviewing planned visit 4 of 6: 2027-01-29");
    await expect(savedRoutePlanner.getByRole("list", {
      name: "Planned visit dates", exact: true,
    }).locator(".recurring-visit-date-text")).toHaveText(anchoredVisitLabels);
    await expect(savedRoutePlanner.getByRole("list", {
      name: "Planned visit dates", exact: true,
    }).locator("li").nth(3).locator(".recurring-visit-saved-count"))
      .toContainText(/Already saved: [1-9]\d* non-archived appointment/);
    const savedAfterExplicitBooking = await page.request.get(
      "/api/demo?organizationId=" + previewOrganization,
    ).then((response) => response.json());
    expect(savedAfterExplicitBooking.workspace.records.length)
      .toBe(savedBeforePreview.workspace.records.length + 1);

    // Normal Add opens a blank date and does NOT inherit the old plan.
    await page.getByRole("button", { name: "+ Add appointment", exact: true }).click();
    await expect(page.locator(".appointment-fields input[type='date']"))
      .toHaveValue("");
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    expect((await page.request.get(
      "/api/demo?organizationId=" + previewOrganization,
    ).then((response) => response.json())).workspace.records)
      .toEqual(savedAfterExplicitBooking.workspace.records);
    // Ordinary cancelled Add remains on Records; it must not carry
    // a phantom return route into future navigation.
    await expect(page.getByRole("heading", {
      name: industry === "cleaning"
        ? "Cleaning appointments"
        : "Maintenance appointments",
      exact: true,
    })).toBeVisible();

    // Verify the seven-day appointment outlook from the previous business day
    // using this existing demo session, then hand off the actual start date.
    await page.getByRole("button", {
      name: industry === "cleaning" ? /^Cleaning jobs/ : /^(Maintenance requests|Tasks)/,
    }).click();
    const futureOverview = page.getByRole("region", {
      name: "Daily operations", exact: true,
    });
    await futureOverview.getByLabel("Operations date", { exact: true }).fill("2026-11-05");
    const futureAppointments = futureOverview.getByRole("region", {
      name: "Upcoming appointments next seven days", exact: true,
    });
    await expect(futureAppointments).toContainText(title);
    await futureAppointments.getByRole("button", {
      name: `Find upcoming appointment ${title}`, exact: true,
    }).click();
    await expect(page.getByLabel("Schedule date", { exact: true })).toHaveValue("2026-11-06");
    await expect(page.getByRole("article", { name: title, exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Show all appointments", exact: true }).click();
    // Exercise the exact appointment link in this existing fictional session.
    await page.getByRole("button", {
      name: industry === "cleaning" ? /^Cleaning jobs/ : /^(Maintenance requests|Tasks)/,
    }).click();
    const operations = page.getByRole("region", { name: "Daily operations", exact: true });
    await operations.getByLabel("Operations date", { exact: true }).fill("2026-11-06");
    const appointments = operations.getByRole("region", {
      name: "Appointments for operations date", exact: true,
    });
    await expect(appointments).toContainText(title);
    await appointments.getByRole("button", {
      name: `Find appointment ${title}`, exact: true,
    }).click();
    await expect(page.getByRole("status").filter({
      hasText: "Showing the exact appointment selected in Daily Operations.",
    })).toBeVisible();
    await expect(page.getByLabel("Schedule date", { exact: true })).toHaveValue("2026-11-06");
    await expect(page.getByRole("article", { name: title, exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Show all appointments", exact: true }).click();
    await expect(page.getByRole("status").filter({
      hasText: "Showing the exact appointment selected in Daily Operations.",
    })).toHaveCount(0);
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

