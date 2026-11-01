import { expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import {
  brandingSchema,
  palettes,
  paletteIds,
  logoMarks,
  contrastRatio,
  brandingVariables,
  defaultBranding,
} from "../../src/core/branding";
import {
  newBuildPlan,
  brandBuildPlan,
  unbrandBuildPlan,
  parseBuildPlanText,
  validateBuildPlan,
} from "../../src/core/buildplan";
import { validateConfig, configurationImpact } from "../../src/core/config";
import { reviewedGallery } from "../../src/core/gallery";
import {
  createBlueprintPackage,
  importBlueprintPackage,
  compareBlueprints,
  blueprintJson,
} from "../../src/core/blueprint";
import {
  readBlueprintArchive,
  writeStoredZip,
  blueprintText,
  decodeBlueprintText,
} from "../../src/core/blueprint-archive";
it("enforces unrounded readable text, controls and focus contrast for every versioned palette in both modes", () => {
  expect(contrastRatio("#000000", "#ffffff")).toBe(21);
  expect(contrastRatio("#777777", "#777777")).toBe(1);
  for (const id of paletteIds)
    for (const mode of ["light", "dark"] as const) {
      const t = palettes[id][mode];
      for (const bg of ["bg", "surface", "surfaceAlt", "secondary"] as const) {
        for (const fg of ["text", "muted", "primary"] as const)
          expect(
            contrastRatio(t[fg], t[bg]),
            `${id}/${mode}/${fg}/${bg}`,
          ).toBeGreaterThanOrEqual(4.5);
        for (const fg of ["border", "accent"] as const)
          expect(
            contrastRatio(t[fg], t[bg]),
            `${id}/${mode}/${fg}/${bg}`,
          ).toBeGreaterThanOrEqual(3);
      }
      expect(contrastRatio(t.onPrimary, t.primary)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(t.onSecondary, t.secondary)).toBeGreaterThanOrEqual(
        4.5,
      );
      expect(contrastRatio(t.onAccent, t.accent)).toBeGreaterThanOrEqual(4.5);
      const vars = brandingVariables(
        { ...defaultBranding("cleaning"), palette: id },
        mode,
      );
      expect(Object.values(vars).every((v) => /^#[a-f0-9]{6}$/.test(v))).toBe(
        true,
      );
    }
});
it("accepts only reviewed IDs and structured plain text and rejects injected styling, images, SVG and markup", () => {
  const base = defaultBranding("property");
  for (const mark of Object.keys(logoMarks))
    expect(brandingSchema.parse({ ...base, mark }).mark).toBe(mark);
  for (const patch of [
    { version: 2 },
    { palette: "unknown" },
    { palette: "#ffffff; color:red" },
    { mark: "<svg onload=alert(1)>" },
    { monogram: "<X>" },
    { monogram: "lower" },
    { monogram: "ABCDE" },
    { monogram: "" },
    { appearance: "external" },
    { tagline: "<script>alert(1)</script>" },
    { tagline: "bad\nline" },
    { tagline: "x".repeat(121) },
    { css: "body{}" },
    { logoUrl: "https://untrusted.invalid/logo.svg" },
    { svg: "<svg/>" },
    { credentials: "secret" },
  ])
    expect(() => brandingSchema.parse({ ...base, ...patch })).toThrow();
  expect(() =>
    brandingVariables({ ...base, palette: "bad" } as any, "light"),
  ).toThrow();
});
it("uses explicit paired config/BuildPlan versions and preserves legacy choices without automatic upgrade", () => {
  for (const template of ["property", "cleaning", "custom"] as const) {
    const legacy = newBuildPlan(template),
      branded = brandBuildPlan(legacy, {
        ...defaultBranding(template),
        monogram: "MY",
        tagline: "Fictional work, my way.",
      });
    expect(branded.version).toBe(2);
    expect(branded.configuration.schemaVersion).toBe(2);
    expect(parseBuildPlanText(JSON.stringify(branded))).toEqual(branded);
    expect(unbrandBuildPlan(branded)).toEqual(legacy);
    expect(legacy.version).toBe(1);
    expect(legacy.configuration).not.toHaveProperty("branding");
    for (const invalid of [
      { ...branded, version: 1 },
      { ...legacy, version: 2 },
      { ...branded, version: 3 },
      {
        ...branded,
        configuration: { ...branded.configuration, schemaVersion: 1 },
      },
      {
        ...legacy,
        configuration: { ...legacy.configuration, schemaVersion: 2 },
      },
    ])
      expect(() => validateBuildPlan(invalid)).toThrow();
    expect(() =>
      validateConfig({ ...branded.configuration, name: "<b>Injected</b>" }),
    ).toThrow();
  }
});
it("reads a real PR16 v1 package and reproduces its exact bytes without changing the legacy protocol", async () => {
  const bytes = await readFile("tests/fixtures/blueprint-v1.zip"),
    old = await importBlueprintPackage(bytes);
  expect(createHash("sha256").update(bytes).digest("hex")).toBe(
    "4b6f8a396f9ea59122b3a84de96f1fd7ad193b6b895e284e269f344d5b37e50d",
  );
  expect(old.manifest.version).toBe(1);
  expect(old.plan.version).toBe(1);
  expect(
    Buffer.from(await createBlueprintPackage(old.plan, old.manifest.blueprint)),
  ).toEqual(bytes);
  expect(parseBuildPlanText(JSON.stringify(old.plan))).toEqual(old.plan);
});
it("round-trips branded packages with exact colors, monogram, tagline and appearance while leaving Gallery defaults detached", async () => {
  for (const entry of reviewedGallery()) {
    const source = structuredClone(entry),
      plan = brandBuildPlan(entry.plan, {
        ...defaultBranding(entry.plan.template),
        tagline: "Fictional and independent",
        monogram: "MY",
        mark: "sparkle",
        appearance: "dark",
      });
    const result = await importBlueprintPackage(
      await createBlueprintPackage(plan, {
        name: "Branded fictional starter",
        description: "No business records.",
      }),
    );
    expect(result.manifest.version).toBe(2);
    expect(result.manifest.compatibility).toMatchObject({
      buildPlan: 2,
      configurationSchema: 2,
      branding: 1,
    });
    expect(result.plan).toEqual(plan);
    expect(result.summary).toContain("BRANDING\nMark: sparkle\nMonogram: MY");
    expect(entry).toEqual(source);
    expect(entry.plan.version).toBe(1);
  }
});
it("refuses downgraded or unsafe branded imports even after archive checksums and payload hashes are repaired", async () => {
  const plan = brandBuildPlan(
      newBuildPlan("cleaning"),
      defaultBranding("cleaning"),
    ),
    bytes = await createBlueprintPackage(plan, {
      name: "Valid branded fixture",
      description: "Fictional only.",
    });
  for (const mutation of [
    (p: any, m: any) => {
      m.version = 1;
    },
    (p: any, m: any) => {
      m.compatibility.branding = 2;
    },
    (p: any) => {
      p.version = 1;
    },
    (p: any) => {
      p.configuration.branding.logoUrl = "https://unsafe.invalid/track.svg";
    },
    (p: any) => {
      p.configuration.branding.palette = "url(javascript:alert(1))";
    },
    (p: any) => {
      p.configuration.branding.tagline = "<img src=x onerror=alert(1)>";
    },
  ]) {
    const files = readBlueprintArchive(bytes),
      p = JSON.parse(decodeBlueprintText(files["buildplan.json"])),
      m = JSON.parse(decodeBlueprintText(files["manifest.json"]));
    mutation(p, m);
    files["buildplan.json"] = blueprintText(blueprintJson(p));
    m.files[0].bytes = files["buildplan.json"].length;
    m.files[0].sha256 = createHash("sha256")
      .update(files["buildplan.json"])
      .digest("hex");
    files["manifest.json"] = blueprintText(blueprintJson(m));
    await expect(
      importBlueprintPackage(
        writeStoredZip(
          Object.entries(files).map(([path, bytes]) => ({ path, bytes })),
        ),
      ),
    ).rejects.toThrow();
  }
});
it("reviews branding separately from operational field schemas and reports changes without mutation", () => {
  const legacy = newBuildPlan("property"),
    branded = brandBuildPlan(legacy, defaultBranding("property")),
    impact = configurationImpact(legacy.configuration, branded.configuration, [
      "customers",
      "items",
      "appointments",
    ]);
  expect(impact.brandingChanged).toBe(true);
  expect(impact.fieldsChanged).toBe(false);
  expect(impact.migrationEntities).toEqual([]);
  expect(impact.identityChanged).toBe(false);
  expect(
    compareBlueprints(legacy.configuration, branded.configuration).map(
      (r) => r.label,
    ),
  ).toContain("Branding: palette");
  expect(legacy.configuration).not.toHaveProperty("branding");
});
