import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { readFile } from "node:fs/promises";
import { logoFixture } from "../helpers/logo-fixtures";
import { inspectLogoCompanion } from "../../src/core/logo-companion";
import { importBlueprintPackage } from "../../src/core/blueprint";
async function step(page: Page, name: string) {
  await page
    .getByRole("navigation", { name: "BuildPlan steps", exact: true })
    .getByRole("button", { name, exact: true })
    .click();
}
async function fits(page: Page) {
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
async function download(page: Page) {
  const pending = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Download Blueprint Package", exact: true })
    .click();
  return readFile((await (await pending).path())!);
}
test("private raster staging, explicit selection, replacement, isolated preview, portable compatibility and fallback work accessibly", async ({
  page,
  context,
  request,
}, info) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Build My Business System", exact: true })
    .click();
  await step(page, "4 · Review & try");
  await page
    .getByRole("button", { name: "Save BuildPlan draft", exact: true })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: "BuildPlan draft saved" }),
  ).toBeVisible();
  const before = await snapshot(page),
    baseline = await download(page),
    bytes = await logoFixture(),
    picker = page.getByLabel("Select a logo image from this device", {
      exact: true,
    });
  await step(page, "3 · Customize");
  await picker.setInputFiles({
    name: "spoofed.png",
    mimeType: "image/png",
    buffer: Buffer.from("<html><script>not an image</script></html>"),
  });
  await page
    .getByRole("button", { name: "Sanitize and stage logo", exact: true })
    .click();
  await expect(
    page.getByRole("alert").filter({ hasText: /static PNG/ }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Refresh private logos", exact: true })
    .click();
  await expect(page.getByText(/11 upload attempts remain/)).toBeVisible();
  await picker.setInputFiles({
    name: "fictional-logo.jpeg",
    mimeType: "text/plain",
    buffer: bytes,
  });
  await page
    .getByRole("button", { name: "Sanitize and stage logo", exact: true })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: /Sanitized image staged/ }),
  ).toBeVisible();
  await expect(page.locator(".topbar img")).toHaveCount(0);
  await expect(page.locator(".brand-example img")).toHaveCount(2);
  await page
    .getByLabel("Contained logo display", { exact: true })
    .selectOption("rectangle");
  await expect(
    page.locator(".brand-example .private-logo-rectangle"),
  ).toHaveCount(2);
  await page
    .getByRole("button", {
      name: "Use staged logo for this session",
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: /Session logo selected/ }),
  ).toBeVisible();
  const src = await page.locator(".topbar img").getAttribute("src");
  expect(src).toMatch(/^\/api\/demo\/logo\?/);
  await expect(page.locator(".workspace-heading img")).toHaveAttribute(
    "src",
    src!,
  );
  for (const [name, filename] of [
    ["Download sanitized PNG", "lms-sanitized-logo.png"],
    ["Download logo companion", "lms-logo-companion.zip"],
  ]) {
    const pending = page.waitForEvent("download");
    await page.getByRole("button", { name, exact: true }).click();
    const downloaded = await pending,
      saved = await readFile((await downloaded.path())!);
    expect(downloaded.suggestedFilename()).toBe(filename);
    if (filename.endsWith("zip"))
      expect((await inspectLogoCompanion(saved)).manifest.display).toBe(
        "rectangle",
      );
    else
      expect([...saved.subarray(0, 8)]).toEqual([
        137, 80, 78, 71, 13, 10, 26, 10,
      ]);
  }
  expect(await snapshot(page)).toEqual(before);
  await fits(page);
  await page
    .getByRole("region", { name: "Custom Business Logo", exact: true })
    .screenshot({
      path: info.outputPath("custom-logo-controls-light.png"),
      scale: "css",
    });
  await page
    .getByRole("button", { name: "Switch to dark theme", exact: true })
    .click();
  await fits(page);
  await page.getByLabel("dark branding sample", { exact: true }).screenshot({
    path: info.outputPath("custom-logo-sample-dark.png"),
    scale: "css",
  });
  expect(await download(page)).toEqual(baseline);
  expect(await snapshot(page)).toEqual(before);
  const { organizationId, selected } = await page.evaluate(async () => {
    const w = (await (await fetch("/api/demo")).json()).workspace;
    return {
      organizationId: w.organizationId,
      ...(await (
        await fetch(`/api/demo/logo?organizationId=${w.organizationId}`)
      ).json()),
    };
  });
  const response = await context.request.get(src!);
  expect((await request.get(src!)).status()).toBe(401);
  const optimizer = `/_next/image?url=${encodeURIComponent(src!)}&w=256&q=75`;
  expect((await context.request.get(optimizer)).status()).toBe(404);
  expect((await request.get(optimizer)).status()).toBe(404);
  expect(response.status()).toBe(200);
  expect(response.headers()["cache-control"]).toContain("no-store");
  expect(response.headers()["cross-origin-resource-policy"]).toBe(
    "same-origin",
  );
  await page
    .getByRole("checkbox", {
      name: "Include business branding in this BuildPlan",
      exact: true,
    })
    .check();
  const branded = await download(page),
    portable = await importBlueprintPackage(branded);
  expect(portable.plan.version).toBe(2);
  expect(JSON.stringify(portable)).not.toContain(selected.id);
  expect(JSON.stringify(portable)).not.toContain("/api/demo/logo");
  await step(page, "4 · Review & try");
  await page
    .getByRole("button", { name: "Prepare workspace preview", exact: true })
    .click();
  const link = page.getByRole("link", {
      name: "Open interactive workspace preview (new tab)",
      exact: true,
    }),
    href = await link.getAttribute("href"),
    opened = context.waitForEvent("page");
  await link.click();
  const preview = await opened;
  await expect(preview.locator(".workspace-heading h1")).toBeVisible();
  await expect(preview.locator("img")).toHaveCount(0);
  const previewOrg = new URL(href!, info.project.use.baseURL).searchParams.get(
    "organizationId",
  )!;
  expect(
    (
      await context.request.get(
        `/api/demo/logo?organizationId=${previewOrg}&assetId=${selected.id}`,
      )
    ).status(),
  ).toBe(404);
  await preview.close();
  await step(page, "3 · Customize");
  await picker.setInputFiles({
    name: "replacement.webp",
    mimeType: "image/webp",
    buffer: await logoFixture("webp"),
  });
  await page
    .getByRole("button", { name: "Sanitize and stage logo", exact: true })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: /Sanitized image staged/ }),
  ).toBeVisible();
  await expect(page.locator(".topbar img")).toHaveAttribute("src", src!);
  await page
    .getByRole("button", {
      name: "Replace session logo with staged image",
      exact: true,
    })
    .click();
  await expect(page.locator(".topbar img")).not.toHaveAttribute("src", src!);
  expect((await context.request.get(src!)).status()).toBe(404);
  expect(await snapshot(page)).toEqual(before);
  await page.route("**/api/demo/logo?**assetId=**", (route) =>
    route.fulfill({ status: 404, body: "" }),
  );
  await page.reload();
  await expect(
    page
      .locator(".topbar")
      .getByText("Logo unavailable · built-in fallback", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "BuildPlan Studio", exact: true })
    .click();
  await step(page, "3 · Customize");
  await page
    .getByRole("button", {
      name: "Use built-in logo for this session",
      exact: true,
    })
    .click();
  await expect(page.locator(".topbar img")).toHaveCount(0);
  await expect(page.locator(".brand-example img")).toHaveCount(0);
  await expect(
    page.getByRole("button", {
      name: "Use built-in logo for this session",
      exact: true,
    }),
  ).toHaveCount(0);
  expect(
    (
      await (
        await context.request.get(
          `/api/demo/logo?organizationId=${organizationId}`,
        )
      ).json()
    ).selected,
  ).toBeNull();
  expect(await snapshot(page)).toEqual(before);
  await fits(page);
});
