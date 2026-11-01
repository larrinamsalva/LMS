import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { readFile } from "node:fs/promises";
import { importBlueprintPackage } from "../../src/core/blueprint";
import {
  testAttestation,
  testPublisher,
} from "../helpers/blueprint-provenance";
async function step(page: Page, name: string) {
  await page
    .getByRole("navigation", { name: "BuildPlan steps", exact: true })
    .getByRole("button", { name, exact: true })
    .click();
}
async function accessible(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
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
async function snapshot(page: Page) {
  return page.evaluate(
    async () => (await (await fetch("/api/demo")).json()).workspace,
  );
}
test("blueprint packages survive a fresh session, require review, reject tampering and preserve drafts and data", async ({
  page,
  browser,
}, info) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Build My Business System", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Browse Business Templates", exact: true })
    .click();
  await page
    .getByRole("article", { name: "Cleaning Crew & Scheduling", exact: true })
    .getByRole("button", { name: "Customize This Template", exact: true })
    .click();
  await page
    .getByLabel("Business name", { exact: true })
    .fill("Fictional Portable Cleaners");
  await page
    .getByLabel("Navigation label for Customers", { exact: true })
    .fill("Our clients");
  await page
    .getByLabel("New field label", { exact: true })
    .fill("Arrival instructions");
  await page
    .getByRole("button", { name: "Add optional field", exact: true })
    .click();
  await page
    .getByLabel("Blueprint name", { exact: true })
    .fill("My cleaning blueprint");
  await page
    .getByLabel("Blueprint description", { exact: true })
    .fill("Fictional crews, appointments and supplies with my terminology.");
  await step(page, "4 · Review & try");
  await page
    .getByRole("button", { name: "Save BuildPlan draft", exact: true })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: "BuildPlan draft saved" }),
  ).toBeVisible();
  const beforeDownload = await snapshot(page),
    pending = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Download Blueprint Package", exact: true })
    .click();
  const downloaded = await pending,
    bytes = await readFile((await downloaded.path())!),
    verified = await importBlueprintPackage(bytes);
  expect(downloaded.suggestedFilename()).toBe("lms-blueprint.zip");
  expect(verified.manifest.blueprint.gallery).toEqual({
    id: "cleaning-crews",
    revision: 1,
  });
  expect(verified.plan.configuration.name).toBe("Fictional Portable Cleaners");
  expect(await snapshot(page)).toEqual(beforeDownload);
  await accessible(page);
  // New isolated cookie jar: no saved draft, preview or import state can carry the choices over.
  const fresh = await browser.newContext({
      baseURL: info.project.use.baseURL,
      viewport: page.viewportSize()!,
      deviceScaleFactor: 1,
      isMobile: info.project.use.isMobile,
      hasTouch: info.project.use.hasTouch,
      userAgent: info.project.use.userAgent,
    }),
    target = await fresh.newPage();
  try {
    await target.goto("/");
    await target
      .getByRole("button", { name: "Build My Business System", exact: true })
      .click();
    await step(target, "3 · Customize");
    await target
      .getByLabel("Business name", { exact: true })
      .fill("Keep my existing editor choices");
    await step(target, "4 · Review & try");
    await target
      .getByRole("button", { name: "Save BuildPlan draft", exact: true })
      .click();
    await expect(
      target.getByRole("status").filter({ hasText: "BuildPlan draft saved" }),
    ).toBeVisible();
    const before = await snapshot(target),
      upload = {
        name: "lms-blueprint.zip",
        mimeType: "application/zip",
        buffer: bytes,
      };
    await target
      .getByLabel("Import Blueprint Package", { exact: true })
      .setInputFiles(upload);
    const attestationInput = target.getByLabel(
        "Detached publisher attestation (optional)",
        { exact: true },
      ),
      claim = await testAttestation(bytes, testPublisher());
    for (const [buffer, error] of [
      [Buffer.from(claim), /Unknown publisher key/],
      [
        Buffer.from(
          new TextDecoder().decode(claim).replace('"Ed25519"', '"RSA"'),
        ),
        /Unsupported publisher signature algorithm/,
      ],
      [Buffer.alloc(8193), /8 KiB/],
    ] as const) {
      await attestationInput.setInputFiles({
        name: "publisher.attestation.json",
        mimeType: "application/json",
        buffer,
      });
      await target
        .getByRole("button", { name: "Verify Blueprint", exact: true })
        .click();
      await expect(
        target.getByRole("alert").filter({ hasText: error }),
      ).toBeVisible();
      await expect(
        target.getByRole("button", {
          name: "Use as unsaved Studio choices",
          exact: true,
        }),
      ).toHaveCount(0);
      expect(await snapshot(target)).toEqual(before);
    }
    await target.screenshot({
      path: info.outputPath("publisher-claim-rejected.png"),
      fullPage: true,
      scale: "css",
    });
    // Deliberately remove the claim. This is an unsigned import, never a verified fallback.
    await attestationInput.setInputFiles([]);
    await target
      .getByRole("button", { name: "Verify Blueprint", exact: true })
      .click();
    await expect(
      target.getByRole("heading", { name: "Review Blueprint", exact: true }),
    ).toBeFocused();
    await expect(
      target.getByText("Unverified publisher · unsigned package", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(target.getByText(/Passed · exact ZIP profile/)).toBeVisible();
    await expect(
      target.getByText(/No detached attestation supplied/),
    ).toBeVisible();
    await expect(
      target.getByRole("heading", {
        name: "My cleaning blueprint",
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      target.getByText("Different project identity:", { exact: false }),
    ).toBeVisible();
    await expect(
      target.getByText(/currently bundled reviewed starter/),
    ).toBeVisible();
    await target
      .getByText("Compare with my unsaved Studio choices", { exact: true })
      .click();
    await expect(
      target.getByText("Keep my existing editor choices", { exact: true }),
    ).toBeVisible();
    await accessible(target);
    await target
      .getByRole("region", { name: "Verify Blueprint", exact: true })
      .screenshot({
        path: info.outputPath("publisher-inspection-light.png"),
        scale: "css",
      });
    await target
      .getByRole("button", { name: "Switch to dark theme", exact: true })
      .click();
    await accessible(target);
    await target
      .getByRole("region", { name: "Verify Blueprint", exact: true })
      .screenshot({
        path: info.outputPath("publisher-inspection-dark.png"),
        scale: "css",
      });
    await target
      .getByText("Compare with my unsaved Studio choices", { exact: true })
      .click();
    await target.screenshot({
      path: info.outputPath("blueprint-review-dark.png"),
      fullPage: true,
    });
    await expect(await snapshot(target)).toEqual(before);
    const cancel = target.getByRole("button", {
      name: "Cancel blueprint import",
      exact: true,
    });
    await cancel.focus();
    await target.keyboard.press("Enter");
    await step(target, "3 · Customize");
    await expect(
      target.getByLabel("Business name", { exact: true }),
    ).toHaveValue("Keep my existing editor choices");
    const corrupted = Buffer.from(bytes);
    corrupted[80] ^= 1;
    await target
      .getByLabel("Import Blueprint Package", { exact: true })
      .setInputFiles({ ...upload, buffer: corrupted });
    await target
      .getByRole("button", { name: "Verify Blueprint", exact: true })
      .click();
    await expect(
      target.getByRole("alert").filter({ hasText: /checksum failed/ }),
    ).toBeVisible();
    await expect(
      target.getByRole("heading", { name: "Review Blueprint", exact: true }),
    ).toHaveCount(0);
    await expect(
      target.getByLabel("Business name", { exact: true }),
    ).toHaveValue("Keep my existing editor choices");
    await target
      .getByLabel("Import Blueprint Package", { exact: true })
      .setInputFiles({ ...upload, buffer: Buffer.alloc(98305) });
    await target
      .getByRole("button", { name: "Verify Blueprint", exact: true })
      .click();
    await expect(
      target.getByRole("alert").filter({ hasText: /96 KiB/ }),
    ).toBeVisible();
    await target
      .getByLabel("Import Blueprint Package", { exact: true })
      .setInputFiles(upload);
    await target
      .getByRole("button", { name: "Verify Blueprint", exact: true })
      .click();
    await expect(
      target.getByRole("heading", { name: "Review Blueprint", exact: true }),
    ).toBeFocused();
    await target
      .getByRole("button", { name: "Prepare blueprint preview", exact: true })
      .click();
    const previewLink = target.getByRole("link", {
      name: "Open blueprint workspace preview (new tab)",
      exact: true,
    });
    await expect(previewLink).toBeVisible();
    const href = await previewLink.getAttribute("href"),
      opened = fresh.waitForEvent("page");
    await previewLink.click();
    const preview = await opened;
    await expect(
      preview.getByRole("heading", {
        name: "Fictional Portable Cleaners",
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      preview.getByRole("button", { name: "Our clients 0", exact: true }),
    ).toBeVisible();
    for (const name of [
      "Schedule",
      "Crews & availability",
      "Inventory & stock",
    ])
      await expect(
        preview.getByRole("button", { name, exact: true }),
      ).toBeVisible();
    const org = new URL(preview.url()).searchParams.get("organizationId"),
      actual = await preview.evaluate(
        async (id) =>
          (await (await fetch(`/api/demo?organizationId=${id}`)).json())
            .workspace.config.document,
        org,
      );
    expect(actual).toEqual(verified.plan.configuration);
    await preview.close();
    await target
      .getByRole("button", {
        name: "Use as unsaved Studio choices",
        exact: true,
      })
      .click();
    await expect(
      target.getByText(/Blueprint loaded as unsaved Studio choices/),
    ).toBeVisible();
    await expect(
      target.getByRole("button", {
        name: "Publish reviewed BuildPlan",
        exact: true,
      }),
    ).toBeDisabled();
    await target
      .getByRole("button", { name: "Prepare workspace preview", exact: true })
      .click();
    await expect(
      target.getByRole("link", {
        name: "Open interactive workspace preview (new tab)",
        exact: true,
      }),
    ).toHaveAttribute("href", href!);
    expect(await snapshot(target)).toEqual(before);
    await step(target, "3 · Customize");
    await expect(
      target.getByLabel("Business name", { exact: true }),
    ).toHaveValue("Fictional Portable Cleaners");
    await expect(
      target.getByLabel("Navigation label for Customers", { exact: true }),
    ).toHaveValue("Our clients");
    await expect(
      target.getByRole("button", {
        name: "Remove optional field Arrival instructions",
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      target.getByLabel("Blueprint description", { exact: true }),
    ).toHaveValue(verified.manifest.blueprint.description);
    const secondDownload = target.waitForEvent("download");
    await target
      .getByRole("button", { name: "Download Blueprint Package", exact: true })
      .click();
    expect(await readFile((await (await secondDownload).path())!)).toEqual(
      bytes,
    );
    await step(target, "4 · Review & try");
    await target
      .getByRole("button", { name: "Save BuildPlan draft", exact: true })
      .click();
    await expect(
      target.getByRole("status").filter({ hasText: "BuildPlan draft saved" }),
    ).toBeVisible();
    const after = await snapshot(target);
    expect(after.buildPlans).toHaveLength(2);
    expect(
      after.buildPlans.some(
        (p: { id: string }) => p.id === before.buildPlans[0].id,
      ),
    ).toBe(true);
    expect(after.history).toEqual(before.history);
    expect(after.records).toEqual(before.records);
    await accessible(target);
  } finally {
    await fresh.close();
  }
});
