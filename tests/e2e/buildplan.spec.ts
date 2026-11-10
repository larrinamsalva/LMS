import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { readFile } from "node:fs/promises";
async function fits(page: Page) {
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
}
async function step(page: Page, name: string) {
  await page
    .getByRole("navigation", { name: "BuildPlan steps", exact: true })
    .getByRole("button", { name, exact: true })
    .click();
}
test("guided cleaning plan resolves dependencies, customizes, previews the real workspace, saves, exports and safely reopens", async ({
  page,
  context,
}, info) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Build My Business System", exact: true })
    .click();
  await expect(
    page.getByRole("heading", {
      name: "Build My Business System",
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Start Cleaning Business", exact: true })
    .click();
  await step(page, "2 · Features");
  await page.getByRole("checkbox", { name: /Employees & crews/ }).uncheck();
  await page.getByRole("checkbox", { name: /Shared scheduling/ }).uncheck();
  await page.getByRole("checkbox", { name: /Employees & crews/ }).check();
  await expect(
    page.getByRole("checkbox", { name: /Shared scheduling/ }),
  ).toBeChecked();
  await expect(
    page.getByRole("checkbox", { name: /Shared scheduling/ }),
  ).toBeDisabled();
  await expect(
    page.getByRole("checkbox", { name: /Services & estimates/ }),
  ).toBeChecked();
  await expect(
    page.getByRole("checkbox", { name: /Inventory & stock/ }),
  ).toBeChecked();
  await fits(page);
  await step(page, "3 · Customize");
  await page
    .getByLabel("Business name", { exact: true })
    .fill("Fictional Spark Studio");
  await page
    .getByLabel("Singular term for Customers", { exact: true })
    .fill("Client");
  await page
    .getByLabel("Plural term for Customers", { exact: true })
    .fill("Clients");
  await page
    .getByLabel("Navigation label for Customers", { exact: true })
    .fill("My clients");
  await page
    .getByLabel("New field label", { exact: true })
    .fill("Access notes");
  await page
    .getByRole("button", { name: "Add optional field", exact: true })
    .click();
  await fits(page);
  await step(page, "4 · Review & try");
  await expect(
    page.getByText(/This starter has a different project identity/),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Prepare workspace preview", exact: true })
    .click();
  const ready = page.getByRole("link", {
    name: "Open interactive workspace preview (new tab)",
    exact: true,
  });
  await expect(ready).toBeVisible();
  const popup = context.waitForEvent("page");
  await ready.click();
  const preview = await popup;
  await expect(
    preview.getByRole("heading", {
      name: "Fictional Spark Studio",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    preview.getByRole("button", { name: /^My clients/ }),
  ).toBeVisible();
  await preview
    .getByRole("button", { name: "+ Add client", exact: true })
    .click();
  await preview
    .getByLabel("Name *", { exact: true })
    .fill("Preview Client Only");
  await preview
    .getByLabel("Access notes", { exact: true })
    .fill("Fictional gate note");
  await fits(preview);
  await preview
    .getByRole("button", { name: "Save record", exact: true })
    .click();
  await expect(
    preview.getByRole("heading", { name: "Preview Client Only", exact: true }),
  ).toBeVisible();
  await preview.reload();
  await expect(
    preview.getByRole("heading", { name: "Preview Client Only", exact: true }),
  ).toBeVisible();
  await fits(preview);
  await preview.screenshot({
    path: info.outputPath("cleaning-generated-workspace.png"),
    fullPage: true,
  });
  await preview.close();
  await page
    .getByRole("button", { name: "Save BuildPlan draft", exact: true })
    .click();
  await expect(
    page.getByText(
      "BuildPlan draft saved. No workspace configuration was published.",
      { exact: true },
    ),
  ).toBeVisible();
  const pendingDownload = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Export BuildPlan JSON", exact: true })
    .click();
  const download = await pendingDownload;
  expect(download.suggestedFilename()).toBe("lms-build-plan.json");
  const bytes = await readFile((await download.path())!);
  const exported = JSON.parse(bytes.toString());
  expect(exported.version).toBe(1);
  expect(exported.configuration.name).toBe("Fictional Spark Studio");
  expect(
    exported.configuration.entities[0].fields.some(
      (f: { label: string }) => f.label === "Access notes",
    ),
  ).toBe(true);
  await page.reload();
  await page
    .getByRole("button", { name: "BuildPlan Studio", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Reopen Fictional Spark Studio", exact: true })
    .click();
  await step(page, "3 · Customize");
  await expect(page.getByLabel("Business name", { exact: true })).toHaveValue(
    "Fictional Spark Studio",
  );
  await expect(
    page.getByLabel("Navigation label for Customers", { exact: true }),
  ).toHaveValue("My clients");
  await expect(
    page.getByRole("button", {
      name: "Remove optional field Access notes",
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByLabel("Load an exported BuildPlan JSON file", { exact: true })
    .setInputFiles({
      name: "saved-plan.json",
      mimeType: "application/json",
      buffer: bytes,
    });
  await expect(page.getByText(/Loaded a validated BuildPlan/)).toBeVisible();
  const bad = JSON.stringify({ ...exported, version: 99 });
  await page
    .getByLabel("Load an exported BuildPlan JSON file", { exact: true })
    .setInputFiles({
      name: "unsafe.json",
      mimeType: "application/json",
      buffer: Buffer.from(bad),
    });
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: "This BuildPlan is invalid or unsupported." }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Switch to dark theme", exact: true })
    .click();
  await fits(page);
  await page.screenshot({
    path: info.outputPath("buildplan-review-dark.png"),
    fullPage: true,
  });
  const denied = await page.evaluate(async () => {
    const r = await fetch("/api/demo", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "save-plan",
        organizationId: crypto.randomUUID(),
        id: crypto.randomUUID(),
        revision: 0,
        baseRevision: 1,
        document: {},
      }),
    });
    return r.status;
  });
  expect(denied).toBe(403);
  // Exercise the optional pack in this existing demo session. Adding a standalone
  // browser case exceeded the production 24-session cap late in each viewport.
  await step(page, "2 · Features");
  await expect(page.getByRole("heading", { name: "Quick-start workflow packs" })).toBeVisible();
  const pack = page.getByRole("article").filter({ has: page.getByRole("heading", { name: "Crew + machine calendar" }) });
  await expect(pack).toContainText("New features:");
  await expect(pack).toContainText("Crew + equipment appointments");
  await pack.getByRole("button", { name: "Add Crew + machine calendar to my plan" }).click();
  await expect(page.getByRole("checkbox", { name: "Crew + equipment appointments" })).toBeChecked();
  await expect(page.getByRole("checkbox", { name: "Equipment calendar mapping" })).toBeChecked();
  await expect(page.getByRole("checkbox", { name: "Equipment & Tools" })).toBeChecked();
  await expect(pack.getByRole("button", { name: "Already included" })).toBeDisabled();
  await page.getByRole("button", { name: "Undo adding Crew + machine calendar", exact: true }).click();
  await expect(page.getByRole("checkbox", { name: "Crew + equipment appointments" })).not.toBeChecked();
  await expect(page.getByRole("checkbox", { name: "Equipment calendar mapping" })).not.toBeChecked();
  await expect(page.getByRole("checkbox", { name: "Equipment & Tools" })).not.toBeChecked();
  await expect(pack.getByRole("button", { name: "Add Crew + machine calendar to my plan" })).toBeEnabled();
  await step(page, "3 · Customize");
  await expect(page.getByLabel("Business name", { exact: true })).toHaveValue("Fictional Spark Studio");
  await expect(page.getByRole("button", { name: "Remove optional field Access notes" })).toBeVisible();
  await step(page, "2 · Features");
  await pack.getByRole("button", { name: "Add Crew + machine calendar to my plan" }).click();
  await expect(page.getByRole("checkbox", { name: "Crew + equipment appointments" })).toBeChecked();
  await step(page, "4 · Review & try");
  await expect(page.getByText(/Configuration schema/).first()).toBeVisible();
  await expect(page.getByText(/unsaved|save/i).first()).toBeVisible();

  // A second preview uses the same demo session and stays inside the
  // three-preview quota; no standalone test consumes a 25th session.
  await page.getByRole("button", { name: "Prepare workspace preview", exact: true }).click();
  const readyWithEquipment = page.getByRole("link", {
    name: "Open interactive workspace preview (new tab)", exact: true,
  });
  await expect(readyWithEquipment).toBeVisible();
  const equipmentPopup = context.waitForEvent("page");
  await readyWithEquipment.click();
  const equipmentPreview = await equipmentPopup;
  await expect(equipmentPreview.getByRole("heading", {
    name: "Fictional Spark Studio", exact: true,
  })).toBeVisible();
  await equipmentPreview.getByRole("button", { name: /^Storage locations/ }).click();
  await equipmentPreview.getByRole("button", { name: "+ Add storage location", exact: true }).click();
  await equipmentPreview.getByLabel("Location name *", { exact: true }).fill("Fictional tool shed");
  await equipmentPreview.getByRole("button", { name: "Save record", exact: true }).click();
  await equipmentPreview.getByRole("button", { name: /^Equipment & Tools/ }).click();

  for (const [name, code] of [
    ["Fictional scrubber", "SCRUBBER-01"],
    ["Fictional polisher", "POLISHER-01"],
  ]) {
    await equipmentPreview.getByRole("button", { name: "+ Add equipment item", exact: true }).click();
    await equipmentPreview.getByLabel("Equipment name *", { exact: true }).fill(name);
    await equipmentPreview.getByLabel("Business equipment ID (permanent) *", { exact: true }).fill(code);
    await equipmentPreview.getByLabel("Storage location *", { exact: true })
      .selectOption({ label: "Fictional tool shed" });
    await equipmentPreview.getByRole("button", { name: "Save record", exact: true }).click();
  }
  await equipmentPreview.getByRole("button", { name: /^My clients/ }).click();
  const dailyEquipment = equipmentPreview.getByRole("region", { name: "Daily operations" });
  const warnings = dailyEquipment.getByRole("region", { name: "Equipment needing attention" });
  const upcomingInspections = dailyEquipment.getByRole("region", {
    name: "Upcoming equipment inspections next seven days", exact: true,
  });
  await expect(upcomingInspections).toContainText(
    "No saved equipment inspections due in the next seven days.",
  );
  await expect(dailyEquipment.getByText("Inspections next 7 days")).toBeVisible();
  // All seven dates show equipment inspections when the module is enabled,
  // and no inspection event is created by opening a date.
  const workload = dailyEquipment.getByRole("region", {
    name: "Seven-day workload by date", exact: true,
  });
  await expect(workload.getByRole("button", {
    name: /^Review \d{4}-\d{2}-\d{2}:/,
  })).toHaveCount(7);
  await expect(workload.getByRole("button", {
    name: /^Review \d{4}-\d{2}-\d{2}:.*equipment inspections$/,
  })).toHaveCount(7);
  await expect(workload.getByText("0 inspections")).toHaveCount(7);
  const weeklyTotals = workload.getByRole("group", {
    name: "Seven-day workload totals", exact: true,
  });
  await expect(weeklyTotals.getByText("Equipment inspections · 7 days")).toBeVisible();
  await expect(weeklyTotals.getByText("Days with saved activity")).toBeVisible();
  await expect(weeklyTotals.getByText(/^\d+ of 7$/)).toBeVisible();
  const activityDays = Number(
    (await weeklyTotals.getByText(/^\d+ of 7$/).textContent())!.split(" of ")[0],
  );
  await workload.getByRole("button", {
    name: "Show active days only", exact: true,
  }).click();
  await expect(workload.getByRole("button", {
    name: /^Review \d{4}-\d{2}-\d{2}:/,
  })).toHaveCount(activityDays);
  if (activityDays === 0) {
    await expect(workload).toContainText("No saved activity in the next seven days");
  }
  await workload.getByRole("button", {
    name: "Show all seven days", exact: true,
  }).click();
  await expect(workload.getByRole("button", {
    name: /^Review \d{4}-\d{2}-\d{2}:/,
  })).toHaveCount(7);
  const workloadPending = equipmentPreview.waitForEvent("download");
  await workload.getByRole("button", {
    name: "Download seven-day workload CSV", exact: true,
  }).click();
  const savedWorkload = await workloadPending;
  const csv = (await readFile((await savedWorkload.path())!)).toString("utf8");
  expect(csv.trimEnd().split("\r\n")).toHaveLength(9);
  expect(csv).toContain("Equipment inspections due");
  expect(csv).toContain("TOTAL (7 days)");
  expect(csv).not.toContain("Fictional scrubber");
  // The download remains useful as a header-only checklist when no future
  // inspection has been scheduled. Reuse this existing preview session.
  await dailyEquipment.getByLabel("Operations date", { exact: true }).fill("2026-11-05");
  const downloadPending = equipmentPreview.waitForEvent("download");
  await upcomingInspections.getByRole("button", {
    name: "Download upcoming inspections CSV", exact: true,
  }).click();
  const downloaded = await downloadPending;
  expect(downloaded.suggestedFilename()).toBe(
    "lms-upcoming-inspections-2026-11-05-through-2026-11-12.csv",
  );
  const inspectionCsv = (await readFile((await downloaded.path())!)).toString("utf8");
  expect(inspectionCsv).toContain("Next inspection date");
  expect(inspectionCsv).not.toContain("Fictional scrubber");
  expect(inspectionCsv).not.toContain("Fictional polisher");
  expect(inspectionCsv.trim().split("\r\n")).toHaveLength(1);
  await expect(warnings).toContainText("Fictional scrubber");
  await expect(warnings).toContainText("Fictional polisher");
  await warnings.getByRole("button", { name: "Find equipment Fictional scrubber", exact: true }).click();
  await expect(equipmentPreview.getByRole("status").filter({
    hasText: "Showing the exact equipment item selected in Daily Operations:",
  })).toContainText("Fictional scrubber");
  await expect(equipmentPreview.getByRole("article", {
    name: "Equipment Fictional scrubber", exact: true,
  })).toBeVisible();
  await expect(equipmentPreview.getByRole("article", {
    name: "Equipment Fictional polisher", exact: true,
  })).toHaveCount(0);
  await equipmentPreview.getByRole("button", { name: "Show all equipment", exact: true }).click();
  await expect(equipmentPreview.getByRole("article", {
    name: "Equipment Fictional polisher", exact: true,
  })).toBeVisible();
  await fits(equipmentPreview);
  await equipmentPreview.close();
  await fits(page);
});
test("property publication protects populated schemas and history; custom template uses the shared forms", async ({
  page,
  context,
}, info) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Build My Business System", exact: true })
    .click();
  await step(page, "3 · Customize");
  await page
    .getByLabel("Business name", { exact: true })
    .fill("Fictional Property Studio");
  await page
    .getByLabel("New field label", { exact: true })
    .fill("Migration test note");
  await page
    .getByRole("button", { name: "Add optional field", exact: true })
    .click();
  await step(page, "4 · Review & try");
  await expect(
    page.getByText(/Database migration review required/),
  ).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: "Publish reviewed BuildPlan",
      exact: true,
    }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "Save BuildPlan draft", exact: true })
    .click();
  await step(page, "3 · Customize");
  await page
    .getByRole("button", {
      name: "Remove optional field Migration test note",
      exact: true,
    })
    .click();
  await step(page, "4 · Review & try");
  await page
    .getByRole("button", { name: "Save BuildPlan draft", exact: true })
    .click();
  await page
    .getByLabel(
      "I reviewed this saved plan and want to publish a fictional configuration revision.",
      { exact: true },
    )
    .check();
  await page
    .getByRole("button", { name: "Publish reviewed BuildPlan", exact: true })
    .click();
  await expect(
    page.getByRole("heading", {
      name: "Fictional Property Studio",
      exact: true,
      level: 1,
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Project & modules" }).click();
  await page
    .getByRole("button", { name: "Restore revision 1", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Cedar Grove Property", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "BuildPlan Studio", exact: true })
    .click();
  await page
    .getByRole("button", {
      name: "Reopen Fictional Property Studio",
      exact: true,
    })
    .click();
  await expect(page.getByText(/current revision is 3/)).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: "Publish reviewed BuildPlan",
      exact: true,
    }),
  ).toBeDisabled();
  await page
    .getByRole("button", {
      name: "Review against current revision",
      exact: true,
    })
    .click();
  await page
    .getByRole("button", { name: "Save BuildPlan draft", exact: true })
    .click();
  await step(page, "1 · Start");
  await page
    .getByRole("button", { name: "Start Custom Business", exact: true })
    .click();
  await step(page, "3 · Customize");
  await page
    .getByLabel("Business name", { exact: true })
    .fill("Fictional Custom Workshop");
  await step(page, "4 · Review & try");
  await page
    .getByRole("button", { name: "Prepare workspace preview", exact: true })
    .click();
  const popup = context.waitForEvent("page");
  await page
    .getByRole("link", {
      name: "Open interactive workspace preview (new tab)",
      exact: true,
    })
    .click();
  const preview = await popup;
  await expect(
    preview.getByRole("heading", {
      name: "Fictional Custom Workshop",
      exact: true,
    }),
  ).toBeVisible();
  await preview.getByRole("button", { name: /^Work items/ }).click();
  await preview
    .getByRole("button", { name: "+ Add work item", exact: true })
    .click();
  await preview
    .getByLabel("Task title *", { exact: true })
    .fill("Fictional custom repair");
  await preview.getByLabel("Status *", { exact: true }).selectOption("Open");
  await preview
    .getByRole("button", { name: "Save record", exact: true })
    .click();
  await expect(
    preview.getByRole("heading", {
      name: "Fictional custom repair",
      exact: true,
    }),
  ).toBeVisible();
  await preview
    .getByRole("button", { name: "Switch to dark theme", exact: true })
    .click();
  await fits(preview);
  await preview.screenshot({
    path: info.outputPath("custom-generated-workspace-dark.png"),
    fullPage: true,
  });
  await preview.close();
});
