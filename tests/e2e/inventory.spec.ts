import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { readFile } from "node:fs/promises";
test("inventory catalog, keyboard scanning, exact movement retries and retained archive history work accessibly", async ({
  page,
}, testInfo) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Explore the working demo" }).click();
  await expect(
    page.getByRole("heading", { name: "Cedar Grove Property", exact: true }),
  ).toBeVisible();
  let posted: Record<string, unknown> | undefined;
  page.on("request", (r) => {
    if (r.method() === "POST" && r.url().endsWith("/api/demo")) {
      const input = r.postDataJSON();
      if (input.action === "save" && input.entity === "stock-movements")
        posted = input;
    }
  });
  for (const industry of ["property", "cleaning"]) {
    if (industry === "cleaning")
      await page
        .getByLabel("Business workspace", { exact: true })
        .selectOption({ label: "Cleaning Company" });
    await page
      .getByRole("button", { name: "Inventory & stock", exact: true })
      .click();
    const name =
        industry === "property"
          ? "Fictional park gloves"
          : "Fictional cleaning gloves",
      code = "TEST-SCAN-13";
    await page
      .getByRole("button", { name: "+ Add product", exact: true })
      .click();
    await page.getByLabel("Item name *", { exact: true }).fill(name);
    await page.getByLabel("Unit / package", { exact: true }).fill("glove");
    await page
      .getByLabel("Product category", { exact: true })
      .fill("Protective supplies");
    await page.getByLabel("SKU", { exact: true }).fill("GLOVE-13");
    await page.getByLabel("Barcode", { exact: true }).fill(code);
    await page.getByLabel("Units per case", { exact: true }).fill("12");
    await page
      .getByLabel("Minimum stock per location", { exact: true })
      .fill("25");
    await page
      .getByRole("button", { name: "Save record", exact: true })
      .click();
    const product = page.getByRole("article", {
      name: "Product " + name,
      exact: true,
    });
    await expect(product).toBeVisible();
    const location =
      industry === "property" ? "Maintenance store" : "Supply shelf";
    const watchlist = page.getByRole("region", {
      name: "Low-stock watchlist", exact: true,
    });
    const lowAlert = watchlist.getByRole("article", {
      name: "Low stock " + name + " at " + location, exact: true,
    });
    await expect(lowAlert).toContainText("Below minimum by 25 glove");
    const countSheetButton = page.getByRole("button", {
      name: "Download physical count sheet CSV", exact: true,
    });
    const countPending = page.waitForEvent("download");
    await countSheetButton.click();
    const countDownload = await countPending;
    expect(countDownload.suggestedFilename()).toBe(
      "lms-physical-stock-count-sheet-all-locations.csv",
    );
    const initialCountSheet = (await readFile((await countDownload.path())!))
      .toString("utf8");
    expect(initialCountSheet).toContain(
      '"' + name + '","GLOVE-13","TEST-SCAN-13","' + location +
        '","0","","","glove","12",""',
    );
    expect(initialCountSheet).toContain("Counted units (fill manually)");
    expect(initialCountSheet).not.toContain("Fictional customer");
    // Reuse this existing demo session so the bounded public demo never
    // needs an extra one just to test the read-only count preview.
    const preview = page.getByRole("region", {
      name: "Physical count variance preview", exact: true,
    });
    const picker = preview.getByLabel("Product and location to compare", {
      exact: true,
    });
    const option = picker.locator("option")
      .filter({ hasText: name })
      .filter({ hasText: location });
    await expect(option).toHaveCount(1);
    const optionValue = await option.getAttribute("value");
    expect(optionValue).toBeTruthy();
    await picker.selectOption(optionValue!);
    const countedInput = preview.getByLabel("Physically counted units", {
      exact: true,
    });
    await expect(preview).toContainText("Recorded stock: 0 glove");
    await countedInput.fill("5");
    await expect(preview).toContainText("Difference: +5 glove");
    await countedInput.fill("0");
    await expect(preview).toContainText("Counts match: difference 0 glove");
    await countedInput.fill("3.5");
    await expect(preview).toContainText(
      "Enter a valid whole-unit count from 0 to 999,999,999,999.",
    );
    await countedInput.fill("");
    const zeroOnly = watchlist.getByLabel("Show out-of-stock only", {
      exact: true,
    });
    const order = watchlist.getByLabel("Order low-stock alerts", {
      exact: true,
    });
    await zeroOnly.check();
    await order.selectOption("shortfall");
    await expect(lowAlert).toBeVisible();
    const downloadPending = page.waitForEvent("download");
    await watchlist.getByRole("button", {
      name: "Download low-stock planning CSV", exact: true,
    }).click();
    const download = await downloadPending;
    expect(download.suggestedFilename()).toBe(
      "lms-low-stock-planning-all-locations.csv",
    );
    const csv = (await readFile((await download.path())!)).toString("utf8");
    expect(csv).toContain('"25","25","glove","12","3"');
    expect(csv).toContain("GLOVE-13");
    expect(csv).not.toContain("Fictional customer");
    await page
      .getByLabel("Search inventory products", { exact: true })
      .fill("unmatched-stock-query");
    await expect(lowAlert).toHaveCount(0);
    await expect(watchlist.getByRole("button", {
      name: "Download low-stock planning CSV", exact: true,
    })).toBeDisabled();
    await page
      .getByLabel("Search inventory products", { exact: true })
      .fill("GLOVE-13");
    await expect(lowAlert).toBeVisible();
    await zeroOnly.uncheck();
    await expect(product).toBeVisible();
    await page
      .getByLabel("Scan or enter barcode / SKU", { exact: true })
      .fill("NOT-FOUND");
    await page
      .getByLabel("Scan or enter barcode / SKU", { exact: true })
      .press("Enter");
    await expect(
      page.getByText("No active product matches this code.", { exact: true }),
    ).toBeVisible();
    await page
      .getByLabel("Scan or enter barcode / SKU", { exact: true })
      .fill(code);
    await page
      .getByLabel("Scan or enter barcode / SKU", { exact: true })
      .press("Enter");
    const editor = page.getByRole("region", {
      name: "Add stock movement",
      exact: true,
    });
    await expect(editor).toBeVisible();
    await expect(
      page.getByLabel("Product *", { exact: true }).locator("option:checked"),
    ).toHaveText(name);
    await page
      .getByLabel("Movement title *", { exact: true })
      .fill("Fictional case receipt");
    await page.getByLabel("Quantity *", { exact: true }).fill("2");
    await page
      .getByLabel("Quantity packaging *", { exact: true })
      .selectOption("Cases");
    await page
      .getByLabel("Storage location *", { exact: true })
      .selectOption({ label: location });
    await page
      .getByLabel("Movement reason *", { exact: true })
      .fill("Fictional supplies only.");
    await expect(editor).toContainText("2 cases = 24 individual units.");
    expect(
      (
        await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
          .analyze()
      ).violations,
    ).toEqual([]);
    await page
      .getByLabel(
        "I reviewed this fictional stock movement and its locations.",
        { exact: true },
      )
      .check();
    await page
      .getByRole("button", { name: "Post stock movement", exact: true })
      .click();
    await expect(product).toContainText(location + ": 24 glove");
    // The ledger remains authoritative after a real demo receipt.
    // Search input earlier reset the preview, so reselect explicitly.
    const afterReceiptOption = picker.locator("option")
      .filter({ hasText: name })
      .filter({ hasText: location });
    const afterReceiptValue = await afterReceiptOption.getAttribute("value");
    expect(afterReceiptValue).toBeTruthy();
    await picker.selectOption(afterReceiptValue!);
    await expect(preview).toContainText("Recorded stock: 24 glove");
    await countedInput.fill("21");
    await expect(preview).toContainText("Difference: -3 glove");
    await expect(preview).toContainText("Review an Adjustment decrease");
    await countedInput.fill("24");
    await expect(preview).toContainText("Counts match: difference 0 glove");
    await countedInput.fill("");
    const updatedCountPending = page.waitForEvent("download");
    await countSheetButton.click();
    const updatedCount = await updatedCountPending;
    const updatedCountCsv = (await readFile((await updatedCount.path())!))
      .toString("utf8");
    expect(updatedCountCsv).toContain(
      '"' + name + '","GLOVE-13","TEST-SCAN-13","' + location +
        '","24","","","glove","12",""',
    );
    await expect(product).toContainText("Low stock");
    // Other locations may still have zero units of this same product.
    // Narrow to the location where the fictional receipt was recorded.
    await page.getByLabel("Filter storage location", { exact: true })
      .selectOption({ label: location });
    await zeroOnly.check();
    await expect(lowAlert).toHaveCount(0);
    await expect(watchlist.getByRole("button", {
      name: "Download low-stock planning CSV", exact: true,
    })).toBeDisabled();
    await zeroOnly.uncheck();
    await expect(lowAlert).toBeVisible();
    await expect(lowAlert).toContainText("Below minimum by 1 glove");
    await page.getByLabel("Filter storage location", { exact: true })
      .selectOption("");
    const original = posted!;
    const retry = await page.evaluate(async (input) => {
      const r = await fetch("/api/demo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      return { status: r.status, json: await r.json() };
    }, original);
    expect(retry.status).toBe(200);
    expect(
      retry.json.workspace.stockMovements.filter(
        (m: { product_name: string }) => m.product_name === name,
      ),
    ).toHaveLength(1);
    await product
      .getByRole("button", { name: "Move " + name, exact: true })
      .click();
    await page
      .getByLabel("Movement title *", { exact: true })
      .fill("Fictional job usage");
    await page
      .getByLabel("Stock action *", { exact: true })
      .selectOption("Usage");
    await page.getByLabel("Quantity *", { exact: true }).fill("3");
    await page
      .getByLabel("Storage location *", { exact: true })
      .selectOption({ label: location });
    await page
      .getByLabel("Movement reason *", { exact: true })
      .fill("Used on fictional work.");
    await page
      .getByLabel(
        industry === "property"
          ? "Linked maintenance request"
          : "Linked cleaning job",
        { exact: true },
      )
      .selectOption({ index: 1 });
    await page
      .getByLabel(
        "I reviewed this fictional stock movement and its locations.",
        { exact: true },
      )
      .check();
    await page
      .getByRole("button", { name: "Post stock movement", exact: true })
      .click();
    await expect(product).toContainText(location + ": 21 glove");
    await expect(lowAlert).toContainText("Below minimum by 4 glove");
    const updatedPending = page.waitForEvent("download");
    await watchlist.getByRole("button", {
      name: "Download low-stock planning CSV", exact: true,
    }).click();
    const updatedDownload = await updatedPending;
    const updatedCsv = (await readFile((await updatedDownload.path())!))
      .toString("utf8");
    expect(updatedCsv).toContain('"21","25","4","glove","12","1"');
    await product
      .getByRole("button", { name: "Archive " + name, exact: true })
      .click();
    await page
      .getByRole("button", { name: "Confirm archive", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Inventory & stock", exact: true })
      .click();
    await expect(lowAlert).toHaveCount(0);
    await page.getByLabel("Show archived products", { exact: true }).check();
    await expect(product).toContainText(location + ": 21 glove");
    await product
      .getByRole("button", { name: "Restore " + name, exact: true })
      .click();
    await page
      .getByRole("button", { name: "Confirm restore", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Inventory & stock", exact: true })
      .click();
    await expect(product).toContainText(location + ": 21 glove");
    await expect(lowAlert).toContainText("Below minimum by 4 glove");
    if (industry === "cleaning")
      await page
        .getByRole("button", { name: "Switch to dark theme", exact: true })
        .click();
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
    await page.screenshot({
      path: testInfo.outputPath(industry + "-inventory.png"),
      fullPage: true,
    });
  }
});

