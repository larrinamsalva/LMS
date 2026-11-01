import { expect, it } from "vitest";
import {
  explainMigrationImpact,
  migrationReport,
  type MigrationReview,
} from "../../src/core/migration-review";
import {
  newBuildPlan,
  addCustomField,
  brandBuildPlan,
  selectModules,
} from "../../src/core/buildplan";
import { configurationImpact } from "../../src/core/config";
import { defaultBranding } from "../../src/core/branding";
const base = () => newBuildPlan("property");
const extra = (plan = base()) => ({
  ...plan,
  configuration: addCustomField(plan.configuration, "customers", {
    key: "extra_access",
    label: "Access notes",
    type: "text",
    required: false,
  }),
});
it("uses the shared authoritative impact rule for empty, active, archived and disabled entities, never an additive-field exemption", () => {
  const current = base(),
    proposal = extra(current);
  for (const population of [
    [],
    [{ entity: "customers", active: 1, archived: 0 }],
    [{ entity: "customers", active: 0, archived: 1 }],
  ]) {
    const result = explainMigrationImpact(
      current.configuration,
      proposal,
      population,
    );
    expect(result.overall).toBe(
      configurationImpact(
        current.configuration,
        proposal.configuration,
        population.map((p) => p.entity),
      ).migrationEntities.length
        ? "migration-review"
        : "compatible",
    );
    expect(
      result.changes.find((c) => c.change === "Field: Access notes")?.category,
    ).toBe(result.overall);
  }
  const disabled = structuredClone(current.configuration);
  disabled.modules = disabled.modules.filter((m) => m.id !== "inventory");
  disabled.navigation = disabled.navigation.filter(
    (id) =>
      !disabled.entities.some((e) => e.id === id && e.module === "inventory"),
  );
  const p = {
    ...current,
    configuration: addCustomField(disabled, "customers", {
      key: "extra_note",
      label: "Note",
      required: false,
      type: "longtext",
    }),
  };
  expect(
    explainMigrationImpact(disabled, p, [
      { entity: "items", active: 2, archived: 1 },
    ]).entities.find((e) => e.entity === "items"),
  ).toMatchObject({ active: 2, archived: 1, enabled: false });
});
it("explains changed optional types, removals, references and protected history while requiring review on populated schemas", () => {
  const current = extra(),
    proposal = structuredClone(current);
  proposal.configuration.entities
    .find((e) => e.id === "customers")!
    .fields.find((f) => f.key === "extra_access")!.type = "longtext";
  const result = explainMigrationImpact(current.configuration, proposal, [
    { entity: "customers", active: 0, archived: 1 },
  ]);
  expect(result.overall).toBe("migration-review");
  expect(
    result.changes.find((c) => c.change === "Field: Access notes"),
  ).toMatchObject({
    category: "migration-review",
    before: expect.stringContaining("text, optional"),
    after: expect.stringContaining("longtext, optional"),
  });
  expect(
    explainMigrationImpact(current.configuration, base(), [
      { entity: "customers", active: 1, archived: 0 },
    ]).overall,
  ).toBe("migration-review");
  expect(result.warnings.join(" ")).toMatch(/estimate pricing/);
  expect(result.warnings.join(" ")).toMatch(/immutable inventory movements/);
  expect(result.warnings.join(" ")).toMatch(/organization-scoped/);
});
it("reports compatible presentation/module choices, explicit branded v2 and immutable industry identity", () => {
  const current = base(),
    proposal = brandBuildPlan(current, defaultBranding("property"));
  proposal.configuration.name = "Fictional future name";
  proposal.configuration = selectModules(
    proposal.configuration,
    proposal.configuration.modules
      .filter((m) => m.id !== "inventory")
      .map((m) => m.id),
  );
  const result = explainMigrationImpact(current.configuration, proposal, [
    { entity: "items", active: 1, archived: 1 },
  ]);
  expect(result.overall).toBe("compatible");
  expect(
    result.changes.find((c) => c.change === "Module: inventory")?.reason,
  ).toMatch(/does not cancel bookings/);
  expect(result.changes.find((c) => c.change === "Branding")).toBeDefined();
  expect(
    explainMigrationImpact(current.configuration, newBuildPlan("cleaning"), [])
      .overall,
  ).toBe("blocked");
});
it("refuses unsupported schemas, paired versions, required/core/reference alterations and missing module dependencies", () => {
  const current = base();
  for (const edit of [
    (p: any) => (p.version = 3),
    (p: any) => (p.version = 2),
    (p: any) => (p.configuration.schemaVersion = 3),
    (p: any) => (p.configuration.entities[0].fields[0].type = "number"),
    (p: any) => (p.configuration.entities[0].fields[0].required = false),
    (p: any) =>
      (p.configuration.entities
        .find((e: any) => e.id === "tasks")
        .fields.find((f: any) => f.type === "reference").target = "items"),
    (p: any) =>
      (p.configuration.modules = p.configuration.modules.filter(
        (m: any) => m.id !== "scheduling",
      )),
    (p: any) => (p.execute = "drop table records"),
  ]) {
    const p = structuredClone(current);
    edit(p);
    expect(() =>
      explainMigrationImpact(current.configuration, p, []),
    ).toThrow();
  }
});
it("exports only validated configurations and readable warnings, excluding all transient observations and operational payloads", () => {
  const c = base(),
    result = explainMigrationImpact(c.configuration, extra(c), [
      { entity: "customers", active: 42, archived: 5 },
    ]);
  const review: MigrationReview = {
    format: "lms-migration-review",
    version: 1,
    configurationRevision: 1,
    ...result,
    state: { stateDigest: "a".repeat(64), proposalDigest: "b".repeat(64) },
    draft: { id: "private-draft-id", revision: 1 },
  };
  const exported = migrationReport(review),
    text = JSON.stringify(exported);
  expect(exported.format).toBe("lms-migration-impact-report");
  expect(exported.overall).toBe("migration-review");
  expect(exported.configurations.proposed).toEqual(extra(c));
  for (const value of [
    "stateDigest",
    "private-draft-id",
    '"active":42',
    '"archived":5',
    "created_by",
    "record_id",
    "organizationId",
    "drop table",
  ])
    expect(text).not.toContain(value);
  expect(() =>
    explainMigrationImpact(c.configuration, exported as any, []),
  ).toThrow();
});
