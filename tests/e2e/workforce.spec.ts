import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
const directory = async (page: Page) => {
  await page
    .getByRole("button", { name: "Crews & availability", exact: true })
    .click();
};
const save = async (page: Page) => {
  await page.getByRole("button", { name: "Save record", exact: true }).click();
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
  await page.goto("/");
  await page.getByRole("button", { name: "Explore the working demo" }).click();
  await expect(
    page.getByRole("heading", { name: "Cedar Grove Property" }),
  ).toBeVisible();
  for (const industry of ["cleaning", "property"] as const) {
    await page
      .getByLabel("Business workspace", { exact: true })
      .selectOption({
        label:
          industry === "cleaning" ? "Cleaning Company" : "Property Manager",
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
    await page
      .getByLabel("Availability date", { exact: true })
      .fill("2026-11-06");
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
    await page.getByText(/Assignment history ·/).click();
    await expect(
      page.getByText("Reserved", { exact: false }).first(),
    ).toBeVisible();
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
  }
});
