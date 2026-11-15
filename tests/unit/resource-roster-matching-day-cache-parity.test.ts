import { Temporal } from "@js-temporal/polyfill";
import { expect, it } from "vitest";
import type { WorkspaceRecord } from "../../src/core/engine";
import { instant } from "../../src/core/time";
import {
  filterResourceMembershipRecordStatus,
  filterResourceMembershipsByName,
  orderRosterResourcesByMatchingCount,
  resourceMembershipReviewDateError,
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

type Counts = { current: number; archived: number };

// Independent baseline from the verified five-green merged #166 source.
// Counts all authorized historical membership RECORDS, not distinct workers.
// Its selected-day path reparses every start/end instant per membership.
function previousCounts(
  memberships: readonly WorkspaceRecord[],
  linkedRecords: readonly WorkspaceRecord[],
  organizationId: string,
  view: MatchingRosterResourceView,
): Map<string, Counts> {
  const counts = new Map<string, Counts>();
  let scoped = memberships.filter((membership) =>
    membership.entity === "resource-memberships" &&
    membership.organization_id === organizationId,
  );
  if (view.mode !== "all") {
    if (resourceMembershipReviewDateError(view.date, view.zone)) return counts;
    try {
      const day = Temporal.PlainDate.from(view.date);
      const start = day.toZonedDateTime(view.zone).epochNanoseconds;
      const end = day.add({ days: 1 }).toZonedDateTime(view.zone).epochNanoseconds;
      scoped = scoped.filter((membership) => {
        try {
          return instant(String(membership.data.start)).epochNanoseconds < end &&
            instant(String(membership.data.end)).epochNanoseconds > start;
        } catch {
          // Malformed retained dates are not inferred or silently repaired.
          return false;
        }
      });
    } catch {
      return counts;
    }
  }
  const byStatus = filterResourceMembershipRecordStatus(scoped, view.status);
  const matching = filterResourceMembershipsByName(
    byStatus,
    linkedRecords.filter((row) => row.organization_id === organizationId),
    view.search,
  );
  for (const membership of matching) {
    const resourceId = membership.data.resource;
    if (typeof resourceId !== "string") continue;
    let count = counts.get(resourceId);
    if (!count) {
      count = { current: 0, archived: 0 };
      counts.set(resourceId, count);
    }
    if (membership.archived) count.archived += 1;
    else count.current += 1;
  }
  return counts;
}

function expectedCardViews(
  resources: readonly WorkspaceRecord[],
  counts: Map<string, Counts>,
) {
  const selected = resources.filter((resource) =>
    resource.entity === "resources" && resource.organization_id === ORG,
  );
  const matching = selected.filter((resource) => counts.has(resource.id));
  const without = selected.filter((resource) => !counts.has(resource.id));
  let currentMemberships = 0;
  let archivedMemberships = 0;
  for (const resource of matching) {
    const count = counts.get(resource.id);
    if (!count) continue;
    currentMemberships += count.current;
    archivedMemberships += count.archived;
  }
  const sortByCount = (direction: "most" | "fewest") =>
    selected.map((resource, index) => ({
      resource, index,
      count: (counts.get(resource.id)?.current ?? 0) +
        (counts.get(resource.id)?.archived ?? 0),
    })).sort((a, b) =>
      (direction === "most" ? b.count - a.count : a.count - b.count) ||
      a.index - b.index,
    ).map(({ resource }) => resource);
  return {
    matching, without, sortByCount,
    summary: {
      directoryResources: selected.length,
      matchingResources: matching.length,
      matchingMemberships: currentMemberships + archivedMemberships,
      currentMemberships, archivedMemberships,
    },
  };
}

it("preserves resource-card filters, summary counts and count sorting across 720 fictional retained histories", () => {
  const resources: WorkspaceRecord[] = Array.from({ length: 24 }, (_, i) =>
    record("resource-" + i, "resources", {
      kind: i % 3 === 0 ? "Equipment" : i % 3 === 1 ? "Crew" : "Worker",
      name: "Fictional Resource " + i,
    }, ORG, i % 11 === 0),
  );
  resources.push(
    record("resource-7", "resources", { kind: "Crew", name: "Duplicate Card" }),
    record("resource-7", "resources", { kind: "Crew", name: "FOREIGN CARD" }, FOREIGN),
    record("resource-1", "employees", { name: "Not a Resource" }),
  );
  const employees: WorkspaceRecord[] = Array.from({ length: 70 }, (_, i) =>
    record("employee-" + i, "employees", {
      name: i === 4 ? 24 : "Fictional Worker " + i,
      email: "PRIVATE@EXAMPLE.TEST",
    }),
  );
  employees.push(
    record("employee-4", "employees", { name: "Ignored Duplicate" }),
    record("employee-2", "employees", { name: "FOREIGN WORKER" }, FOREIGN),
  );
  const timePairs: Array<readonly [string | number, string | number]> = [
    ["2026-11-01T08:30:00Z", "2026-11-01T08:45:00Z"],
    ["2026-11-01T09:30:00Z", "2026-11-01T09:45:00Z"],
    ["2026-11-02T08:00:00Z", "2026-11-02T09:00:00Z"],
    ["2026-03-08T09:30:00Z", "2026-03-08T09:45:00Z"],
    ["2026-03-08T10:30:00Z", "2026-03-08T10:45:00Z"],
    ["2026-03-09T07:00:00Z", "2026-03-09T07:30:00Z"],
    ["2026-11-06T18:00:00Z", "2026-11-06T21:00:00Z"],
    ["2026-11-07T07:30:00Z", "2026-11-07T08:30:00Z"],
    ["invalid-start", "2026-11-07T08:30:00Z"],
    ["2026-11-07T07:30:00Z", "invalid-end"],
    ["", ""],
    [17, 18],
  ];
  const memberships: WorkspaceRecord[] = [];
  for (let i = 0; i < 720; i++) {
    const [start, end] = timePairs[i % timePairs.length];
    memberships.push(record(
      "history-" + (i % 250), "resource-memberships", {
        resource: i % 79 === 0 ? 123 : "resource-" + (i % 24),
        employee: "employee-" + (i % 70),
        title: i % 13 === 0 ? "Night roster" : "Historical coverage " + i,
        start, end, notes: "PRIVATE HISTORY NOTE",
      }, i % 19 === 0 ? FOREIGN : ORG, i % 5 === 0,
    ));
  }
  const same = record("same-id", "resource-memberships", {
    resource: "resource-7", employee: "employee-2",
    title: "Repeated revision",
    start: "2026-11-01T08:30:00Z",
    end: "2026-11-01T08:45:00Z",
  }, ORG, true);
  memberships.push(same, same, record("same-id", "resource-memberships", {
    resource: "resource-7", employee: "employee-2",
    title: "Separate retained revision",
    start: "2026-11-01T09:30:00Z",
    end: "2026-11-01T09:45:00Z",
  }));
  memberships.push(record("unrelated", "availability", {
    resource: "resource-7",
    start: "2026-11-01T08:30:00Z",
    end: "2026-11-01T08:45:00Z",
  }));
  const linked = [...resources, ...employees];
  const snapshot = structuredClone({ resources, memberships, linked });
  const views: MatchingRosterResourceView[] = [
    { mode: "all", date: "", zone: "UTC", status: "all", search: "" },
    { mode: "overlapping-day", date: "2026-11-01", zone: "UTC",
      status: "all", search: "" },
    { mode: "overlapping-day", date: "2026-11-06", zone: "UTC",
      status: "current", search: "" },
    { mode: "overlapping-day", date: "2026-11-01", zone: "UTC",
      status: "archived", search: "Night" },
    { mode: "overlapping-day", date: "2026-03-08", zone: "UTC",
      status: "all", search: "Worker 1" },
    { mode: "overlapping-day", date: "2026-11-01", zone: "UTC",
      status: "all", search: "FOREIGN WORKER" },
    { mode: "overlapping-day", date: "2026-11-01", zone: "UTC",
      status: "all", search: "no such worker" },
    { mode: "overlapping-day", date: "2026-02-30", zone: "UTC",
      status: "all", search: "" },
    { mode: "overlapping-day", date: "2026-11", zone: "UTC",
      status: "all", search: "" },
  ];
  for (const zone of ["UTC", "America/Los_Angeles", "America/New_York"]) {
    for (const view of views) {
      const localView = { ...view, zone };
      const counts = previousCounts(memberships, linked, ORG, localView);
      const expected = expectedCardViews(resources, counts);
      const actualMatch = resourcesWithMatchingRosterMemberships(
        resources, memberships, linked, ORG, localView,
      );
      const actualWithout = resourcesWithoutMatchingRosterMemberships(
        resources, memberships, linked, ORG, localView,
      );
      expect(actualMatch).toEqual(expected.matching);
      expect(actualWithout).toEqual(expected.without);
      actualMatch.forEach((r, i) => expect(r).toBe(expected.matching[i]));
      actualWithout.forEach((r, i) => expect(r).toBe(expected.without[i]));
      expect(summarizeMatchingRosterMemberships(
        resources, memberships, linked, ORG, localView,
      )).toEqual(expected.summary);
      for (const sort of ["most", "fewest"] as const) {
        const ordered = orderRosterResourcesByMatchingCount(
          resources, memberships, linked, ORG, localView, sort,
        );
        const previouslyOrdered = expected.sortByCount(sort);
        expect(ordered).toEqual(previouslyOrdered);
        ordered.forEach((r, i) => expect(r).toBe(previouslyOrdered[i]));
      }
    }
  }
  expect({ resources, memberships, linked }).toEqual(snapshot);
});

it("recomputes counts for changed historical values and does not reuse results between dates", () => {
  const resources = [
    record("crew", "resources", { kind: "Crew", name: "Crew One" }),
  ];
  const member = record("membership", "resource-memberships", {
    resource: "crew", employee: "employee",
    title: "History",
    start: "invalid",
    end: "2026-11-06T21:00:00Z",
  });
  const memberships = [member, member];
  const view: MatchingRosterResourceView = {
    mode: "overlapping-day", date: "2026-11-06",
    zone: "UTC", status: "all", search: "",
  };
  const summary = () => summarizeMatchingRosterMemberships(
    resources, memberships, [], ORG, view,
  );
  expect(summary()).toEqual(expectedCardViews(
    resources, previousCounts(memberships, [], ORG, view),
  ).summary);
  member.data.start = "2026-11-06T18:00:00Z";
  expect(summary()).toEqual({
    directoryResources: 1, matchingResources: 1,
    matchingMemberships: 2, currentMemberships: 2, archivedMemberships: 0,
  });
  expect(summary()).toEqual(expectedCardViews(
    resources, previousCounts(memberships, [], ORG, view),
  ).summary);
  expect(summarizeMatchingRosterMemberships(
    resources, memberships, [], ORG, { ...view, date: "2026-11-07" },
  )).toEqual(expectedCardViews(
    resources, previousCounts(memberships, [], ORG,
      { ...view, date: "2026-11-07" }),
  ).summary);
});
