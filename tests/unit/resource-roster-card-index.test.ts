import { expect, it } from "vitest";
import type { WorkspaceRecord } from "../../src/core/engine";
import {
  filterResourceMembershipRecordStatus,
  filterResourceMembershipsByName,
  orderRosterResourcesByMatchingCount,
  resourceMembershipRowsForReview,
  resourcesWithMatchingRosterMemberships,
  resourcesWithoutMatchingRosterMemberships,
  summarizeMatchingRosterMemberships,
  type MatchingRosterResourceView,
} from "../../src/core/resource-membership-review";

const ORG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const FOREIGN = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function record(
  id: string, entity: string, data: WorkspaceRecord["data"],
  organization_id = ORG, archived = false,
): WorkspaceRecord {
  return {
    id, entity, data, organization_id, archived,
    revision: 1, config_revision: 1,
    created_at: "2026-11-01T00:00:00Z",
    updated_at: "2026-11-01T00:00:00Z",
  };
}

// Independent prior per-resource implementation using unchanged public
// primitives. The optimized card-index implementation must match every
// visible result, including original order, ties and zero-match records.
function previousPerResourceMatches(
  resources: readonly WorkspaceRecord[],
  memberships: readonly WorkspaceRecord[],
  linkedRecords: readonly WorkspaceRecord[],
  view: MatchingRosterResourceView,
) {
  const scopedMembers = memberships.filter((r) => r.organization_id === ORG);
  const scopedPeople = linkedRecords.filter((r) => r.organization_id === ORG);
  return resources
    .filter((r) => r.entity === "resources" && r.organization_id === ORG)
    .map((resource) => {
      const dated = resourceMembershipRowsForReview(
        scopedMembers, resource, view.mode, view.date, view.zone,
      );
      const matching = filterResourceMembershipsByName(
        filterResourceMembershipRecordStatus(dated, view.status),
        scopedPeople, view.search,
      );
      return {
        resource,
        current: matching.filter((m) => !m.archived).length,
        archived: matching.filter((m) => m.archived).length,
      };
    });
}

it("matches the previous per-resource card, overview and count-sort views across 720 fictional memberships", () => {
  const resources: WorkspaceRecord[] = [];
  const memberships: WorkspaceRecord[] = [];
  const people: WorkspaceRecord[] = [];
  for (let i = 0; i < 160; i++) {
    resources.push(record("resource-" + i, "resources", {
      name: "Roster Resource " + i,
      kind: i % 3 === 0 ? "Crew" : i % 3 === 1 ? "Worker" : "Equipment",
    }, ORG, i % 9 === 0));
  }
  resources.push(record("resource-3", "resources", {
    name: "Foreign ID collision", kind: "Crew",
  }, FOREIGN));
  resources.push(record("not-resource", "employees", {
    name: "Wrong entity", kind: "Crew",
  }));
  resources.push(record("resource-3", "resources", {
    name: "Duplicate local resource", kind: "Crew",
  }));
  for (let i = 0; i < 720; i++) {
    const owner = i % 11 === 0 ? FOREIGN : ORG;
    const employeeId = "employee-" + i;
    people.push(record(employeeId, "employees", {
      name: "Person Zone " + (i % 17) + " Employee " + i,
      notes: "SECRET " + i,
    }, owner));
    const start = i % 23 === 0 ? "bad-date" :
      i % 3 === 0 ? "2026-11-01T08:30:00Z" :
      i % 3 === 1 ? "2026-11-06T10:00:00Z" : "2026-11-07T10:00:00Z";
    const end = i % 3 === 0 ? "2026-11-01T10:30:00Z" :
      i % 3 === 1 ? "2026-11-06T22:00:00Z" : "2026-11-08T10:00:00Z";
    memberships.push(record("membership-" + i,
      i % 47 === 0 ? "availability" : "resource-memberships", {
        resource: i % 67 === 0 ? 42 : "resource-" + (i % 140),
        employee: i % 71 === 0 ? 42 : employeeId,
        title: i % 5 === 0 ? "Weekend shift " + i : "General shift " + i,
        start, end, notes: "Private shift " + i,
      }, owner, i % 7 === 0));
  }
  // First-record-wins for duplicate local employee IDs, even a bad first name.
  people.unshift(record("employee-1", "employees", {
    name: 123, notes: "Never searchable",
  }));
  people.unshift(record("employee-3", "employees", {
    name: "FOREIGN PRIVATE",
  }, FOREIGN));
  const before = structuredClone({ resources, memberships, people });
  const views: MatchingRosterResourceView[] = [
    { mode: "all", date: "", zone: "Invalid/Zone", status: "all", search: "" },
    { mode: "all", date: "", zone: "UTC", status: "archived", search: "weekEND" },
    { mode: "all", date: "", zone: "UTC", status: "current", search: "person" },
    { mode: "all", date: "", zone: "UTC", status: "all", search: "secret" },
    { mode: "all", date: "", zone: "UTC", status: "all", search: "foreign private" },
    { mode: "all", date: "", zone: "UTC", status: "all", search: "employee-3" },
    { mode: "overlapping-day", date: "2026-11-01",
      zone: "America/Los_Angeles", status: "all", search: "" },
    { mode: "overlapping-day", date: "2026-11-01",
      zone: "America/Los_Angeles", status: "current", search: "person" },
    { mode: "overlapping-day", date: "2026-11-06",
      zone: "America/Los_Angeles", status: "archived", search: "shift" },
    { mode: "overlapping-day", date: "2026-11-07",
      zone: "UTC", status: "all", search: "" },
    { mode: "overlapping-day", date: "2026-02-30",
      zone: "UTC", status: "all", search: "" },
    { mode: "overlapping-day", date: "2026-11-06",
      zone: "Invalid/Zone", status: "all", search: "" },
    { mode: "all", date: "", zone: "UTC", status: "all", search: "missing text" },
  ];
  for (const view of views) {
    const expected = previousPerResourceMatches(
      resources, memberships, people, view,
    );
    const matched = expected.filter((entry) =>
      entry.current + entry.archived > 0).map((entry) => entry.resource.id);
    const unmatched = expected.filter((entry) =>
      entry.current + entry.archived === 0).map((entry) => entry.resource.id);
    expect(resourcesWithMatchingRosterMemberships(
      resources, memberships, people, ORG, view,
    ).map((r) => r.id)).toEqual(matched);
    expect(resourcesWithoutMatchingRosterMemberships(
      resources, memberships, people, ORG, view,
    ).map((r) => r.id)).toEqual(unmatched);
    const current = expected.reduce((total, e) => total + e.current, 0);
    const archived = expected.reduce((total, e) => total + e.archived, 0);
    expect(summarizeMatchingRosterMemberships(
      resources, memberships, people, ORG, view,
    )).toEqual({
      directoryResources: expected.length,
      matchingResources: matched.length,
      matchingMemberships: current + archived,
      currentMemberships: current,
      archivedMemberships: archived,
    });
    for (const sort of ["most", "fewest"] as const) {
      const reference = expected
        .map((entry, index) => ({
          ...entry, index, count: entry.current + entry.archived,
        }))
        .sort((a, b) => (
          (sort === "most" ? b.count - a.count : a.count - b.count) ||
          a.index - b.index
        ))
        .map((entry) => entry.resource.id);
      expect(orderRosterResourcesByMatchingCount(
        resources, memberships, people, ORG, view, sort,
      ).map((r) => r.id)).toEqual(reference);
    }
  }
  expect({ resources, memberships, people }).toEqual(before);
});

it("retains duplicate-ID count semantics and half-open DST-day boundaries", () => {
  const resources = [
    record("same", "resources", { name: "A", kind: "Worker" }),
    record("same", "resources", { name: "B", kind: "Crew" }),
    record("same", "resources", { name: "FOREIGN", kind: "Crew" }, FOREIGN),
    record("none", "resources", { name: "No matching history", kind: "Worker" }),
  ];
  const memberships = [
    record("fold-one", "resource-memberships", {
      resource: "same", title: "Fold", employee: "e",
      start: "2026-11-01T08:30:00Z", end: "2026-11-01T08:40:00Z",
    }),
    record("fold-two", "resource-memberships", {
      resource: "same", title: "Fold", employee: "e",
      start: "2026-11-01T09:30:00Z", end: "2026-11-01T09:40:00Z",
    }, ORG, true),
    record("next-day", "resource-memberships", {
      resource: "same", title: "Fold", employee: "e",
      start: "2026-11-02T08:00:00Z", end: "2026-11-02T09:00:00Z",
    }),
    record("foreign", "resource-memberships", {
      resource: "same", title: "Fold", employee: "e",
      start: "2026-11-01T08:30:00Z", end: "2026-11-01T09:40:00Z",
    }, FOREIGN),
  ];
  const view: MatchingRosterResourceView = {
    mode: "overlapping-day", date: "2026-11-01",
    zone: "America/Los_Angeles", status: "all", search: "fold",
  };
  expect(summarizeMatchingRosterMemberships(
    resources, memberships, [], ORG, view,
  )).toEqual({
    directoryResources: 3, matchingResources: 2,
    matchingMemberships: 4, currentMemberships: 2,
    archivedMemberships: 2,
  });
  expect(orderRosterResourcesByMatchingCount(
    resources, memberships, [], ORG, view, "most",
  ).map((r) => r.data.name)).toEqual(["A", "B", "No matching history"]);
});
