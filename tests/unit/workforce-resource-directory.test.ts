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

/**
 * Keep a deliberately simple reference to the pre-indexed filter here, so
 * future changes must retain exact historical enrollment and search
 * semantics even as the production implementation is optimized.
 */
function referenceDirectory(
  allResources: readonly WorkspaceRecord[],
  allMemberships: readonly WorkspaceRecord[],
  archived: boolean,
  search: string,
  kind: "all" | "Crew" | "Worker" | "Equipment",
  enrollment: "all" | "enrolled" | "resource-only",
): WorkspaceRecord[] {
  const query = search.trim().toLocaleLowerCase();
  return allResources.filter((resource) => {
    if (resource.entity !== "resources" ||
        resource.archived !== archived) return false;
    if (resource.data.kind !== "Crew" && resource.data.kind !== "Worker" &&
        resource.data.kind !== "Equipment") return false;
    if (kind !== "all" && resource.data.kind !== kind) return false;
    if (enrollment !== "all") {
      if (resource.data.kind === "Equipment") return false;
      const everEnrolled = allMemberships.some((membership) =>
        membership.entity === "resource-memberships" &&
        membership.organization_id === resource.organization_id &&
        membership.data.resource === resource.id,
      );
      if (enrollment === "enrolled" && !everEnrolled) return false;
      if (enrollment === "resource-only" && everEnrolled) return false;
    }
    return !query || (typeof resource.data.name === "string" &&
      resource.data.name.toLocaleLowerCase().includes(query));
  });
}

it("indexed enrollment filtering matches the original behavior across a large mixed directory", () => {
  const manyResources: WorkspaceRecord[] = [];
  const manyMemberships: WorkspaceRecord[] = [];
  for (let i = 0; i < 720; i += 1) {
    const id = "resource-" + i;
    const kind = i % 3 === 0 ? "Crew" : i % 3 === 1 ? "Worker" : "Equipment";
    manyResources.push(record(id, "resources", {
      kind, name: "Zone " + (i % 12) + " Resource " + i,
    }, i % 11 === 0));
    if (i % 4 === 0) {
      manyMemberships.push(record("membership-" + i,
        "resource-memberships", { resource: id, employee: "worker-" + i },
        i % 8 === 0));
      // Duplicate and archived history must not change boolean enrollment.
      if (i % 20 === 0) manyMemberships.push(record("duplicate-" + i,
        "resource-memberships", { resource: id, employee: "worker-" + i },
        true));
    }
    // Deliberately collide on ID across organizations: a foreign membership
    // must never enroll a local Worker/Crew, or vice versa.
    manyMemberships.push(record("foreign-member-" + i,
      "resource-memberships", { resource: id, employee: "outside-" + i },
      false, OTHER));
  }
  manyResources.push(record("resource-9", "resources", {
    kind: "Crew", name: "Foreign crew",
  }, false, OTHER));
  manyResources.push(record("ignored-person", "employees", {
    kind: "Worker", name: "Zone 2 Person",
  }));
  manyResources.push(record("ignored-kind", "resources", {
    kind: "Unknown", name: "Zone 2 Unknown",
  }));
  manyMemberships.push(record("not-membership", "employees", {
    resource: "resource-1", employee: "someone",
  }));
  manyMemberships.push(record("non-string-resource", "resource-memberships", {
    resource: 123, employee: "someone",
  }));
  const snapshot = structuredClone({ manyResources, manyMemberships });
  for (const archived of [false, true]) {
    for (const kind of ["all", "Crew", "Worker", "Equipment"] as const) {
      for (const enrollment of ["all", "enrolled", "resource-only"] as const) {
        for (const search of ["", "  ZONE 2  ", "not-found"]) {
          const expected = referenceDirectory(
            manyResources, manyMemberships, archived, search, kind, enrollment,
          ).map((r) => r.organization_id + ":" + r.id);
          const actual = filterWorkforceResourceDirectory(
            manyResources, manyMemberships, archived, search, kind, enrollment,
          ).map((r) => r.organization_id + ":" + r.id);
          expect(actual).toEqual(expected);
        }
      }
    }
  }
  expect({ manyResources, manyMemberships }).toEqual(snapshot);
});

it("does not confuse retained enrollment for reused resource IDs across organizations", () => {
  const a = record("shared", "resources", { name: "Shared crew A", kind: "Crew" });
  const b = record("shared", "resources", {
    name: "Shared crew B", kind: "Crew",
  }, false, OTHER);
  const onlyBMembership = record("b-member", "resource-memberships", {
    resource: "shared", employee: "staff",
  }, true, OTHER);
  expect(filterWorkforceResourceDirectory(
    [a, b], [onlyBMembership], false, "", "Crew", "enrolled",
  )).toEqual([b]);
  expect(filterWorkforceResourceDirectory(
    [a, b], [onlyBMembership], false, "", "Crew", "resource-only",
  )).toEqual([a]);
  const onlyAMembership = record("a-member", "resource-memberships", {
    resource: "shared", employee: "staff",
  }, true);
  expect(filterWorkforceResourceDirectory(
    [a, b], [onlyBMembership, onlyAMembership], false, "", "Crew", "enrolled",
  )).toEqual([a, b]);
});
