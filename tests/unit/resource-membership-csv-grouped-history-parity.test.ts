import { expect, it } from "vitest";
import type { WorkspaceRecord } from "../../src/core/engine";
import { csvSafeCell } from "../../src/core/daily-operations-csv";
import { instant, isTimeZone, localTime } from "../../src/core/time";
import {
  filterWorkforceResourceDirectory,
} from "../../src/core/workforce-resource-directory";
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

// Independent pre-optimization implementation copied from merged PR #155
// baseline. Its two per-resource full membership scans are unchanged.
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
  for (const resource of visibleResources) {
    // Historical enrollment is established by ANY retained membership, even
    // if this selected day has zero overlapping membership rows.
    const all = resourceMembershipRowsForReview(
      memberships, resource, "all", view.date, zone,
    );
    const dateRows = resourceMembershipRowsForReview(
      memberships, resource, view.mode, view.date, zone,
    );
    const shown = orderResourceMembershipsByStart(
      filterResourceMembershipsByName(
        filterResourceMembershipRecordStatus(dateRows, view.membershipStatus),
        scoped, view.memberSearch,
      ),
      view.sort,
    );
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


it("keeps CSV bytes identical across 720 fictional membership rows and historic review combinations", () => {
  const records: WorkspaceRecord[] = [];
  for (let i = 0; i < 30; i++) {
    records.push(record("resources", "resource-" + i, {
      name: i % 9 === 0 ? "@Formula Resource" : "Fictional Resource " + i,
      kind: i % 3 === 0 ? "Equipment" : i % 3 === 1 ? "Worker" : "Crew",
      notes: "PRIVATE RESOURCE NOTE",
    }, i % 8 === 0));
  }
  records.push(record("resources", "resource-7", {
    name: "Duplicate local Worker", kind: "Worker",
  }));
  records.push(record("resources", "resource-7", {
    name: "FOREIGN resource collision", kind: "Worker",
  }, false, OTHER));
  for (let i = 0; i < 720; i++) {
    const organization = i % 19 === 0 ? OTHER : ORG;
    records.push(record("employees", "employee-" + i, {
      name: i % 23 === 0 ? "=HYPERLINK(unsafe)" : "Fictional Employee Zone " + (i % 13) + " " + i,
      email: "PRIVATE@EXAMPLE.TEST",
    }, i % 7 === 0, organization));
    records.push(record("resource-memberships", "membership-" + i, {
      resource: i % 71 === 0 ? 55 : "resource-" + (i % 29),
      employee: "employee-" + i,
      title: i % 11 === 0 ? "Weekend crew " + i : "Historic shift " + i,
      start: i % 27 === 0 ? "invalid" :
        i % 4 === 0 ? "2026-11-01T08:30:00Z" :
        i % 4 === 1 ? "2026-11-01T09:30:00Z" :
        i % 4 === 2 ? "2026-11-06T18:00:00Z" : "2026-11-03T16:00:00Z",
      end: i % 4 === 0 ? "2026-11-01T08:45:00Z" :
        i % 4 === 1 ? "2026-11-01T09:45:00Z" :
        i % 4 === 2 ? "2026-11-06T22:00:00Z" : "2026-11-03T18:00:00Z",
      notes: "PRIVATE MEMBERSHIP NOTE",
    }, i % 5 === 0, organization));
  }
  records.push(record("resource-memberships", "foreign-link", {
    resource: "resource-7", employee: "employee-1",
    title: "FOREIGN PRIVATE ROSTER",
    start: "2026-11-06T18:00:00Z", end: "2026-11-06T22:00:00Z",
  }, false, OTHER));
  records.unshift(record("employees", "employee-2", { name: 42 }));
  records.push(record("employees", "employee-2", { name: "Ignored duplicate name" }));
  const snapshot = structuredClone(records);
  const views: ResourceMembershipCsvView[] = [
    baseView,
    { ...baseView, sort: "oldest" },
    { ...baseView, sort: "newest", resourceSort: "most" },
    { ...baseView, resourceSort: "fewest" },
    { ...baseView, resourceSort: "name-asc" },
    { ...baseView, resourceSort: "name-desc" },
    { ...baseView, resourceKind: "Worker" },
    { ...baseView, resourceKind: "Crew", enrollment: "enrolled" },
    { ...baseView, enrollment: "resource-only" },
    { ...baseView, resourceSearch: "resource 1" },
    { ...baseView, archivedResources: true },
    { ...baseView, membershipStatus: "current" },
    { ...baseView, membershipStatus: "archived", memberSearch: "weekend" },
    { ...baseView, onlyMatchingResources: true, memberSearch: "zone 3" },
    { ...baseView, onlyWithoutMatchingResources: true, memberSearch: "nothing" },
    { ...baseView, mode: "overlapping-day", date: "2026-11-01" },
    { ...baseView, mode: "overlapping-day", date: "2026-11-01",
      membershipStatus: "archived", resourceSort: "fewest" },
    { ...baseView, mode: "overlapping-day", date: "2026-11-06",
      memberSearch: "historic shift", resourceSort: "most" },
    { ...baseView, mode: "overlapping-day", date: "2026-11-03",
      resourceKind: "Crew", onlyMatchingResources: true },
  ];
  for (const view of views) {
    expect(filteredResourceMembershipsCsv(
      records, ORG, "America/Los_Angeles", view,
    )).toBe(previousCsv(
      records, ORG, "America/Los_Angeles", view,
    ));
  }
  const localCsv = filteredResourceMembershipsCsv(records, ORG, "UTC", baseView);
  for (const secret of [
    "FOREIGN PRIVATE ROSTER", "FOREIGN resource collision",
    "PRIVATE@EXAMPLE.TEST", "PRIVATE MEMBERSHIP NOTE",
    "Ignored duplicate name",
  ]) expect(localCsv).not.toContain(secret);
  expect(records).toEqual(snapshot);
});

it("retains identical output for duplicate resource IDs, malformed links and archived members", () => {
  const records = [
    record("resources", "shared", { kind: "Crew", name: "Crew One" }),
    record("resources", "shared", { kind: "Worker", name: "Worker Two" }),
    record("resources", "empty", { kind: "Worker", name: "No history" }),
    record("resources", "shared", { kind: "Crew", name: "FOREIGN SHADOW" }, false, OTHER),
    record("resource-memberships", "archived", {
      resource: "shared", employee: "worker", title: "Archived assignment",
      start: "2026-11-01T08:30:00Z", end: "2026-11-01T08:45:00Z",
    }, true),
    record("resource-memberships", "current", {
      resource: "shared", employee: "worker", title: "Current assignment",
      start: "2026-11-01T09:30:00Z", end: "2026-11-01T09:45:00Z",
    }),
    record("resource-memberships", "invalid-resource", {
      resource: 42, employee: "worker", title: "Never matches ID",
      start: "2026-11-01T09:30:00Z", end: "2026-11-01T09:45:00Z",
    }),
    record("resource-memberships", "foreign-same-resource", {
      resource: "shared", employee: "worker", title: "FOREIGN HISTORY",
      start: "2026-11-01T09:30:00Z", end: "2026-11-01T09:45:00Z",
    }, false, OTHER),
    record("employees", "worker", { name: "+Spreadsheet-safe person" }),
  ];
  for (const view of [
    baseView,
    { ...baseView, mode: "overlapping-day" as const, date: "2026-11-01" },
    { ...baseView, membershipStatus: "archived" as const },
    { ...baseView, onlyMatchingResources: true },
  ]) {
    const actual = filteredResourceMembershipsCsv(
      records, ORG, "America/Los_Angeles", view,
    );
    expect(actual).toBe(previousCsv(
      records, ORG, "America/Los_Angeles", view,
    ));
    expect(actual).not.toContain("FOREIGN HISTORY");
    expect(actual).not.toContain("Never matches ID");
  }
});

it("preserves invalid-date and invalid-zone errors and empty CSV headers", () => {
  const badDate = { ...baseView, mode: "overlapping-day" as const,
    date: "2026-02-30" };
  expect(() => filteredResourceMembershipsCsv([], ORG, "UTC", badDate))
    .toThrow(/valid membership review date/);
  expect(() => filteredResourceMembershipsCsv([], ORG, "Not/AZone", baseView))
    .toThrow(/valid business time zone/);
  expect(filteredResourceMembershipsCsv([], ORG, "UTC", baseView))
    .toBe(previousCsv([], ORG, "UTC", baseView));
});
