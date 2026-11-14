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

const basicView: ResourceMembershipCsvView = {
  archivedResources: false, resourceSearch: "", resourceKind: "all",
  enrollment: "all", mode: "all", membershipStatus: "all",
  sort: "retained", resourceSort: "directory", memberSearch: "",
  onlyMatchingResources: false, onlyWithoutMatchingResources: false,
  date: "",
};

// Independent pre-optimization implementation, copied from the last green
// main branch before this PR. This keeps employees.find() per exported row.

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
  const employeeName = (id: unknown): string => {
    const employee = employees.find((e) => e.id === id);
    return typeof employee?.data.name === "string" ? employee.data.name : "";
  };
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


it("produces identical membership CSV bytes for 720 fictional rows and filter permutations", () => {
  const records: WorkspaceRecord[] = [];
  for (let i = 0; i < 12; i++) {
    records.push(record("resources", "resource-" + i, {
      kind: i % 3 === 0 ? "Equipment" : i % 3 === 1 ? "Worker" : "Crew",
      name: "Resource " + i,
    }, i % 5 === 0));
  }
  for (let i = 0; i < 720; i++) {
    const org = i % 23 === 0 ? OTHER : ORG;
    records.push(record("employees", "employee-" + i, {
      name: i % 29 === 0 ? "=HYPERLINK(unsafe)" : "Employee Zone " + (i % 13) + " " + i,
      notes: "PRIVATE NOTES " + i, email: "secret@example.test",
    }, i % 7 === 0, org));
    records.push(record("resource-memberships", "membership-" + i, {
      resource: "resource-" + (i % 12),
      employee: "employee-" + i,
      title: i % 11 === 0 ? "Weekend coverage " + i : "Roster shift " + i,
      start: i % 17 === 0 ? "invalid" : i % 2 === 0
        ? "2026-11-06T18:00:00Z" : "2026-11-03T16:00:00Z",
      end: i % 2 === 0 ? "2026-11-06T22:00:00Z"
        : "2026-11-03T18:00:00Z",
    }, i % 5 === 0, org));
  }
  // Match the original strict employee ID equality and first-record-wins.
  records.unshift(record("employees", "employee-7", { name: 42 }));
  records.push(record("employees", "employee-7", { name: "Ignored duplicate" }));
  records.unshift(record("employees", "employee-3", {
    name: "FOREIGN PRIVATE NAME",
  }, false, OTHER));
  records.unshift(record("contacts", "employee-2", {
    name: "PRIVATE CONTACT",
  }));
  records.push(record("resources", "resource-1", {
    name: "FOREIGN RESOURCE", kind: "Crew",
  }, false, OTHER));
  records.push(record("resource-memberships", "foreign-duplicate", {
    resource: "resource-1", employee: "employee-3",
    title: "FOREIGN MEMBERSHIP",
    start: "2026-11-06T18:00:00Z",
    end: "2026-11-06T22:00:00Z",
  }, false, OTHER));

  const snapshot = structuredClone(records);
  const scenarios: ResourceMembershipCsvView[] = [
    basicView,
    { ...basicView, sort: "oldest" },
    { ...basicView, sort: "newest", resourceSort: "most" },
    { ...basicView, resourceSort: "name-desc" },
    { ...basicView, membershipStatus: "current", memberSearch: "zone 2" },
    { ...basicView, membershipStatus: "archived", memberSearch: "weekend" },
    { ...basicView, resourceKind: "Crew", enrollment: "enrolled" },
    { ...basicView, resourceKind: "Worker", resourceSearch: "resource 1" },
    { ...basicView, archivedResources: true },
    { ...basicView, onlyMatchingResources: true, memberSearch: "employee 41" },
    { ...basicView, onlyWithoutMatchingResources: true, memberSearch: "no match" },
    { ...basicView, mode: "overlapping-day", date: "2026-11-06" },
    { ...basicView, mode: "overlapping-day", date: "2026-11-03",
      membershipStatus: "archived", resourceSort: "fewest" },
  ];
  for (const view of scenarios) {
    const csv = filteredResourceMembershipsCsv(records, ORG,
      "America/Los_Angeles", view);
    expect(csv).toBe(previousCsv(records, ORG, "America/Los_Angeles", view));
  }
  const full = filteredResourceMembershipsCsv(records, ORG, "UTC", basicView);
  for (const privateValue of [
    "FOREIGN PRIVATE NAME", "FOREIGN MEMBERSHIP", "PRIVATE CONTACT",
    "Ignored duplicate", "secret@example.test",
  ]) expect(full).not.toContain(privateValue);
  expect(records).toEqual(snapshot);
});

it("preserves strict ID lookup, malformed first names, unknown employees and CSV escaping", () => {
  const records = [
    record("resources", "crew", { kind: "Crew", name: "Local crew" }),
    record("employees", "shared", { name: 25 }),
    record("employees", "shared", { name: "Must not export duplicate" }),
    record("employees", "valid", { name: "@Formula person" }),
    record("employees", "foreign", { name: "FOREIGN SECRET" }, false, OTHER),
    record("contacts", "contact", { name: "PRIVATE CONTACT" }),
    record("resource-memberships", "one", {
      resource: "crew", employee: "shared", title: "Malformed first name",
      start: "2026-11-06T18:00:00Z", end: "2026-11-06T19:00:00Z",
    }),
    record("resource-memberships", "two", {
      resource: "crew", employee: "valid", title: "Formula person",
      start: "2026-11-06T18:00:00Z", end: "2026-11-06T19:00:00Z",
    }),
    record("resource-memberships", "three", {
      resource: "crew", employee: "foreign", title: "Missing local worker",
      start: "2026-11-06T18:00:00Z", end: "2026-11-06T19:00:00Z",
    }),
    record("resource-memberships", "four", {
      resource: "crew", employee: 7, title: "Invalid numeric worker",
      start: "2026-11-06T18:00:00Z", end: "2026-11-06T19:00:00Z",
    }),
  ];
  const actual = filteredResourceMembershipsCsv(records, ORG, "UTC", basicView);
  expect(actual).toBe(previousCsv(records, ORG, "UTC", basicView));
  expect(actual).toContain('"' + "'@Formula person" + '"');
  for (const secret of [
    "Must not export duplicate", "FOREIGN SECRET", "PRIVATE CONTACT",
  ]) expect(actual).not.toContain(secret);
});

it("keeps malformed date validation and empty header-only export semantics", () => {
  const invalid = { ...basicView, mode: "overlapping-day" as const, date: "2026-02-30" };
  expect(() => filteredResourceMembershipsCsv([], ORG, "UTC", invalid))
    .toThrow(/valid membership review date/);
  expect(filteredResourceMembershipsCsv([], ORG, "UTC", basicView))
    .toBe(previousCsv([], ORG, "UTC", basicView));
});
