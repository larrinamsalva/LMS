import { expect, it } from "vitest";
import {
  newBuildPlan,
  validateBuildPlan,
  parseBuildPlanText,
  planForConfig,
  selectModules,
  addCustomField,
  moduleRequirements,
  workflowPacks,
  reviewWorkflowPack,
} from "../../src/core/buildplan";
import { configurationImpact } from "../../src/core/config";
import { presets } from "../../src/presets";
it("generates three valid reviewed templates and reopens compatible choices losslessly", () => {
  for (const type of ["property", "cleaning", "custom"] as const) {
    const plan = newBuildPlan(type);
    expect(plan.configuration.industry).toBe(type);
    expect(parseBuildPlanText(JSON.stringify(plan))).toEqual(plan);
    expect(planForConfig(plan.configuration)).toEqual(plan);
  }
  expect(planForConfig(presets.property).configuration.id).toBe(
    presets.property.id,
  );
});
it("resolves manifest and required-reference dependencies, while imports with missing dependencies refuse", () => {
  const plan = newBuildPlan("cleaning");
  const config = selectModules(plan.configuration, [
    "workforce",
    "estimates",
    "inventory",
  ]);
  expect(config.modules.map((m) => m.id)).toEqual(
    expect.arrayContaining([
      "customers",
      "tasks",
      "scheduling",
      "workforce",
      "cleaning",
      "estimates",
      "inventory",
    ]),
  );
  expect(moduleRequirements(config, "scheduling")).toContain("cleaning");
  const bad = {
    ...plan,
    configuration: {
      ...config,
      modules: config.modules.filter((m) => m.id !== "cleaning"),
      navigation: config.navigation.filter((n) => n !== "jobs"),
    },
  };
  expect(() => validateBuildPlan(bad)).toThrow();
  expect(() => selectModules(config, ["remote-code"])).toThrow();
});
it("rejects executable/unknown inputs, unsafe keys, unknown versions, oversized imports and changed core schemas", () => {
  const p = newBuildPlan("property");
  for (const input of [
    { ...p, version: 2 },
    { ...p, engineApi: 2 },
    { ...p, templateVersion: 2 },
    { ...p, execute: "alert(1)" },
    { ...p, configuration: { ...p.configuration, script: "eval()" } },
    { ...p, template: "cleaning" },
  ])
    expect(() => validateBuildPlan(input)).toThrow();
  expect(() => parseBuildPlanText('{"__proto__":{"polluted":true}}')).toThrow();
  expect(() => parseBuildPlanText(" ".repeat(49153))).toThrow();
  expect(() => parseBuildPlanText("<script>alert(1)</script>")).toThrow();
  const changed = structuredClone(p);
  changed.configuration.entities[0].fields[0].type = "number";
  expect(() => validateBuildPlan(changed)).toThrow();
});
it("supports four optional safe custom fields and refuses required, reference, reserved, unsafe and excessive extensions", () => {
  const p = newBuildPlan("custom");
  p.configuration = addCustomField(p.configuration, "customers", {
    key: "extra_gate",
    label: "Gate code notes",
    type: "text",
    required: false,
  });
  expect(parseBuildPlanText(JSON.stringify(p))).toEqual(p);
  for (const field of [
    { key: "extra_bad", label: "Bad", type: "text", required: true },
    { key: "extra_bad", label: "Bad", type: "datetime", required: false },
  ] as const) {
    const changed = {
      ...p,
      configuration: addCustomField(p.configuration, "customers", field),
    };
    expect(() => validateBuildPlan(changed)).toThrow();
  }
  let cfg = p.configuration;
  for (let i = 0; i < 4; i++)
    cfg = addCustomField(cfg, "customers", {
      key: "extra_" + i,
      label: "Extra " + i,
      type: "text",
      required: false,
    });
  expect(() => validateBuildPlan({ ...p, configuration: cfg })).toThrow();
});
it("shares publication impact rules for labels, hidden populated records, schema changes and identity", () => {
  const p = newBuildPlan("property"),
    next = structuredClone(p.configuration);
  next.name = "Fictional local";
  next.entities[0].singular = "Client";
  next.entities[0].navigationLabel = "People";
  expect(
    configurationImpact(p.configuration, next, ["customers"]).migrationEntities,
  ).toEqual([]);
  const changed = addCustomField(next, "items", {
    key: "extra_a",
    label: "Unsafe stock field",
    type: "text",
    required: false,
  });
  expect(
    configurationImpact(p.configuration, changed, ["items"]).migrationEntities,
  ).toContain("items");
  expect(
    configurationImpact(
      p.configuration,
      newBuildPlan("custom").configuration,
      [],
    ).identityChanged,
  ).toBe(true);
});

it("offers additive, reviewed workflow packs without publishing or changing existing choices", () => {
  const starter = newBuildPlan("custom").configuration;
  const sparse = selectModules(starter, ["customers", "tasks"]);
  const original = structuredClone(sparse);
  for (const pack of workflowPacks) {
    const reviewed = reviewWorkflowPack(sparse, pack.id);
    expect(reviewed.added.length).toBeGreaterThan(0);
    expect(reviewed.configuration.modules.map((m) => m.id)).toEqual(
      expect.arrayContaining(["customers", "tasks", ...pack.features]),
    );
    expect(reviewWorkflowPack(reviewed.configuration, pack.id).added).toEqual(
      [],
    );
    expect(validateBuildPlan({
      ...newBuildPlan("custom"),
      configuration: reviewed.configuration,
    }).configuration).toEqual(reviewed.configuration);
  }
  expect(sparse).toEqual(original);
  expect(reviewWorkflowPack(sparse, "equipment-care").added).toEqual(
    expect.arrayContaining(["inventory", "scheduling", "workforce", "equipment"]),
  );
  expect(reviewWorkflowPack(sparse, "estimate-to-draft").added).toEqual(
    expect.arrayContaining(["estimates", "invoice-drafts"]),
  );
  expect(
    reviewWorkflowPack(sparse, "crew-machine-calendar").added,
  ).toEqual(
    expect.arrayContaining([
      "inventory", "scheduling", "workforce", "equipment",
      "equipment-reservations", "coordinated-scheduling",
    ]),
  );
  expect(() => reviewWorkflowPack(sparse, "unexpected" as never)).toThrow(
    "Unknown workflow pack.",
  );
});

it("workflow packs keep existing fields, terminology, selections and branding", () => {
  let config = selectModules(newBuildPlan("cleaning").configuration, [
    "customers", "tasks", "cleaning", "inventory",
  ]);
  config = addCustomField(config, "customers", {
    key: "extra_gate", label: "Arrival instructions", type: "longtext", required: false,
  });
  config.name = "Friendly Demo";
  config.entities.find((e) => e.id === "customers")!.plural = "Clients";
  const selected = config.modules.map((m) => m.id);
  const { configuration: updated } = reviewWorkflowPack(config, "estimate-to-draft");
  expect(updated.name).toBe("Friendly Demo");
  expect(updated.entities.find((e) => e.id === "customers")!.plural).toBe("Clients");
  expect(updated.entities.find((e) => e.id === "customers")!.fields).toEqual(
    expect.arrayContaining([{ key: "extra_gate", label: "Arrival instructions", type: "longtext", required: false }]),
  );
  for (const id of selected) expect(updated.modules.some((m) => m.id === id)).toBe(true);
  expect(config.modules.map((m) => m.id)).toEqual(selected);
});
