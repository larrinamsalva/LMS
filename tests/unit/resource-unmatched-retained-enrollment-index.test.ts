import { expect, it } from "vitest";
import type { WorkspaceRecord } from "../../src/core/engine";
import {
  resourcesWithoutMatchingRosterMemberships,
  summarizeUnmatchedRosterResources,
  type MatchingRosterResourceView,
} from "../../src/core/resource-membership-review";

const ORG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function record(
  id: string,
  entity: string,
  data: WorkspaceRecord["data"],
  organization_id = ORG,
  archived = false,
): WorkspaceRecord {
  return {
    id, entity, data, organization_id, archived,
    revision: 1, config_revision: 1,
    created_at: "2026-11-01T00:00:00Z",
    updated_at: "2026-11-01T00:00:00Z",
  };
}

/** Independent previous scan-based classification for correctness comparison. */
function previousSummary(
  resources: readonly WorkspaceRecord[],
  memberships: readonly WorkspaceRecord[],
  linked: readonly WorkspaceRecord[],
  view: MatchingRosterResourceView,
) {
  const selected = resources.filter((resource) =>
    resource.entity === "resources" &&
    resource.organization_id === ORG &&
    (resource.data.kind === "Crew" ||
      resource.data.kind === "Worker" ||
      resource.data.kind === "Equipment"),
  );
  const unmatched = resourcesWithoutMatchingRosterMemberships(
    selected, memberships, linked, ORG, view,
  );
  const scoped = memberships.filter((member) =>
    member.entity === "resource-memberships" &&
    member.organization_id === ORG,
  );
  let enrolledWithoutMatching = 0;
  let resourceOnlyWithoutMatching = 0;
  let equipmentWithoutMatching = 0;
  for (const resource of unmatched) {
    if (resource.data.kind === "Equipment") {
      equipmentWithoutMatching += 1;
    } else if (scoped.some((member) =>
      member.data.resource === resource.id,
    )) {
      enrolledWithoutMatching += 1;
    } else {
      resourceOnlyWithoutMatching += 1;
    }
  }
  return {
    withoutMatching: unmatched.length,
    enrolledWithoutMatching,
    resourceOnlyWithoutMatching,
    equipmentWithoutMatching,
  };
}

it("matches previous scan-based totals across 720 fictional records and historic review filters", () => {
  const resources: WorkspaceRecord[] = [];
  const memberships: WorkspaceRecord[] = [];
  const linked: WorkspaceRecord[] = [];
  for (let i = 0; i < 180; i++) {
    resources.push(record("resource-" + i, "resources", {
      name: "Worker or Crew " + i,
      kind: i % 3 === 0 ? "Equipment" : i % 3 === 1 ? "Worker" : "Crew",
    }, ORG, i % 11 === 0));
  }
  resources.push(record("resource-3", "resources", {
    name: "Foreign resource ID collision", kind: "Worker",
  }, OTHER));
  resources.push(record("resource-3", "resources", {
    name: "Duplicate local ID", kind: "Crew",
  }));
  resources.push(record("wrong-entity", "employees", {
    name: "Not a resource", kind: "Crew",
  }));
  resources.push(record("wrong-kind", "resources", {
    name: "Not a valid workforce resource", kind: "Vehicle",
  }));
  for (let i = 0; i < 720; i++) {
    const organization = i % 17 === 0 ? OTHER : ORG;
    linked.push(record("employee-" + i, "employees", {
      name: "Employee Zone " + (i % 12) + " " + i,
      phone: "PRIVATE " + i,
    }, organization));
    memberships.push(record("membership-" + i,
      i % 59 === 0 ? "availability" : "resource-memberships", {
        resource: i % 71 === 0 ? 12 : "resource-" + (i % 160),
        employee: "employee-" + i,
        title: i % 7 === 0 ? "Weekend roster " + i : "Shift " + i,
        start: i % 23 === 0 ? "invalid" : i % 2 === 0
          ? "2026-11-06T10:00:00Z" : "2026-11-07T10:00:00Z",
        end: i % 2 === 0 ? "2026-11-06T22:00:00Z"
          : "2026-11-08T10:00:00Z",
      }, organization, i % 5 === 0));
  }
  // Archived retained membership counts as enrollment even when excluded
  // by current-day or current-status match filters.
  memberships.push(record("archived-only", "resource-memberships", {
    resource: "resource-170", employee: "employee-1", title: "Past work",
    start: "2026-01-01T00:00:00Z", end: "2026-01-02T00:00:00Z",
  }, ORG, true));
  memberships.push(record("foreign-id", "resource-memberships", {
    resource: "resource-177", employee: "employee-2", title: "Private",
    start: "2026-11-06T10:00:00Z", end: "2026-11-06T22:00:00Z",
  }, OTHER));
  const snapshot = structuredClone({ resources, memberships, linked });
  const views: MatchingRosterResourceView[] = [
    { mode: "all", date: "", zone: "UTC", status: "all", search: "" },
    { mode: "all", date: "", zone: "UTC", status: "current", search: "weekend" },
    { mode: "all", date: "", zone: "UTC", status: "archived", search: "zone 4" },
    { mode: "all", date: "", zone: "Invalid/Zone", status: "all", search: "never matches" },
    { mode: "overlapping-day", date: "2026-11-06", zone: "America/Los_Angeles", status: "all", search: "" },
    { mode: "overlapping-day", date: "2026-11-07", zone: "America/Los_Angeles", status: "current", search: "shift" },
    { mode: "overlapping-day", date: "2026-11-07", zone: "UTC", status: "archived", search: "employee" },
    { mode: "overlapping-day", date: "2026-02-30", zone: "UTC", status: "all", search: "" },
    { mode: "overlapping-day", date: "2026-11-07", zone: "Invalid/Zone", status: "all", search: "" },
    { mode: "all", date: "", zone: "UTC", status: "all", search: "PRIVATE" },
  ];
  for (const view of views) {
    expect(summarizeUnmatchedRosterResources(
      resources, memberships, linked, ORG, view,
    )).toEqual(previousSummary(resources, memberships, linked, view));
    expect(summarizeUnmatchedRosterResources(
      resources.slice(0, 90), memberships, linked, ORG, view,
    )).toEqual(previousSummary(resources.slice(0, 90), memberships, linked, view));
  }
  expect({ resources, memberships, linked }).toEqual(snapshot);
});

it("does not confuse foreign ID collisions, malformed links or equipment with worker availability", () => {
  const resources = [
    record("local-archived", "resources", { kind: "Worker", name: "Historical" }),
    record("foreign-only", "resources", { kind: "Crew", name: "No local enrollment" }),
    record("numeric-only", "resources", { kind: "Crew", name: "Numeric bad link" }),
    record("tool", "resources", { kind: "Equipment", name: "Equipment" }),
    record("foreign-only", "resources", { kind: "Worker", name: "Foreign" }, OTHER),
  ];
  const memberships = [
    record("archived", "resource-memberships", {
      resource: "local-archived", employee: "e1", title: "Last year",
      start: "2025-01-01T00:00:00Z", end: "2025-01-02T00:00:00Z",
    }, ORG, true),
    record("foreign", "resource-memberships", {
      resource: "foreign-only", employee: "e2", title: "Foreign",
    }, OTHER),
    record("invalid-link", "resource-memberships", {
      resource: 12, employee: "e3", title: "Invalid",
    }),
    record("wrong-type", "availability", {
      resource: "numeric-only", title: "Unrelated",
    }),
    record("equipment-history", "resource-memberships", {
      resource: "tool", employee: "e4", title: "Equipment is still equipment",
    }),
  ];
  const view: MatchingRosterResourceView = {
    mode: "all", date: "", zone: "UTC",
    status: "all", search: "no matching title",
  };
  expect(summarizeUnmatchedRosterResources(
    resources, memberships, [], ORG, view,
  )).toEqual({
    withoutMatching: 4,
    enrolledWithoutMatching: 1,
    resourceOnlyWithoutMatching: 2,
    equipmentWithoutMatching: 1,
  });
  expect(summarizeUnmatchedRosterResources(
    resources, memberships, [], ORG, view,
  )).toEqual(previousSummary(resources, memberships, [], view));
});
