import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
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
    await page
      .getByLabel("Search inventory products", { exact: true })
      .fill("GLOVE-13");
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
    const location =
      industry === "property" ? "Maintenance store" : "Supply shelf";
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
    await expect(product).toContainText("Low stock");
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
    await product
      .getByRole("button", { name: "Archive " + name, exact: true })
      .click();
    await page
      .getByRole("button", { name: "Confirm archive", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Inventory & stock", exact: true })
      .click();
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
