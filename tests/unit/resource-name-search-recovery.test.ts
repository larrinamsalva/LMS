import { expect, it } from "vitest";
import type { WorkspaceRecord } from "../../src/core/engine";
import { resourceNameSearchRecoveryCount } from "../../src/core/resource-name-search-recovery";

const ORG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const FOREIGN = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function record(
  entity: string, id: string, data: WorkspaceRecord["data"],
  archived = false, organization_id = ORG,
): WorkspaceRecord {
  return {
    entity, id, data, archived, organization_id,
    revision: 1, config_revision: 1,
    created_at: "2026-11-01T00:00:00Z",
    updated_at: "2026-11-01T00:00:00Z",
  };
}
const resources: WorkspaceRecord[] = [
  record("resources", "crew", { kind: "Crew", name: "Northern Crew" }),
  record("resources", "worker", { kind: "Worker", name: "Southern Worker" }),
  record("resources", "equipment", { kind: "Equipment", name: "Floor Machine" }),
  record("resources", "former", { kind: "Worker", name: "Former Worker" }, true),
  record("resources", "foreign", { kind: "Crew", name: "PRIVATE FOREIGN" },
    false, FOREIGN),
  record("employees", "person", { name: "Not a resource" }),
];
const memberships: WorkspaceRecord[] = [
  record("resource-memberships", "archived-link", {
    resource: "crew", employee: "person",
  }, true),
  record("resource-memberships", "foreign-link", {
    resource: "worker", employee: "person",
  }, false, FOREIGN),
];

const recover = (
  search: string, kind: "all" | "Crew" | "Worker" | "Equipment" = "all",
  enrollment: "all" | "enrolled" | "resource-only" = "all",
  archived = false,
) => resourceNameSearchRecoveryCount(
  resources, memberships, ORG, archived, search, kind, enrollment,
);

it("only suggests clearing a nonempty, zero-result resource-name search", () => {
  const before = structuredClone({ resources, memberships });
  expect(recover("")).toBe(0);
  expect(recover("  ")).toBe(0);
  expect(recover("north")).toBe(0);
  expect(recover("UNKNOWN")).toBe(3);
  expect(recover("UNKNOWN", "Crew")).toBe(1);
  expect(recover("UNKNOWN", "Worker")).toBe(1);
  expect(recover("UNKNOWN", "Equipment")).toBe(1);
  expect({ resources, memberships }).toEqual(before);
});

it("keeps resource type, archived tab and permanent enrollment filters", () => {
  expect(recover("not-here", "all", "enrolled")).toBe(1);
  expect(recover("not-here", "all", "resource-only")).toBe(1);
  expect(recover("not-here", "Equipment", "enrolled")).toBe(0);
  expect(recover("not-here", "Crew", "resource-only")).toBe(0);
  expect(recover("not-here", "Worker", "all", true)).toBe(1);
  expect(recover("not-here", "Crew", "all", true)).toBe(0);
});

it("does not include foreign resources, foreign memberships or private metadata", () => {
  expect(recover("PRIVATE")).toBe(3);
  expect(recover("foreign-link")).toBe(3);
  // Foreign membership must not mark the worker as enrolled.
  expect(recover("FOREIGN", "Worker", "enrolled")).toBe(0);
  expect(recover("FOREIGN", "Worker", "resource-only")).toBe(1);
});
