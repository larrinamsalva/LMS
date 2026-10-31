import { describe, expect, it } from "vitest";
import {
  activeEntities,
  validateConfig,
  validateRecord,
} from "../../src/core/config";
import { presets } from "../../src/presets";
import { manifests } from "../../src/modules/registry";
describe("configuration and reviewed module contracts", () => {
  it("validates both distinct presets with the same engine version", () => {
    for (const config of Object.values(presets))
      expect(validateConfig(config).schemaVersion).toBe(1);
    expect(activeEntities(presets.property).map((e) => e.id)).toContain(
      "units",
    );
    expect(activeEntities(presets.cleaning).map((e) => e.id)).toContain("jobs");
    expect(manifests.every((m) => m.engineApi === 1)).toBe(true);
  });
  it("rejects unknown modules, missing dependencies, unknown properties, versions and executable actions", () => {
    const base = structuredClone(presets.property);
    for (const value of [
      { ...base, schemaVersion: 2 },
      { ...base, ai: { apiKey: "secret" } },
      {
        ...base,
        modules: [...base.modules, { id: "remote-code", version: "1.0.0" }],
      },
      { ...base, modules: base.modules.filter((m) => m.id !== "customers") },
      { ...base, navigation: ["unknown"] },
      { ...base, modules: [{ id: "customers", version: "2.0.0" }] },
      { ...base, workflows: [{ action: "send-message" }] },
    ])
      expect(() => validateConfig(value)).toThrow();
  });
  it("rejects duplicate/reserved fields and validates required date/select/number/email data", () => {
    const bad = structuredClone(presets.property);
    bad.entities[0].fields.push(bad.entities[0].fields[0]);
    expect(() => validateConfig(bad)).toThrow();
    bad.entities[0].fields[0].key = "constructor";
    expect(() => validateConfig(bad)).toThrow();
    const customer = presets.property.entities[0];
    expect(() => validateRecord(customer, { name: "" })).toThrow();
    expect(() =>
      validateRecord(customer, { name: "Test", organization_id: "forged" }),
    ).toThrow();
    expect(() =>
      validateRecord(customer, { name: "Test", email: "invalid" }),
    ).toThrow();
    const job = presets.cleaning.entities.find((e) => e.id === "jobs")!;
    expect(() =>
      validateRecord(job, {
        title: "Test",
        service: "Deep clean",
        date: "2026-02-30",
        status: "Planned",
      }),
    ).toThrow();
    expect(() =>
      validateRecord(job, {
        title: "Test",
        service: "Arbitrary",
        date: "2026-11-03",
        status: "Planned",
      }),
    ).toThrow();
    expect(
      validateRecord(customer, {
        name: "  Test  ",
        notes: "<script>alert(1)</script>",
      }).name,
    ).toBe("Test");
  });
  it("supports a new custom operational entity without new forms or engine code", () => {
    const config = validateConfig({
      ...presets.property,
      modules: [
        ...presets.property.modules,
        { id: "custom-records", version: "1.0.0" },
      ],
      entities: [
        ...presets.property.entities,
        {
          id: "custom-tools",
          module: "custom-records",
          singular: "Tool",
          plural: "Tools",
          titleField: "name",
          fields: [
            { key: "name", label: "Name", type: "text", required: true },
            { key: "count", label: "Count", type: "number", required: true },
          ],
        },
      ],
      navigation: [...presets.property.navigation, "custom-tools"],
    });
    const tool = config.entities.at(-1)!;
    expect(validateRecord(tool, { name: "Vacuum", count: 2 }).count).toBe(2);
    expect(() => validateRecord(tool, { name: "Vacuum", count: -1 })).toThrow();
  });
});
