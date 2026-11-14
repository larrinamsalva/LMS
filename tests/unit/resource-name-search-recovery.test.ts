import { expect, it } from "vitest";
import type { WorkspaceRecord } from "../../src/core/engine";
import {
  resourceNameSearchRecoveryCount,
  resourceEnrollmentRecoveryCount,
  resourceTypeRecoveryCount,
} from "../../src/core/resource-name-search-recovery";

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


const recoverEnrollment = (
  search: string, kind: "all" | "Crew" | "Worker" | "Equipment" = "all",
  enrollment: "all" | "enrolled" | "resource-only" = "all",
  archived = false,
) => resourceEnrollmentRecoveryCount(
  resources, memberships, ORG, archived, search, kind, enrollment,
);

it("suggests only an enrollment-only reset that would restore matching directory resources", () => {
  const snapshot = structuredClone({ resources, memberships });
  expect(recoverEnrollment("Northern Crew", "Crew", "resource-only")).toBe(1);
  // An archived retained crew membership still counts as enrolled.
  expect(recoverEnrollment("Northern Crew", "Crew", "enrolled")).toBe(0);
  expect(recoverEnrollment("Southern Worker", "Worker", "enrolled")).toBe(1);
  expect(recoverEnrollment("Southern Worker", "Worker", "resource-only")).toBe(0);
  expect(recoverEnrollment("Floor Machine", "Equipment", "enrolled")).toBe(1);
  expect(recoverEnrollment("Floor Machine", "Equipment", "resource-only")).toBe(1);
  expect(recoverEnrollment("Floor Machine", "Equipment", "all")).toBe(0);
  expect(recoverEnrollment("", "Crew", "enrolled")).toBe(0);
  expect({ resources, memberships }).toEqual(snapshot);
});

it("never offers enrollment reset when name/type/archive filters still hide everything", () => {
  expect(recoverEnrollment("NONE", "all", "enrolled")).toBe(0);
  expect(recoverEnrollment("Southern Worker", "Crew", "enrolled")).toBe(0);
  expect(recoverEnrollment("Northern Crew", "Crew", "enrolled", true)).toBe(0);
  expect(recoverEnrollment("Former Worker", "Worker", "enrolled", true)).toBe(1);
  expect(recoverEnrollment("Former Worker", "Worker", "resource-only", true)).toBe(0);
  expect(recoverEnrollment("PRIVATE FOREIGN", "Crew", "enrolled")).toBe(0);
  expect(recoverEnrollment("Southern Worker", "Worker", "enrolled")).toBe(1);
  // A foreign membership with the same resource ID cannot enroll a local Worker.
  expect(recoverEnrollment("Southern Worker", "Worker", "resource-only")).toBe(0);
});


const recoverType = (
  search: string, kind: "all" | "Crew" | "Worker" | "Equipment" = "all",
  enrollment: "all" | "enrolled" | "resource-only" = "all",
  archived = false,
) => resourceTypeRecoveryCount(
  resources, memberships, ORG, archived, search, kind, enrollment,
);

it("suggests type-only reset only for empty selected types with recoverable resources", () => {
  const before = structuredClone({ resources, memberships });
  expect(recoverType("Northern Crew", "Worker")).toBe(1);
  expect(recoverType("Southern Worker", "Crew")).toBe(1);
  expect(recoverType("Floor Machine", "Crew")).toBe(1);
  expect(recoverType("Northern Crew", "Crew")).toBe(0);
  expect(recoverType("Northern Crew", "all")).toBe(0);
  expect(recoverType("no-match", "Worker")).toBe(0);
  // A blank name search still finds the current Worker, so no recovery.
  expect(recoverType("  ", "Worker")).toBe(0);
  expect({ resources, memberships }).toEqual(before);
});

it("retains employee enrollment and current/archived filters when previewing type reset", () => {
  expect(recoverType("Northern Crew", "Worker", "enrolled")).toBe(1);
  expect(recoverType("Southern Worker", "Crew", "resource-only")).toBe(1);
  // Equipment is never eligible under enrolled/resource-only filters.
  expect(recoverType("Floor Machine", "Crew", "enrolled")).toBe(0);
  expect(recoverType("Floor Machine", "Worker", "resource-only")).toBe(0);
  expect(recoverType("Former Worker", "Crew", "all", true)).toBe(1);
  expect(recoverType("Former Worker", "Crew", "all", false)).toBe(0);
  expect(recoverType("Former Worker", "Worker", "all", true)).toBe(0);
});

it("does not leak foreign organizations or let foreign memberships enroll local resources", () => {
  expect(recoverType("PRIVATE FOREIGN", "Worker", "all")).toBe(0);
  expect(recoverType("Southern Worker", "Crew", "enrolled")).toBe(0);
  expect(recoverType("Southern Worker", "Crew", "resource-only")).toBe(1);
  expect(recoverType("foreign-link", "Crew", "all")).toBe(0);
});
