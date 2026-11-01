import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
test("saved rates populate fictional cleaning and maintenance drafts, retain snapshots and print accessibly", async ({
  page,
}, testInfo) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Explore the working demo" }).click();
  await expect(
    page.getByRole("heading", { name: "Cedar Grove Property" }),
  ).toBeVisible();
  for (const industry of ["cleaning", "property"] as const) {
    await page.getByLabel("Business workspace", { exact: true }).selectOption({
      label: industry === "cleaning" ? "Cleaning Company" : "Property Manager",
    });
    const service =
        industry === "cleaning" ? "Home cleaning" : "Maintenance labor",
      customer = industry === "cleaning" ? "Jordan Sample" : "Alex Example",
      work =
        industry === "cleaning"
          ? "Maple House move-out"
          : "Inspect porch light",
      title = `${industry} fictional draft test`;
    await page
      .getByRole("button", { name: "Services & Rates", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Services & Rates", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("article", { name: "Service " + service, exact: true }),
    ).toContainText("Hourly");
    await page.getByRole("button", { name: /^Estimates/ }).click();
    await page
      .getByRole("button", { name: "+ Add estimate draft", exact: true })
      .click();
    await page.getByLabel("Estimate title *", { exact: true }).fill(title);
    await page
      .getByLabel("Customer *", { exact: true })
      .selectOption({ label: customer });
    await page
      .getByLabel(
        industry === "cleaning" ? "Cleaning job" : "Maintenance request",
        { exact: true },
      )
      .selectOption({ label: work });
    await page
      .getByLabel("Pricing zone *", { exact: true })
      .selectOption({ label: "Local service area" });
    await page.getByLabel("Pricing date *", { exact: true }).fill("2026-11-06");
    await page.getByRole("button", { name: "+ Add line", exact: true }).click();
    await page
      .getByLabel("Line 1 service or extra *", { exact: true })
      .selectOption({
        label:
          service +
          " · USD " +
          (industry === "cleaning" ? "35.00" : "55.00") +
          " / hour",
      });
    await page.getByLabel("Line 1 quantity *", { exact: true }).fill("1.5");
    await page
      .getByLabel("Discount type", { exact: true })
      .selectOption("Amount");
    await page
      .getByLabel("Discount amount (USD)", { exact: true })
      .fill("2.00");
    await page
      .getByLabel("Tax handling", { exact: true })
      .selectOption("Manual");
    await page.getByLabel("Manual tax percent", { exact: true }).fill("8.25");
    await page
      .getByLabel("Manual tax label *", { exact: true })
      .fill("Fictional manual tax");
    const total = industry === "cleaning" ? "USD 54.67" : "USD 87.14";
    await expect(page.getByLabel("Estimate calculation")).toContainText(total);
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
    await page
      .getByLabel(
        "I reviewed the amounts and confirm this is a fictional internal draft only.",
        { exact: true },
      )
      .check();
    await page
      .getByRole("button", { name: "Save estimate draft", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: title, exact: true }),
    ).toBeVisible();
    // A new browser load reads saved catalog and estimate records from this bounded demo runtime.
    await page.reload();
    await expect(
      page.getByRole("heading", { name: "Customers", exact: true }),
    ).toBeVisible();
    if (industry === "cleaning")
      await page
        .getByLabel("Business workspace", { exact: true })
        .selectOption({ label: "Cleaning Company" });
    await page
      .getByRole("button", { name: "Services & Rates", exact: true })
      .click();
    const rate = page.getByRole("article", {
      name: "Rate Local hourly rate",
      exact: true,
    });
    await rate
      .getByRole("button", { name: "Edit Local hourly rate", exact: true })
      .click();
    await page.getByLabel("Unit price (USD) *", { exact: true }).fill("99.00");
    await page
      .getByRole("button", { name: "Save record", exact: true })
      .click();
    await page.getByRole("button", { name: /^Estimates/ }).click();
    const card = page.getByRole("article", {
      name: "Estimate " + title,
      exact: true,
    });
    await expect(card).toContainText(total);
    await card
      .getByRole("button", { name: "Preview " + title, exact: true })
      .click();
    const dialog = page.getByRole("dialog", { name: title, exact: true });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("FICTIONAL INTERNAL ESTIMATE DRAFT");
    await expect(dialog).toContainText(total);
    await expect(dialog).not.toContainText("USD 99.00");
    expect(
      (
        await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
          .analyze()
      ).violations,
    ).toEqual([]);
    await page.emulateMedia({ media: "print" });
    await expect(
      dialog.getByRole("button", { name: "Print fictional draft" }),
    ).toBeHidden();
    await expect(page.locator(".topbar")).toBeHidden();
    await expect(dialog.getByText(total, { exact: true })).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath(industry + "-estimate-print.png"),
      fullPage: true,
    });
    await page.emulateMedia({ media: "screen" });
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await card
      .getByRole("button", { name: "Edit " + title, exact: true })
      .click();
    await page
      .getByLabel("Draft status *", { exact: true })
      .selectOption("Reviewed draft");
    await page
      .getByLabel(
        "I reviewed the amounts and confirm this is a fictional internal draft only.",
        { exact: true },
      )
      .check();
    await page
      .getByRole("button", { name: "Save estimate draft", exact: true })
      .click();
    await page.getByRole("button", { name: /^Estimates/ }).click();
    await expect(
      page.getByRole("article", { name: "Estimate " + title, exact: true }),
    ).toContainText("Reviewed draft");
    await page
      .getByRole("article", { name: "Estimate " + title, exact: true })
      .getByText("Status and pricing history", { exact: true })
      .click();
    await expect(
      page
        .getByRole("article", { name: "Estimate " + title, exact: true })
        .getByText("v1 · Draft", { exact: true }),
    ).toBeVisible();
    if (industry === "cleaning")
      await page
        .getByRole("button", { name: "Switch to dark theme", exact: true })
        .click();
  }
});
