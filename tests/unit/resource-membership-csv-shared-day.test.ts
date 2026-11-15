import { expect, it } from "vitest";
import type { WorkspaceRecord } from "../../src/core/engine";
import { csvSafeCell } from "../../src/core/daily-operations-csv";
import { instant, isTimeZone, localTime } from "../../src/core/time";
import { filterWorkforceResourceDirectory } from "../../src/core/workforce-resource-directory";
import {
  resourceMembershipRowsForReview,
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
const OTHER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
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
const baseView: ResourceMembershipCsvView = {
  archivedResources: false, resourceSearch: "", resourceKind: "all",
  enrollment: "all", mode: "all", membershipStatus: "all",
  sort: "retained", resourceSort: "directory", memberSearch: "",
  onlyMatchingResources: false, onlyWithoutMatchingResources: false,
  date: "",
};

// Independent reference from merged five-green #159 baseline: this version
// computes local-day overlap individually for every visible resource card.

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
  for (const resource of visibleResources) {
    // Enrollment comes from ALL retained history, not the selected review day.
    const all = membershipsByResource.get(resource.id) ?? [];
    // Keep the original DST-safe overlap helper for selected-day review,
    // but give it only this resource's group rather than the full history.
    const dateRows = view.mode === "all" ? all
      : resourceMembershipRowsForReview(
        all, resource, view.mode, view.date, zone,
      );
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


it("retains byte-for-byte detailed CSV parity across 720 fictional historical memberships", () => {
  const data: WorkspaceRecord[] = [];
  for (let i = 0; i < 36; i++) {
    data.push(record("resources", "resource-" + i, {
      kind: i % 3 === 0 ? "Equipment" : i % 3 === 1 ? "Crew" : "Worker",
      name: i % 13 === 0 ? "@PotentialFormula" : "Fictional Resource " + i,
      notes: "PRIVATE RESOURCE NOTE",
    }, i % 11 === 0));
  }
  data.push(record("resources", "resource-7", {
    kind: "Crew", name: "Duplicate Local Card",
  }));
  data.push(record("resources", "resource-7", {
    kind: "Crew", name: "FOREIGN RESOURCE",
  }, false, OTHER));
  for (let i = 0; i < 720; i++) {
    const organization = i % 19 === 0 ? OTHER : ORG;
    data.push(record("employees", "employee-" + (i % 320), {
      name: i % 29 === 0 ? 123 : "Example Worker Zone " + (i % 12) + " " + i,
      email: "PRIVATE@EXAMPLE.TEST",
    }, i % 7 === 0, organization));
    const start = i % 41 === 0 ? "bad-retained-date"
      : i % 6 === 0 ? "2026-11-01T08:30:00Z"
        : i % 6 === 1 ? "2026-11-01T09:30:00Z"
          : i % 6 === 2 ? "2026-11-06T18:00:00Z"
            : i % 6 === 3 ? "2026-11-07T07:30:00Z"
              : i % 6 === 4 ? "2026-11-07T08:00:00Z"
                : "2026-11-03T16:00:00Z";
    const end = i % 6 === 0 ? "2026-11-01T08:45:00Z"
      : i % 6 === 1 ? "2026-11-01T09:45:00Z"
        : i % 6 === 2 ? "2026-11-06T21:00:00Z"
          : i % 6 === 3 ? "2026-11-07T08:30:00Z"
            : i % 6 === 4 ? "2026-11-07T09:00:00Z"
              : "2026-11-03T19:00:00Z";
    data.push(record("resource-memberships", "membership-" + (i % 290), {
      resource: i % 79 === 0 ? 24 : "resource-" + (i % 35),
      employee: i % 83 === 0 ? 77 : "employee-" + (i % 320),
      title: i % 17 === 0 ? "=SUM(1,2)" : i % 11 === 0
        ? "Weekend Shift " + i : "Roster task " + i,
      start, end, notes: "PRIVATE MEMBERSHIP NOTE",
    }, i % 5 === 0, organization));
  }
  data.unshift(record("employees", "employee-4", { name: 99 }));
  data.push(record("employees", "employee-4", { name: "Ignored Duplicate" }));
  data.push(record("resource-memberships", "foreign", {
    resource: "resource-7", employee: "employee-2",
    title: "FOREIGN PRIVATE MEMBERSHIP",
    start: "2026-11-01T08:30:00Z", end: "2026-11-01T09:30:00Z",
  }, false, OTHER));
  data.push(record("contacts", "employee-2", { name: "PRIVATE CONTACT" }));
  const before = structuredClone(data);
  const views: ResourceMembershipCsvView[] = [
    baseView,
    { ...baseView, mode: "overlapping-day", date: "2026-11-01" },
    { ...baseView, mode: "overlapping-day", date: "2026-11-06" },
    { ...baseView, mode: "overlapping-day", date: "2026-11-07" },
    { ...baseView, mode: "overlapping-day", date: "2026-11-08" },
    { ...baseView, mode: "overlapping-day", date: "2026-11-01",
      membershipStatus: "archived" },
    { ...baseView, mode: "overlapping-day", date: "2026-11-06",
      membershipStatus: "current", resourceSort: "most" },
    { ...baseView, mode: "overlapping-day", date: "2026-11-01",
      memberSearch: "weekend", resourceSort: "fewest" },
    { ...baseView, mode: "overlapping-day", date: "2026-11-06",
      memberSearch: "worker zone", resourceSort: "name-asc" },
    { ...baseView, mode: "overlapping-day", date: "2026-11-06",
      memberSearch: "roster task", onlyMatchingResources: true },
    { ...baseView, mode: "overlapping-day", date: "2026-11-06",
      memberSearch: "missing", onlyWithoutMatchingResources: true },
    { ...baseView, mode: "overlapping-day", date: "2026-11-01",
      resourceKind: "Crew", enrollment: "enrolled", resourceSort: "name-desc" },
    { ...baseView, mode: "overlapping-day", date: "2026-11-06",
      archivedResources: true, sort: "oldest" },
    { ...baseView, mode: "all", resourceSort: "most",
      memberSearch: "Weekend", sort: "newest" },
  ];
  for (const zone of ["America/Los_Angeles", "UTC"]) {
    for (const view of views) {
      const actual = filteredResourceMembershipsCsv(data, ORG, zone, view);
      expect(actual).toBe(previousCsv(data, ORG, zone, view));
    }
  }
  const csv = filteredResourceMembershipsCsv(data, ORG,
    "America/Los_Angeles", { ...baseView, mode: "overlapping-day",
      date: "2026-11-01" });
  for (const hidden of [
    "PRIVATE@EXAMPLE.TEST", "PRIVATE MEMBERSHIP NOTE", "PRIVATE CONTACT",
    "FOREIGN PRIVATE MEMBERSHIP", "FOREIGN RESOURCE", "Ignored Duplicate",
  ]) expect(csv).not.toContain(hidden);
  expect(data).toEqual(before);
});

it("retains distinct revisions and repeated record references during local-day classification", () => {
  const sameObject = record("resource-memberships", "revision-id", {
    resource: "same", employee: "employee", title: "Repeated revision",
    start: "2026-11-01T08:30:00Z", end: "2026-11-01T08:45:00Z",
  });
  const data = [
    record("resources", "same", { name: "First Crew", kind: "Crew" }),
    record("resources", "same", { name: "Second Crew", kind: "Crew" }),
    record("resources", "empty", { name: "Empty Worker", kind: "Worker" }),
    record("employees", "employee", { name: "+Spreadsheet Safe" }),
    sameObject, sameObject,
    record("resource-memberships", "revision-id", {
      resource: "same", employee: "employee", title: "Later revision",
      start: "2026-11-01T09:30:00Z", end: "2026-11-01T09:45:00Z",
    }, true),
    record("resource-memberships", "bad-time", {
      resource: "same", employee: "employee", title: "Bad historic time",
      start: "not-a-date", end: "2026-11-01T09:45:00Z",
    }),
    record("resource-memberships", "foreign", {
      resource: "same", employee: "employee", title: "FOREIGN HISTORY",
      start: "2026-11-01T08:30:00Z", end: "2026-11-01T08:45:00Z",
    }, false, OTHER),
  ];
  for (const view of [
    { ...baseView, mode: "overlapping-day" as const, date: "2026-11-01" },
    { ...baseView, mode: "overlapping-day" as const, date: "2026-11-01",
      membershipStatus: "archived" as const },
    { ...baseView, memberSearch: "repeated" },
  ]) {
    expect(filteredResourceMembershipsCsv(
      data, ORG, "America/Los_Angeles", view,
    )).toBe(previousCsv(data, ORG, "America/Los_Angeles", view));
  }
  const selected = filteredResourceMembershipsCsv(data, ORG,
    "America/Los_Angeles", { ...baseView, mode: "overlapping-day", date: "2026-11-01" });
  expect(selected.match(/Repeated revision/g)).toHaveLength(4);
  expect(selected).not.toContain("Bad historic time");
  expect(selected).not.toContain("FOREIGN HISTORY");
});

it("preserves malformed review-day and time-zone errors and empty exports", () => {
  for (const date of ["", "2026-02-30", "2026-11"]) {
    expect(() => filteredResourceMembershipsCsv([], ORG, "UTC",
      { ...baseView, mode: "overlapping-day", date }))
      .toThrow(/valid membership review date/);
  }
  expect(() => filteredResourceMembershipsCsv([], ORG, "Invalid/Zone", baseView))
    .toThrow(/valid business time zone/);
  expect(filteredResourceMembershipsCsv([], ORG, "UTC", baseView))
    .toBe(previousCsv([], ORG, "UTC", baseView));
});
