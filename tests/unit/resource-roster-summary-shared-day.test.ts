import { expect, it } from "vitest";
import type { WorkspaceRecord } from "../../src/core/engine";
import { csvSafeCell } from "../../src/core/daily-operations-csv";
import { isTimeZone } from "../../src/core/time";
import { filterWorkforceResourceDirectory } from "../../src/core/workforce-resource-directory";
import {
  filterResourceMembershipRecordStatus,
  filterResourceMembershipsByName,
  orderRosterResourcesByMatchingCount,
  resourceMembershipReviewDateError,
  resourceMembershipRowsForReview,
  resourcesWithMatchingRosterMemberships,
  resourcesWithoutMatchingRosterMemberships,
} from "../../src/core/resource-membership-review";
import type { ResourceMembershipCsvView } from "../../src/core/resource-membership-review-csv";
import {
  filteredRosterResourceSummaryCsv,
  rosterSummaryFilterContext,
} from "../../src/core/resource-roster-summary-csv";

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
  memberSearch: "", onlyMatchingResources: false,
  onlyWithoutMatchingResources: false, resourceSort: "directory",
  sort: "retained", date: "",
};

// Independent reference copied from the previously verified #158 main
// exporter. Recomputes the DST-safe date boundaries for every resource.

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

  const scoped = records.filter((record) =>
    record.organization_id === organizationId,
  );
  const resources = scoped.filter((record) => record.entity === "resources");
  const memberships = scoped.filter((record) =>
    record.entity === "resource-memberships",
  );
  const directory = filterWorkforceResourceDirectory(
    resources, memberships, view.archivedResources, view.resourceSearch,
    view.resourceKind, view.enrollment,
  );
  const matchingView = {
    mode: view.mode, date: view.date, zone,
    status: view.membershipStatus, search: view.memberSearch,
  };
  const selected = view.onlyMatchingResources
    ? resourcesWithMatchingRosterMemberships(
      directory, memberships, scoped, organizationId, matchingView,
    )
    : view.onlyWithoutMatchingResources
      ? resourcesWithoutMatchingRosterMemberships(
        directory, memberships, scoped, organizationId, matchingView,
      )
      : directory;
  const ordered = orderRosterResourcesByMatchingCount(
    selected, memberships, scoped, organizationId, matchingView,
    view.resourceSort,
  );

  const rows: string[][] = [[
    "Membership review scope", "Membership review day (business local)",
    "Resource name", "Resource type", "Resource record status",
    "Retained enrollment", "All retained membership records",
    "Matching membership records", "Matching current records",
    "Matching archived records", "Business time zone",
    "Membership record status filter",
    "Member name/title search applied", "Resource name search applied",
    "Resource type filter", "Employee enrollment filter",
    "Resource card selection", "Resource card order",
  ]];
  const filterContext = rosterSummaryFilterContext(view);
  // Member title/linked-name matches do not depend on a resource card's
  // date/status selection. Build one authorized match set per nonblank
  // search, using record identity rather than potentially duplicate IDs.
  // An empty search requires no additional lookup.
  const matchingMemberRows = view.memberSearch.trim()
    ? new Set(filterResourceMembershipsByName(
      memberships, scoped, view.memberSearch,
    ))
    : null;
  // Group same-organization retained history once, in original record order.
  // Duplicate resource cards with the same ID deliberately reuse the same
  // history, just like the previous independent per-card membership scan.
  const membershipsByResource = new Map<string, WorkspaceRecord[]>();
  for (const membership of memberships) {
    const resourceId = membership.data.resource;
    if (typeof resourceId !== "string") continue;
    let entries = membershipsByResource.get(resourceId);
    if (!entries) {
      entries = [];
      membershipsByResource.set(resourceId, entries);
    }
    entries.push(membership);
  }
  for (const resource of ordered) {
    const retained = membershipsByResource.get(resource.id) ?? [];
    // All-history mode already has exactly the retained rows. For a
    // selected local day, keep the existing DST-safe overlap calculation.
    const dated = view.mode === "all" ? retained :
      resourceMembershipRowsForReview(
        retained, resource, view.mode, view.date, zone,
      );
    const statusRows = filterResourceMembershipRecordStatus(
      dated, view.membershipStatus,
    );
    const matched = matchingMemberRows
      ? statusRows.filter((membership) => matchingMemberRows.has(membership))
      : statusRows;
    const archivedCount = matched.filter((record) => record.archived).length;
    const currentCount = matched.length - archivedCount;
    rows.push([
      view.mode === "all" ? "All retained history" : "Overlapping selected day",
      view.mode === "all" ? "" : view.date,
      typeof resource.data.name === "string" ? resource.data.name : "",
      typeof resource.data.kind === "string" ? resource.data.kind : "",
      resource.archived ? "Archived" : "Current",
      resource.data.kind === "Equipment" ? "Not applicable"
        : retained.length ? "Enrolled" : "Resource-only",
      String(retained.length), String(matched.length),
      String(currentCount), String(archivedCount), zone,
      filterContext.membershipStatus,
      filterContext.memberSearchApplied, filterContext.resourceSearchApplied,
      filterContext.resourceType, filterContext.enrollment,
      filterContext.cardSelection, filterContext.resourceOrder,
    ]);
  }
  return rows.map((row) => row.map(csvSafeCell).join(",")).join("\r\n") +
    "\r\n";
}


it("keeps exact roster-summary CSV output for 720 fictional records in all/day modes and resource filters", () => {
  const data: WorkspaceRecord[] = [];
  for (let i = 0; i < 36; i++) {
    data.push(record("resources", "resource-" + i, {
      name: "Example Resource " + i,
      kind: i % 3 === 0 ? "Equipment" : i % 3 === 1 ? "Worker" : "Crew",
      notes: "PRIVATE RESOURCE NOTES",
    }, i % 11 === 0));
  }
  data.push(record("resources", "resource-7", {
    name: "Duplicate Crew Card", kind: "Crew",
  }));
  data.push(record("resources", "resource-7", {
    name: "FOREIGN CARD", kind: "Worker",
  }, false, OTHER));
  for (let i = 0; i < 720; i++) {
    const org = i % 19 === 0 ? OTHER : ORG;
    data.push(record("employees", "employee-" + (i % 325), {
      name: i % 31 === 0 ? 123 : "Example Worker " + i,
      email: "PRIVATE@EXAMPLE.TEST",
    }, i % 13 === 0, org));
    const start = i % 33 === 0 ? "not-a-date"
      : i % 5 === 0 ? "2026-11-01T08:30:00Z"
        : i % 5 === 1 ? "2026-11-01T09:30:00Z"
          : i % 5 === 2 ? "2026-11-06T18:00:00Z"
            : i % 5 === 3 ? "2026-11-07T07:30:00Z"
              : "2026-11-07T08:00:00Z";
    const end = i % 5 === 0 ? "2026-11-01T08:45:00Z"
      : i % 5 === 1 ? "2026-11-01T09:45:00Z"
        : i % 5 === 2 ? "2026-11-06T20:00:00Z"
          : i % 5 === 3 ? "2026-11-07T08:30:00Z"
            : "2026-11-07T09:00:00Z";
    data.push(record("resource-memberships", "membership-" + (i % 250), {
      resource: i % 71 === 0 ? 23 : "resource-" + (i % 35),
      employee: i % 79 === 0 ? 77 : "employee-" + (i % 325),
      title: i % 9 === 0 ? "Weekend roster " + i : "Shift " + i,
      start, end,
      notes: "PRIVATE MEMBER NOTES",
    }, i % 7 === 0, org));
  }
  data.push(record("resource-memberships", "foreign", {
    resource: "resource-7", employee: "employee-2", title: "FOREIGN MEMBERSHIP",
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
      memberSearch: "worker", resourceSort: "name-asc" },
    { ...baseView, mode: "overlapping-day", date: "2026-11-06",
      memberSearch: "shift", onlyMatchingResources: true },
    { ...baseView, mode: "overlapping-day", date: "2026-11-06",
      memberSearch: "notfound", onlyWithoutMatchingResources: true },
    { ...baseView, mode: "overlapping-day", date: "2026-11-01",
      resourceKind: "Crew", enrollment: "enrolled", resourceSort: "name-desc" },
    { ...baseView, mode: "overlapping-day", date: "2026-11-06",
      archivedResources: true },
    { ...baseView, mode: "all", resourceSort: "most",
      memberSearch: "weekend" },
  ];
  for (const zone of ["America/Los_Angeles", "UTC"]) {
    for (const view of views) {
      const got = filteredRosterResourceSummaryCsv(data, ORG, zone, view);
      expect(got).toBe(previousCsv(data, ORG, zone, view));
    }
  }
  const output = filteredRosterResourceSummaryCsv(data, ORG,
    "America/Los_Angeles", { ...baseView, mode: "overlapping-day",
      date: "2026-11-01" });
  for (const secret of [
    "PRIVATE@EXAMPLE.TEST", "PRIVATE MEMBER NOTES", "PRIVATE CONTACT",
    "FOREIGN CARD", "FOREIGN MEMBERSHIP",
  ]) expect(output).not.toContain(secret);
  expect(data).toEqual(before);
});

it("retains duplicate local resource cards, distinct revisions with repeated IDs, and shared object references", () => {
  const retained = record("resource-memberships", "revision-id", {
    resource: "shared", employee: "worker", title: "Repeated history",
    start: "2026-11-01T08:30:00Z", end: "2026-11-01T08:40:00Z",
  });
  const data = [
    record("resources", "shared", { kind: "Crew", name: "First Crew" }),
    record("resources", "shared", { kind: "Worker", name: "Second Worker" }),
    record("resources", "empty", { kind: "Worker", name: "Empty Worker" }),
    retained, retained,
    record("resource-memberships", "revision-id", {
      resource: "shared", employee: "worker", title: "Different revision",
      start: "2026-11-01T09:30:00Z", end: "2026-11-01T09:45:00Z",
    }, true),
    record("resource-memberships", "foreign", {
      resource: "empty", employee: "worker", title: "FOREIGN SHADOW",
      start: "2026-11-01T09:30:00Z", end: "2026-11-01T09:45:00Z",
    }, false, OTHER),
  ];
  for (const view of [
    { ...baseView, mode: "overlapping-day" as const, date: "2026-11-01" },
    { ...baseView, mode: "overlapping-day" as const, date: "2026-11-01",
      membershipStatus: "archived" as const },
    { ...baseView, mode: "all" as const, memberSearch: "Repeated" },
  ]) {
    const csv = filteredRosterResourceSummaryCsv(data, ORG,
      "America/Los_Angeles", view);
    expect(csv).toBe(previousCsv(data, ORG, "America/Los_Angeles", view));
  }
  const csv = filteredRosterResourceSummaryCsv(data, ORG, "UTC",
    { ...baseView, mode: "overlapping-day", date: "2026-11-01" });
  expect(csv).toContain('"First Crew","Crew","Current","Enrolled","3","3","2","1"');
  expect(csv).toContain('"Second Worker","Worker","Current","Enrolled","3","3","2","1"');
});

it("rejects invalid review day and time zone and preserves header-only exports", () => {
  for (const date of ["", "2026-02-30", "2026-11"]) {
    expect(() => filteredRosterResourceSummaryCsv([], ORG, "UTC",
      { ...baseView, mode: "overlapping-day", date }))
      .toThrow(/valid membership review date/);
  }
  expect(() => filteredRosterResourceSummaryCsv([], ORG, "Invalid/Zone", baseView))
    .toThrow(/valid business time zone/);
  expect(filteredRosterResourceSummaryCsv([], ORG, "UTC", baseView))
    .toBe(previousCsv([], ORG, "UTC", baseView));
});
