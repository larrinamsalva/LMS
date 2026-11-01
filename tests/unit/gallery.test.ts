import { expect, it } from "vitest";
import {
  reviewedGallery,
  validateGallery,
  validateGalleryEntry,
  filterGallery,
  remixGalleryEntry,
} from "../../src/core/gallery";
import { parseBuildPlanText } from "../../src/core/buildplan";
it("validates all five curated blueprints with existing portable envelopes and reviewed modules", () => {
  const entries = reviewedGallery();
  expect(entries.map((e) => e.metadata.name)).toEqual([
    "Basic Cleaning Business",
    "Cleaning Crew & Scheduling",
    "RV Park / Property Management",
    "Property Maintenance",
    "General Service Business",
  ]);
  for (const entry of entries) {
    expect(validateGalleryEntry(entry)).toEqual(entry);
    const plan = remixGalleryEntry(entry);
    expect(parseBuildPlanText(JSON.stringify(plan))).toEqual(plan);
    expect(plan).not.toHaveProperty("metadata");
    expect(plan.version).toBe(1);
  }
});
it("rejects invalid envelopes, unsupported modules, missing dependencies and invalid metadata", () => {
  const entry = reviewedGallery()[1];
  const unknown = structuredClone(entry);
  unknown.plan.configuration.modules.push({
    id: "remote-code",
    version: "1.0.0",
  });
  expect(() => validateGalleryEntry(unknown)).toThrow();
  const missing = structuredClone(entry);
  missing.plan.configuration.modules =
    missing.plan.configuration.modules.filter((m) => m.id !== "scheduling");
  missing.plan.configuration.navigation =
    missing.plan.configuration.navigation.filter(
      (id) => !["appointments", "resources"].includes(id),
    );
  expect(() => validateGalleryEntry(missing)).toThrow();
  expect(() => validateGalleryEntry({ ...entry, execute: "eval()" })).toThrow();
  expect(() =>
    validateGalleryEntry({
      ...entry,
      metadata: { ...entry.metadata, previewUrl: "https://untrusted.invalid" },
    }),
  ).toThrow();
  expect(() =>
    validateGalleryEntry({ ...entry, plan: { ...entry.plan, version: 99 } }),
  ).toThrow();
  expect(() => validateGallery([entry, entry])).toThrow();
});
it("refuses workflows backed by disabled modules, unknown workflows and duplicate claims", () => {
  const entry = reviewedGallery()[0];
  expect(
    entry.plan.configuration.modules.some((m) => m.id === "estimates"),
  ).toBe(false);
  expect(() =>
    validateGalleryEntry({
      ...entry,
      metadata: {
        ...entry.metadata,
        workflows: [...entry.metadata.workflows, "estimates"],
      },
    }),
  ).toThrow(/disabled/);
  expect(() =>
    validateGalleryEntry({
      ...entry,
      metadata: { ...entry.metadata, workflows: ["live-payments"] },
    }),
  ).toThrow();
  expect(() =>
    validateGalleryEntry({
      ...entry,
      metadata: { ...entry.metadata, workflows: ["customers", "customers"] },
    }),
  ).toThrow();
});
it("searches names, purposes and supported workflows and combines type/feature filters", () => {
  const entries = reviewedGallery();
  expect(
    filterGallery(entries, " CLEANING  CREW ", "cleaning", "workforce").map(
      (e) => e.metadata.id,
    ),
  ).toEqual(["cleaning-crews"]);
  expect(filterGallery(entries, "", "property", "all")).toHaveLength(2);
  expect(filterGallery(entries, "", "cleaning", "estimates")).toEqual([]);
  expect(
    filterGallery(entries, "estimates", "all", "all").map((e) => e.metadata.id),
  ).toEqual(["rv-property", "general-service"]);
  expect(filterGallery(entries, "", "all", "live-payments")).toEqual([]);
});
it("detaches remixes and never updates existing choices from catalog revisions", () => {
  const source = reviewedGallery()[0],
    saved = remixGalleryEntry(source),
    before = JSON.stringify(saved);
  const updated = structuredClone(source);
  updated.metadata.revision = 2;
  updated.plan.configuration.name = "Later catalog name";
  validateGalleryEntry(updated);
  expect(JSON.stringify(saved)).toBe(before);
  saved.configuration.name = "My unchanged choice";
  saved.configuration.entities[0].navigationLabel = "My clients";
  expect(reviewedGallery()[0]).toEqual(source);
  expect(source.plan.configuration.name).not.toBe(saved.configuration.name);
});
