import { expect, it } from "vitest";
import type { WorkspaceRecord } from "../../src/core/engine";
import {
  previewResourceTypeQuickViews,
  resourceTypeQuickView,
} from "../../src/core/resource-type-quick-view";
import type {
  WorkforceResourceEnrollmentFilter,
  WorkforceResourceTypeFilter,
} from "../../src/core/workforce-resource-directory";

it("keeps existing enrollment selection when switching among Crew, Worker and All", () => {
  for (const enrollment of ["all", "enrolled", "resource-only"] as
    WorkforceResourceEnrollmentFilter[]) {
    for (const kind of ["Crew", "Worker", "all"] as
      WorkforceResourceTypeFilter[]) {
      expect(resourceTypeQuickView(kind, enrollment)).toEqual({
        kind, enrollment,
      });
    }
  }
});

it("resets incompatible employee enrollment whenever selecting Equipment", () => {
  expect(resourceTypeQuickView("Equipment", "all")).toEqual({
    kind: "Equipment", enrollment: "all",
  });
  expect(resourceTypeQuickView("Equipment", "enrolled")).toEqual({
    kind: "Equipment", enrollment: "all",
  });
  expect(resourceTypeQuickView("Equipment", "resource-only")).toEqual({
    kind: "Equipment", enrollment: "all",
  });
  expect(resourceTypeQuickView("Crew", "enrolled")).toEqual({
    kind: "Crew", enrollment: "enrolled",
  });
});


const ORG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const FOREIGN = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
function record(entity: string, id: string, data: WorkspaceRecord["data"],
  archived = false, organization_id = ORG): WorkspaceRecord {
  return {
    entity, id, data, archived, organization_id,
    revision: 1, config_revision: 1,
    created_at: "2026-11-01T00:00:00Z",
    updated_at: "2026-11-01T00:00:00Z",
  };
}
const resources: WorkspaceRecord[] = [
  record("resources", "crew", { name: "North Crew", kind: "Crew" }),
  record("resources", "worker", { name: "North Worker", kind: "Worker" }),
  record("resources", "equip", { name: "North Equipment", kind: "Equipment" }),
  record("resources", "archived", { name: "North Former", kind: "Crew" }, true),
  record("resources", "foreign", { name: "PRIVATE North", kind: "Crew" }, false, FOREIGN),
  record("employees", "person", { name: "North Employee" }),
];
const memberships: WorkspaceRecord[] = [
  record("resource-memberships", "enrolled", {
    resource: "crew", employee: "person",
  }, true),
  record("resource-memberships", "foreign-overlap", {
    resource: "worker", employee: "person",
  }, false, FOREIGN),
];

it("previews every shortcut independently of current type and handles equipment enrollment reset", () => {
  const snapshot = structuredClone({ resources, memberships });
  expect(previewResourceTypeQuickViews(
    resources, memberships, ORG, false, "North", "all",
  )).toEqual({ crews: 1, workers: 1, equipment: 1, all: 3 });
  expect(previewResourceTypeQuickViews(
    resources, memberships, ORG, false, "North", "enrolled",
  )).toEqual({ crews: 1, workers: 0, equipment: 1, all: 1 });
  expect(previewResourceTypeQuickViews(
    resources, memberships, ORG, false, "North", "resource-only",
  )).toEqual({ crews: 0, workers: 1, equipment: 1, all: 1 });
  expect({ resources, memberships }).toEqual(snapshot);
});

it("applies archived tab and case-insensitive name searches without foreign leaks", () => {
  expect(previewResourceTypeQuickViews(
    resources, memberships, ORG, true, "  north  ", "all",
  )).toEqual({ crews: 1, workers: 0, equipment: 0, all: 1 });
  expect(previewResourceTypeQuickViews(
    resources, memberships, ORG, false, "NO SUCH", "all",
  )).toEqual({ crews: 0, workers: 0, equipment: 0, all: 0 });
  expect(previewResourceTypeQuickViews(
    resources, memberships, ORG, false, "PRIVATE", "all",
  )).toEqual({ crews: 0, workers: 0, equipment: 0, all: 0 });
});
