import { expect, it } from "vitest";
import type { WorkspaceRecord } from "../../src/core/engine";
import { csvSafeCell } from "../../src/core/daily-operations-csv";
import { instant, isTimeZone, localTime } from "../../src/core/time";
import { filterWorkforceResourceDirectory } from "../../src/core/workforce-resource-directory";
import {
  resourceMembershipReviewDateError,
  filterResourceMembershipRecordStatus,
  filterResourceMembershipsByName,
  resourcesWithMatchingRosterMemberships,
  resourcesWithoutMatchingRosterMemberships,
  orderRosterResourcesByMatchingCount,
  orderResourceMembershipsByStart,
} from "../../src/core/resource-membership-review";
import {
  filteredResourceMembershipsCsv,
  type ResourceMembershipCsvView,
} from "../../src/core/resource-membership-review-csv";

const ORG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const FOREIGN = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
function rec(
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
const baseView: ResourceMembershipCsvView = {
  archivedResources: false, resourceSearch: "", resourceKind: "all",
  enrollment: "all", mode: "all", membershipStatus: "all",
  sort: "retained", resourceSort: "directory", memberSearch: "",
  onlyMatchingResources: false, onlyWithoutMatchingResources: false,
  date: "",
};

// Independent previous implementation copied from the last five-green
// merged main branch (#160); it formats every start/end without caching.

function previousCsv(
  records: readonly WorkspaceRecord[],
  organizationId: string,
  zone: string,
  view: ResourceMembershipCsvView,
): string {
  if (!isTimeZone(zone)) throw new Error("Choose a valid business time zone.");
  if (view.mode === "overlapping-day" &&
      resourceMembershipReviewDateError(view.date, zone)) {
    throw new Error("Choose a valid membership review date before exporting.");
  }
  const scoped = records.filter((r) => r.organization_id === organizationId);
  const resources = scoped.filter((r) => r.entity === "resources");
  const memberships = scoped.filter((r) => r.entity === "resource-memberships");
  const employees = scoped.filter((r) => r.entity === "employees");
  const directoryResources = filterWorkforceResourceDirectory(
    resources, memberships, view.archivedResources, view.resourceSearch,
    view.resourceKind, view.enrollment,
  );
  const matchingView = {
    mode: view.mode, date: view.date, zone,
    status: view.membershipStatus, search: view.memberSearch,
  };
  const selectedResources = view.onlyMatchingResources
    ? resourcesWithMatchingRosterMemberships(
      directoryResources, memberships, scoped, organizationId, matchingView,
    )
    : view.onlyWithoutMatchingResources
      ? resourcesWithoutMatchingRosterMemberships(
        directoryResources, memberships, scoped, organizationId, matchingView,
      )
      : directoryResources;
  const visibleResources = orderRosterResourcesByMatchingCount(
    selectedResources, memberships, scoped, organizationId,
    matchingView, view.resourceSort,
  );
  // Build a temporary lookup from same-organization employee records once.
  // Preserve the previous find() result: first record wins, even when its
  // display name is invalid/missing. Never search contacts or foreign data.
  const employeeNames = new Map<string, string>();
  for (const employee of employees) {
    if (!employeeNames.has(employee.id)) {
      const name = employee.data.name;
      employeeNames.set(employee.id, typeof name === "string" ? name : "");
    }
  }
  const employeeName = (id: unknown): string =>
    typeof id === "string" ? employeeNames.get(id) ?? "" : "";
  const dateValue = (value: unknown): { local: string; utc: string } => {
    try {
      const utc = instant(String(value)).toString();
      return { local: localTime(utc, zone), utc };
    } catch {
      return { local: "", utc: "" };
    }
  };
  const header = [
    "Membership review scope", "Membership review day (business local)",
    "Resource name", "Resource type", "Resource record status",
    "Retained enrollment", "Membership title", "Employee name",
    "Membership record status", "Effective start (business local)",
    "Effective end (business local)", "Effective start (UTC)",
    "Effective end (UTC)", "Business time zone",
  ];
  const rows: string[][] = [];
  // A nonblank member-name/title search is independent of resource, status
  // and day filters. Evaluate it once against authorized canonical rows and
  // reuse the matching record *references* per card (not IDs, which may
  // repeat across historical records). Blank search needs no index.
  const matchingMemberRows = view.memberSearch.trim()
    ? new Set(filterResourceMembershipsByName(
      memberships, scoped, view.memberSearch,
    ))
    : null;
  // Group retained same-organization memberships once per export. Keep the
  // canonical membership order and preserve identical results for duplicate
  // local resource cards that share an ID.
  const membershipsByResource = new Map<string, WorkspaceRecord[]>();
  for (const membership of memberships) {
    const resourceId = membership.data.resource;
    if (typeof resourceId !== "string") continue;
    let grouped = membershipsByResource.get(resourceId);
    if (!grouped) {
      grouped = [];
      membershipsByResource.set(resourceId, grouped);
    }
    grouped.push(membership);
  }
  // Every card shares the same requested business-local review day. Reuse
  // its DST-aware boundaries and classify each authorized retained record
  // once. Keep record identity, not historical IDs, for duplicate revisions.
  const overlappingDay = view.mode === "all" ? null : (() => {
    const day = Temporal.PlainDate.from(view.date);
    const start = day.toZonedDateTime(zone).epochNanoseconds;
    const end = day.add({ days: 1 }).toZonedDateTime(zone).epochNanoseconds;
    const matches = new Set<WorkspaceRecord>();
    for (const membership of memberships) {
      try {
        if (instant(String(membership.data.start)).epochNanoseconds < end &&
            instant(String(membership.data.end)).epochNanoseconds > start) {
          matches.add(membership);
        }
      } catch {
        // Invalid retained timestamps do not invent review-day membership.
      }
    }
    return matches;
  })();
  for (const resource of visibleResources) {
    // Enrollment comes from ALL retained history, not the selected review day.
    const all = membershipsByResource.get(resource.id) ?? [];
    const dateRows = overlappingDay
      ? all.filter((membership) => overlappingDay.has(membership))
      : all;
    const statusRows = filterResourceMembershipRecordStatus(
      dateRows, view.membershipStatus,
    );
    const nameRows = matchingMemberRows
      ? statusRows.filter((membership) => matchingMemberRows.has(membership))
      : statusRows;
    const shown = orderResourceMembershipsByStart(nameRows, view.sort);
    for (const membership of shown) {
      const start = dateValue(membership.data.start);
      const end = dateValue(membership.data.end);
      rows.push([
        view.mode === "all" ? "All retained history" : "Overlapping selected day",
        view.mode === "all" ? "" : view.date,
        typeof resource.data.name === "string" ? resource.data.name : "",
        typeof resource.data.kind === "string" ? resource.data.kind : "",
        resource.archived ? "Archived" : "Current",
        all.length ? "Enrolled" : "Resource-only",
        typeof membership.data.title === "string" ? membership.data.title : "",
        employeeName(membership.data.employee),
        membership.archived ? "Archived" : "Current",
        start.local, end.local, start.utc, end.utc, zone,
      ]);
    }
  }
  return [header, ...rows]
    .map((row) => row.map(csvSafeCell).join(","))
    .join("\r\n") + "\r\n";
}


it("preserves exact CSV bytes across 720 fictional roster memberships with repeated instants", () => {
  const records: WorkspaceRecord[] = [];
  for (let i = 0; i < 30; i++) {
    records.push(rec("resources", "resource-" + i, {
      name: "Fictional Resource " + i,
      kind: i % 3 === 0 ? "Equipment" : i % 3 === 1 ? "Worker" : "Crew",
      notes: "PRIVATE RESOURCE NOTE",
    }, i % 11 === 0));
  }
  records.push(rec("resources", "resource-7", {
    name: "Duplicate Local Card", kind: "Crew",
  }));
  records.push(rec("resources", "resource-7", {
    name: "FOREIGN CARD", kind: "Crew",
  }, false, FOREIGN));
  // Only a few distinct start/end values repeat across 720 records. Include
  // normal shifts, the two fall DST fold instants, invalid text, missing and
  // malformed/non-string retained dates.
  const times: unknown[] = [
    "2026-11-06T18:00:00Z",
    "2026-11-06T22:00:00Z",
    "2026-11-01T08:30:00Z",
    "2026-11-01T09:30:00Z",
    "2026-11-07T07:30:00Z",
    "2026-11-07T08:30:00Z",
    "invalid-time",
    "",
    null,
    57,
    { invalid: true },
  ];
  for (let i = 0; i < 720; i++) {
    const org = i % 19 === 0 ? FOREIGN : ORG;
    records.push(rec("employees", "employee-" + (i % 340), {
      name: i % 29 === 0 ? 22 : "Worker Zone " + (i % 17) + " " + i,
      email: "PRIVATE@EXAMPLE.TEST",
    }, i % 7 === 0, org));
    records.push(rec("resource-memberships", "membership-" + (i % 330), {
      resource: i % 71 === 0 ? 12 : "resource-" + (i % 29),
      employee: i % 83 === 0 ? 32 : "employee-" + (i % 340),
      title: i % 13 === 0 ? "@Formula title" : "Roster work " + i,
      start: times[i % times.length],
      end: times[(i + 3) % times.length],
      notes: "PRIVATE MEMBER NOTES",
    }, i % 5 === 0, org));
  }
  records.push(rec("resource-memberships", "foreign-collision", {
    resource: "resource-7", employee: "employee-1",
    title: "FOREIGN PRIVATE ROSTER",
    start: "2026-11-06T18:00:00Z", end: "2026-11-06T22:00:00Z",
  }, false, FOREIGN));
  const snapshot = structuredClone(records);
  const views: ResourceMembershipCsvView[] = [
    baseView,
    { ...baseView, sort: "oldest" },
    { ...baseView, sort: "newest", resourceSort: "most" },
    { ...baseView, resourceSort: "fewest" },
    { ...baseView, resourceSort: "name-asc" },
    { ...baseView, archivedResources: true },
    { ...baseView, resourceKind: "Crew" },
    { ...baseView, resourceKind: "Worker", enrollment: "enrolled" },
    { ...baseView, resourceSearch: "resource 1" },
    { ...baseView, memberSearch: "roster work" },
    { ...baseView, memberSearch: "worker zone 2" },
    { ...baseView, memberSearch: "not found" },
    { ...baseView, membershipStatus: "current" },
    { ...baseView, membershipStatus: "archived" },
    { ...baseView, onlyMatchingResources: true, memberSearch: "roster work" },
    { ...baseView, onlyWithoutMatchingResources: true, memberSearch: "not found" },
    { ...baseView, mode: "overlapping-day", date: "2026-11-01" },
    { ...baseView, mode: "overlapping-day", date: "2026-11-06", memberSearch: "work" },
    { ...baseView, mode: "overlapping-day", date: "2026-11-07",
      resourceSort: "most", membershipStatus: "archived" },
  ];
  for (const zone of ["America/Los_Angeles", "UTC"]) {
    for (const view of views) {
      expect(filteredResourceMembershipsCsv(records, ORG, zone, view))
        .toBe(previousCsv(records, ORG, zone, view));
    }
  }
  const csv = filteredResourceMembershipsCsv(records, ORG, "UTC", baseView);
  for (const hidden of [
    "PRIVATE@EXAMPLE.TEST", "PRIVATE MEMBER NOTES", "FOREIGN PRIVATE ROSTER",
    "FOREIGN CARD",
  ]) expect(csv).not.toContain(hidden);
  expect(records).toEqual(snapshot);
});

it("preserves duplicate revisions and exactly the same local/UTC formatting for shared instants", () => {
  const same = rec("resource-memberships", "same-revision", {
    resource: "crew", employee: "worker",
    title: "Same instant",
    start: "2026-11-01T08:30:00Z",
    end: "2026-11-01T08:45:00Z",
  });
  const records = [
    rec("resources", "crew", { name: "First Crew", kind: "Crew" }),
    rec("resources", "crew", { name: "Second Crew", kind: "Crew" }),
    rec("employees", "worker", { name: "=Formula Person" }),
    same, same,
    rec("resource-memberships", "same-revision", {
      resource: "crew", employee: "worker",
      title: "Second fold",
      start: "2026-11-01T09:30:00Z",
      end: "2026-11-01T09:45:00Z",
    }, true),
    rec("resource-memberships", "bad-date", {
      resource: "crew", employee: "worker",
      title: "Bad historical time",
      start: "not-a-date",
      end: "not-a-date",
    }),
  ];
  const actual = filteredResourceMembershipsCsv(
    records, ORG, "America/Los_Angeles", baseView,
  );
  expect(actual).toBe(previousCsv(records, ORG, "America/Los_Angeles", baseView));
  expect(actual.match(/"2026-11-01T01:30"/g)).toHaveLength(6);
  expect(actual).toContain('"2026-11-01T08:30:00Z"');
  expect(actual).toContain('"2026-11-01T09:30:00Z"');
  expect(actual).toContain('"Bad historical time"');
  expect(actual).toContain('"",""');
  const day = { ...baseView, mode: "overlapping-day" as const, date: "2026-11-01" };
  expect(filteredResourceMembershipsCsv(records, ORG, "America/Los_Angeles", day))
    .toBe(previousCsv(records, ORG, "America/Los_Angeles", day));
});

it("does not change invalid date/zone validation or header-only output", () => {
  for (const date of ["", "2026-02-30", "2026-11"]) {
    expect(() => filteredResourceMembershipsCsv([], ORG, "UTC", {
      ...baseView, mode: "overlapping-day", date,
    })).toThrow(/valid membership review date/);
  }
  expect(() => filteredResourceMembershipsCsv([], ORG, "NoSuch/Zone", baseView))
    .toThrow(/valid business time zone/);
  expect(filteredResourceMembershipsCsv([], ORG, "UTC", baseView))
    .toBe(previousCsv([], ORG, "UTC", baseView));
});
