import { reviewAppointmentResources } from "../../src/core/coordinated-scheduling";
import { test, expect, type Page } from "@playwright/test";
import { selectModules } from "../../src/core/buildplan";
import AxeBuilder from "@axe-core/playwright";
import { readFile } from "node:fs/promises";
const directory = async (page: Page) => {
  await page
    .getByRole("button", { name: "Crews & availability", exact: true })
    .click();
};
const save = async (page: Page) => {
  const button = page.getByRole("button", { name: "Save record", exact: true });
  const review = page.getByRole("region", {
    name: "Review appointment resources",
    exact: true,
  });
  if (await review.count()) {
    // Mobile overflow can enlarge innerWidth: compare against the actual layout viewport.
    const layout = await review.evaluate((section) => {
      const form = section.closest("form")!,
        footer = form.querySelector(".form-footer")!;
      const rect = section.getBoundingClientRect(),
        footerRect = footer.getBoundingClientRect(),
        confirmation = section.querySelector(".check-label");
      return {
        clientWidth: document.documentElement.clientWidth,
        documentWidth: document.documentElement.scrollWidth,
        section: rect.toJSON(),
        footer: footerRect.toJSON(),
        track: getComputedStyle(section).gridTemplateColumns,
        confirmationWhiteSpace: confirmation
          ? getComputedStyle(confirmation).whiteSpace
          : null,
        childRight: Math.max(
          ...[...section.children].map(
            (child) => child.getBoundingClientRect().right,
          ),
        ),
      };
    });
    expect(layout.documentWidth).toBeLessThanOrEqual(layout.clientWidth);
    expect(layout.childRight).toBeLessThanOrEqual(layout.section.right + 0.5);
    expect(layout.footer.top).toBeGreaterThanOrEqual(layout.section.bottom);
    // Trial still performs Playwright's pointer/actionability checks; it cannot submit.
    await button.click({ trial: true });
    const target = await button.evaluate((element) => {
      const rect = element.getBoundingClientRect(),
        hit = document.elementFromPoint(
          rect.x + rect.width / 2,
          rect.y + rect.height / 2,
        );
      return {
        hitsButton: hit === element || (!!hit && element.contains(hit)),
        hitTag: hit?.tagName ?? null,
      };
    });
    expect(target.hitsButton).toBe(true);
    const theme = await page.locator(".app").getAttribute("data-theme");
    await test.info().attach("appointment-form-layout-" + theme, {
      body: JSON.stringify({
        theme,
        viewport: page.viewportSize(),
        ...layout,
        ...target,
      }),
      contentType: "application/json",
    });
    if (test.info().project.name === "phone")
      await page.screenshot({
        path: test.info().outputPath(`fictional-coordinated-form-${theme}.png`),
      });
  }
  await button.click();
};
const fits = async (page: Page) => {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
};
test("fictional crews and workers publish availability, schedule both industries and retain assignment history accessibly", async ({
  page,
}, testInfo) => {
  test.setTimeout(180000);
  page.setDefaultTimeout(15000);
  await page.goto("/");
  await page.getByRole("button", { name: "Explore the working demo" }).click();
  await expect(
    page.getByRole("heading", { name: "Cedar Grove Property" }),
  ).toBeVisible();
  for (const industry of ["cleaning", "property"] as const) {
    await page.getByLabel("Business workspace", { exact: true }).selectOption({
      label: industry === "cleaning" ? "Cleaning Company" : "Property Manager",
    });
    const people =
      industry === "cleaning"
        ? ["Avery Crew Example", "Morgan Crew Example"]
        : ["Casey Maintenance Example"];
    for (const name of people) {
      await directory(page);
      await page
        .getByRole("button", { name: "+ Add employee profile", exact: true })
        .click();
      await page.getByLabel("Employee name *", { exact: true }).fill(name);
      await page
        .getByLabel("Work role *", { exact: true })
        .fill(
          industry === "cleaning"
            ? "Cleaning specialist"
            : "Maintenance worker",
        );
      await page
        .getByLabel("Skills", { exact: true })
        .fill(
          industry === "cleaning"
            ? "Cleaning, room preparation"
            : "Inspection, minor repairs",
        );
      await save(page);
      await expect(
        page.getByRole("heading", { name, exact: true }),
      ).toBeVisible();
      await directory(page);
      await page
        .getByRole("button", { name: "+ Add availability period", exact: true })
        .click();
      const title = name + " Friday work";
      await page.getByLabel("Period title *", { exact: true }).fill(title);
      await page
        .getByLabel("Employee", { exact: true })
        .selectOption({ label: name });
      await page
        .getByLabel("Period type *", { exact: true })
        .selectOption("Working hours");
      await page
        .getByLabel("Period start *", { exact: true })
        .fill("2026-11-06T08:00");
      await page
        .getByLabel("Period end *", { exact: true })
        .fill("2026-11-06T17:00");
      await save(page);
      await expect(
        page.getByRole("heading", { name: title, exact: true }),
      ).toBeVisible();
    }

    // The same read-only directory controls serve property and cleaning staff.
    await directory(page);
    const employeeSearch = page.getByLabel(
      "Search employee directory", { exact: true },
    );
    const employeeStatus = page.getByLabel(
      "Filter employee status", { exact: true },
    );
    await employeeSearch.fill(people[0].split(" ")[0].toLowerCase());
    const firstEmployee = page.getByRole("article", {
      name: "Employee " + people[0], exact: true,
    });
    await expect(firstEmployee).toBeVisible();
    for (const other of people.slice(1)) {
      await expect(page.getByRole("article", {
        name: "Employee " + other, exact: true,
      })).toHaveCount(0);
    }
    await employeeStatus.selectOption("inactive");
    await expect(firstEmployee).toHaveCount(0);
    await employeeStatus.selectOption("active");
    await expect(firstEmployee).toBeVisible();
    await employeeSearch.fill("not-a-real-profile");
    await expect(page.getByText(
      "No employee profiles match these filters.", { exact: true },
    )).toBeVisible();
    await page.getByRole("button", {
      name: "Clear employee filters", exact: true,
    }).click();
    await expect(employeeSearch).toHaveValue("");
    await expect(employeeStatus).toHaveValue("all");
    for (const name of people) {
      await expect(page.getByRole("article", {
        name: "Employee " + name, exact: true,
      })).toBeVisible();
    }
    await fits(page);
    const resource =
      industry === "cleaning"
        ? "Friday cleaning crew"
        : "Friday maintenance worker";
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
    await directory(page);
    const resourceSearch = page.getByLabel(
      "Search resource directory", { exact: true },
    );
    const resourceType = page.getByLabel(
      "Filter resource type", { exact: true },
    );
    const resourceEnrollment = page.getByLabel(
      "Filter employee enrollment", { exact: true },
    );
    const resourceCard = page.getByRole("article", {
      name: "Resource " + resource, exact: true,
    });
    await resourceSearch.fill(resource.toUpperCase());
    await expect(resourceCard).toBeVisible();
    await resourceType.selectOption(industry === "cleaning" ? "Worker" : "Crew");
    await expect(resourceCard).toHaveCount(0);
    await resourceType.selectOption(industry === "cleaning" ? "Crew" : "Worker");
    await expect(resourceCard).toBeVisible();
    await resourceEnrollment.selectOption("enrolled");
    await expect(resourceCard).toHaveCount(0);
    await resourceEnrollment.selectOption("resource-only");
    await expect(resourceCard).toBeVisible();
    await resourceSearch.fill("no-such-resource");
    await expect(page.getByText(
      "No resources match these filters.", { exact: true },
    )).toBeVisible();
    await page.getByRole("button", {
      name: "Clear resource filters", exact: true,
    }).click();
    await expect(resourceSearch).toHaveValue("");
    await expect(resourceType).toHaveValue("all");
    await expect(resourceEnrollment).toHaveValue("all");
    await expect(resourceCard).toBeVisible();
    for (const name of people) {
      await directory(page);
      await page
        .getByRole("button", { name: "+ Add dated membership", exact: true })
        .click();
      const title = name + " membership";
      await page.getByLabel("Membership title *", { exact: true }).fill(title);
      await page
        .getByLabel("Employee *", { exact: true })
        .selectOption({ label: name });
      await page
        .getByLabel("Worker or crew *", { exact: true })
        .selectOption({ label: resource });
      await page
        .getByLabel("Effective start *", { exact: true })
        .fill("2026-11-01T00:00");
      await page
        .getByLabel("Effective end *", { exact: true })
        .fill("2026-12-01T00:00");
      await save(page);
      await expect(
        page.getByRole("heading", { name: title, exact: true }),
      ).toBeVisible();
    }
    await directory(page);
    await resourceSearch.fill(resource);
    await resourceEnrollment.selectOption("enrolled");
    await expect(resourceCard).toBeVisible();
    await expect(resourceCard).toContainText(
      "Enrolled — employee reservations required",
    );
    await resourceEnrollment.selectOption("resource-only");
    await expect(resourceCard).toHaveCount(0);
    await page.getByRole("button", {
      name: "Clear resource filters", exact: true,
    }).click();
    await expect(resourceCard).toBeVisible();
    // CSV covers every filtered resource, not just this card. Scope the
    // directory to the new fictional crew before testing an empty day.
    await resourceSearch.fill(resource);
    const rosterMode = page.getByLabel(
      "Show resource memberships", { exact: true },
    );
    const rosterStatus = page.getByLabel(
      "Filter membership record status", { exact: true },
    );
    const rosterSort = page.getByLabel(
      "Sort membership history", { exact: true },
    );
    const resourceCountSort = page.getByLabel(
      "Sort resources by matching memberships", { exact: true },
    );
    const rosterSearch = page.getByLabel(
      "Search roster memberships", { exact: true },
    );
    await expect(rosterMode).toHaveValue("all");
    await expect(rosterStatus).toHaveValue("all");
    await expect(rosterSort).toHaveValue("retained");
    await expect(resourceCountSort).toHaveValue("directory");
    await expect(rosterSearch).toHaveValue("");
    const onlyMatchingResources = page.getByRole("checkbox", {
      name: "Show only resources with matching memberships", exact: true,
    });
    await expect(onlyMatchingResources).not.toBeChecked();
    const rosterOverview = page.getByRole("group", {
      name: "Roster membership overview", exact: true,
    });
    await expect(rosterOverview).toContainText(
      "Matching resources: 1 of 1 directory resources.",
    );
    await expect(rosterOverview).toContainText(
      "Matching membership records: " + people.length + ".",
    );
    const rosterRows = resourceCard.locator(".workforce-members li");
    await expect(rosterRows).toHaveCount(people.length);
    await rosterMode.selectOption("overlapping-day");
    const rosterDate = page.getByLabel(
      "Membership review date", { exact: true },
    );
    await rosterDate.fill("2026-11-06");
    await expect(rosterRows).toHaveCount(people.length);
    await expect(resourceCard).toContainText(
      "retained dated memberships overlapping 2026-11-06",
    );
    const rosterCsvButton = page.getByRole("button", {
      name: "Download filtered roster memberships CSV", exact: true,
    });
    await rosterStatus.selectOption("archived");
    await expect(rosterOverview).toContainText(
      "Matching membership records: 0. Current records: 0. Archived records: 0.",
    );
    await expect(rosterRows).toHaveCount(0);
    await expect(resourceCard.getByText(
      "No retained memberships match this status filter.", { exact: true },
    )).toBeVisible();
    await expect(resourceCard).toContainText(
      "Enrolled — employee reservations required",
    );
    await expect(rosterCsvButton).toBeDisabled();
    await rosterStatus.selectOption("current");
    await expect(rosterOverview).toContainText(
      "Matching membership records: " + people.length +
      ". Current records: " + people.length + ". Archived records: 0.",
    );
    await expect(rosterRows).toHaveCount(people.length);
    await rosterSearch.fill(people[0].toLowerCase());
    await expect(rosterOverview).toContainText(
      "Matching resources: 1 of 1 directory resources.",
    );
    await expect(rosterOverview).toContainText(
      "Matching membership records: 1. Current records: 1. Archived records: 0.",
    );
    await expect(rosterRows).toHaveCount(1);
    await onlyMatchingResources.check();
    await expect(resourceCard).toBeVisible();
    await expect(resourceCard).toContainText(
      "Enrolled — employee reservations required",
    );
    await expect(rosterCsvButton).toBeEnabled();
    const searchedDownloadPending = page.waitForEvent("download");
    await rosterCsvButton.click();
    const searchedDownload = await searchedDownloadPending;
    const searchedCsv = (await readFile((await searchedDownload.path())!))
      .toString("utf8");
    expect(searchedCsv).toContain(people[0] + " membership");
    for (const other of people.slice(1)) {
      expect(searchedCsv).not.toContain(other + " membership");
    }
    await rosterSearch.fill("no-such-member-name");
    await expect(rosterOverview).toContainText(
      "Matching resources: 0 of 1 directory resources.",
    );
    await expect(rosterOverview).toContainText(
      "Matching membership records: 0. Current records: 0. Archived records: 0.",
    );
    await expect(resourceCard).toHaveCount(0);
    await expect(page.getByText(
      "No resources have memberships matching these roster filters.",
      { exact: true },
    )).toBeVisible();
    await expect(rosterCsvButton).toBeDisabled();
    await onlyMatchingResources.uncheck();
    await expect(resourceCard).toBeVisible();
    await expect(rosterRows).toHaveCount(0);
    await expect(resourceCard.getByText(
      "No retained memberships match this roster search.", { exact: true },
    )).toBeVisible();
    await rosterSearch.fill(people[0] + " membership");
    await expect(rosterRows).toHaveCount(1);
    await rosterSearch.fill("");
    await expect(rosterRows).toHaveCount(people.length);
    await resourceCountSort.selectOption("most");
    await expect(resourceCountSort).toHaveValue("most");
    await expect(rosterRows).toHaveCount(people.length);
    await resourceCountSort.selectOption("fewest");
    await expect(resourceCountSort).toHaveValue("fewest");
    await expect(rosterRows).toHaveCount(people.length);
    await rosterSort.selectOption("newest");
    await expect(rosterSort).toHaveValue("newest");
    await expect(rosterRows).toHaveCount(people.length);
    await rosterSort.selectOption("oldest");
    await expect(rosterSort).toHaveValue("oldest");
    await expect(rosterRows).toHaveCount(people.length);
    await expect(rosterCsvButton).toBeEnabled();
    const rosterDownloadPending = page.waitForEvent("download");
    await rosterCsvButton.click();
    const rosterDownload = await rosterDownloadPending;
    expect(rosterDownload.suggestedFilename()).toBe(
      "lms-resource-roster-review-2026-11-06.csv",
    );
    const rosterCsv = (await readFile((await rosterDownload.path())!))
      .toString("utf8");
    expect(rosterCsv).toContain(resource);
    expect(rosterCsv).toContain('"Overlapping selected day"');
    expect(rosterCsv).toContain('"Membership record status"');
    for (const name of people) expect(rosterCsv).toContain(name);
    expect(rosterCsv).not.toContain("PRIVATE");
    expect(rosterCsv).not.toContain("membership-id");
    await rosterDate.fill("2026-12-06");
    await expect(rosterRows).toHaveCount(0);
    await expect(resourceCard.getByText(
      "No retained memberships overlap the selected day.", { exact: true },
    )).toBeVisible();
    await expect(rosterCsvButton).toBeDisabled();
    await expect(resourceCard).toContainText(
      "Enrolled — employee reservations required",
    );
    await onlyMatchingResources.check();
    await expect(resourceCard).toHaveCount(0);
    await page.getByRole("button", {
      name: "Clear resource filters", exact: true,
    }).click();
    await expect(onlyMatchingResources).not.toBeChecked();
    await expect(rosterMode).toHaveValue("all");
    await expect(rosterStatus).toHaveValue("all");
    await expect(rosterSort).toHaveValue("retained");
    await expect(resourceCountSort).toHaveValue("directory");
    await expect(rosterSearch).toHaveValue("");
    await expect(rosterRows).toHaveCount(people.length);
    await expect(rosterCsvButton).toBeEnabled();
    await expect(page.getByLabel(
      "Membership review date", { exact: true },
    )).toHaveCount(0);
    await page
      .getByLabel("Availability date", { exact: true })
      .fill("2026-11-06");
    const periodKind = page.getByLabel(
      "Filter availability period type", { exact: true },
    );
    const periodSearch = page.getByLabel(
      "Search availability periods", { exact: true },
    );
    const firstPeriod = page.getByRole("article", {
      name: people[0] + " Friday work", exact: true,
    });
    const availabilityOverview = page.getByRole("group", {
      name: "Availability period overview", exact: true,
    });
    // Start at the heading within the group, then select its direct card.
    // A group-scoped locator in filter({ has }) is re-rooted per card
    // and never matches, causing all three viewport runs to time out.
    const workingHoursOverview = availabilityOverview.getByRole("heading", {
      name: "Working hours", exact: true,
    }).locator("..");
    const recordedCount = await workingHoursOverview.locator("p").innerText();
    expect(recordedCount).toMatch(/^[1-9]\d* recorded periods$/);
    await expect(availabilityOverview.getByRole("button", {
      name: "View working hours periods", exact: true,
    })).toBeEnabled();
    await expect(firstPeriod).toBeVisible();
    await periodSearch.fill(people[0].toLowerCase());
    await expect(workingHoursOverview.locator("p")).toHaveText(recordedCount);
    await expect(firstPeriod).toBeVisible();
    await availabilityOverview.getByRole("button", {
      name: "View working hours periods", exact: true,
    }).click();
    await expect(periodKind).toHaveValue("Working hours");
    await expect(periodSearch).toHaveValue("");
    await expect(workingHoursOverview.locator("p")).toHaveText(recordedCount);
    await periodSearch.fill(people[0].toLowerCase());
    await expect(firstPeriod).toBeVisible();
    const availabilityCsvButton = page.getByRole("button", {
      name: "Download filtered availability periods CSV", exact: true,
    });
    await expect(availabilityCsvButton).toBeEnabled();
    const availabilityDownloadPending = page.waitForEvent("download");
    await availabilityCsvButton.click();
    const availabilityDownload = await availabilityDownloadPending;
    expect(availabilityDownload.suggestedFilename()).toBe(
      "lms-availability-periods-2026-11-06-current.csv",
    );
    const periodCsv = (await readFile((await availabilityDownload.path())!))
      .toString("utf8");
    expect(periodCsv).toContain(people[0] + " Friday work");
    expect(periodCsv).toContain(people[0]);
    expect(periodCsv).toContain('"Working hours"');
    expect(periodCsv).toContain('"Start (UTC)"');
    expect(periodCsv).not.toContain("PRIVATE");
    for (const other of people.slice(1)) {
      expect(periodCsv).not.toContain(other + " Friday work");
    }
    for (const other of people.slice(1)) {
      await expect(page.getByRole("article", {
        name: other + " Friday work", exact: true,
      })).toHaveCount(0);
    }
    await periodKind.selectOption("Vacation");
    await expect(firstPeriod).toHaveCount(0);
    await expect(page.getByText(
      "No availability periods match these filters.", { exact: true },
    )).toBeVisible();
    await expect(availabilityCsvButton).toBeDisabled();
    await periodKind.selectOption("Working hours");
    await expect(firstPeriod).toBeVisible();
    await periodSearch.fill("no-such-period-title");
    await expect(firstPeriod).toHaveCount(0);
    await page.getByRole("button", {
      name: "Clear availability filters", exact: true,
    }).click();
    await expect(periodKind).toHaveValue("all");
    await expect(periodSearch).toHaveValue("");
    await expect(availabilityCsvButton).toBeEnabled();
    await expect(firstPeriod).toBeVisible();
    for (const other of people.slice(1)) {
      await expect(page.getByRole("article", {
        name: other + " Friday work", exact: true,
      })).toBeVisible();
    }
    await fits(page);
    const crew = page.getByRole("article", {
      name: "Resource " + resource,
      exact: true,
    });
    await expect(crew).toContainText("Enrolled");
    for (const name of people) await expect(crew).toContainText(name);
    await fits(page);
    expect(
      (
        await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
          .analyze()
      ).violations,
    ).toEqual([]);
    if (industry === "property")
      await page
        .getByRole("button", { name: "Switch to dark theme", exact: true })
        .click();
    await page.getByRole("button", { name: "Schedule", exact: true }).click();
    await page
      .getByRole("button", { name: "+ Add appointment", exact: true })
      .click();
    const title = resource + " visit";
    await page.getByLabel("Appointment title *", { exact: true }).fill(title);
    await page.getByLabel("Customer *", { exact: true }).selectOption({
      label: industry === "cleaning" ? "Jordan Sample" : "Alex Example",
    });
    await page
      .getByLabel(
        industry === "cleaning" ? "Cleaning job *" : "Maintenance request *",
        { exact: true },
      )
      .selectOption({
        label:
          industry === "cleaning"
            ? "Maple House move-out"
            : "Inspect porch light",
      });
    await page
      .getByLabel(
        industry === "cleaning"
          ? "Assigned crew / resource *"
          : "Assigned worker / resource *",
        { exact: true },
      )
      .selectOption({ label: resource });
    await page
      .getByLabel("Start time *", { exact: true })
      .fill("2026-11-06T10:00");
    await page
      .getByLabel("End time *", { exact: true })
      .fill("2026-11-06T11:00");
    await save(page);
    await expect(
      page.getByRole("heading", { name: title, exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Schedule", exact: true }).click();
    await page.getByLabel("Schedule date", { exact: true }).fill("2026-11-06");
    const appointment = page.getByRole("article", { name: title, exact: true });
    for (const name of people) await expect(appointment).toContainText(name);
    // An availability edit must refuse to invalidate existing reservations.
    await directory(page);
    await page
      .getByRole("button", { name: "+ Add availability period", exact: true })
      .click();
    await page
      .getByLabel("Period title *", { exact: true })
      .fill("Rejected overlapping vacation");
    await page
      .getByLabel("Employee", { exact: true })
      .selectOption({ label: people[0] });
    await page
      .getByLabel("Period type *", { exact: true })
      .selectOption("Vacation");
    await page
      .getByLabel("Period start *", { exact: true })
      .fill("2026-11-06T09:00");
    await page
      .getByLabel("Period end *", { exact: true })
      .fill("2026-11-06T12:00");
    await save(page);
    await expect(
      page.getByText(/unavailable during this appointment/).first(),
    ).toBeVisible();
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await directory(page);
    await page
      .getByLabel("Availability date", { exact: true })
      .fill("2026-11-06");
    const assignmentHistory = page.getByText(/Assignment history ·/)
      .locator("..");
    await assignmentHistory.locator("summary").click();
    await expect(assignmentHistory.getByText("Reserved", { exact: false }).first())
      .toBeVisible();
    const assignmentSearch = assignmentHistory.getByLabel(
      "Search assignment history", { exact: true },
    );
    const assignmentStatus = assignmentHistory.getByLabel(
      "Filter assignment status", { exact: true },
    );
    const historyCount = assignmentHistory.getByText(/matching retained assignments/);
    const assignmentFromDate = assignmentHistory.getByLabel(
      "Assignment start from", { exact: true },
    );
    const assignmentThroughDate = assignmentHistory.getByLabel(
      "Assignment start through", { exact: true },
    );
    const assignmentSort = assignmentHistory.getByLabel(
      "Sort assignment history", { exact: true },
    );
    await expect(historyCount).toContainText("Showing");
    await assignmentSearch.fill(resource.toLowerCase());
    await expect(assignmentHistory.locator("li")
      .filter({ hasText: people[0] }).first()).toBeVisible();
    const filteredHistoryCsv = assignmentHistory.getByRole("button", {
      name: "Download filtered assignment history CSV", exact: true,
    });
    await expect(filteredHistoryCsv).toBeEnabled();
    const assignmentDownloadPending = page.waitForEvent("download");
    await filteredHistoryCsv.click();
    const assignmentDownload = await assignmentDownloadPending;
    expect(assignmentDownload.suggestedFilename()).toBe(
      "lms-filtered-assignment-history.csv",
    );
    const exportedHistory = (await readFile((await assignmentDownload.path())!))
      .toString("utf8");
    expect(exportedHistory).toContain(people[0]);
    expect(exportedHistory).toContain(resource);
    expect(exportedHistory).toContain('"Assignment status"');
    expect(exportedHistory).not.toContain("private-person-id");
    expect(exportedHistory).not.toContain("PRIVATE SKILLS");
    await assignmentSort.selectOption("newest");
    await expect(assignmentSort).toHaveValue("newest");
    await assignmentSort.selectOption("oldest");
    await expect(assignmentSort).toHaveValue("oldest");
    await assignmentSearch.fill("");
    await assignmentSort.selectOption("retained");
    await assignmentFromDate.fill("2026-11-06");
    await assignmentThroughDate.fill("2026-11-06");
    await expect(historyCount).toContainText("Showing");
    await expect(assignmentHistory.locator("li")
      .filter({ hasText: people[0] }).first()).toBeVisible();
    await assignmentThroughDate.fill("2026-11-05");
    await expect(assignmentHistory.getByRole("alert")).toContainText(
      "From date must be on or before Through date.",
    );
    await expect(filteredHistoryCsv).toBeDisabled();
    await expect(assignmentHistory.getByText(
      "Fix the assignment start date range to see history.", { exact: true },
    )).toBeVisible();
    await assignmentFromDate.fill("2026-11-07");
    await assignmentThroughDate.fill("");
    await expect(assignmentHistory.getByText(
      "No retained assignments match these filters.", { exact: true },
    )).toBeVisible();
    await assignmentFromDate.fill("2026-11-06");
    await expect(assignmentHistory.locator("li")
      .filter({ hasText: people[0] }).first()).toBeVisible();
    await assignmentSearch.fill(people[0].toLowerCase());
    await expect(assignmentHistory.locator("li")
      .filter({ hasText: people[0] }).first()).toBeVisible();
    await assignmentStatus.selectOption("reserved");
    await expect(assignmentHistory.locator("li")
      .filter({ hasText: people[0] }).first()).toBeVisible();
    await assignmentStatus.selectOption("released");
    await expect(assignmentStatus).toHaveValue("released");
    await assignmentSearch.fill("no-matching-employee-or-appointment");
    await expect(assignmentHistory.getByText(
      "No retained assignments match these filters.", { exact: true },
    )).toBeVisible();
    await expect(filteredHistoryCsv).toBeDisabled();
    await assignmentHistory.getByRole("button", {
      name: "Clear assignment filters", exact: true,
    }).click();
    await expect(assignmentSearch).toHaveValue("");
    await expect(assignmentStatus).toHaveValue("all");
    await expect(assignmentSort).toHaveValue("retained");
    await expect(assignmentFromDate).toHaveValue("");
    await expect(assignmentThroughDate).toHaveValue("");
    await expect(assignmentHistory.locator("li")
      .filter({ hasText: people[0] }).first()).toBeVisible();
    await fits(page);
    expect(
      (
        await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
          .analyze()
      ).violations,
    ).toEqual([]);
    await page.screenshot({
      path: testInfo.outputPath(industry + "-crews.png"),
      fullPage: true,
    });
    // Reuse this same bounded fictional session; explicitly publish only the optional module.
    const session = await (await page.request.get("/api/demo")).json();
    const organizationId = session.session.organizations.find(
      (o: { industry: string }) => o.industry === industry,
    ).id;
    const scoped = await (
      await page.request.get(`/api/demo?organizationId=${organizationId}`)
    ).json();
    expect(
      scoped.workspace.config.document.modules.some(
        (m: { id: string }) => m.id === "equipment",
      ),
    ).toBe(false);
    const config = selectModules(scoped.workspace.config.document, [
      ...scoped.workspace.config.document.modules.map(
        (m: { id: string }) => m.id,
      ),
      "coordinated-scheduling",
    ]);
    expect(
      (
        await page.request.post("/api/demo", {
          headers: { Origin: new URL(page.url()).origin },
          data: {
            action: "configure",
            organizationId,
            document: config,
            revision: scoped.workspace.config.revision,
          },
        })
      ).ok(),
    ).toBe(true);
    await page.reload();
    await page.getByLabel("Business workspace", { exact: true }).selectOption({
      label: industry === "cleaning" ? "Cleaning Company" : "Property Manager",
    });
    await page.getByRole("button", { name: /^Equipment & Tools/ }).click();
    await page
      .getByRole("button", { name: "+ Add equipment item", exact: true })
      .click();
    const equipmentName = industry + " fictional equipment";
    await page
      .getByLabel("Equipment name *", { exact: true })
      .fill(equipmentName);
    await page
      .getByLabel("Business equipment ID (permanent) *", { exact: true })
      .fill("MACHINE-TEST-01");
    await page.getByLabel("Category", { exact: true }).fill("Reusable tools");
    await page
      .getByLabel("Serial number", { exact: true })
      .fill("FICTIONAL-SERIAL");
    await page
      .getByLabel("Barcode / asset tag", { exact: true })
      .fill("TOOL-TAG-01");
    await page.getByLabel("Storage location *", { exact: true }).selectOption({
      label: industry === "cleaning" ? "Supply shelf" : "Maintenance store",
    });
    // Optional purchase-cost remains empty: no accounting operation is required to register a tool.
    await save(page);
    const item = page.getByRole("article", {
      name: "Equipment " + equipmentName,
      exact: true,
    });
    await expect(item).toContainText("Needs inspection");
    await expect(
      item.getByRole("button", { name: "Check out", exact: true }),
    ).toHaveCount(0);
    const confirm = async () => {
      const d = page.getByRole("dialog");
      await d
        .getByRole("textbox")
        .last()
        .fill("Reviewed fictional equipment history");
      await d.getByRole("checkbox").check();
      expect(
        (
          await new AxeBuilder({ page })
            .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
            .analyze()
        ).violations,
      ).toEqual([]);
      await d
        .getByRole("button", { name: "Confirm equipment action", exact: true })
        .click();
      await expect(d).toHaveCount(0);
    };
    await item
      .getByRole("button", { name: "Review release", exact: true })
      .click();
    await page
      .getByRole("dialog")
      .getByRole("combobox", { name: "Technician / inspector", exact: true })
      .selectOption({ label: people[0] });
    await page
      .getByLabel("Service / inspection date", { exact: true })
      .fill("2026-11-01");
    await confirm();
    await expect(item).toContainText("Available for checkout");
    await item.getByRole("button", { name: "Check out", exact: true }).click();
    await page
      .getByRole("combobox", { name: "Responsible employee", exact: true })
      .selectOption({ label: people[0] });
    await page
      .getByRole("combobox", {
        name: "Optional crew / worker resource",
        exact: true,
      })
      .selectOption({ label: resource });
    await page
      .getByRole("combobox", {
        name: "Optional linked job / task",
        exact: true,
      })
      .selectOption({
        label:
          industry === "cleaning"
            ? "Maple House move-out"
            : "Inspect porch light",
      });
    await page
      .getByLabel("Checkout time", { exact: true })
      .fill("2026-11-01T08:00");
    await page
      .getByLabel("Expected return time", { exact: true })
      .fill("2026-11-01T17:00");
    await confirm();
    await expect(item).toContainText("Held by " + people[0]);
    await expect(item).toContainText("Overdue return");
    await item.getByRole("button", { name: "Begin use", exact: true }).click();
    await confirm();
    await expect(item).toContainText("In use");
    await item
      .getByRole("button", { name: "Report problem", exact: true })
      .click();
    await confirm();
    await item
      .getByRole("button", { name: "Record return", exact: true })
      .click();
    await page
      .getByLabel("Actual return time", { exact: true })
      .fill("2026-11-01T18:00");
    await confirm();
    await expect(item).toContainText("Needs inspection");
    await expect(
      item.getByRole("button", { name: "Review release", exact: true }),
    ).toHaveCount(0);
    await item
      .getByRole("button", { name: "Open maintenance", exact: true })
      .click();
    await page
      .getByRole("combobox", { name: "Open maintenance task", exact: true })
      .selectOption({ index: 1 });
    await confirm();
    await item
      .getByRole("button", { name: "Record service", exact: true })
      .click();
    await page
      .getByRole("dialog")
      .getByRole("combobox", { name: "Technician / inspector", exact: true })
      .selectOption({ label: people[0] });
    await page
      .getByLabel("Service / inspection date", { exact: true })
      .fill("2026-11-02");
    await page
      .getByLabel("Next inspection date (optional)", { exact: true })
      .fill("2026-12-06");
    await confirm();
    await expect(item).toContainText("Under maintenance");
    await expect(
      item.getByRole("button", { name: "Check out", exact: true }),
    ).toHaveCount(0);
    await item
      .getByText("Checkout & maintenance history", { exact: true })
      .click();
    await fits(page);
    expect(
      (
        await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
          .analyze()
      ).violations,
    ).toEqual([]);
    if (testInfo.project.name === "phone")
      await item
        .getByRole("heading", { name: equipmentName, exact: true })
        .scrollIntoViewIfNeeded();
    await page.screenshot({
      path: testInfo.outputPath(
        `fictional-equipment-${industry}-${industry === "cleaning" ? "light" : "dark"}.png`,
      ),
      fullPage: testInfo.project.name !== "phone",
    });
    await item
      .getByRole("button", { name: "Review release", exact: true })
      .click();
    await page
      .getByRole("dialog")
      .getByRole("combobox", { name: "Technician / inspector", exact: true })
      .selectOption({ label: people[0] });
    await page
      .getByLabel("Service / inspection date", { exact: true })
      .fill("2026-11-02");
    await expect(
      page.getByLabel("Next inspection date (optional)", { exact: true }),
    ).toHaveValue("2026-12-06");
    await confirm();
    await expect(item).toContainText("Available for checkout");
    const after = await (
      await page.request.get(`/api/demo?organizationId=${organizationId}`)
    ).json();
    expect(
      after.workspace.equipmentStates.find(
        (s: { record_id: string }) =>
          s.record_id ===
          after.workspace.records.find(
            (r: { entity: string; data: { name: string } }) =>
              r.entity === "equipment" && r.data.name === equipmentName,
          ).id,
      ).next_inspection,
    ).toBe("2026-12-06");
    expect(after.workspace.stockBalances).toEqual(
      scoped.workspace.stockBalances,
    );
    expect(after.workspace.stockMovements).toEqual(
      scoped.workspace.stockMovements,
    );
    // Explicit physical identity mapping; never adopt a calendar name as a machine.
    const calendarName = industry + " machine calendar";
    const created = await page.request.post("/api/demo", {
      headers: { Origin: new URL(page.url()).origin },
      data: {
        action: "save",
        organizationId,
        entity: "resources",
        data: { name: calendarName, kind: "Equipment" },
        operationId: crypto.randomUUID(),
      },
    });
    expect(created.ok()).toBe(true);
    await page.reload();
    await page.getByLabel("Business workspace", { exact: true }).selectOption({
      label: industry === "cleaning" ? "Cleaning Company" : "Property Manager",
    });
    await page.getByRole("button", { name: /^Equipment & Tools/ }).click();
    const mappingSummary = item.getByText("Review calendar mapping", {
      exact: true,
    });
    await mappingSummary.focus();
    await page.keyboard.press("Enter");
    await item
      .getByLabel("Equipment calendar resource", { exact: true })
      .selectOption({ label: calendarName + " · revision 1" });
    await item
      .getByLabel("Mapping review reason", { exact: true })
      .fill("Reviewed this exact fictional physical machine");
    await item
      .getByRole("checkbox", {
        name: "I reviewed this exact equipment, calendar resource and current revisions.",
      })
      .check();
    await item
      .getByRole("button", { name: "Confirm equipment mapping", exact: true })
      .click();
    await expect(item).toContainText("mapping revision 1");
    await page.getByRole("button", { name: "Schedule", exact: true }).click();
    await page
      .getByRole("button", { name: "+ Add appointment", exact: true })
      .click();
    const machineTitle = industry + " reserved floor machine";
    await page
      .getByLabel("Appointment title *", { exact: true })
      .fill(machineTitle);
    await page.getByLabel("Customer *", { exact: true }).selectOption({
      label: industry === "cleaning" ? "Jordan Sample" : "Alex Example",
    });
    await page
      .getByLabel(
        industry === "cleaning" ? "Cleaning job *" : "Maintenance request *",
        { exact: true },
      )
      .selectOption({
        label:
          industry === "cleaning"
            ? "Maple House move-out"
            : "Inspect porch light",
      });
    await page
      .getByLabel(
        industry === "cleaning"
          ? "Assigned crew / resource *"
          : "Assigned worker / resource *",
        { exact: true },
      )
      .selectOption({ label: calendarName });
    await page
      .getByLabel("Start time *", { exact: true })
      .fill("2026-11-06T10:00");
    await page
      .getByLabel("End time *", { exact: true })
      .fill("2026-11-06T11:00");
    await save(page);
    await expect(
      page.getByRole("heading", { name: machineTitle, exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Schedule", exact: true }).click();
    await page.getByLabel("Schedule date", { exact: true }).fill("2026-11-06");
    await expect(
      page.getByRole("article", { name: machineTitle, exact: true }),
    ).toContainText(equipmentName);
    const reserved = await (
      await page.request.get(`/api/demo?organizationId=${organizationId}`)
    ).json();
    const reservedAppointment = reserved.workspace.records.find(
      (r: { data: { title: string } }) => r.data.title === machineTitle,
    );
    const conflict = await page.request.post("/api/demo", {
      headers: { Origin: new URL(page.url()).origin },
      data: {
        action: "save",
        organizationId,
        entity: "appointments",
        data: reservedAppointment.data,
        operationId: crypto.randomUUID(),
      },
    });
    expect(conflict.status()).toBe(409);
    expect((await conflict.json()).error).toMatch(
      /already has an appointment/i,
    );
    // One appointment now deliberately reserves the staffed primary and the physical machine.
    await page
      .getByRole("button", { name: "+ Add appointment", exact: true })
      .click();
    const coordinatedTitle = industry + " crew and floor machine";
    await page
      .getByLabel("Appointment title *", { exact: true })
      .fill(coordinatedTitle);
    await page
      .getByLabel("Customer *", { exact: true })
      .selectOption({
        label: industry === "cleaning" ? "Jordan Sample" : "Alex Example",
      });
    await page
      .getByLabel(
        industry === "cleaning" ? "Cleaning job *" : "Maintenance request *",
        { exact: true },
      )
      .selectOption({
        label:
          industry === "cleaning"
            ? "Maple House move-out"
            : "Inspect porch light",
      });
    await page
      .getByLabel(
        industry === "cleaning"
          ? "Assigned crew / resource *"
          : "Assigned worker / resource *",
        { exact: true },
      )
      .selectOption({ label: resource });
    await page
      .getByLabel("Additional equipment (optional)", { exact: true })
      .selectOption({ label: calendarName });
    await page
      .getByLabel("Start time *", { exact: true })
      .fill("2026-11-06T12:00");
    await page
      .getByLabel("End time *", { exact: true })
      .fill("2026-11-06T13:00");
    await page
      .getByRole("checkbox", {
        name: "I reviewed the primary resource and optional equipment for this exact appointment.",
      })
      .check();
    await save(page);
    await expect(
      page.getByRole("heading", { name: coordinatedTitle, exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Schedule", exact: true }).click();
    await page.getByLabel("Schedule date", { exact: true }).fill("2026-11-06");
    const combined = page.getByRole("article", {
      name: coordinatedTitle,
      exact: true,
    });
    await expect(combined).toContainText(resource);
    await expect(combined).toContainText("Additional equipment:");
    await expect(combined).toContainText("MACHINE-TEST-01");
    for (const name of people) await expect(combined).toContainText(name);
    await combined
      .getByRole("button", { name: "Edit " + coordinatedTitle, exact: true })
      .click();
    await expect(
      page.getByLabel("Additional equipment (optional)", { exact: true }),
    ).toHaveValue(reserved.workspace.equipmentMappings[0].resource_id);
    await page
      .getByLabel("Start time *", { exact: true })
      .fill("2026-11-06T13:00");
    await page
      .getByLabel("End time *", { exact: true })
      .fill("2026-11-06T14:00");
    await page
      .getByRole("checkbox", {
        name: "I reviewed the primary resource and optional equipment for this exact appointment.",
      })
      .check();
    await save(page);
    await page.getByRole("button", { name: "Schedule", exact: true }).click();
    await page.getByLabel("Schedule date", { exact: true }).fill("2026-11-06");
    await combined
      .getByRole("button", { name: "Archive " + coordinatedTitle, exact: true })
      .click();
    await page
      .getByRole("button", { name: "Confirm archive", exact: true })
      .click();
    await page.getByRole("button", { name: "Schedule", exact: true }).click();
    await page.getByLabel("Schedule date", { exact: true }).fill("2026-11-06");
    await page
      .getByLabel("Show archived appointments", { exact: true })
      .check();
    await combined
      .getByRole("button", { name: "Restore " + coordinatedTitle, exact: true })
      .click();
    await page
      .getByRole("button", { name: "Confirm restore", exact: true })
      .click();
    await page.getByRole("button", { name: "Schedule", exact: true }).click();
    await page.getByLabel("Schedule date", { exact: true }).fill("2026-11-06");
    const both = await (
        await page.request.get(`/api/demo?organizationId=${organizationId}`)
      ).json(),
      coordinated = both.workspace.records.find(
        (r: { data: { title: string } }) => r.data.title === coordinatedTitle,
      );
    const allocations = both.workspace.appointmentAllocations.filter(
      (a: { appointment_id: string; present: boolean; blocking: boolean }) =>
        a.appointment_id === coordinated.id && a.present && a.blocking,
    );
    expect(allocations).toHaveLength(2);
    expect(allocations[0].starts_at).toBe(allocations[1].starts_at);
    expect(coordinated.revision).toBe(4);
    const crossSlot = await page.request.post("/api/demo", {
      headers: { Origin: new URL(page.url()).origin },
      data: {
        action: "save",
        organizationId,
        entity: "appointments",
        data: {
          ...coordinated.data,
          resource: allocations.find(
            (a: { slot: string }) => a.slot === "Equipment",
          ).resource_id,
        },
        operationId: crypto.randomUUID(),
      },
    });
    expect(crossSlot.status()).toBe(409);
    const reviewed = reviewAppointmentResources(
      both.workspace.config.revision,
      both.workspace.records,
      both.workspace.equipmentMappings,
      String(coordinated.data.resource),
      allocations.find((a: { slot: string }) => a.slot === "Equipment")
        .resource_id,
    );
    const opposite = await page.request.post("/api/demo", {
      headers: { Origin: new URL(page.url()).origin },
      data: {
        action: "save",
        organizationId,
        entity: "appointments",
        data: {
          ...coordinated.data,
          start: reservedAppointment.data.start,
          end: reservedAppointment.data.end,
        },
        resources: reviewed,
        operationId: crypto.randomUUID(),
      },
    });
    expect(opposite.status()).toBe(409);
    await fits(page);
    expect(
      (
        await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
          .analyze()
      ).violations,
    ).toEqual([]);
    await page.screenshot({
      path: testInfo.outputPath(
        `fictional-coordinated-schedule-${industry}.png`,
      ),
      fullPage: testInfo.project.name !== "phone",
    });
    await page.getByRole("button", { name: /^Equipment & Tools/ }).click();
    await item
      .getByRole("button", { name: "Report problem", exact: true })
      .click();
    await confirm();
    await expect(item).toContainText(
      "Safety review required — appointment retained",
    );
    await item
      .getByText("Check availability for a period", { exact: true })
      .click();
    await item
      .getByLabel("Equipment period start", { exact: true })
      .fill("2026-11-06T10:00");
    await item
      .getByLabel("Equipment period end", { exact: true })
      .fill("2026-11-06T11:00");
    await expect(item).toContainText("Blocked for inspection or maintenance");
    await fits(page);
    expect(
      (
        await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
          .analyze()
      ).violations,
    ).toEqual([]);
    await item
      .getByRole("heading", { name: "Equipment calendar", exact: true })
      .scrollIntoViewIfNeeded();
    await page.screenshot({
      path: testInfo.outputPath(
        `fictional-coordinated-equipment-${industry}.png`,
      ),
      fullPage: testInfo.project.name !== "phone",
    });
    const retained = await (
      await page.request.get(`/api/demo?organizationId=${organizationId}`)
    ).json();
    expect(
      retained.workspace.records.find(
        (r: { id: string }) => r.id === reservedAppointment.id,
      ),
    ).toEqual(reservedAppointment);
    expect(retained.workspace.equipmentCheckouts).toEqual(
      after.workspace.equipmentCheckouts,
    );
    expect(retained.workspace.stockMovements).toEqual(
      scoped.workspace.stockMovements,
    );
  }
});
