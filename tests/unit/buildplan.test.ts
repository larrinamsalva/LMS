import { expect, it } from "vitest";
import {
  newBuildPlan,
  validateBuildPlan,
  parseBuildPlanText,
  planForConfig,
  selectModules,
  addCustomField,
  moduleRequirements,
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
