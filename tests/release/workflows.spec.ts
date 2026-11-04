import { readFile } from "node:fs/promises";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { parseBuildPlanText } from "../../src/core/buildplan";

const fixtures = {
  cleaning: {
    business: "Cleaning Company",
    workNav: /^Cleaning jobs/,
    addWork: "+ Add cleaning job",
    workTitle: "Job title *",
    linkedWork: "Cleaning job",
    resourceNav: /^Crews & resources/,
    addResource: "+ Add crew or resource",
    resourceType: "Crew",
    resourceLabel: "Assigned crew / resource *",
    location: "Supply shelf",
    sku: "CL-CLOTH-01",
    stock: "33 cloth",
    service: "Home cleaning · USD 35.00 / hour",
    total: "USD 70.00",
  },
  property: {
    business: "Property Manager",
    workNav: /^(Maintenance requests|Tasks)/,
    addWork: /^\+ Add (maintenance request|task)$/,
    workTitle: "Task title *",
    linkedWork: "Maintenance request",
    resourceNav: /^Workers & resources/,
    addResource: "+ Add worker or resource",
    resourceType: "Worker",
    resourceLabel: "Assigned worker / resource *",
    location: "Maintenance store",
    sku: "RV-FIT-01",
    stock: "33 fitting",
    service: "Maintenance labor · USD 55.00 / hour",
    total: "USD 110.00",
  },
};

async function checkLayout(page: Page) {
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth,
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

for (const industry of ["cleaning", "property"] as const) {
  test(`installed demo completes a fictional ${industry} business workflow`, async ({
    page,
    context,
  }, info) => {
    test.setTimeout(180_000);
    page.setDefaultTimeout(15_000);
    const sample = fixtures[industry];
    const name = `Fictional ${industry} release`;
    const customer = `${name} customer`;
    const work = `${name} work`;
    const estimate = `${name} estimate`;
    const button = (label: string | RegExp) =>
      page.getByRole("button", { name: label, exact: true });
    const field = (label: string) => page.getByLabel(label, { exact: true });
    const save = () => button("Save record").click();
    const step = (label: string) =>
      page
        .getByRole("navigation", { name: "BuildPlan steps" })
        .getByRole("button", { name: label, exact: true })
        .click();

    await page.goto("/");
    const entry = page.getByRole("button", {
      name: /Explore the working demo/,
    });
    await expect(
      page.getByRole("region", { name: "First visit" }),
    ).toBeVisible();
    await checkLayout(page);
    await entry.focus();
    await entry.press("Enter");
    await expect(
      page.getByRole("heading", { name: "Cedar Grove Property" }),
    ).toBeVisible();
    await field("Business workspace").selectOption({ label: sample.business });
    await button("BuildPlan Studio").click();
    await step("2 · Features");
    await page.getByRole("checkbox", { name: /Equipment & Tools/ }).check();
    await page.getByRole("checkbox", { name: /Invoice Drafts/ }).check();
    await step("3 · Customize");
    await field("Business name").fill(name);
    await field("Include business branding in this BuildPlan").check();
    await field("Tagline or slogan (optional)").fill(
      "Made-up work for the local demo.",
    );
    await field("Default workspace appearance").selectOption(
      industry === "property" ? "dark" : "light",
    );
    await step("4 · Review & try");
    await button("Prepare workspace preview").click();
    const previewLink = page.getByRole("link", {
      name: "Open interactive workspace preview (new tab)",
    });
    const [preview] = await Promise.all([
      context.waitForEvent("page"),
      previewLink.click(),
    ]);
    await expect(
      preview.getByRole("heading", { name, exact: true }),
    ).toBeVisible();
    await checkLayout(preview);
    await preview.close();
    const downloadEvent = page.waitForEvent("download");
    await button("Export BuildPlan JSON").click();
    const download = await downloadEvent;
    const plan = parseBuildPlanText(
      await readFile((await download.path())!, "utf8"),
    );
    expect(plan.version).toBe(2);
    expect(plan.configuration.name).toBe(name);
    expect(plan.configuration.modules.map(({ id }) => id)).toEqual(
      expect.arrayContaining(["equipment", "invoice-drafts"]),
    );
    const publish = button("Publish reviewed BuildPlan");
    await expect(publish).toBeDisabled();
    await button("Save BuildPlan draft").click();
    const confirmation = page.getByRole("checkbox", {
      name: /I reviewed this saved plan/,
    });
    await expect(confirmation).toBeEnabled();
    await confirmation.focus();
    await confirmation.press("Space");
    await publish.click();
    await expect(page.locator(".topbar")).toContainText(name);

    await button(/^Customers/).click();
    await button("+ Add customer").click();
    await field("Name *").fill(customer);
    await save();
    await expect(
      page.getByRole("heading", { name: customer, exact: true }),
    ).toBeVisible();

    await button(sample.workNav).click();
    await button(sample.addWork).click();
    await field(sample.workTitle).fill(work);
    await field("Customer").selectOption({ label: customer });
    if (industry === "cleaning") {
      await field("Service *").selectOption("Deep clean");
      await field("Service date *").fill("2026-11-06");
      await field("Status *").selectOption("Planned");
    } else {
      await field("Site or unit").selectOption({ label: "Cabin 02" });
      await field("Status *").selectOption("Open");
    }
    await save();
    await expect(
      page.getByRole("heading", { name: work, exact: true }),
    ).toBeVisible();

    await button(sample.resourceNav).click();
    await button(sample.addResource).click();
    await field("Resource name *").fill(name + " resource");
    await field("Resource type *").selectOption(sample.resourceType);
    await save();
    await button("Schedule").click();
    await button("+ Add appointment").click();
    await field("Appointment title *").fill(name + " appointment");
    await field("Customer *").selectOption({ label: customer });
    await field(sample.linkedWork + " *").selectOption({ label: work });
    await field(sample.resourceLabel).selectOption({
      label: name + " resource",
    });
    await field("Start time *").fill("2026-11-06T10:00");
    await field("End time *").fill("2026-11-06T11:00");
    await save();
    await button("Schedule").click();
    await field("Schedule date").fill("2026-11-06");
    const booking = page.getByRole("article", { name: name + " appointment" });
    await expect(booking).toContainText(work);
    await expect(booking).toContainText(customer);
    await checkLayout(page);
    await booking.scrollIntoViewIfNeeded();
    await page.screenshot({ path: info.outputPath("release-schedule.png") });

    await button(/^Equipment & Tools/).click();
    await button("+ Add equipment item").click();
    await field("Equipment name *").fill(name + " tool");
    await field("Business equipment ID (permanent) *").fill("RELEASE-TOOL");
    await field("Storage location *").selectOption({ label: sample.location });
    await save();
    const tool = page.getByRole("article", {
      name: "Equipment " + name + " tool",
    });
    await expect(tool).toContainText("RELEASE-TOOL");
    await expect(
      tool.getByRole("button", { name: "Check out", exact: true }),
    ).toHaveCount(0);

    await button("Inventory & stock").click();
    await field("Scan or enter barcode / SKU").fill(sample.sku);
    await field("Scan or enter barcode / SKU").press("Enter");
    await field("Movement title *").fill(name + " receipt");
    await field("Quantity *").fill("1");
    await field("Quantity packaging *").selectOption("Cases");
    await field("Storage location *").selectOption({ label: sample.location });
    await field("Movement reason *").fill("Fictional delivery");
    await field(
      "I reviewed this fictional stock movement and its locations.",
    ).check();
    await button("Post stock movement").click();
    await expect(
      page.getByRole("article", { name: /^Product / }),
    ).toContainText(sample.location + ": " + sample.stock);

    await button(/^Estimates/).click();
    await button("+ Add estimate draft").click();
    await field("Estimate title *").fill(estimate);
    await field("Customer *").selectOption({ label: customer });
    await field(sample.linkedWork).selectOption({ label: work });
    await field("Pricing zone *").selectOption({ label: "Local service area" });
    await field("Pricing date *").fill("2026-11-06");
    await button("+ Add line").click();
    await field("Line 1 service or extra *").selectOption({
      label: sample.service,
    });
    await field("Line 1 quantity *").fill("2");
    const confirmEstimate = field(
      "I reviewed the amounts and confirm this is a fictional internal draft only.",
    );
    await confirmEstimate.check();
    await button("Save estimate draft").click();
    const card = page.getByRole("article", { name: "Estimate " + estimate });
    await expect(card).toContainText(sample.total);
    await card.getByRole("button", { name: "Edit " + estimate }).click();
    await field("Draft status *").selectOption("Reviewed draft");
    await confirmEstimate.check();
    await button("Save estimate draft").click();
    await expect(card).toContainText("Reviewed draft");
    await card
      .getByRole("button", { name: "Create Invoice Draft from Estimate" })
      .click();
    const conversion = page.getByRole("dialog", {
      name: "Review estimate conversion",
    });
    await expect(conversion).toContainText(sample.total);
    const convert = conversion.getByRole("button", {
      name: "Confirm create invoice draft",
    });
    await expect(convert).toBeDisabled();
    await conversion
      .getByRole("checkbox", { name: /I reviewed this exact revision/ })
      .check();
    await convert.click();
    const invoice = page.getByRole("article", {
      name: "Invoice draft " + estimate,
    });
    await expect(invoice).toContainText("FICTIONAL DRAFT — NOT ISSUED");
    await expect(invoice).toContainText(sample.total);
    await checkLayout(page);
    await invoice.scrollIntoViewIfNeeded();
    await page.screenshot({ path: info.outputPath("release-invoice.png") });
  });
}
