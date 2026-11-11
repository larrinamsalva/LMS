import { expect, test } from "@playwright/test";
import { selectModules } from "../../src/core/buildplan";
import AxeBuilder from "@axe-core/playwright";
import { readFile } from "node:fs/promises";
test("saved rates populate fictional cleaning and maintenance drafts, retain snapshots and print accessibly", async ({
  page,
}, testInfo) => {
  test.setTimeout(180000);
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
    const rateCardPending = page.waitForEvent("download");
    await page.getByRole("button", {
      name: "Download active service rates CSV", exact: true,
    }).click();
    const rateCardDownload = await rateCardPending;
    expect(rateCardDownload.suggestedFilename()).toBe(
      "lms-active-service-rates.csv",
    );
    const rateCardText = (await readFile((await rateCardDownload.path())!))
      .toString("utf8");
    expect(rateCardText).toContain("Local hourly rate");
    expect(rateCardText).toContain("Local service area");
    expect(rateCardText).toContain(
      '"' + (industry === "cleaning" ? "35.00" : "55.00") + '"',
    );
    expect(rateCardText).toContain('"Effective until (exclusive)"');
    expect(rateCardText).not.toContain(customer);
    expect(rateCardText).not.toContain(work);
    const rateDate = page.getByLabel("Rates covering date (optional)", {
      exact: true,
    });
    await rateDate.fill("2025-11-06");
    await expect(page.getByRole("article", {
      name: "Rate Local hourly rate", exact: true,
    })).toHaveCount(0);
    await expect(page.getByText(
      "No saved rates match the selected status, date and service area.",
      { exact: true },
    )).toBeVisible();
    await expect(page.getByRole("button", {
      name: "Download active service rates CSV", exact: true,
    })).toBeDisabled();
    await rateDate.fill("2026-11-06");
    await expect(page.getByRole("article", {
      name: "Rate Local hourly rate", exact: true,
    })).toBeVisible();
    const filteredPending = page.waitForEvent("download");
    await page.getByRole("button", {
      name: "Download active service rates CSV", exact: true,
    }).click();
    const filteredDownload = await filteredPending;
    const filteredCsv = (await readFile((await filteredDownload.path())!))
      .toString("utf8");
    expect(filteredCsv).toContain('"Local hourly rate"');
    expect(filteredCsv).not.toContain(customer);
    const areaFilter = page.getByLabel("Filter service rates by area", {
      exact: true,
    });
    await areaFilter.selectOption({ label: "Local service area" });
    await expect(page.getByRole("article", {
      name: "Rate Local hourly rate", exact: true,
    })).toBeVisible();
    await expect(page.getByRole("article", {
      name: "Rate Outer-area hourly rate", exact: true,
    })).toHaveCount(0);
    const areaDownloadPending = page.waitForEvent("download");
    await page.getByRole("button", {
      name: "Download active service rates CSV", exact: true,
    }).click();
    const areaDownload = await areaDownloadPending;
    const areaCsv = (await readFile((await areaDownload.path())!))
      .toString("utf8");
    expect(areaCsv).toContain('"Local hourly rate"');
    expect(areaCsv).not.toContain('"Outer-area hourly rate"');
    expect(areaCsv).not.toContain(customer);
    await areaFilter.selectOption({ label: "Outer service area" });
    await expect(page.getByRole("article", {
      name: "Rate Local hourly rate", exact: true,
    })).toHaveCount(0);
    await expect(page.getByRole("article", {
      name: "Rate Outer-area hourly rate", exact: true,
    })).toBeVisible();
    await rateDate.fill("2025-11-06");
    await expect(page.getByRole("button", {
      name: "Download active service rates CSV", exact: true,
    })).toBeDisabled();
    await rateDate.fill("");
    await areaFilter.selectOption("");
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
    // Optional capability is explicitly published through the existing fictional configuration control.
    const current = await (await page.request.get("/api/demo")).json();
    const organizationId = current.session.organizations.find(
      (o: { industry: string }) => o.industry === industry,
    ).id;
    const scoped = await (
      await page.request.get(`/api/demo?organizationId=${organizationId}`)
    ).json();
    expect(
      scoped.workspace.config.document.modules.some(
        (m: { id: string }) => m.id === "invoice-drafts",
      ),
    ).toBe(false);
    const configuration = selectModules(scoped.workspace.config.document, [
      ...scoped.workspace.config.document.modules.map(
        (m: { id: string }) => m.id,
      ),
      "invoice-drafts",
    ]);
    const configured = await page.request.post("/api/demo", {
      headers: { Origin: new URL(page.url()).origin },
      data: {
        action: "configure",
        organizationId,
        document: configuration,
        revision: scoped.workspace.config.revision,
      },
    });
    expect(configured.ok()).toBe(true);
    await page.reload();
    await page
      .getByLabel("Business workspace", { exact: true })
      .selectOption({
        label:
          industry === "cleaning" ? "Cleaning Company" : "Property Manager",
      });
    await page.getByRole("button", { name: /^Estimates/ }).click();
    const reviewedCard = page.getByRole("article", {
      name: "Estimate " + title,
      exact: true,
    });
    await reviewedCard
      .getByRole("button", {
        name: "Create Invoice Draft from Estimate",
        exact: true,
      })
      .click();
    const conversion = page.getByRole("dialog", {
      name: "Review estimate conversion",
    });
    await expect(conversion).toContainText(total);
    await expect(
      conversion.getByRole("button", { name: "Confirm create invoice draft" }),
    ).toBeDisabled();
    expect(
      (
        await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
          .analyze()
      ).violations,
    ).toEqual([]);
    await conversion
      .getByLabel(
        "I reviewed this exact revision and confirm this fictional, unissued draft action.",
        { exact: true },
      )
      .check();
    await conversion
      .getByRole("button", {
        name: "Confirm create invoice draft",
        exact: true,
      })
      .click();
    const invoice = page.getByRole("article", {
      name: "Invoice draft " + title,
      exact: true,
    });
    await expect(invoice).toContainText(total);
    await expect(invoice).toContainText("FICTIONAL DRAFT — NOT ISSUED");
    await page.getByLabel("Search invoice drafts").fill("no match");
    await expect(invoice).toHaveCount(0);
    await page.getByLabel("Search invoice drafts").fill(customer);
    await expect(invoice).toBeVisible();
    await invoice
      .getByRole("button", { name: "Correct draft", exact: true })
      .click();
    const correction = page.getByRole("dialog", {
      name: "Correct invoice draft",
    });
    await correction.getByLabel("Line 1 quantity", { exact: true }).fill("2");
    await correction
      .getByLabel("Reason for correction", { exact: true })
      .fill("Corrected fictional visit duration");
    await correction
      .getByLabel(
        "I reviewed this exact revision and confirm this fictional, unissued draft action.",
        { exact: true },
      )
      .check();
    expect(
      (
        await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
          .analyze()
      ).violations,
    ).toEqual([]);
    await correction
      .getByRole("button", { name: "Save correction revision", exact: true })
      .click();
    await invoice
      .getByText("Financial revision history", { exact: true })
      .click();
    await expect(invoice).toContainText("v1 · Draft");
    await expect(invoice).toContainText("v2 · Draft");
    await invoice
      .getByRole("button", { name: "Open invoice revision 1", exact: true })
      .click();
    const print = page.getByRole("dialog", { name: title, exact: true });
    await expect(print).toContainText(total);
    await expect(print).not.toContainText("USD 99.00");
    await expect(print).toContainText("FICTIONAL DRAFT — NOT ISSUED");
    await page.emulateMedia({ media: "print" });
    await expect(page.locator(".topbar")).toBeHidden();
    await expect(
      print.getByRole("button", { name: "Print fictional draft" }),
    ).toBeHidden();
    await page.screenshot({
      path: testInfo.outputPath(`fictional-invoice-${industry}-print.png`),
      fullPage: true,
    });
    await page.emulateMedia({ media: "screen" });
    await page.keyboard.press("Escape");
    await page.screenshot({
      path: testInfo.outputPath(
        `fictional-invoice-${industry}-${industry === "cleaning" ? "light" : "dark"}.png`,
      ),
      fullPage: true,
    });
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
    await invoice
      .getByRole("button", { name: "Void draft", exact: true })
      .click();
    const voidReview = page.getByRole("dialog", { name: "Void invoice draft" });
    await voidReview
      .getByLabel("Reason for void", { exact: true })
      .fill("Voided fictional demonstration draft");
    await voidReview
      .getByLabel(
        "I reviewed this exact revision and confirm this fictional, unissued draft action.",
        { exact: true },
      )
      .check();
    await voidReview
      .getByRole("button", { name: "Confirm void draft", exact: true })
      .click();
    await expect(invoice).toContainText("Void · v3");
    await expect(
      invoice.getByRole("button", { name: "Correct draft", exact: true }),
    ).toHaveCount(0);
    if (industry === "cleaning")
      await page
        .getByRole("button", { name: "Switch to dark theme", exact: true })
        .click();
  }
});
