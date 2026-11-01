import { expect, it } from "vitest";
import { createHash } from "node:crypto";
import {
  createBlueprintPackage,
  importBlueprintPackage,
  blueprintJson,
  compareBlueprints,
  reviewGalleryCompatibility,
} from "../../src/core/blueprint";
import {
  readBlueprintArchive,
  blueprintText,
} from "../../src/core/blueprint-archive";
import { reviewedGallery } from "../../src/core/gallery";
import {
  addCustomField,
  parseBuildPlanText,
  selectModules,
} from "../../src/core/buildplan";
const details = {
  name: "My fictional blueprint",
  description: "Portable choices, no records.",
};
it("round-trips every reviewed starter deterministically with exact hashes and derived dependencies", async () => {
  for (const entry of reviewedGallery()) {
    const metadata = {
        ...details,
        gallery: { id: entry.metadata.id, revision: 1 },
      },
      bytes = await createBlueprintPackage(entry.plan, metadata),
      files = readBlueprintArchive(bytes),
      result = await importBlueprintPackage(bytes);
    expect(await createBlueprintPackage(entry.plan, metadata)).toEqual(bytes);
    expect(result.plan).toEqual(entry.plan);
    expect(result.manifest.blueprint).toEqual(metadata);
    for (const file of result.manifest.files) {
      expect(createHash("sha256").update(files[file.path]).digest("hex")).toBe(
        file.sha256,
      );
      expect(files[file.path].length).toBe(file.bytes);
    }
    const workforce = result.manifest.compatibility.modules.find(
      (m) => m.id === "workforce",
    );
    if (workforce) expect(workforce.dependencies).toContain("scheduling");
    expect(result.summary).toContain("SETUP AND SAFE REUSE");
    expect(parseBuildPlanText(JSON.stringify(result.plan))).toEqual(entry.plan);
    expect(result.plan).not.toHaveProperty("blueprint");
    expect(Object.keys(files)).toEqual([
      "manifest.json",
      "buildplan.json",
      "README.txt",
    ]);
  }
});
it("retains customized Unicode names, labels, navigation order and optional fields without retaining references", async () => {
  const plan = reviewedGallery()[1].plan;
  plan.configuration.name = "Fictional Café 🧹";
  plan.configuration.entities[0].navigationLabel = "Our clients";
  plan.configuration = addCustomField(plan.configuration, "customers", {
    key: "extra_access",
    label: "Access notes",
    type: "longtext",
    required: false,
  });
  plan.configuration.navigation.reverse();
  const result = await importBlueprintPackage(
    await createBlueprintPackage(plan, details),
  );
  expect(result.plan).toEqual(plan);
  result.plan.configuration.name = "Different";
  expect(plan.configuration.name).toBe("Fictional Café 🧹");
  expect(blueprintJson({ z: 1, a: { b: true, a: "é" } })).toBe(
    '{"a":{"a":"é","b":true},"z":1}\n',
  );
});
it("rejects unsafe or executable metadata, record payloads and unsupported versions before export", async () => {
  const plan = reviewedGallery()[0].plan;
  for (const bad of [
    { ...details, credentials: "secret" },
    { ...details, name: "bad\nname" },
    { ...details, description: "" },
    { ...details, gallery: { id: "../x", revision: 1 } },
  ])
    await expect(createBlueprintPackage(plan, bad)).rejects.toThrow();
  for (const bad of [
    { ...plan, version: 2 },
    { ...plan, records: [] },
    { ...plan, execute: "fetch()" },
  ])
    await expect(createBlueprintPackage(bad, details)).rejects.toThrow();
});
it("compares customized choices with a newer reviewed starter without mutating or merging either", () => {
  const entries = reviewedGallery(),
    plan = structuredClone(entries[0].plan),
    before = structuredClone(plan);
  plan.configuration.name = "My saved choice";
  entries[0].metadata.revision = 2;
  entries[0].plan.configuration = selectModules(entries[0].plan.configuration, [
    "workforce",
    "cleaning",
  ]);
  const result = reviewGalleryCompatibility(
    plan,
    { id: "basic-cleaning", revision: 1 },
    entries,
  );
  expect(result.message).toMatch(/newer reviewed.*revision 2/);
  expect(result.differences).toContainEqual({
    label: "Business name",
    before: "My saved choice",
    after: before.configuration.name,
  });
  expect(result.differences).toContainEqual({
    label: "Employees & crews",
    before: "Disabled",
    after: "1.0.0",
  });
  expect(plan.configuration.name).toBe("My saved choice");
  expect(entries[0].metadata.revision).toBe(2);
  expect(reviewedGallery()[0].metadata.revision).toBe(1);
});
it("treats unavailable, stale-release, forged-type and absent Gallery references as untrusted hints", () => {
  const plan = reviewedGallery()[0].plan;
  expect(reviewGalleryCompatibility(plan).message).toMatch(/No Gallery/);
  expect(
    reviewGalleryCompatibility(plan, { id: "unknown-starter", revision: 1 })
      .message,
  ).toMatch(/unavailable/);
  expect(
    reviewGalleryCompatibility(plan, { id: "basic-cleaning", revision: 2 })
      .message,
  ).toMatch(/cannot be verified/);
  expect(
    reviewGalleryCompatibility(plan, { id: "rv-property", revision: 1 })
      .message,
  ).toMatch(/different business type/);
  expect(
    reviewGalleryCompatibility(plan, { id: "basic-cleaning", revision: 1 })
      .message,
  ).toMatch(/currently bundled/);
});
it("compares fields, terminology, module choices, zone and order using configuration only", () => {
  const original = reviewedGallery()[0].plan,
    plan = structuredClone(original);
  plan.configuration.name = "Renamed";
  plan.configuration.timeZone = "UTC";
  plan.configuration.entities[0].plural = "Clients";
  plan.configuration.entities[0].navigationLabel = "Clients";
  plan.configuration = addCustomField(plan.configuration, "customers", {
    key: "extra_note",
    label: "Visit note",
    type: "text",
    required: false,
  });
  plan.configuration.navigation.reverse();
  const rows = compareBlueprints(original.configuration, plan.configuration);
  expect(rows.map((r) => r.label)).toEqual(
    expect.arrayContaining([
      "Business name",
      "Time zone",
      "Navigation order",
      "customers: terminology",
      "customers: navigation label",
      "customers: field extra_note",
    ]),
  );
  expect(compareBlueprints(plan.configuration, plan.configuration)).toEqual([]);
  expect(blueprintText(blueprintJson(plan)).length).toBeLessThan(49152);
});
