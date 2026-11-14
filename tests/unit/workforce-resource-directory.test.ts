import { expect, it } from "vitest";
import type { WorkspaceRecord } from "../../src/core/engine";
import {
  filterWorkforceResourceDirectory,
  summarizeWorkforceResourceTypes,
} from "../../src/core/workforce-resource-directory";

const ORG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
function record(
  id: string, entity: string, data: Record<string, unknown>,
  archived = false, organization_id = ORG,
): WorkspaceRecord {
  return {
    id, entity, organization_id, data, archived, revision: 1,
    config_revision: 1, created_at: "2026-11-01T00:00:00Z",
    updated_at: "2026-11-01T00:00:00Z",
  } as WorkspaceRecord;
}

const resources = [
  record("crew", "resources", { name: "Blue cleaning crew", kind: "Crew" }),
  record("worker", "resources", { name: "Morning maintenance", kind: "Worker" }),
  record("machine", "resources", { name: "Floor machine", kind: "Equipment" }),
  record("former", "resources", { name: "Archived worker", kind: "Worker" }, true),
  record("not-resource", "employees", { name: "Someone", kind: "Crew" }),
  record("unknown", "resources", { name: "Unrecognized", kind: "Unknown" }),
];
const memberships = [
  record("membership-archived", "resource-memberships", {
    resource: "crew", employee: "employee-x",
  }, true),
  record("membership-foreign", "resource-memberships", {
    resource: "worker", employee: "other-person",
  }, false, OTHER),
  record("membership-active", "resource-memberships", {
    resource: "former", employee: "someone",
  }),
];

it("filters only current/archived Worker, Crew and Equipment names and types", () => {
  const before = structuredClone(resources);
  expect(filterWorkforceResourceDirectory(
    resources, memberships, false, "", "all",
  ).map((r) => r.id)).toEqual(["crew", "worker", "machine"]);
  expect(filterWorkforceResourceDirectory(
    resources, memberships, false, " CLEANing ", "Crew",
  ).map((r) => r.id)).toEqual(["crew"]);
  expect(filterWorkforceResourceDirectory(
    resources, memberships, false, "floor", "Equipment",
  ).map((r) => r.id)).toEqual(["machine"]);
  expect(filterWorkforceResourceDirectory(
    resources, memberships, false, "", "Worker",
  ).map((r) => r.id)).toEqual(["worker"]);
  expect(filterWorkforceResourceDirectory(
    resources, memberships, true, "", "Worker",
  ).map((r) => r.id)).toEqual(["former"]);
  expect(filterWorkforceResourceDirectory(
    resources, memberships, false, "not found",
  )).toEqual([]);
  expect(resources).toEqual(before);
});

it("treats archived memberships as retained enrollment, never as resource-only", () => {
  expect(filterWorkforceResourceDirectory(
    resources, memberships, false, "", "all", "enrolled",
  ).map((r) => r.id)).toEqual(["crew"]);
  expect(filterWorkforceResourceDirectory(
    resources, memberships, false, "", "all", "resource-only",
  ).map((r) => r.id)).toEqual(["worker"]);
  expect(filterWorkforceResourceDirectory(
    resources, memberships, true, "", "all", "enrolled",
  ).map((r) => r.id)).toEqual(["former"]);
  expect(filterWorkforceResourceDirectory(
    resources, memberships, false, "", "Equipment", "resource-only",
  )).toEqual([]);
  expect(filterWorkforceResourceDirectory(
    resources, memberships, false, "", "Equipment", "enrolled",
  )).toEqual([]);
});

it("never uses foreign membership to imply enrollment or searches IDs and metadata", () => {
  const originals = structuredClone(memberships);
  const names = ["crew", "worker", "machine", "not-resource"];
  for (const query of ["membership-archived", "employee-x", "not-resource"]) {
    expect(filterWorkforceResourceDirectory(
      resources, memberships, false, query,
    )).toEqual([]);
  }
  expect(filterWorkforceResourceDirectory(
    resources, memberships, false, "", "all", "resource-only",
  ).map((r) => r.id)).toEqual(["worker"]);
  const shown = filterWorkforceResourceDirectory(
    resources, memberships, false, "", "all",
  );
  shown.reverse();
  expect(memberships).toEqual(originals);
  expect(resources.slice(0, 3).map((r) => r.id)).toEqual(
    ["crew", "worker", "machine"],
  );
  expect(names).toHaveLength(4);
});


it("counts directory-selected and shown resource types without leaking foreign or invalid records", () => {
  const foreign = record("foreign-crew", "resources", {
    name: "PRIVATE FOREIGN CREW", kind: "Crew",
  }, false, OTHER);
  const foreignEquipment = record("machine", "resources", {
    name: "PRIVATE FOREIGN MACHINE", kind: "Equipment",
  }, false, OTHER);
  const mixed = [...resources, foreign, foreignEquipment];
  const original = structuredClone(mixed);
  expect(summarizeWorkforceResourceTypes(mixed, ORG)).toEqual({
    crews: 1, workers: 2, equipment: 1, total: 4,
  });
  const directory = filterWorkforceResourceDirectory(
    mixed.filter((r) => r.organization_id === ORG),
    memberships, false, "", "all", "all",
  );
  expect(summarizeWorkforceResourceTypes(directory, ORG)).toEqual({
    crews: 1, workers: 1, equipment: 1, total: 3,
  });
  // A card-only filter narrows shown cards, but not directory selection.
  expect(summarizeWorkforceResourceTypes([directory[1]], ORG)).toEqual({
    crews: 0, workers: 1, equipment: 0, total: 1,
  });
  expect(summarizeWorkforceResourceTypes([], ORG)).toEqual({
    crews: 0, workers: 0, equipment: 0, total: 0,
  });
  expect(mixed).toEqual(original);
});

it("agrees with resource name, type, enrollment and archived directory filters", () => {
  const directory = (showArchived: boolean, search: string,
    kind: "all" | "Crew" | "Worker" | "Equipment",
    enrollment: "all" | "enrolled" | "resource-only",
  ) => summarizeWorkforceResourceTypes(
    filterWorkforceResourceDirectory(
      resources, memberships, showArchived, search, kind, enrollment,
    ), ORG,
  );
  expect(directory(false, "", "all", "all")).toEqual({
    crews: 1, workers: 1, equipment: 1, total: 3,
  });
  expect(directory(false, "", "all", "enrolled")).toEqual({
    crews: 1, workers: 0, equipment: 0, total: 1,
  });
  expect(directory(false, "", "all", "resource-only")).toEqual({
    crews: 0, workers: 1, equipment: 0, total: 1,
  });
  expect(directory(false, "floor", "Equipment", "all")).toEqual({
    crews: 0, workers: 0, equipment: 1, total: 1,
  });
  expect(directory(true, "", "all", "all")).toEqual({
    crews: 0, workers: 1, equipment: 0, total: 1,
  });
  expect(directory(false, "none", "all", "all").total).toBe(0);
});
