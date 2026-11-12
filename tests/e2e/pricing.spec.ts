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
    const catalogSearch = page.getByLabel("Search catalog cards", {
      exact: true,
    });
    await catalogSearch.fill("  OUTER  ");
    await expect(page.getByRole("article", {
      name: "Rate Outer-area hourly rate", exact: true,
    })).toBeVisible();
    await expect(page.getByRole("article", {
      name: "Rate Local hourly rate", exact: true,
    })).toHaveCount(0);
    await expect(page.getByRole("article", {
      name: "Pricing area Outer service area", exact: true,
    })).toBeVisible();
    await expect(page.getByRole("article", {
      name: "Service " + service, exact: true,
    })).toHaveCount(0);
    await catalogSearch.fill(service.toUpperCase());
    await expect(page.getByRole("article", {
      name: "Service " + service, exact: true,
    })).toBeVisible();
    await expect(page.getByRole("article", {
      name: "Rate Local hourly rate", exact: true,
    })).toBeVisible();
    await catalogSearch.fill("not a saved catalog item");
    await expect(page.getByText(
      "No saved rates match this search and the selected filters.",
      { exact: true },
    )).toBeVisible();
    await expect(page.getByRole("button", {
      name: "Download active service rates CSV", exact: true,
    })).toBeEnabled();
    await page.getByRole("button", {
      name: "Clear catalog search", exact: true,
    }).click();
    await expect(catalogSearch).toHaveValue("");
    await expect(page.getByRole("article", {
      name: "Rate Local hourly rate", exact: true,
    })).toBeVisible();
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
    const upcoming = page.getByRole("region", {
      name: "Upcoming rate dates", exact: true,
    });
    const upcomingWindow = page.getByLabel("Review upcoming period", {
      exact: true,
    });
    const upcomingCsvButton = upcoming.getByRole("button", {
      name: "Download upcoming rate dates CSV", exact: true,
    });
    await expect(upcomingCsvButton).toBeDisabled();
    await expect(upcoming).toContainText(
      "Choose a rate date above to review upcoming saved-rate dates.",
    );
    const allAreas = page.getByRole("region", {
      name: "All-area rate coverage", exact: true,
    });
    const allAreaCsvButton = allAreas.getByRole("button", {
      name: "Download all-area rate coverage CSV", exact: true,
    });
    const allAreaMissingButton = allAreas.getByRole("button", {
      name: "Download all-area missing-rate review CSV", exact: true,
    });
    await expect(allAreaCsvButton).toBeDisabled();
    await expect(allAreaMissingButton).toBeDisabled();
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
    await expect(upcoming).toContainText(
      "No saved active-rate start or end dates in this period.",
    );
    await expect(upcomingCsvButton).toBeDisabled();
    await upcomingWindow.selectOption("90");
    await expect(upcoming).toContainText("5 upcoming rate date events");
    await expect(upcomingCsvButton).toBeEnabled();
    const upcomingPending = page.waitForEvent("download");
    await upcomingCsvButton.click();
    const upcomingExport = await upcomingPending;
    expect(upcomingExport.suggestedFilename()).toBe(
      "lms-upcoming-service-rate-dates.csv",
    );
    const upcomingCsv = (await readFile((await upcomingExport.path())!))
      .toString("utf8");
    expect(upcomingCsv.trimEnd().split("\r\n")).toHaveLength(6);
    expect(upcomingCsv).toContain('"Ends (exclusive)"');
    expect(upcomingCsv).toContain('"Local hourly rate"');
    expect(upcomingCsv).toContain('"Outer-area hourly rate"');
    expect(upcomingCsv).toContain('"Operator decision (fill manually)"');
    expect(upcomingCsv).not.toContain(customer);
    expect(upcomingCsv).not.toContain(work);
    await expect(upcoming.getByRole("article", {
      name: "Upcoming ends for Local hourly rate", exact: true,
    })).toContainText("2027-01-01");
    await upcomingWindow.selectOption("30");
    await expect(upcoming).toContainText(
      "No saved active-rate start or end dates in this period.",
    );
    await expect(upcomingCsvButton).toBeDisabled();
    await expect(allAreas).toContainText(
      "3 missing-rate candidates across 2 active service areas",
    );
    await expect(allAreas.getByRole("article", {
      name: "Coverage for Outer service area", exact: true,
    })).toContainText("3 missing-rate candidates");
    await expect(allAreas.getByRole("article", {
      name: "Coverage for Local service area", exact: true,
    })).toContainText("0 missing-rate candidates");
    await expect(allAreaCsvButton).toBeEnabled();
    await expect(allAreaMissingButton).toBeEnabled();
    const allMissingPending = page.waitForEvent("download");
    await allAreaMissingButton.click();
    const allMissingDownload = await allMissingPending;
    expect(allMissingDownload.suggestedFilename()).toBe(
      "lms-all-area-missing-rates-review.csv",
    );
    const allMissingCsv = (await readFile((await allMissingDownload.path())!))
      .toString("utf8");
    expect(allMissingCsv.trimEnd().split("\r\n")).toHaveLength(4);
    expect(allMissingCsv).toContain('"Outer service area"');
    expect(allMissingCsv).toContain('"Operator decision (fill manually)"');
    expect(allMissingCsv).not.toContain('"Local service area","2026-11-06"');
    expect(allMissingCsv).not.toContain(customer);
    expect(allMissingCsv).not.toContain(work);
    const overviewPending = page.waitForEvent("download");
    await allAreaCsvButton.click();
    const overviewDownload = await overviewPending;
    expect(overviewDownload.suggestedFilename()).toBe(
      "lms-all-area-rate-coverage.csv",
    );
    const overviewCsv = (await readFile((await overviewDownload.path())!))
      .toString("utf8");
    expect(overviewCsv.trimEnd().split("\r\n")).toHaveLength(3);
    expect(overviewCsv).toContain('"Outer service area","2026-11-06","4","1","3"');
    expect(overviewCsv).toContain('"Local service area","2026-11-06","4","4","0"');
    expect(overviewCsv).not.toContain(customer);
    expect(overviewCsv).not.toContain(work);
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
    const audit = page.getByRole("region", {
      name: "Rate coverage audit", exact: true,
    });
    const missingRateDownload = audit.getByRole("button", {
      name: "Download missing-rate review CSV", exact: true,
    });
    await expect(missingRateDownload).toBeDisabled();
    await expect(audit).toContainText(
      "Choose a service area and a rate date above to audit coverage.",
    );
    await allAreas.getByRole("button", {
      name: "Review missing rates in Outer service area", exact: true,
    }).click();
    await expect(audit).toContainText("3 missing rate candidates.");
    const outerOptionValue = await areaFilter
      .locator("option", { hasText: "Outer service area" })
      .getAttribute("value");
    expect(outerOptionValue).toBeTruthy();
    await expect(areaFilter).toHaveValue(outerOptionValue!);
    await areaFilter.selectOption({ label: "Local service area" });
    await rateDate.fill("2026-12-15");
    await expect(upcoming).toContainText("4 upcoming rate date events");
    await expect(upcomingCsvButton).toBeEnabled();
    const localUpcomingPending = page.waitForEvent("download");
    await upcomingCsvButton.click();
    const localUpcomingExport = await localUpcomingPending;
    const localUpcomingCsv = (await readFile((await localUpcomingExport.path())!))
      .toString("utf8");
    expect(localUpcomingCsv.trimEnd().split("\r\n")).toHaveLength(5);
    expect(localUpcomingCsv).toContain('"Local hourly rate"');
    expect(localUpcomingCsv).not.toContain('"Outer-area hourly rate"');
    await expect(upcoming.getByRole("article", {
      name: "Upcoming ends for Local hourly rate", exact: true,
    })).toBeVisible();
    await expect(upcoming.getByRole("article", {
      name: "Upcoming ends for Outer-area hourly rate", exact: true,
    })).toHaveCount(0);
    await rateDate.fill("2026-11-06");
    await expect(audit).toContainText("0 missing rate candidates.");
    await expect(missingRateDownload).toBeDisabled();
    await expect(audit.getByText(
      "No missing active saved-rate coverage found for this selection.",
      { exact: true },
    )).toBeVisible();
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
    await expect(audit).toContainText("3 missing rate candidates.");
    await expect(missingRateDownload).toBeEnabled();
    const missingPending = page.waitForEvent("download");
    await missingRateDownload.click();
    const missingExport = await missingPending;
    expect(missingExport.suggestedFilename()).toBe(
      "lms-missing-service-rates-review.csv",
    );
    const missingCsv = (await readFile((await missingExport.path())!))
      .toString("utf8");
    expect(missingCsv.trimEnd().split("\r\n")).toHaveLength(4);
    expect(missingCsv).toContain('"Outer service area"');
    expect(missingCsv).toContain(
      '"' + (industry === "cleaning" ? "Oven detail" : "Disposal add-on") + '"',
    );
    expect(missingCsv).toContain('"Operator decision (fill manually)"');
    expect(missingCsv).not.toContain(customer);
    expect(missingCsv).not.toContain(work);
    await expect(audit.getByRole("article", {
      name: "Missing rate for " +
        (industry === "cleaning" ? "Oven detail" : "Disposal add-on"),
      exact: true,
    })).toBeVisible();
    await expect(page.getByRole("article", {
      name: "Rate Local hourly rate", exact: true,
    })).toHaveCount(0);
    await expect(page.getByRole("article", {
      name: "Rate Outer-area hourly rate", exact: true,
    })).toBeVisible();
    await rateDate.fill("2025-11-06");
    await expect(audit).toContainText("4 missing rate candidates.");
    const historicPending = page.waitForEvent("download");
    await missingRateDownload.click();
    const historicExport = await historicPending;
    const historicCsv = (await readFile((await historicExport.path())!))
      .toString("utf8");
    expect(historicCsv.trimEnd().split("\r\n")).toHaveLength(5);
    await expect(page.getByRole("button", {
      name: "Download active service rates CSV", exact: true,
    })).toBeDisabled();
    await rateDate.fill("");
    await expect(upcomingCsvButton).toBeDisabled();
    await expect(allAreaCsvButton).toBeDisabled();
    await expect(allAreaMissingButton).toBeDisabled();
    await expect(missingRateDownload).toBeDisabled();
    await expect(audit).toContainText(
      "Choose a service area and a rate date above to audit coverage.",
    );
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
