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
function cancelledOnlyCardCount(savedLabels: readonly string[], statusLabels: readonly string[]): number {
  expect(statusLabels).toHaveLength(savedLabels.length);
  return savedLabels.filter((label, index) => {
    const total = label.match(/^Already saved: (\d+) non-archived/);
    const cancelled = statusLabels[index].match(/Cancelled (\d+)/);
    expect(total).not.toBeNull();
    expect(cancelled).not.toBeNull();
    return Number(total![1]) > 0 && Number(total![1]) === Number(cancelled![1]);
  }).length;
}
function cancelledOnlyCardDates(
  savedLabels: readonly string[], statusLabels: readonly string[],
  dates: readonly string[],
): string[] {
  expect(dates).toHaveLength(savedLabels.length);
  expect(statusLabels).toHaveLength(savedLabels.length);
  return dates.filter((_, index) => {
    const total = savedLabels[index].match(/^Already saved: (\d+) non-archived/);
    const cancelled = statusLabels[index].match(/Cancelled (\d+)/);
    expect(total).not.toBeNull();
    expect(cancelled).not.toBeNull();
    return Number(total![1]) > 0 && Number(total![1]) === Number(cancelled![1]);
  });
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
    const copyButton = planner.getByRole("button", {
      name: "Copy planned dates", exact: true,
    });
    const statusExportButton = planner.getByRole("button", {
      name: "Download saved-date review CSV", exact: true,
    });
    const savedCsvCopyButton = planner.getByRole("button", {
      name: "Copy saved-date review CSV", exact: true,
    });
    const savedCsvPreviewToggle = planner.getByRole("button", {
      name: /^(Preview saved-date review CSV|Hide saved-date review CSV preview)$/,
    });
    const savedCsvPreviewTextarea = planner.getByRole("textbox", {
      name: "Selectable saved-date review CSV — NOT BOOKED", exact: true,
    });
    const savedCsvCopyFeedback = planner.locator(
      ".recurring-visit-saved-review-csv-copy-feedback",
    );
    await expect(savedCsvCopyButton).toBeVisible();
    await expect(savedCsvPreviewToggle).toHaveAttribute("aria-expanded", "false");
    await expect(savedCsvPreviewTextarea).toHaveCount(0);
    await expect(savedCsvCopyFeedback).toHaveCount(0);
    await expect(statusExportButton).toBeVisible();
    await expect(exportButton).toBeVisible();
    await expect(copyButton).toBeVisible();
    const overview = planner.getByRole("region", {
      name: "Proposed visit overview", exact: true,
    });
    await expect(overview).toContainText("Plan at a glance — proposed only");
    await expect(overview.locator("dd")).toHaveText([
      "4", "4", "0",
      "Friday 2026-11-06", "Friday 2026-11-27", "3 calendar weeks",
    ]);
    await expect(overview)
      .toContainText("not a count of booked appointments");
    const coverage = overview.getByRole("group", {
      name: "Saved appointment date coverage", exact: true,
    });
    await expect(coverage).toContainText("Saved records on proposed dates");
    await expect(coverage).toContainText("Existing records may be unrelated");
    await expect(coverage).toContainText(
      "Neither count confirms proposed bookings",
    );
    const withSaved = coverage.locator(".recurring-visit-coverage-with-saved");
    const withoutSaved = coverage.locator(".recurring-visit-coverage-without-saved");
    const cancelledOnly = coverage.locator(".recurring-visit-coverage-cancelled-only-count");
    const cancelledListToggle = coverage.getByRole("button", {
      name: /^(Show|Hide) cancelled-only proposed dates/,
    });
    const cancelledList = coverage.getByRole("list", {
      name: "Cancelled-only proposed visit dates", exact: true,
    });
    const noSavedListToggle = coverage.getByRole("button", {
      name: /^(Show|Hide) proposed dates without saved appointments/,
    });
    const noSavedList = coverage.getByRole("list", {
      name: "Proposed dates without saved appointments", exact: true,
    });
    // The NOT BOOKED / availability disclaimer is a sibling <p>
    // above this <ul>, not part of the list's accessible text.
    const noSavedListPanel = coverage.locator(".recurring-visit-no-saved-list");
    await expect(noSavedListToggle).toHaveAttribute("aria-expanded", "false");
    await expect(noSavedList).toHaveCount(0);
    await expect(cancelledListToggle).toHaveAttribute("aria-expanded", "false");
    await expect(cancelledList).toHaveCount(0);
    await expect(coverage).toContainText("proposed dates with saved");
    await expect(coverage).toContainText("only cancelled, non-archived appointments");
    await expect(coverage).toContainText("cancelled-only count does not confirm");
    const reviewPreviousWithSaved = coverage.getByRole("button", {
      name: "Review previous proposed date with saved records", exact: true,
    });
    const reviewPreviousWithoutSaved = coverage.getByRole("button", {
      name: "Review previous proposed date without saved records", exact: true,
    });
    const reviewNextWithSaved = coverage.getByRole("button", {
      name: "Review next proposed date with saved records", exact: true,
    });
    const reviewNextWithoutSaved = coverage.getByRole("button", {
      name: "Review next proposed date without saved records", exact: true,
    });
    await expect(reviewPreviousWithSaved).toBeVisible();
    await expect(reviewPreviousWithoutSaved).toBeVisible();
    await expect(reviewPreviousWithSaved).toBeDisabled();
    await expect(reviewPreviousWithoutSaved).toBeDisabled();
    await expect(reviewNextWithSaved).toBeVisible();
    await expect(reviewNextWithoutSaved).toBeVisible();
    await expect(coverage).toContainText("without wrapping");
    await expect(coverage).toContainText("do not check free time");
    const reviewedDetails = planner.getByRole("region", {
      name: "Reviewed proposed visit details", exact: true,
    });
    await expect(reviewedDetails).toContainText("Reviewed visit 1 of 4");
    await expect(reviewedDetails.locator(".recurring-visit-selected-date"))
      .toHaveText("Friday 2026-11-06");
    await expect(reviewedDetails).toContainText(
      "Counts include saved records on this calendar date",
    );
    const reviewCopyButton = reviewedDetails.getByRole("button", {
      name: "Copy reviewed visit", exact: true,
    });
    const reviewDownloadButton = reviewedDetails.getByRole("button", {
      name: "Download reviewed visit TXT", exact: true,
    });
    const reviewedStatusDownloadButton = reviewedDetails.getByRole("button", {
      name: "Download reviewed visit status TXT", exact: true,
    });
    const statusCopyButton = reviewedDetails.getByRole("button", {
      name: "Copy saved status summary", exact: true,
    });
    const statusCopyFeedback = reviewedDetails.locator(
      ".recurring-visit-reviewed-status-copy-feedback",
    );
    await expect(statusCopyButton).toBeEnabled();
    await expect(statusCopyFeedback).toHaveCount(0);
    const statusPreviewToggle = reviewedDetails.getByRole("button", {
      name: /^(Preview saved status summary|Hide saved status summary)$/,
    });
    const selectableStatusSummary = reviewedDetails.getByRole("textbox", {
      name: "Selectable saved appointment status summary — NOT BOOKED", exact: true,
    });
    await expect(statusPreviewToggle).toHaveAttribute("aria-expanded", "false");
    await expect(selectableStatusSummary).toHaveCount(0);
    const previewVisitNote = reviewedDetails.getByRole("button", {
      name: "Preview visit note", exact: true,
    });
    const selectableNote = reviewedDetails.getByRole("textbox", {
      name: "Selectable proposed visit note — NOT BOOKED", exact: true,
    });
    await expect(previewVisitNote).toHaveAttribute("aria-expanded", "false");
    await expect(selectableNote).toHaveCount(0);
    await previewVisitNote.click();
    await expect(selectableNote).toBeVisible();
    await expect(selectableNote).toHaveAttribute("readonly", "");
    await expect(selectableNote).toHaveValue([
      "LMS proposed visit 1 of 4 - NOT BOOKED",
      "Friday, 2026-11-06 (business-local date; no time)",
      "Planning note only. No appointment, staff or equipment is booked or confirmed.",
    ].join("\n"));
    await expect(reviewedDetails).toContainText("long-press on a phone");
    await reviewedDetails.getByRole("button", {
      name: "Hide visit note", exact: true,
    }).click();
    await expect(selectableNote).toHaveCount(0);
    await expect(previewVisitNote).toHaveAttribute("aria-expanded", "false");
    await expect(reviewCopyButton).toBeEnabled();
    await expect(reviewDownloadButton).toBeEnabled();
    // The download is local and uses the same already-validated text
    // as Copy, without requiring browser clipboard permissions.
    const [initialReviewDownload] = await Promise.all([
      page.waitForEvent("download"),
      reviewDownloadButton.click(),
    ]);
    expect(initialReviewDownload.suggestedFilename())
      .toBe("lms-proposed-visit-2026-11-06-NOT-BOOKED.txt");
    expect(await readFile(await initialReviewDownload.path(), "utf8")).toBe([
      "LMS proposed visit 1 of 4 - NOT BOOKED",
      "Friday, 2026-11-06 (business-local date; no time)",
      "Planning note only. No appointment, staff or equipment is booked or confirmed.",
      "",
    ].join("\n"));
    await expect(reviewedStatusDownloadButton).toBeEnabled();
    const [initialStatusDownload] = await Promise.all([
      page.waitForEvent("download"), reviewedStatusDownloadButton.click(),
    ]);
    expect(initialStatusDownload.suggestedFilename()).toBe(
      "lms-reviewed-visit-status-2026-11-06-NOT-BOOKED.txt",
    );
    const initialSavedStatusText = await readFile(await initialStatusDownload.path(), "utf8");
    const initialSavedCount = (await reviewedDetails.locator(
      ".recurring-visit-selected-count",
    ).innerText()).match(/Saved on this date: (\d+) non-archived/)?.[1];
    expect(initialSavedCount).toBeDefined();
    const initialStatusCounts = await reviewedDetails.locator(
      ".recurring-visit-selected-statuses",
    ).innerText();
    expect(initialSavedStatusText).toContain("LMS proposed visit 1 of 4 - NOT BOOKED");
    expect(initialSavedStatusText).toContain(
      "Existing non-archived saved appointments on date: " + initialSavedCount,
    );
    for (const label of ["Scheduled", "In progress", "Completed", "Cancelled", "Other"]) {
      const numeric = initialStatusCounts.match(new RegExp(label + " (\\d+)"))?.[1] ?? "0";
      expect(initialSavedStatusText).toContain(label + " " + numeric);
    }
    expect(initialSavedStatusText).toContain(
      "No staff, equipment, or appointment availability is confirmed.",
    );
    expect(initialSavedStatusText).not.toContain(customer);
    expect(initialSavedStatusText).not.toContain(work);
    expect(initialSavedStatusText).not.toContain(resource);
    expect(initialSavedStatusText).not.toContain("2026-11-06T");
    // A successful clipboard action must contain exactly the same
    // validated, privacy-safe text as the existing status TXT download.
    await page.evaluate(() => {
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: { writeText: async (text: string) => {
          document.documentElement.dataset.copiedStatusSummary = text;
        } },
      });
    });
    await statusCopyButton.click();
    await expect(statusCopyFeedback).toHaveText(
      "Saved status summary copied. No visit was booked or confirmed.",
    );
    expect(await page.evaluate(() =>
      document.documentElement.dataset.copiedStatusSummary ?? "",
    )).toBe(initialSavedStatusText.trimEnd());
    await expect(reviewedDetails.locator(
      ".recurring-visit-reviewed-copy-feedback",
    )).toHaveCount(0);
    await page.evaluate(() => {
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: { writeText: async () => { throw new Error("Clipboard denied"); } },
      });
    });
    await statusCopyButton.click();
    await expect(statusCopyFeedback).toContainText(
      "Could not copy saved status summary. Clipboard access may be blocked",
    );
    await expect(statusCopyFeedback).toContainText(
      "Download reviewed visit status TXT or Preview saved status summary",
    );
    // The new on-screen preview must match the validated, privacy-safe
    // downloaded TXT exactly, without a file or clipboard permission.
    await statusPreviewToggle.click();
    await expect(statusPreviewToggle).toHaveAttribute("aria-expanded", "true");
    await expect(selectableStatusSummary).toHaveAttribute("readonly", "");
    await expect(selectableStatusSummary).toHaveValue(initialSavedStatusText.trimEnd());
    expect(await selectableStatusSummary.inputValue()).not.toContain(customer);
    expect(await selectableStatusSummary.inputValue()).not.toContain(work);
    expect(await selectableStatusSummary.inputValue()).not.toContain(resource);
    await expect(reviewedDetails).toContainText("long-press on a phone");
    await statusPreviewToggle.click();
    await expect(statusPreviewToggle).toHaveAttribute("aria-expanded", "false");
    await expect(selectableStatusSummary).toHaveCount(0);
    const reviewedCopyFeedback = reviewedDetails.locator(
      ".recurring-visit-reviewed-copy-feedback",
    );
    await expect(reviewedCopyFeedback).toHaveCount(0);
    const plannedDates = planner.getByRole("list", {
      name: "Planned visit dates", exact: true,
    }).locator("li");
    const compactView = planner.getByRole("checkbox", {
      name: "Compact view — hide date cards", exact: true,
    });
    await expect(compactView).not.toBeChecked();
    await expect(plannedDates).toHaveCount(4);
    await compactView.check();
    await expect(plannedDates).toHaveCount(0);
    await expect(planner.locator(".recurring-visit-compact-note"))
      .toContainText("Date cards hidden for easier review");
    await expect(reviewedDetails).toContainText("Reviewed visit 1 of 4");
    await expect(overview).toContainText("Proposed visits");
    await expect(exportButton).toBeVisible();
    await expect(statusExportButton).toBeVisible();
    await expect(savedCsvCopyButton).toBeVisible();
    await expect(savedCsvPreviewToggle).toBeVisible();
    await savedCsvPreviewToggle.click();
    await expect(savedCsvPreviewToggle).toHaveAttribute("aria-expanded", "true");
    await expect(savedCsvPreviewTextarea).toHaveAttribute("readonly", "");
    await expect(savedCsvPreviewTextarea).toBeVisible();
    await fits(page);
    await savedCsvPreviewToggle.click();
    await expect(savedCsvPreviewTextarea).toHaveCount(0);
    await expect(copyButton).toBeVisible();
    await compactView.uncheck();
    await expect(plannedDates).toHaveCount(4);
    await expect(planner.locator(".recurring-visit-compact-note")).toHaveCount(0);
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
    await expect(cancelledOnly).toHaveText(String(cancelledOnlyCardCount(
      await savedCounts.allTextContents(), await savedStatuses.allTextContents(),
    )));
    // Only the date portion of each already-rendered, authorized card
    // may appear in the read-only proposed cancelled-only list.
    const cancelledFourDates = cancelledOnlyCardDates(
      await savedCounts.allTextContents(), await savedStatuses.allTextContents(),
      await plannedDates.locator(".recurring-visit-date-text time").allTextContents(),
    );
    const cancelledCardLabels = plannedDates.locator(".recurring-visit-card-cancelled-only");
    const selectedCancelledLabel = reviewedDetails.locator(
      ".recurring-visit-selected-cancelled-only",
    );
    const noSavedCardLabels = plannedDates.locator(".recurring-visit-card-no-saved");
    const selectedNoSavedLabel = reviewedDetails.locator(
      ".recurring-visit-selected-no-saved",
    );
    const fourSavedTotals = await savedCounts.allTextContents();
    const fourDateValues = await plannedDates.locator(".recurring-visit-date-text time")
      .allTextContents();
    const fourNoSavedDates = fourDateValues.filter((_, index) =>
      /^Already saved: 0 non-archived/.test(fourSavedTotals[index]),
    );
    await expect(noSavedCardLabels).toHaveCount(fourNoSavedDates.length);
    for (const row of await plannedDates.all()) {
      const rowDate = await row.locator(".recurring-visit-date-text time").innerText();
      await expect(row.locator(".recurring-visit-card-no-saved")).toHaveCount(
        fourNoSavedDates.includes(rowDate) ? 1 : 0,
      );
    }
    if (fourNoSavedDates.length > 0) {
      await expect(noSavedCardLabels.first()).toContainText(
        "NOT BOOKED by this proposal; availability not confirmed",
      );
    }
    await expect(selectedNoSavedLabel).toHaveCount(
      fourNoSavedDates.includes("2026-11-06") ? 1 : 0,
    );
    if (fourNoSavedDates.includes("2026-11-06")) {
      await expect(selectedNoSavedLabel).toContainText(
        "staff or equipment availability is not confirmed",
      );
    }
    // Empty and cancelled-only are mutually exclusive classifications.
    for (const row of await plannedDates.all()) {
      expect(await row.locator(".recurring-visit-card-no-saved").count() +
        await row.locator(".recurring-visit-card-cancelled-only").count())
        .toBeLessThanOrEqual(1);
    }
    // The optional no-saved list must match these very same fictional
    // organization's four date cards (never infer actual availability).
    if (fourNoSavedDates.length === 0) {
      await expect(noSavedListToggle).toBeDisabled();
      await expect(noSavedList).toHaveCount(0);
    } else {
      await expect(noSavedListToggle).toHaveText(
        `Show proposed dates without saved appointments (${fourNoSavedDates.length})`,
      );
      await noSavedListToggle.click();
      await expect(noSavedListToggle).toHaveAttribute("aria-expanded", "true");
      await expect(noSavedListPanel).toContainText("NOT BOOKED");
      await expect(noSavedListPanel).toContainText("availability has not been checked");
      await expect(noSavedList.locator("time")).toHaveCount(fourNoSavedDates.length);
      expect(await noSavedList.locator("time").evaluateAll((nodes) =>
        nodes.map((node) => node.getAttribute("datetime")),
      )).toEqual(fourNoSavedDates);
      await expect(noSavedList.locator(".recurring-visit-no-saved-position"))
        .toHaveText(fourNoSavedDates.map((d) =>
          `Proposed visit ${fourDateValues.indexOf(d) + 1} of 4`,
        ));
      const currentNoSaved = noSavedList.locator('li[aria-current="date"]');
      await expect(currentNoSaved).toHaveCount(
        fourNoSavedDates.includes("2026-11-06") ? 1 : 0,
      );
      if (fourNoSavedDates.includes("2026-11-06")) {
        await expect(currentNoSaved).toContainText("Currently reviewing");
      }
      const otherDate = fourNoSavedDates.find((d) => d !== "2026-11-06");
      if (otherDate) {
        await noSavedList.getByRole("button", {
          name: "Review proposed date without saved appointments " + otherDate,
          exact: true,
        }).click();
        await expect(page.getByLabel("Schedule date", { exact: true }))
          .toHaveValue(otherDate);
        await expect(currentNoSaved).toContainText("Currently reviewing");
        await expect(currentNoSaved.locator("time"))
          .toHaveAttribute("datetime", otherDate);
        await expect(currentNoSaved.getByRole("button", {
          name: "Review proposed date without saved appointments " + otherDate,
          exact: true,
        })).toBeDisabled();
        await planner.getByLabel("Jump to planned visit", { exact: true })
          .selectOption("2026-11-06");
      }
      await noSavedListToggle.click();
      await expect(noSavedList).toHaveCount(0);
      await expect(noSavedListToggle).toHaveAttribute("aria-expanded", "false");
    }
    await expect(cancelledCardLabels).toHaveCount(cancelledFourDates.length);
    for (const [index, row] of (await plannedDates.all()).entries()) {
      const dateOnCard = await row.locator(".recurring-visit-date-text time").innerText();
      await expect(row.locator(".recurring-visit-card-cancelled-only")).toHaveCount(
        cancelledFourDates.includes(dateOnCard) ? 1 : 0,
      );
    }
    if (cancelledFourDates.length > 0) {
      await expect(cancelledCardLabels.first()).toContainText(
        "NOT BOOKED by this proposal; availability not confirmed",
      );
    }
    await expect(selectedCancelledLabel).toHaveCount(
      cancelledFourDates.includes("2026-11-06") ? 1 : 0,
    );
    if (cancelledFourDates.includes("2026-11-06")) {
      await expect(selectedCancelledLabel).toContainText(
        "This proposed visit is NOT BOOKED",
      );
    }
    if (cancelledFourDates.length === 0) {
      await expect(cancelledListToggle).toBeDisabled();
      await expect(cancelledList).toHaveCount(0);
    } else {
      await expect(cancelledListToggle).toBeEnabled();
      await expect(cancelledListToggle).toHaveText(
        `Show cancelled-only proposed dates (${cancelledFourDates.length})`,
      );
      await cancelledListToggle.click();
      await expect(cancelledListToggle).toHaveAttribute("aria-expanded", "true");
      await expect(cancelledList.locator("time")).toHaveCount(cancelledFourDates.length);
      expect(await cancelledList.locator("time").evaluateAll((nodes) =>
        nodes.map((node) => node.getAttribute("datetime")),
      )).toEqual(cancelledFourDates);
      const allFourDates = await plannedDates.locator(".recurring-visit-date-text time")
        .allTextContents();
      await expect(cancelledList.locator(".recurring-visit-cancelled-position"))
        .toHaveText(cancelledFourDates.map((value) =>
          `Proposed visit ${allFourDates.indexOf(value) + 1} of 4`,
        ));
      // The currently reviewed date (if in the filtered list) is the
      // sole selected row, with a visible and accessible state label.
      const currentCancelledRows = cancelledList.locator('li[aria-current="date"]');
      await expect(currentCancelledRows).toHaveCount(
        cancelledFourDates.includes("2026-11-06") ? 1 : 0,
      );
      if (cancelledFourDates.includes("2026-11-06")) {
        await expect(currentCancelledRows).toContainText("Currently reviewing");
        await expect(currentCancelledRows.getByRole("button", {
          name: "Review cancelled-only proposed date 2026-11-06",
          exact: true,
        })).toBeDisabled();
      }
      const reviewCandidate = cancelledFourDates.find((value) => value !== "2026-11-06");
      if (reviewCandidate) {
        await cancelledList.getByRole("button", {
          name: "Review cancelled-only proposed date " + reviewCandidate,
          exact: true,
        }).click();
        await expect(page.getByLabel("Schedule date", { exact: true }))
          .toHaveValue(reviewCandidate);
        await expect(selectedCancelledLabel).toContainText(
          "This proposed visit is NOT BOOKED",
        );
        await expect(currentCancelledRows).toHaveCount(1);
        await expect(currentCancelledRows).toContainText("Currently reviewing");
        await expect(currentCancelledRows.locator("time"))
          .toHaveAttribute("datetime", reviewCandidate);
        await expect(currentCancelledRows.getByRole("button", {
          name: "Review cancelled-only proposed date " + reviewCandidate,
          exact: true,
        })).toBeDisabled();
        await planner.getByLabel("Jump to planned visit", { exact: true })
          .selectOption("2026-11-06");
        await expect(selectedCancelledLabel).toHaveCount(
          cancelledFourDates.includes("2026-11-06") ? 1 : 0,
        );
        await expect(currentCancelledRows).toHaveCount(
          cancelledFourDates.includes("2026-11-06") ? 1 : 0,
        );
      } else {
        await expect(cancelledList.getByRole("button", {
          name: "Review cancelled-only proposed date 2026-11-06",
          exact: true,
        })).toBeDisabled();
      }
      await cancelledListToggle.click();
      await expect(cancelledList).toHaveCount(0);
      await expect(cancelledListToggle).toHaveAttribute("aria-expanded", "false");
    }
    // A normal agenda review changes only the focused no-saved explanation,
    // never the original recurring preview anchor or saved appointments.
    const otherEmptyDate = fourNoSavedDates.find((d) => d !== "2026-11-06");
    if (otherEmptyDate) {
      await planner.getByLabel("Jump to planned visit", { exact: true })
        .selectOption(otherEmptyDate);
      await expect(selectedNoSavedLabel).toContainText(
        "The proposed visit is NOT BOOKED",
      );
      await expect(selectedCancelledLabel).toHaveCount(0);
      await planner.getByLabel("Jump to planned visit", { exact: true })
        .selectOption("2026-11-06");
      await expect(selectedNoSavedLabel).toHaveCount(
        fourNoSavedDates.includes("2026-11-06") ? 1 : 0,
      );
    }
    await expect(reviewedDetails.locator(".recurring-visit-selected-count"))
      .toContainText("Saved on this date:");
    await expect(reviewedDetails.locator(".recurring-visit-selected-statuses"))
      .toHaveText(await savedStatuses.first().innerText());
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
    const initialSavedDateRows = (await savedCounts.allTextContents())
      .filter((text) => /^Already saved: [1-9]\d* non-archived/.test(text)).length;
    await expect(withSaved).toHaveText(String(initialSavedDateRows));
    await expect(withoutSaved).toHaveText(String(4 - initialSavedDateRows));
    await expect(coverage).toContainText("of 4 proposed dates");
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
    const sixSavedDateRows = (await savedCounts.allTextContents())
      .filter((text) => /^Already saved: [1-9]\d* non-archived/.test(text)).length;
    await expect(withSaved).toHaveText(String(sixSavedDateRows));
    await expect(withoutSaved).toHaveText(String(6 - sixSavedDateRows));
    await expect(noSavedCardLabels).toHaveCount(6 - sixSavedDateRows);
    await expect(noSavedListToggle).toHaveAttribute("aria-expanded", "false");
    await expect(noSavedList).toHaveCount(0);
    const sixNoSavedDates = (await savedCounts.allTextContents())
      .filter((text) => /^Already saved: 0 non-archived/.test(text)).length;
    expect(sixNoSavedDates).toBe(6 - sixSavedDateRows);
    await expect(selectedNoSavedLabel).toHaveCount(
      /^Already saved: 0 non-archived/.test((await savedCounts.first().textContent()) ?? "")
        ? 1 : 0,
    );
    await expect(cancelledOnly).toHaveText(String(cancelledOnlyCardCount(
      await savedCounts.allTextContents(), await savedStatuses.allTextContents(),
    )));
    await expect(cancelledCardLabels).toHaveCount(
      cancelledOnlyCardCount(
        await savedCounts.allTextContents(), await savedStatuses.allTextContents(),
      ),
    );
    await expect(selectedCancelledLabel).toHaveCount(
      cancelledOnlyCardDates(
        await savedCounts.allTextContents(), await savedStatuses.allTextContents(),
        await plannedDates.locator(".recurring-visit-date-text time").allTextContents(),
      ).includes("2026-11-06") ? 1 : 0,
    );
    await expect(cancelledListToggle).toHaveAttribute("aria-expanded", "false");
    await expect(cancelledList).toHaveCount(0);
    await expect(coverage).toContainText("of 6 proposed dates");
    // Verify the coverage shortcuts with real seeded saved-row counts,
    // not assumptions about which fictional dates already contain data.
    // Both shortcuts are strictly read-only and must not re-anchor
    // the original four-week proposal.
    const savedDateLabels = await savedCounts.allTextContents();
    const proposedDateValues = await visitLabels.allTextContents();
    const savedIndex = savedDateLabels.findIndex((label, index) =>
      index > 0 && /^Already saved: [1-9]\d* non-archived/.test(label),
    );
    const withoutIndex = savedDateLabels.findIndex((label, index) =>
      index > 0 && /^Already saved: 0 non-archived/.test(label),
    );
    for (const [shortcut, index] of [
      [reviewNextWithSaved, savedIndex],
      [reviewNextWithoutSaved, withoutIndex],
    ] as const) {
      if (index < 0) {
        await expect(shortcut).toBeDisabled();
      } else {
        await expect(shortcut).toBeEnabled();
        const expectedDate = proposedDateValues[index].split(": ")[1];
        await shortcut.click();
        await expect(page.getByLabel("Schedule date", { exact: true }))
          .toHaveValue(expectedDate);
        await expect(planner.locator(".recurring-visit-review-state"))
          .toContainText(`planned visit ${index + 1} of 6: ${expectedDate}`);
        await planner.getByLabel("Jump to planned visit", { exact: true })
          .selectOption("2026-11-06");
        await expect(page.getByLabel("Schedule date", { exact: true }))
          .toHaveValue("2026-11-06");
      }
      expect(await visitLabels.allTextContents()).toEqual(proposedDateValues);
    }
    // The last visit has no strictly later proposed date in either
    // group; the buttons must not silently loop back to the first.
    await planner.getByLabel("Jump to planned visit", { exact: true })
      .selectOption("2027-03-26");
    await expect(reviewNextWithSaved).toBeDisabled();
    await expect(reviewNextWithoutSaved).toBeDisabled();
    // Backward review uses the same already-rendered, authorized saved
    // date rows and picks the nearest strictly earlier matching date.
    // Exclude the final index: a button must never review the current day.
    for (const [shortcut, isSaved] of [
      [reviewPreviousWithSaved, true],
      [reviewPreviousWithoutSaved, false],
    ] as const) {
      const matchingIndexes = savedDateLabels.flatMap((label, index) =>
        index < 5 && (isSaved
          ? /^Already saved: [1-9]\d* non-archived/.test(label)
          : /^Already saved: 0 non-archived/.test(label))
          ? [index] : [],
      );
      const previousIndex = matchingIndexes.at(-1);
      if (previousIndex === undefined) {
        await expect(shortcut).toBeDisabled();
      } else {
        await expect(shortcut).toBeEnabled();
        const expectedDate = proposedDateValues[previousIndex].split(": ")[1];
        await shortcut.click();
        await expect(page.getByLabel("Schedule date", { exact: true }))
          .toHaveValue(expectedDate);
        await expect(planner.locator(".recurring-visit-review-state"))
          .toContainText(`planned visit ${previousIndex + 1} of 6: ${expectedDate}`);
        await planner.getByLabel("Jump to planned visit", { exact: true })
          .selectOption("2027-03-26");
      }
      expect(await visitLabels.allTextContents()).toEqual(proposedDateValues);
    }
    // At the first proposal date no earlier match exists, regardless
    // of whether the saved-record status is positive or zero.
    await planner.getByLabel("Jump to planned visit", { exact: true })
      .selectOption("2026-11-06");
    await expect(reviewPreviousWithSaved).toBeDisabled();
    await expect(reviewPreviousWithoutSaved).toBeDisabled();
    await expect(weekdays).toHaveText(Array.from({ length: 6 }, () => "Friday"));
    await expect(overview.locator("dd")).toHaveText([
      "6", "6", "0",
      "Friday 2026-11-06", "Friday 2027-03-26", "20 calendar weeks",
    ]);
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
    // Export saved DATE and STATUS COUNTS only; verify that exported rows
    // match the same authorized organization-scoped cards already on screen.
    const [statusDownload] = await Promise.all([
      page.waitForEvent("download"), statusExportButton.click(),
    ]);
    expect(statusDownload.suggestedFilename()).toBe(
      "lms-visit-saved-date-review-2026-11-06-NOT-BOOKED.csv",
    );
    const savedStatusCsv = await readFile(await statusDownload.path(), "utf8");
    const statusCsvRows = savedStatusCsv.trimEnd().split("\r\n");
    expect(statusCsvRows).toHaveLength(7);
    expect(statusCsvRows[0]).toBe(
      "Visit,Proposed date,Existing non-archived saved appointments,Scheduled,In progress,Completed,Cancelled,Other,Saved-date classification,Note",
    );
    const savedCardTotals = await savedCounts.allTextContents();
    const savedCardStatuses = await savedStatuses.allTextContents();
    const savedCardDates = await plannedDates.locator(
      ".recurring-visit-date-text time",
    ).allTextContents();
    for (let index = 0; index < savedCardDates.length; index++) {
      const parts = statusCsvRows[index + 1].split(",");
      expect(parts).toHaveLength(10);
      const fromSavedCard = savedCardTotals[index].match(/Already saved: (\d+)/)?.[1];
      expect(fromSavedCard).toBeDefined();
      const countStatus = (name: string) => savedCardStatuses[index]
        .match(new RegExp(name + " (\\d+)"))?.[1] ?? "0";
      expect(parts.slice(0, 8)).toEqual([
        String(index + 1), savedCardDates[index], fromSavedCard,
        countStatus("Scheduled"), countStatus("In progress"),
        countStatus("Completed"), countStatus("Cancelled"),
        countStatus("Other"),
      ]);
      const classification = Number(fromSavedCard) === 0
        ? "No saved appointment records"
        : fromSavedCard === countStatus("Cancelled")
          ? "Cancelled-only saved records"
          : "Has non-cancelled saved records";
      expect(parts[8]).toBe(classification);
      expect(parts[9]).toBe("Proposal only - NOT BOOKED - availability not confirmed");
    }
    expect(savedStatusCsv).not.toContain(customer);
    expect(savedStatusCsv).not.toContain(work);
    expect(savedStatusCsv).not.toContain(resource);
    expect(savedStatusCsv).not.toContain("2026-11-06T");
    // HTML textarea inputValue normalizes CRLF to LF, but the underlying
    // CSV formatter/download/copy preserves CRLF byte-for-byte.
    await savedCsvPreviewToggle.click();
    await expect(savedCsvPreviewToggle).toHaveAttribute("aria-expanded", "true");
    await expect(savedCsvPreviewTextarea).toHaveValue(
      savedStatusCsv.replace(/\r\n/g, "\n"),
    );
    expect(await savedCsvPreviewTextarea.inputValue()).not.toContain(customer);
    expect(await savedCsvPreviewTextarea.inputValue()).not.toContain(work);
    expect(await savedCsvPreviewTextarea.inputValue()).not.toContain(resource);
    await expect(planner.locator(".recurring-visit-full-csv-preview"))
      .toContainText("No visits are booked and availability is");
    const selectedRowsButton = planner.getByRole("button", {
      name: "Copy selected review rows", exact: true,
    });
    await expect(selectedRowsButton).toBeVisible();
    const selectedReviewDownloadButton = planner.getByRole("button", {
      name: "Download selected review rows", exact: true,
    });
    await expect(selectedReviewDownloadButton).toBeDisabled();
    const selectedVisitPrintButton = planner.getByRole("button", {
      name: "Print selected review rows", exact: true,
    });
    await expect(selectedVisitPrintButton).toBeDisabled();
    const reviewSelectionCounter = planner.getByText(/^\d+ of \d+ visit rows selected$/);
    const clearReviewSelectionButton = planner.getByRole("button", {
      name: "Clear selection", exact: true,
    });
    const reviewRowTotal = savedStatusCsv.trimEnd().split("\r\n").length - 1;
    await expect(reviewSelectionCounter).toHaveText(`0 of ${reviewRowTotal} visit rows selected`);
    await selectedRowsButton.click();
    await expect(planner.getByRole("status").filter({
      hasText: "Select text within one or more visit rows first.",
    })).toBeVisible();
    // Select only the second proposal row, without selecting headers or notes.
    await savedCsvPreviewTextarea.evaluate((element: HTMLTextAreaElement) => {
      const lines = element.value.split("\n");
      const secondRowStart = lines[0].length + 1 + lines[1].length + 1;
      element.focus();
      element.setSelectionRange(secondRowStart + 2, secondRowStart + 7);
    });
    // Exercise keyboard selection as well as the select-all button.
    await savedCsvPreviewTextarea.press("Shift+ArrowRight");
    await expect(reviewSelectionCounter).toHaveText(`1 of ${reviewRowTotal} visit rows selected`);
    await page.evaluate(() => {
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: { writeText: async (value: string) => {
          (window as typeof window & { __selectedReviewRows?: string }).__selectedReviewRows = value;
        } },
      });
    });
    await selectedRowsButton.click();
    await expect(planner.getByRole("status").filter({
      hasText: "Selected review rows copied with column headers.",
    })).toBeVisible();
    const selectedCopy = await page.evaluate(() =>
      (window as typeof window & { __selectedReviewRows?: string }).__selectedReviewRows,
    );
    expect(selectedCopy).toContain(savedStatusCsv.split("\r\n")[0]);
    expect(selectedCopy).toContain(savedStatusCsv.split("\r\n")[2]);
    expect(selectedCopy).not.toContain(savedStatusCsv.split("\r\n")[1] + "\r\n");
    expect(selectedCopy).not.toContain(customer);
    expect(selectedCopy).not.toContain(work);
    expect(selectedCopy).not.toContain(resource);
    const [singleSelectedReviewDownload] = await Promise.all([
      page.waitForEvent("download"), selectedReviewDownloadButton.click(),
    ]);
    expect(singleSelectedReviewDownload.suggestedFilename()).toBe(
      "lms-selected-visit-review-2026-11-06-NOT-BOOKED.csv",
    );
    expect(await readFile(await singleSelectedReviewDownload.path(), "utf8")).toBe(selectedCopy);
    const [selectedVisitReportPage] = await Promise.all([
      page.context().waitForEvent("page"), selectedVisitPrintButton.click(),
    ]);
    await expect(selectedVisitReportPage.getByRole("heading", {
      name: "LMS selected visit review — NOT BOOKED",
    })).toBeVisible();
    await expect(selectedVisitReportPage.locator("tbody tr")).toHaveCount(1);
    expect(await selectedVisitReportPage.locator("thead th").allTextContents())
      .toEqual(statusCsvRows[0].split(","));
    expect(await selectedVisitReportPage.locator("tbody tr").first().locator("td").allTextContents())
      .toEqual(statusCsvRows[2].split(","));
    const selectedVisitReportContent = await selectedVisitReportPage.locator("body").innerText();
    expect(selectedVisitReportContent).not.toContain(customer);
    expect(selectedVisitReportContent).not.toContain(work);
    expect(selectedVisitReportContent).not.toContain(resource);
    expect(selectedVisitReportContent).toContain("No visits are booked or confirmed.");
    const selectedPrintSummary = selectedVisitReportPage.getByRole("region", { name: "Selected dates summary" });
    const selectedPrintCells = statusCsvRows[2].split(",");
    await expect(selectedPrintSummary.locator("dd")).toHaveText([
      "1", ...selectedPrintCells.slice(2, 8),
      selectedPrintCells[2] === "0" ? "1" : "0",
      selectedPrintCells[2] !== "0" && selectedPrintCells[2] === selectedPrintCells[6] ? "1" : "0",
    ]);
    await expect(selectedPrintSummary).toContainText("not unique appointments");
    await expect(selectedPrintSummary).toContainText("Zero saved records does not establish availability.");
    const printChartExpectedValues = (counts: string[]) => counts.slice(1).map((count) =>
      count + " (" + (Number(counts[0]) === 0 ? "0.0" :
        (Math.round(Number(count) / Number(counts[0]) * 1000) / 10).toFixed(1)) + "%)",
    );
    const selectedPrintChart = selectedVisitReportPage.getByRole("region", {
      name: "Saved appointment status breakdown",
    });
    await expect(selectedPrintChart.locator(".status-chart-value")).toHaveText(
      printChartExpectedValues(selectedPrintCells.slice(2, 8)),
    );
    await expect(selectedPrintChart.locator('svg[aria-hidden="true"]')).toHaveCount(5);
    await selectedVisitReportPage.evaluate(() => {
      window.print = () => { document.documentElement.dataset.printInvoked = "yes"; };
    });
    await selectedVisitReportPage.getByRole("button", { name: "Print report", exact: true }).click();
    await expect(selectedVisitReportPage.locator("html")).toHaveAttribute("data-print-invoked", "yes");
    await selectedVisitReportPage.close();
    // One tap selects all proposal visit rows without the CSV column header.
    const selectAllRowsButton = planner.getByRole("button", {
      name: "Select all visit rows", exact: true,
    });
    await selectAllRowsButton.click();
    await expect(reviewSelectionCounter).toHaveText(
      `${reviewRowTotal} of ${reviewRowTotal} visit rows selected`,
    );
    const allVisitRowsSelectedText = await savedCsvPreviewTextarea.evaluate(
      (element: HTMLTextAreaElement) =>
        element.value.substring(element.selectionStart, element.selectionEnd),
    );
    const originalLines = savedStatusCsv.replace(/\r\n/g, "\n").trimEnd().split("\n");
    expect(allVisitRowsSelectedText).toBe(originalLines.slice(1).join("\n"));
    expect(allVisitRowsSelectedText).not.toContain(originalLines[0]);
    await selectedRowsButton.click();
    await expect(planner.getByRole("status").filter({
      hasText: "Selected review rows copied with column headers.",
    })).toBeVisible();
    const allRowsCopied = await page.evaluate(() =>
      (window as typeof window & { __selectedReviewRows?: string }).__selectedReviewRows,
    );
    expect(allRowsCopied).toBe(savedStatusCsv);
    expect(allRowsCopied).not.toContain(customer);
    expect(allRowsCopied).not.toContain(work);
    expect(allRowsCopied).not.toContain(resource);
    const selectedPrintLayoutChoice = planner.getByLabel("Print report layout", { exact: true });
    await expect(selectedPrintLayoutChoice).toHaveValue("full");
    const selectedPrintOrientationChoice = planner.getByLabel("Print paper orientation", { exact: true });
    await expect(selectedPrintOrientationChoice).toHaveValue("landscape");
    const printAnnotationToggle = planner.getByText("Optional print report title and notes", { exact: true });
    const printCustomTitleInput = planner.getByLabel("Custom report title (optional)", { exact: true });
    const printCustomNotesInput = planner.getByLabel("Manager's planning notes (optional)", { exact: true });
    await printAnnotationToggle.click();
    await expect(printCustomTitleInput).toHaveValue("");
    await expect(printCustomNotesInput).toHaveValue("");
    await printCustomTitleInput.fill("Weekly planning <review>");
    await printCustomNotesInput.fill("Review coverage first.\n<img src=x onerror=alert(1)>");
    await selectedRowsButton.click();
    await expect.poll(() => page.evaluate(() =>
      (window as typeof window & { __selectedReviewRows?: string }).__selectedReviewRows,
    )).toBe(savedStatusCsv);
    const [allSelectedPrintReport] = await Promise.all([
      page.context().waitForEvent("page"), selectedVisitPrintButton.click(),
    ]);
    await expect(allSelectedPrintReport.getByRole("heading", { name: "LMS selected visit review — NOT BOOKED" })).toBeVisible();
    await expect(allSelectedPrintReport.getByRole("heading", { name: "Weekly planning <review>", exact: true })).toBeVisible();
    const printAnnotations = allSelectedPrintReport.locator(".report-annotations");
    await expect(printAnnotations.locator("p")).toHaveText("Review coverage first.\n<img src=x onerror=alert(1)>");
    await expect(printAnnotations.locator("img")).toHaveCount(0);
    const allPrintSummary = allSelectedPrintReport.getByRole("region", { name: "Selected dates summary" });
    const allPrintCells = statusCsvRows.slice(1).map((line) => line.split(","));
    const allPrintTotals = [2, 3, 4, 5, 6, 7].map((column) =>
      String(allPrintCells.reduce((total, cells) => total + Number(cells[column]), 0)),
    );
    await expect(allPrintSummary.locator("dd")).toHaveText([
      String(allPrintCells.length), ...allPrintTotals,
      String(allPrintCells.filter((cells) => cells[2] === "0").length),
      String(allPrintCells.filter((cells) => cells[2] !== "0" && cells[2] === cells[6]).length),
    ]);
    await expect(allSelectedPrintReport.locator("tbody tr")).toHaveCount(allPrintCells.length);
    const allPrintChart = allSelectedPrintReport.getByRole("region", {
      name: "Saved appointment status breakdown",
    });
    await expect(allPrintChart.locator(".status-chart-value")).toHaveText(
      printChartExpectedValues(allPrintTotals),
    );
    const allPrintBarWidths = await allPrintChart.locator("svg rect:last-child").evaluateAll(
      (bars) => bars.map((bar) => Number(bar.getAttribute("width"))),
    );
    expect(allPrintBarWidths).toHaveLength(5);
    allPrintBarWidths.forEach((width, index) => {
      const tenths = Number(allPrintTotals[0]) === 0 ? 0 :
        Math.round(Number(allPrintTotals[index + 1]) / Number(allPrintTotals[0]) * 1000);
      expect(width).toBeCloseTo(tenths * 0.998, 5);
    });
    await expect(allSelectedPrintReport.getByText("Requested paper orientation: Landscape", { exact: true })).toBeVisible();
    expect(await allSelectedPrintReport.locator("style").textContent()).toContain("@page { size: landscape;");
    await allSelectedPrintReport.close();
    await selectedPrintOrientationChoice.selectOption("portrait");
    for (const layoutCase of [
      { value: "summary", label: "Summary and charts only", summary: true, details: false },
      { value: "details", label: "Detailed visit table only", summary: false, details: true },
    ]) {
      await selectedPrintLayoutChoice.selectOption(layoutCase.value);
      const [layoutReportPage] = await Promise.all([
        page.context().waitForEvent("page"), selectedVisitPrintButton.click(),
      ]);
      await expect(layoutReportPage.getByRole("heading", { name: "LMS selected visit review — NOT BOOKED" })).toBeVisible();
      await expect(layoutReportPage.getByText("Report layout: " + layoutCase.label, { exact: true })).toBeVisible();
      await expect(layoutReportPage.getByText("Requested paper orientation: Portrait", { exact: true })).toBeVisible();
      expect(await layoutReportPage.locator("style").textContent()).toContain("@page { size: portrait;");
      expect(await layoutReportPage.locator("style").textContent()).toContain("table-layout: fixed");

      await expect(layoutReportPage.getByText("Planning report only.", { exact: false })).toBeVisible();
      await expect(layoutReportPage.getByRole("heading", { name: "Weekly planning <review>", exact: true })).toBeVisible();
      await expect(layoutReportPage.locator(".report-summary")).toHaveCount(layoutCase.summary ? 1 : 0);
      await expect(layoutReportPage.locator(".report-status-chart")).toHaveCount(layoutCase.summary ? 1 : 0);
      await expect(layoutReportPage.locator("tbody tr")).toHaveCount(layoutCase.details ? allPrintCells.length : 0);
      await expect(layoutReportPage.getByRole("button", { name: "Print report", exact: true })).toBeVisible();
      await layoutReportPage.close();
    }
    await selectedPrintLayoutChoice.selectOption("full");
    await selectedPrintOrientationChoice.selectOption("landscape");
    await planner.getByRole("button", { name: "Clear print title and notes", exact: true }).click();
    await expect(printCustomTitleInput).toHaveValue("");
    await expect(printCustomNotesInput).toHaveValue("");
    // Status selection can include non-adjacent dates; copy must preserve
    // original visit numbering and must not include intervening rows.
    const reviewStatusSelectionGroup = planner.getByRole("group", {
      name: "Select visit rows by saved status",
    });
    for (const reviewStatusCase of [
      { label: "With saved appointments", matches: (cells: string[]) => Number(cells[2]) > 0 },
      { label: "No saved appointments", matches: (cells: string[]) => Number(cells[2]) === 0 },
      { label: "Cancelled-only appointments", matches: (cells: string[]) =>
        Number(cells[2]) > 0 && cells[2] === cells[6] },
    ]) {
      const reviewStatusButton = reviewStatusSelectionGroup.getByRole("button", {
        name: reviewStatusCase.label, exact: true,
      });
      const matchingReviewCsvRows = statusCsvRows.slice(1).filter(
        (line) => reviewStatusCase.matches(line.split(",")),
      );
      await reviewStatusButton.click();
      await expect(reviewStatusButton).toHaveAttribute("aria-pressed", "true");
      await expect(reviewSelectionCounter).toHaveText(
        `${matchingReviewCsvRows.length} of ${reviewRowTotal} visit rows selected`,
      );
      expect(await savedCsvPreviewTextarea.inputValue()).toBe(
        savedStatusCsv.replace(/\r\n/g, "\n"),
      );
      const clipboardBeforeStatusCopy = await page.evaluate(() =>
        (window as typeof window & { __selectedReviewRows?: string }).__selectedReviewRows,
      );
      await selectedRowsButton.click();
      if (matchingReviewCsvRows.length) {
        await expect(selectedReviewDownloadButton).toBeEnabled();
        if (reviewStatusCase.label === "No saved appointments") {
          const [zeroSavedPrintReport] = await Promise.all([
            page.context().waitForEvent("page"), selectedVisitPrintButton.click(),
          ]);
          const zeroSavedPrintChart = zeroSavedPrintReport.getByRole("region", {
            name: "Saved appointment status breakdown",
          });
          await expect(zeroSavedPrintChart).toContainText(
            "No saved appointment date overlaps in the selected rows. This does not establish availability.",
          );
          await expect(zeroSavedPrintChart.locator(".status-chart-value")).toHaveText(
            Array(5).fill("0 (0.0%)"),
          );
          await zeroSavedPrintReport.close();
        }
        const [statusSelectedReviewDownload] = await Promise.all([
          page.waitForEvent("download"), selectedReviewDownloadButton.click(),
        ]);
        expect(await readFile(await statusSelectedReviewDownload.path(), "utf8")).toBe(
          [statusCsvRows[0], ...matchingReviewCsvRows].join("\r\n") + "\r\n",
        );
        await expect(planner.getByRole("status").filter({
          hasText: "Selected review rows copied with column headers.",
        })).toBeVisible();
        expect(await page.evaluate(() =>
          (window as typeof window & { __selectedReviewRows?: string }).__selectedReviewRows,
        )).toBe([statusCsvRows[0], ...matchingReviewCsvRows].join("\r\n") + "\r\n");
      } else {
        await expect(selectedReviewDownloadButton).toBeDisabled();
        await expect(selectedVisitPrintButton).toBeDisabled();
        await expect(planner.getByRole("status").filter({
          hasText: "No matching visit rows to copy.",
        })).toBeVisible();
        expect(await page.evaluate(() =>
          (window as typeof window & { __selectedReviewRows?: string }).__selectedReviewRows,
        )).toBe(clipboardBeforeStatusCopy);
      }
    }
    // Select-all leaves the status mode and restores all original rows.
    await selectAllRowsButton.click();
    await expect(reviewStatusSelectionGroup.locator('[aria-pressed="true"]')).toHaveCount(0);
    await expect(reviewSelectionCounter).toHaveText(
      `${reviewRowTotal} of ${reviewRowTotal} visit rows selected`,
    );
    await selectedRowsButton.click();
    await expect(planner.getByRole("status").filter({
      hasText: "Selected review rows copied with column headers.",
    })).toBeVisible();
    expect(await page.evaluate(() =>
      (window as typeof window & { __selectedReviewRows?: string }).__selectedReviewRows,
    )).toBe(savedStatusCsv);
    await clearReviewSelectionButton.click();
    await expect(selectedVisitPrintButton).toBeDisabled();
    await expect(selectedReviewDownloadButton).toBeDisabled();
    await expect(reviewSelectionCounter).toHaveText(`0 of ${reviewRowTotal} visit rows selected`);
    expect(await savedCsvPreviewTextarea.evaluate((element: HTMLTextAreaElement) =>
      element.selectionStart === element.selectionEnd,
    )).toBe(true);
    await selectedRowsButton.click();
    await expect(planner.getByRole("status").filter({
      hasText: "Select text within one or more visit rows first.",
    })).toBeVisible();
    expect(await page.evaluate(() =>
      (window as typeof window & { __selectedReviewRows?: string }).__selectedReviewRows,
    )).toBe(savedStatusCsv);
    await selectAllRowsButton.click();
    await selectedPrintLayoutChoice.selectOption("details");
    await selectedPrintOrientationChoice.selectOption("portrait");
    await printCustomTitleInput.fill("Temporary planning");
    await printCustomNotesInput.fill("Discard on close");
    await savedCsvPreviewToggle.click();
    await expect(savedCsvPreviewToggle).toHaveAttribute("aria-expanded", "false");
    await expect(savedCsvPreviewTextarea).toHaveCount(0);
    await savedCsvPreviewToggle.click();
    await expect(reviewSelectionCounter).toHaveText(`0 of ${reviewRowTotal} visit rows selected`);
    await expect(selectedPrintLayoutChoice).toHaveValue("full");
    await expect(selectedPrintOrientationChoice).toHaveValue("landscape");
    await printAnnotationToggle.click();
    await expect(printCustomTitleInput).toHaveValue("");
    await expect(printCustomNotesInput).toHaveValue("");
    await savedCsvPreviewToggle.click();
    // Copy is the same validated count CSV, including CRLF, header and
    // NOT BOOKED label, without an additional test/demo session.
    await page.evaluate(() => {
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: { writeText: async (text: string) => {
          document.documentElement.dataset.savedReviewCsvClipboard = text;
        } },
      });
    });
    await savedCsvCopyButton.click();
    await expect(savedCsvCopyFeedback).toHaveText(
      "Saved-date review CSV copied. No visits were booked or confirmed.",
    );
    expect(await page.evaluate(() =>
      document.documentElement.dataset.savedReviewCsvClipboard ?? "",
    )).toBe(savedStatusCsv);
    await expect(planner.locator(".recurring-visit-copy-feedback")).toHaveCount(0);
    await page.evaluate(() => {
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: { writeText: async () => { throw new Error("Denied"); } },
      });
    });
    await savedCsvCopyButton.click();
    await expect(savedCsvCopyFeedback).toContainText(
      "Could not copy saved-date review CSV. Clipboard access may be blocked",
    );
    await expect(savedCsvCopyFeedback).toContainText(
      "Download saved-date review CSV instead",
    );
    // Stub the browser clipboard transport in THIS existing session:
    // assert exactly what would be copied without requiring the runner
    // to grant clipboard permissions, and never create an extra demo.
    await page.evaluate(() => {
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          writeText: async (text: string) => {
            document.documentElement.dataset.previewCopiedText = text;
          },
        },
      });
    });
    await copyButton.click();
    const copyFeedback = planner.locator(".recurring-visit-copy-feedback");
    await expect(copyFeedback)
      .toHaveText("Proposed dates copied. Nothing was booked or reserved.");
    const copiedText = await page.evaluate(
      () => document.documentElement.dataset.previewCopiedText ?? "",
    );
    expect(copiedText).toContain(
      "LMS proposed recurring visit dates - NOT BOOKED",
    );
    expect(copiedText).toContain(
      "2. Friday, 2026-12-04 - proposed only",
    );
    expect(copiedText.split("\n")).toHaveLength(10);
    expect(copiedText).not.toContain(customer);
    expect(copiedText).not.toContain(work);
    expect(copiedText).not.toContain(resource);
    // Denied permissions must not falsely show Copy succeeded.
    await page.evaluate(() => {
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          writeText: async () => { throw new Error("Denied"); },
        },
      });
    });
    await copyButton.click();
    await expect(copyFeedback)
      .toContainText("Could not copy dates. Clipboard access may be blocked");
    // Copy feedback is specific to this exact recurrence rule; altering
    // it cannot leave a stale Copied/Failed message on another plan.
    await savedCsvPreviewToggle.click();
    await expect(savedCsvPreviewTextarea).toBeVisible();
    await planner.getByLabel("Repeat visits", { exact: true }).selectOption("2");
    await expect(copyFeedback).toHaveCount(0);
    await expect(savedCsvCopyFeedback).toHaveCount(0);
    await expect(savedCsvPreviewToggle).toHaveAttribute("aria-expanded", "false");
    await expect(savedCsvPreviewTextarea).toHaveCount(0);
    await planner.getByLabel("Repeat visits", { exact: true }).selectOption("4");
    await expect(savedCsvCopyFeedback).toHaveCount(0);
    await expect(savedCsvPreviewToggle).toHaveAttribute("aria-expanded", "false");
    await expect(savedCsvPreviewTextarea).toHaveCount(0);
    const anchoredVisitLabels = await visitLabels.allTextContents();
    const previousPlanned = planner.getByRole("button", {
      name: "Previous planned visit", exact: true,
    });
    const nextPlanned = planner.getByRole("button", {
      name: "Next planned visit", exact: true,
    });
    const firstPlanned = planner.getByRole("button", {
      name: "First planned visit", exact: true,
    });
    const lastPlanned = planner.getByRole("button", {
      name: "Last planned visit", exact: true,
    });
    const jumpToPlanned = planner.getByLabel("Jump to planned visit", { exact: true });
    await expect(jumpToPlanned).toHaveValue("2026-11-06");
    await expect(reviewedDetails).toContainText("Reviewed visit 1 of 6");
    await expect(jumpToPlanned.locator("option")).toHaveCount(7);
    await expect(jumpToPlanned.locator("option").nth(3))
      .toHaveText("Visit 3 — Friday, 2027-01-01");
    // A direct jump reviews the selected agenda day, never mutates
    // the plan's anchor, interval, or any previously saved record.
    await jumpToPlanned.selectOption("2027-01-01");
    await expect(page.getByLabel("Schedule date", { exact: true }))
      .toHaveValue("2027-01-01");
    await expect(reviewedState)
      .toContainText("Currently reviewing planned visit 3 of 6: 2027-01-01");
    await expect(plannedDates.nth(2)).toHaveAttribute("aria-current", "date");
    await expect(reviewedDetails).toContainText("Reviewed visit 3 of 6");
    await expect(reviewedDetails.locator(".recurring-visit-selected-date"))
      .toHaveText("Friday 2027-01-01");
    await expect(reviewedDetails.locator(".recurring-visit-selected-statuses"))
      .toHaveText(await savedStatuses.nth(2).innerText());
    // Single-date copy is entirely distinct from the existing whole-
    // plan CSV/clipboard export; it never copies saved status counts.
    await page.evaluate(() => {
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          writeText: async (text: string) => {
            document.documentElement.dataset.reviewedVisitCopiedText = text;
          },
        },
      });
    });
    await reviewCopyButton.click();
    await expect(reviewedCopyFeedback).toHaveText(
      "Selected proposed visit copied. Nothing was booked.",
    );
    const selectedText = await page.evaluate(
      () => document.documentElement.dataset.reviewedVisitCopiedText ?? "",
    );
    expect(selectedText).toBe([
      "LMS proposed visit 3 of 6 - NOT BOOKED",
      "Friday, 2027-01-01 (business-local date; no time)",
      "Planning note only. No appointment, staff or equipment is booked or confirmed.",
    ].join("\n"));
    expect(selectedText).not.toContain(customer);
    expect(selectedText).not.toContain(work);
    expect(selectedText).not.toContain(resource);
    expect(selectedText).not.toContain("Saved on this date:");
    await previewVisitNote.click();
    await expect(selectableNote).toHaveValue(selectedText);
    await expect(selectableNote).toHaveAttribute("readonly", "");
    await expect(previewVisitNote).toHaveCount(0);
    await expect(reviewedDetails.getByRole("button", {
      name: "Hide visit note", exact: true,
    })).toHaveAttribute("aria-expanded", "true");
    await expect(selectableNote).not.toHaveValue(/Saved on this date/);
    expect(await selectableNote.inputValue()).not.toContain(customer);
    expect(await selectableNote.inputValue()).not.toContain(work);
    expect(await selectableNote.inputValue()).not.toContain(resource);
    const [singleDownload] = await Promise.all([
      page.waitForEvent("download"),
      reviewDownloadButton.click(),
    ]);
    expect(singleDownload.suggestedFilename())
      .toBe("lms-proposed-visit-2027-01-01-NOT-BOOKED.txt");
    const downloadedText = await readFile(await singleDownload.path(), "utf8");
    expect(downloadedText).toBe(selectedText + "\n");
    expect(downloadedText).not.toContain(customer);
    expect(downloadedText).not.toContain(work);
    expect(downloadedText).not.toContain(resource);
    expect(downloadedText).not.toContain("Saved on this date");
    expect(downloadedText).not.toContain("2026-12-04");
    // Permission denial must show failure, not a false copied message.
    await page.evaluate(() => {
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          writeText: async () => { throw new Error("Denied"); },
        },
      });
    });
    await reviewCopyButton.click();
    await expect(reviewedCopyFeedback)
      .toContainText("Could not copy selected visit. Clipboard access may be blocked");
    await expect(reviewedCopyFeedback)
      .toContainText("use Download reviewed visit TXT or Preview visit note instead");
    await expect(selectableNote).toHaveValue(selectedText);
    // The download remains available when clipboard copying is denied.
    const [permissionFallback] = await Promise.all([
      page.waitForEvent("download"),
      reviewDownloadButton.click(),
    ]);
    expect(await readFile(await permissionFallback.path(), "utf8"))
      .toBe(selectedText + "\n");
    expect(await page.evaluate(
      () => document.documentElement.dataset.reviewedVisitCopiedText ?? "",
    )).toBe(selectedText);
    expect(await visitLabels.allTextContents()).toEqual(anchoredVisitLabels);
    // An expanded status summary must close on a changed recurrence and
    // must not resurrect if the operator returns to the previous rule.
    await statusPreviewToggle.click();
    await expect(selectableStatusSummary).toBeVisible();
    // When the agenda is not included in the newly selected rule,
    // show a placeholder; do not pick/claim a booked date implicitly.
    await planner.getByLabel("Repeat visits", { exact: true }).selectOption("1");
    await expect(jumpToPlanned).toHaveValue("");
    await expect(reviewedDetails).toHaveCount(0);
    await expect(selectableNote).toHaveCount(0);
    await expect(previewVisitNote).toHaveCount(0);
    await expect(reviewCopyButton).toHaveCount(0);
    await expect(statusCopyButton).toHaveCount(0);
    await expect(statusCopyFeedback).toHaveCount(0);
    await expect(reviewDownloadButton).toHaveCount(0);
    await expect(reviewedStatusDownloadButton).toHaveCount(0);
    await expect(statusPreviewToggle).toHaveCount(0);
    await expect(selectableStatusSummary).toHaveCount(0);
    await expect(reviewedState).toContainText(
      "Agenda date is not one of the proposed visit dates",
    );
    await expect(planner.locator(".recurring-visit-dates li[aria-current='date']"))
      .toHaveCount(0);
    await planner.getByLabel("Repeat visits", { exact: true }).selectOption("4");
    await expect(jumpToPlanned).toHaveValue("2027-01-01");
    await expect(reviewedDetails).toContainText("Reviewed visit 3 of 6");
    await expect(statusPreviewToggle).toHaveAttribute("aria-expanded", "false");
    await expect(selectableStatusSummary).toHaveCount(0);
    await expect(previewVisitNote).toHaveAttribute("aria-expanded", "false");
    // Regression: reverting an excluded recurrence rule must not
    // silently resurrect the previously opened note on the same date.
    await expect(selectableNote).toHaveCount(0);
    await previewVisitNote.click();
    expect(await selectableNote.inputValue()).toContain("NOT BOOKED");
    await planner.getByLabel("Number of preview visits", { exact: true })
      .selectOption("12");
    // Changing the number of proposed visits also closes the note,
    // rather than keeping its stale 3-of-6 header on a 12-date plan.
    await expect(previewVisitNote).toHaveAttribute("aria-expanded", "false");
    await expect(selectableNote).toHaveCount(0);
    await expect(jumpToPlanned.locator("option")).toHaveCount(13);
    await expect(reviewedDetails).toContainText("Reviewed visit 3 of 12");
    // In a 12-visit plan, compact view hides only repeated cards;
    // navigation, current details and manual preparation remain usable.
    await compactView.check();
    await expect(plannedDates).toHaveCount(0);
    await expect(noSavedCardLabels).toHaveCount(0);
    await expect(selectedNoSavedLabel).toHaveCount(
      /Saved on this date: 0 non-archived/.test(
        (await reviewedDetails.locator(".recurring-visit-selected-count").textContent()) ?? "",
      ) ? 1 : 0,
    );
    await expect(cancelledListToggle).toBeVisible();
    // Compact view hides numbered cards, not the optional cancelled-only
    // list or the operator's ability to review its date-only proposals.
    const compactNoSavedCount = Number(await withoutSaved.textContent());
    await expect(noSavedListToggle).toBeVisible();
    if (compactNoSavedCount > 0) {
      await noSavedListToggle.click();
      await expect(noSavedList.locator("li")).toHaveCount(compactNoSavedCount);
      await expect(noSavedListPanel).toContainText("NOT BOOKED");
      const datesInNoSavedList = await noSavedList.locator("time").evaluateAll(
        (nodes) => nodes.map((node) => node.getAttribute("datetime")),
      );
      const allTwelveNoSavedDates = await jumpToPlanned.locator("option").evaluateAll(
        (nodes) => nodes.map((node) => node.getAttribute("value")).filter(Boolean),
      );
      await expect(noSavedList.locator(".recurring-visit-no-saved-position"))
        .toHaveText(datesInNoSavedList.map((d) =>
          `Proposed visit ${allTwelveNoSavedDates.indexOf(d) + 1} of 12`,
        ));
      await expect(noSavedList.locator('li[aria-current="date"]')).toHaveCount(
        datesInNoSavedList.includes("2027-01-01") ? 1 : 0,
      );
      await noSavedListToggle.click();
      await expect(noSavedList).toHaveCount(0);
    } else {
      await expect(noSavedListToggle).toBeDisabled();
    }
    const compactCancelledCount = Number(await cancelledOnly.textContent());
    if (compactCancelledCount > 0) {
      await cancelledListToggle.click();
      await expect(cancelledList.locator("li")).toHaveCount(compactCancelledCount);
      await expect(cancelledList).toContainText("NOT BOOKED");
      const compactDateTimes = await cancelledList.locator("time").evaluateAll((nodes) =>
        nodes.map((node) => node.getAttribute("datetime")),
      );
      const allTwelveDates = await jumpToPlanned.locator("option").evaluateAll((nodes) =>
        nodes.map((node) => node.getAttribute("value")).filter(Boolean),
      );
      // The first picker option is the empty "choose a visit" sentinel.
      await expect(cancelledList.locator(".recurring-visit-cancelled-position"))
        .toHaveText(compactDateTimes.map((date) =>
          `Proposed visit ${allTwelveDates.indexOf(date) + 1} of 12`,
        ));
      await expect(cancelledList.locator('li[aria-current="date"]')).toHaveCount(
        compactDateTimes.includes("2027-01-01") ? 1 : 0,
      );
      await cancelledListToggle.click();
      await expect(cancelledList).toHaveCount(0);
    } else {
      await expect(cancelledListToggle).toBeDisabled();
    }
    await expect(reviewPreviousWithSaved).toBeVisible();
    await expect(reviewPreviousWithoutSaved).toBeVisible();
    await expect(reviewNextWithSaved).toBeVisible();
    await expect(reviewNextWithoutSaved).toBeVisible();
    await expect(reviewCopyButton).toBeVisible();
    await expect(reviewDownloadButton).toBeVisible();
    await expect(reviewedStatusDownloadButton).toBeVisible();
    await expect(statusCopyButton).toBeVisible();
    await expect(statusCopyFeedback).toHaveCount(0);
    await expect(statusPreviewToggle).toBeVisible();
    await statusPreviewToggle.click();
    await expect(statusPreviewToggle).toHaveAttribute("aria-expanded", "true");
    expect(await selectableStatusSummary.inputValue()).toContain(
      "LMS proposed visit 3 of 12 - NOT BOOKED",
    );
    expect(await selectableStatusSummary.inputValue()).toContain(
      "No staff, equipment, or appointment availability is confirmed.",
    );
    await statusPreviewToggle.click();
    await expect(selectableStatusSummary).toHaveCount(0);
    await previewVisitNote.click();
    await expect(selectableNote).toHaveValue([
      "LMS proposed visit 3 of 12 - NOT BOOKED",
      "Friday, 2027-01-01 (business-local date; no time)",
      "Planning note only. No appointment, staff or equipment is booked or confirmed.",
    ].join("\n"));
    await expect(reviewedDetails.getByRole("button", {
      name: "Prepare currently reviewed visit 3 on 2027-01-01",
      exact: true,
    })).toBeEnabled();
    const tenthDate = await jumpToPlanned.locator("option").nth(10).getAttribute("value");
    expect(tenthDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    await jumpToPlanned.selectOption(tenthDate!);
    await expect(reviewedDetails).toContainText("Reviewed visit 10 of 12");
    await expect(selectableNote).toHaveCount(0);
    await expect(previewVisitNote).toHaveAttribute("aria-expanded", "false");
    await previewVisitNote.click();
    const tenthNote = await selectableNote.inputValue();
    expect(tenthNote).toContain("LMS proposed visit 10 of 12 - NOT BOOKED");
    expect(tenthNote).toContain(tenthDate!);
    await expect(page.getByLabel("Schedule date", { exact: true }))
      .toHaveValue(tenthDate!);
    await expect(plannedDates).toHaveCount(0);
    await compactView.uncheck();
    await expect(plannedDates).toHaveCount(12);
    await expect(plannedDates.nth(9)).toHaveAttribute("aria-current", "date");
    await jumpToPlanned.selectOption("2027-01-01");
    await expect(reviewedDetails).toContainText("Reviewed visit 3 of 12");
    await planner.getByLabel("Number of preview visits", { exact: true })
      .selectOption("6");
    await expect(jumpToPlanned.locator("option")).toHaveCount(7);
    await expect(reviewedDetails).toContainText("Reviewed visit 3 of 6");
    await firstPlanned.click();
    await expect(jumpToPlanned).toHaveValue("2026-11-06");
    expect(await visitLabels.allTextContents()).toEqual(anchoredVisitLabels);
    // Review shortcuts are independent of recurrence anchor and booking.
    await expect(reviewedState)
      .toContainText("Currently reviewing planned visit 1 of 6: 2026-11-06");
    await expect(planner.locator(".recurring-visit-dates li[aria-current='date']")).toHaveCount(1);
    await expect(previousPlanned).toBeDisabled();
    await expect(firstPlanned).toBeDisabled();
    await expect(lastPlanned).toBeEnabled();
    await nextPlanned.click();
    await expect(page.getByLabel("Schedule date", { exact: true }))
      .toHaveValue("2026-12-04");
    await expect(reviewedState)
      .toContainText("Currently reviewing planned visit 2 of 6: 2026-12-04");
    await expect(plannedDates.nth(1)).toHaveAttribute("aria-current", "date");
    await expect(plannedDates.first()).not.toHaveAttribute("aria-current", "date");
    await expect(planner.locator(".recurring-visit-dates li[aria-current='date']")).toHaveCount(1);
    await expect(previousPlanned).toBeEnabled();
    await expect(firstPlanned).toBeEnabled();
    await previousPlanned.click();
    await expect(page.getByLabel("Schedule date", { exact: true }))
      .toHaveValue("2026-11-06");
    await expect(previousPlanned).toBeDisabled();
    await expect(firstPlanned).toBeDisabled();
    expect(await visitLabels.allTextContents()).toEqual(anchoredVisitLabels);

    // Edge jumps use the exact same agenda-review pathway as individual
    // cards and Previous/Next, never changing the first proposed date.
    await lastPlanned.click();
    await expect(reviewedDetails).toContainText("Reviewed visit 6 of 6");
    await expect(page.getByLabel("Schedule date", { exact: true }))
      .toHaveValue("2027-03-26");
    await expect(reviewedState)
      .toContainText("Currently reviewing planned visit 6 of 6: 2027-03-26");
    await expect(lastPlanned).toBeDisabled();
    await expect(firstPlanned).toBeEnabled();
    await expect(nextPlanned).toBeDisabled();
    await firstPlanned.click();
    await expect(page.getByLabel("Schedule date", { exact: true }))
      .toHaveValue("2026-11-06");
    await expect(firstPlanned).toBeDisabled();
    await expect(lastPlanned).toBeEnabled();
    await expect(planner.locator(".recurring-visit-dates li[aria-current='date']"))
      .toHaveCount(1);
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
    // Regression: changing the calendar anchor closes a previous
    // on-screen note. Returning to the original date must not revive it.
    await previewVisitNote.click();
    expect(await selectableNote.inputValue()).toContain("NOT BOOKED");
    // Do not silently return partial plans if the last date is out of range.
    await page.getByLabel("Schedule date", { exact: true }).fill("2100-12-25");
    await expect(planner.getByRole("status")).toContainText(
      "on or before 2100-12-31",
    );
    await expect(plannedDates).toHaveCount(0);
    await expect(compactView).toHaveCount(0);
    await expect(overview).toHaveCount(0);
    await expect(coverage).toHaveCount(0);
    await expect(statusCopyButton).toHaveCount(0);
    await expect(statusCopyFeedback).toHaveCount(0);
    await expect(reviewedStatusDownloadButton).toHaveCount(0);
    await expect(statusPreviewToggle).toHaveCount(0);
    await expect(selectableStatusSummary).toHaveCount(0);
    await expect(noSavedListToggle).toHaveCount(0);
    await expect(noSavedList).toHaveCount(0);
    await expect(noSavedCardLabels).toHaveCount(0);
    await expect(selectedNoSavedLabel).toHaveCount(0);
    await expect(cancelledCardLabels).toHaveCount(0);
    await expect(selectedCancelledLabel).toHaveCount(0);
    await expect(cancelledOnly).toHaveCount(0);
    await expect(cancelledListToggle).toHaveCount(0);
    await expect(cancelledList).toHaveCount(0);
    await expect(reviewPreviousWithSaved).toHaveCount(0);
    await expect(reviewPreviousWithoutSaved).toHaveCount(0);
    await expect(reviewNextWithSaved).toHaveCount(0);
    await expect(reviewNextWithoutSaved).toHaveCount(0);
    await expect(reviewedDetails).toHaveCount(0);
    await expect(selectableNote).toHaveCount(0);
    await expect(previewVisitNote).toHaveCount(0);
    await expect(reviewCopyButton).toHaveCount(0);
    await expect(statusCopyButton).toHaveCount(0);
    await expect(statusCopyFeedback).toHaveCount(0);
    await expect(reviewDownloadButton).toHaveCount(0);
    await expect(weekdays).toHaveCount(0);
    await expect(savedCounts).toHaveCount(0);
    await expect(savedStatuses).toHaveCount(0);
    await expect(planner.locator(".recurring-visit-review-state")).toHaveCount(0);
    await expect(exportButton).toHaveCount(0);
    await expect(statusExportButton).toHaveCount(0);
    await expect(savedCsvCopyButton).toHaveCount(0);
    await expect(savedCsvPreviewToggle).toHaveCount(0);
    await expect(savedCsvPreviewTextarea).toHaveCount(0);
    await expect(savedCsvCopyFeedback).toHaveCount(0);
    await expect(copyButton).toHaveCount(0);
    await expect(copyFeedback).toHaveCount(0);
    await expect(previousPlanned).toHaveCount(0);
    await expect(nextPlanned).toHaveCount(0);
    await expect(jumpToPlanned).toHaveCount(0);
    await expect(firstPlanned).toHaveCount(0);
    await expect(lastPlanned).toHaveCount(0);
    await page.getByLabel("Schedule date", { exact: true }).fill("2026-11-06");
    await expect(plannedDates).toHaveCount(6);
    await expect(previewVisitNote).toHaveAttribute("aria-expanded", "false");
    await expect(selectableNote).toHaveCount(0);
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
    await expect(overview.locator("dd")).toHaveText([
      "6", "0", "6",
      "Saturday 2026-11-07", "Saturday 2027-03-27", "20 calendar weeks",
    ]);
    await page.getByLabel("Schedule date", { exact: true }).fill("2026-11-06");
    await expect(weekdays).toHaveText(Array.from({ length: 6 }, () => "Friday"));
    await expect(overview.locator("dd")).toHaveText([
      "6", "6", "0",
      "Friday 2026-11-06", "Friday 2027-03-26", "20 calendar weeks",
    ]);
    const savedAfterPreview = await page.request
      .get("/api/demo?organizationId=" + previewOrganization)
      .then((response) => response.json());
    expect(savedAfterPreview.workspace.records)
      .toEqual(savedBeforePreview.workspace.records);

    // Exercise a date-only handoff in THIS existing two-business session.
    // A separate test would exhaust the demo's fixed 24-session limit
    // on the final HTTP boundary test. No production caps are changed.
    const preparedDate = "2026-12-04";
    await jumpToPlanned.selectOption(preparedDate);
    await compactView.check();
    await expect(plannedDates).toHaveCount(0);
    await expect(compactView).toBeChecked();
    await expect(reviewedDetails).toContainText("Reviewed visit 2 of 6");
    await expect(reviewedDetails.locator(".recurring-visit-selected-date"))
      .toHaveText("Friday " + preparedDate);
    await reviewedDetails.getByRole("button", {
      name: "Prepare currently reviewed visit 2 on " + preparedDate,
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
    const restoredCompact = restoredPlanner.getByRole("checkbox", {
      name: "Compact view — hide date cards", exact: true,
    });
    await expect(restoredCompact).toBeChecked();
    await expect(restoredPlanner.getByRole("list", {
      name: "Planned visit dates", exact: true,
    })).toHaveCount(0);
    await expect(restoredPlanner.getByRole("region", {
      name: "Reviewed proposed visit details", exact: true,
    })).toContainText("Reviewed visit 2 of 6");
    await restoredCompact.uncheck();
    await expect(restoredPlanner.locator(".recurring-visit-review-state"))
      .toContainText("Currently reviewing planned visit 2 of 6: 2026-12-04");
    await expect(restoredPlanner.getByRole("region", {
      name: "Reviewed proposed visit details", exact: true,
    })).toContainText("Reviewed visit 2 of 6");
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
    await expect(restoredPlanner.getByLabel("Jump to planned visit", { exact: true }))
      .toHaveValue("2026-12-04");
    await expect(restoredPlanner.getByRole("region", {
      name: "Proposed visit overview", exact: true,
    }).locator("dd")).toHaveText([
      "6", "6", "0",
      "Friday 2026-11-06", "Friday 2027-03-26", "20 calendar weeks",
    ]);
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
    const beforeSavePlanner = page.getByRole("region", {
      name: "Repeating visit planner", exact: true,
    });
    // Exercise the separate successful Save return while compact.
    await beforeSavePlanner.getByRole("checkbox", {
      name: "Compact view — hide date cards", exact: true,
    }).check();
    await beforeSavePlanner.getByLabel("Jump to planned visit", { exact: true })
      .selectOption(nextVisitDate);
    await beforeSavePlanner.getByRole("region", {
      name: "Reviewed proposed visit details", exact: true,
    }).getByRole("button", {
      name: "Prepare currently reviewed visit 4 on " + nextVisitDate,
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
    const savedCompact = savedRoutePlanner.getByRole("checkbox", {
      name: "Compact view — hide date cards", exact: true,
    });
    await expect(savedCompact).toBeChecked();
    await expect(savedRoutePlanner.getByRole("list", {
      name: "Planned visit dates", exact: true,
    })).toHaveCount(0);
    await expect(savedRoutePlanner.getByRole("region", {
      name: "Reviewed proposed visit details", exact: true,
    })).toContainText("Reviewed visit 4 of 6");
    await savedCompact.uncheck();
    await expect(savedRoutePlanner.locator(".recurring-visit-review-state"))
      .toContainText("Currently reviewing planned visit 4 of 6: 2027-01-29");
    const afterSaveDetails = savedRoutePlanner.getByRole("region", {
      name: "Reviewed proposed visit details", exact: true,
    });
    await expect(afterSaveDetails).toContainText("Reviewed visit 4 of 6");
    const afterSaveReviewedStatus = afterSaveDetails.getByRole("button", {
      name: "Download reviewed visit status TXT", exact: true,
    });
    const [afterSaveStatusDownload] = await Promise.all([
      page.waitForEvent("download"), afterSaveReviewedStatus.click(),
    ]);
    expect(afterSaveStatusDownload.suggestedFilename()).toBe(
      "lms-reviewed-visit-status-2027-01-29-NOT-BOOKED.txt",
    );
    const afterSaveStatusText = await readFile(await afterSaveStatusDownload.path(), "utf8");
    expect(afterSaveStatusText).toContain("LMS proposed visit 4 of 6 - NOT BOOKED");
    expect(afterSaveStatusText).toContain("Reviewed date: 2027-01-29");
    expect(afterSaveStatusText).toContain("Saved-date classification: Has non-cancelled saved records");
    const actualScheduled = (await afterSaveDetails.locator(
      ".recurring-visit-selected-statuses",
    ).innerText()).match(/Scheduled (\d+)/)?.[1];
    expect(Number(actualScheduled)).toBeGreaterThanOrEqual(1);
    expect(afterSaveStatusText).toContain("Saved statuses: Scheduled " + actualScheduled);
    expect(afterSaveStatusText).toContain("No staff, equipment, or appointment availability is confirmed.");
    expect(afterSaveStatusText).not.toContain(customer);
    expect(afterSaveStatusText).not.toContain(work);
    expect(afterSaveStatusText).not.toContain(resource);
    const afterSaveCopyButton = afterSaveDetails.getByRole("button", {
      name: "Copy saved status summary", exact: true,
    });
    const afterSaveStatusFeedback = afterSaveDetails.locator(
      ".recurring-visit-reviewed-status-copy-feedback",
    );
    await expect(afterSaveStatusFeedback).toHaveCount(0);
    await page.evaluate(() => {
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: { writeText: async (text: string) => {
          document.documentElement.dataset.afterSaveCopiedStatus = text;
        } },
      });
    });
    await afterSaveCopyButton.click();
    await expect(afterSaveStatusFeedback).toHaveText(
      "Saved status summary copied. No visit was booked or confirmed.",
    );
    expect(await page.evaluate(() =>
      document.documentElement.dataset.afterSaveCopiedStatus ?? "",
    )).toBe(afterSaveStatusText.trimEnd());
    expect(await page.evaluate(() =>
      document.documentElement.dataset.afterSaveCopiedStatus ?? "",
    )).not.toContain(customer);
    const afterSavePreviewToggle = afterSaveDetails.getByRole("button", {
      name: /^(Preview saved status summary|Hide saved status summary)$/,
    });
    const afterSavePreviewText = afterSaveDetails.getByRole("textbox", {
      name: "Selectable saved appointment status summary — NOT BOOKED", exact: true,
    });
    await expect(afterSavePreviewToggle).toHaveAttribute("aria-expanded", "false");
    await afterSavePreviewToggle.click();
    await expect(afterSavePreviewText).toHaveValue(afterSaveStatusText.trimEnd());
    await afterSavePreviewToggle.click();
    await expect(afterSavePreviewText).toHaveCount(0);
    await expect(afterSaveDetails.locator(".recurring-visit-selected-count"))
      .toContainText(/Saved on this date: [1-9]\d* non-archived appointment/);
    // The explicit manual Save created a Scheduled appointment; the
    // selected date can no longer be classified as cancelled-only.
    await expect(afterSaveDetails.locator(".recurring-visit-selected-cancelled-only"))
      .toHaveCount(0);
    await expect(afterSaveDetails.locator(".recurring-visit-selected-no-saved"))
      .toHaveCount(0);
    await expect(savedRoutePlanner.getByRole("list", {
      name: "Planned visit dates", exact: true,
    }).locator(".recurring-visit-date-text")).toHaveText(anchoredVisitLabels);
    await expect(savedRoutePlanner.getByRole("list", {
      name: "Planned visit dates", exact: true,
    }).locator("li").nth(3).locator(".recurring-visit-saved-count"))
      .toContainText(/Already saved: [1-9]\d* non-archived appointment/);
    // Exactly one explicit manual appointment was saved. The overview
    // must recompute date coverage from the same saved per-date rows.
    const afterSaveCoverage = savedRoutePlanner.getByRole("group", {
      name: "Saved appointment date coverage", exact: true,
    });
    const afterSaveStatusExport = savedRoutePlanner.getByRole("button", {
      name: "Download saved-date review CSV", exact: true,
    });
    await expect(afterSaveStatusExport).toBeVisible();
    const [afterSaveCsvDownload] = await Promise.all([
      page.waitForEvent("download"), afterSaveStatusExport.click(),
    ]);
    expect(afterSaveCsvDownload.suggestedFilename()).toBe(
      "lms-visit-saved-date-review-2026-11-06-NOT-BOOKED.csv",
    );
    const afterSaveReviewCsv = await readFile(await afterSaveCsvDownload.path(), "utf8");
    const afterSaveCsvPreviewToggle = savedRoutePlanner.getByRole("button", {
      name: /^(Preview saved-date review CSV|Hide saved-date review CSV preview)$/,
    });
    const afterSaveCsvPreview = savedRoutePlanner.getByRole("textbox", {
      name: "Selectable saved-date review CSV — NOT BOOKED", exact: true,
    });
    await expect(afterSaveCsvPreviewToggle).toHaveAttribute("aria-expanded", "false");
    await afterSaveCsvPreviewToggle.click();
    await expect(afterSaveCsvPreview).toHaveValue(
      afterSaveReviewCsv.replace(/\r\n/g, "\n"),
    );
    await afterSaveCsvPreviewToggle.click();
    await expect(afterSaveCsvPreview).toHaveCount(0);
    const afterSaveCsvCopyButton = savedRoutePlanner.getByRole("button", {
      name: "Copy saved-date review CSV", exact: true,
    });
    const afterSaveCsvCopyFeedback = savedRoutePlanner.locator(
      ".recurring-visit-saved-review-csv-copy-feedback",
    );
    await expect(afterSaveCsvCopyFeedback).toHaveCount(0);
    await page.evaluate(() => {
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: { writeText: async (text: string) => {
          document.documentElement.dataset.afterSaveReviewCsv = text;
        } },
      });
    });
    await afterSaveCsvCopyButton.click();
    await expect(afterSaveCsvCopyFeedback).toHaveText(
      "Saved-date review CSV copied. No visits were booked or confirmed.",
    );
    expect(await page.evaluate(() =>
      document.documentElement.dataset.afterSaveReviewCsv ?? "",
    )).toBe(afterSaveReviewCsv);
    expect(afterSaveReviewCsv).not.toContain(customer);
    expect(afterSaveReviewCsv).not.toContain(work);
    expect(afterSaveReviewCsv).not.toContain(resource);
    const afterSaveReviewRows = afterSaveReviewCsv.trimEnd().split("\r\n");
    expect(afterSaveReviewRows).toHaveLength(7);
    const explicitSavedDateRow = afterSaveReviewRows[4].split(",");
    expect(explicitSavedDateRow[0]).toBe("4");
    expect(explicitSavedDateRow[1]).toBe("2027-01-29");
    expect(Number(explicitSavedDateRow[3])).toBeGreaterThanOrEqual(1);
    expect(explicitSavedDateRow[8]).toBe("Has non-cancelled saved records");
    expect(explicitSavedDateRow[9]).toBe("Proposal only - NOT BOOKED - availability not confirmed");
    expect(afterSaveReviewCsv).not.toContain(customer);
    expect(afterSaveReviewCsv).not.toContain(work);
    expect(afterSaveReviewCsv).not.toContain(resource);
    const afterSaveLabels = await savedRoutePlanner.getByRole("list", {
      name: "Planned visit dates", exact: true,
    }).locator(".recurring-visit-saved-count").allTextContents();
    expect(afterSaveLabels).toHaveLength(6);
    const coveredAfterSave = afterSaveLabels.filter((text) =>
      /^Already saved: [1-9]\d* non-archived/.test(text),
    ).length;
    await expect(afterSaveCoverage.locator(".recurring-visit-coverage-with-saved"))
      .toHaveText(String(coveredAfterSave));
    await expect(afterSaveCoverage.locator(".recurring-visit-coverage-without-saved"))
      .toHaveText(String(6 - coveredAfterSave));
    const afterSaveStatuses = await savedRoutePlanner.getByRole("list", {
      name: "Planned visit dates", exact: true,
    }).locator(".recurring-visit-status-counts").allTextContents();
    await expect(afterSaveCoverage.locator(".recurring-visit-coverage-cancelled-only-count"))
      .toHaveText(String(cancelledOnlyCardCount(afterSaveLabels, afterSaveStatuses)));
    await expect(afterSaveCoverage.getByRole("button", {
      name: /^(Show|Hide) cancelled-only proposed dates/,
    })).toBeVisible();
    const afterSaveNoSavedToggle = afterSaveCoverage.getByRole("button", {
      name: /^(Show|Hide) proposed dates without saved appointments/,
    });
    await expect(afterSaveNoSavedToggle).toBeVisible();
    await expect(afterSaveNoSavedToggle).toHaveAttribute("aria-expanded", "false");
    if (6 - coveredAfterSave > 0) {
      await expect(afterSaveNoSavedToggle).toHaveText(
        `Show proposed dates without saved appointments (${6 - coveredAfterSave})`,
      );
    } else {
      await expect(afterSaveNoSavedToggle).toBeDisabled();
    }
    await expect(afterSaveCoverage).toContainText(
      "Neither count confirms proposed bookings",
    );
    await expect(afterSaveCoverage.getByRole("button", {
      name: "Review previous proposed date with saved records", exact: true,
    })).toBeVisible();
    await expect(afterSaveCoverage.getByRole("button", {
      name: "Review previous proposed date without saved records", exact: true,
    })).toBeVisible();
    await expect(afterSaveCoverage.getByRole("button", {
      name: "Review next proposed date with saved records", exact: true,
    })).toBeVisible();
    await expect(afterSaveCoverage.getByRole("button", {
      name: "Review next proposed date without saved records", exact: true,
    })).toBeVisible();
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

