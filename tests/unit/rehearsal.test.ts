import { expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import {
  newBuildPlan,
  addCustomField,
  brandBuildPlan,
  moduleRequirements,
} from "../../src/core/buildplan";
import { defaultBranding } from "../../src/core/branding";
import {
  explainMigrationImpact,
  type MigrationReview,
} from "../../src/core/migration-review";
import {
  buildRehearsalPlan,
  readiness,
  rehearsalChecks,
  rehearsalInput,
  rehearsalReport,
  rehearsalResultSchema,
  type RehearsalResult,
} from "../../src/core/rehearsal";
const review = (): MigrationReview => {
  const current = newBuildPlan("property"),
    proposed = brandBuildPlan(
      {
        ...current,
        configuration: addCustomField(current.configuration, "customers", {
          key: "extra_note",
          label: "Fictional optional note",
          type: "text",
          required: false,
        }),
      },
      defaultBranding("property"),
    );
  return {
    format: "lms-migration-review",
    version: 1,
    configurationRevision: 1,
    ...explainMigrationImpact(current.configuration, proposed, [
      { entity: "customers", active: 21, archived: 4 },
    ]),
    state: { stateDigest: "a".repeat(64), proposalDigest: "b".repeat(64) },
    draft: { id: randomUUID(), revision: 1 },
  };
};
const completed = (): RehearsalResult => ({
  version: 1,
  status: "completed",
  outcomes: Object.keys(rehearsalChecks).map((id) => ({
    id: id as keyof typeof rehearsalChecks,
    status: "passed",
  })),
  workspace: { organizationId: randomUUID() },
});
it("derives versioned plans and exact dependencies from the existing validated configuration without population or transient metadata", () => {
  const r = review(),
    p = buildRehearsalPlan(r);
  expect(p.configurations.proposed.version).toBe(2);
  expect(p.configurations.current.schemaVersion).toBe(1);
  for (const m of p.modules)
    expect(m.dependencies).toEqual(
      moduleRequirements(r.proposed.configuration, m.id),
    );
  expect(p.entityDefinitions).toEqual(r.proposed.configuration.entities);
  expect(
    p.relationships.some(
      (v) => v.entity === "appointments" && v.target === "customers",
    ),
  ).toBe(true);
  expect(JSON.stringify(p)).not.toContain('"active":21');
  expect(JSON.stringify(p)).not.toContain(r.draft!.id);
  expect(p.blockers.join(" ")).toContain("migration-review");
});
it("keeps backup, authorization, production acceptance and populated-data blockers separate from completed fictional checks", () => {
  const r = review(),
    rows = readiness(r, completed());
  expect(rows.find((r) => r.item === "Fictional rehearsal")?.status).toContain(
    "Completed",
  );
  expect(
    rows.find((r) => r.item === "Existing data compatibility")?.status,
  ).toContain("Blocked");
  expect(
    rows.find((r) => r.item === "Business backup and restore evidence")?.status,
  ).toContain("Not verified");
  expect(rows.find((r) => r.item === "Migration authorization")?.status).toBe(
    "Not granted",
  );
  expect(
    rows.find((r) => r.item === "Production security acceptance")?.status,
  ).toBe("Blocked");
  expect(
    readiness(r).find((r) => r.item === "Fictional rehearsal")?.status,
  ).toBe("Not run");
});
it("requires source fingerprints and refuses malformed schemas, unknown commands and unsupported outcome claims", () => {
  const r = review(),
    request = {
      document: r.proposed,
      expected: r.state,
      operationId: randomUUID(),
    };
  expect(rehearsalInput.parse(request)).toEqual(request);
  for (const input of [
    { ...request, expected: undefined },
    { ...request, force: true },
    { ...request, sql: "SECRET" },
    { ...request, operationId: "unsafe" },
  ])
    expect(() => rehearsalInput.parse(input)).toThrow();
  const good = completed();
  expect(rehearsalResultSchema.parse(good)).toEqual(good);
  for (const edit of [
    (r: any) => (r.secret = "SECRET"),
    (r: any) => (r.outcomes[0].id = "execute"),
    (r: any) => (r.outcomes[1].id = r.outcomes[0].id),
    (r: any) => (r.outcomes[0].status = "failed"),
    (r: any) => r.outcomes.pop(),
  ]) {
    const v = structuredClone(good);
    edit(v);
    expect(() => rehearsalResultSchema.parse(v)).toThrow();
  }
  const bad = structuredClone(r);
  (bad.proposed as any).version = 3;
  expect(() => buildRehearsalPlan(bad)).toThrow();
});
it("exports only validated configuration, static outcomes and explicit follow-ups, never workspace IDs, raw errors or records", () => {
  const r = review(),
    result = completed(),
    out = rehearsalReport(r, result),
    text = JSON.stringify(out);
  expect(out.plan.configurations.proposed).toEqual(r.proposed);
  expect(out.status).toBe("completed");
  for (const item of [
    result.workspace!.organizationId,
    r.draft!.id,
    r.state.stateDigest,
    "organizationId",
    "stateDigest",
    '"records":',
    '"active":',
    "customerName",
    "sessionToken",
    "pg_restore --",
  ])
    expect(text).not.toContain(item);
  expect(text).toContain("not this business's backup");
  expect(() =>
    rehearsalReport(r, { ...result, error: "SECRET" } as any),
  ).toThrow();
  expect(() => rehearsalReport(r, { ...result, status: "failed" })).toThrow();
});
