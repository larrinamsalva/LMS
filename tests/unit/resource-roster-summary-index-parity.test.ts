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
  filteredRosterResourceSummaryCsv, rosterSummaryFilterContext,
} from "../../src/core/resource-roster-summary-csv";

const ORG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const FOREIGN = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

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
  archivedResources: false,
  resourceSearch: "", resourceKind: "all", enrollment: "all",
  mode: "all", membershipStatus: "all", memberSearch: "",
  onlyMatchingResources: false, onlyWithoutMatchingResources: false,
  resourceSort: "directory", sort: "retained", date: "",
};

// Independent pre-optimization exporter retained verbatim from merged #154.
// In particular this baseline repeatedly scans the complete membership
// collection twice for every resource to derive retained and dated counts.
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
  for (const resource of ordered) {
    const retained = resourceMembershipRowsForReview(
      memberships, resource, "all", view.date, zone,
    );
    const dated = resourceMembershipRowsForReview(
      memberships, resource, view.mode, view.date, zone,
    );
    const matched = filterResourceMembershipsByName(
      filterResourceMembershipRecordStatus(dated, view.membershipStatus),
      scoped, view.memberSearch,
    );
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


it("preserves exact roster-summary CSV bytes across 720 fictional membership rows and view combinations", () => {
  const records: WorkspaceRecord[] = [];
  for (let i = 0; i < 40; i++) {
    records.push(record("resources", "resource-" + i, {
      name: i % 9 === 0 ? "=PotentialFormula" : "Fictional Resource " + i,
      kind: i % 3 === 0 ? "Equipment" : i % 3 === 1 ? "Worker" : "Crew",
      notes: "PRIVATE RESOURCE NOTES " + i,
    }, i % 10 === 0));
  }
  records.push(record("resources", "resource-7", {
    name: "Duplicate Local Card", kind: "Crew",
  }));
  records.push(record("resources", "resource-7", {
    name: "Foreign Duplicate", kind: "Worker",
  }, false, FOREIGN));
  records.push(record("resources", "resource-4", {
    name: "Foreign Shadow", kind: "Crew",
  }, false, FOREIGN));
  for (let i = 0; i < 720; i++) {
    const org = i % 19 === 0 ? FOREIGN : ORG;
    records.push(record("employees", "employee-" + i, {
      name: "Example Worker Zone " + (i % 12) + " " + i,
      email: "PRIVATE@EXAMPLE.TEST",
    }, i % 7 === 0, org));
    records.push(record("resource-memberships", "membership-" + i, {
      resource: i % 73 === 0 ? 99 : "resource-" + (i % 37),
      employee: "employee-" + i,
      title: i % 11 === 0 ? "Weekend historic work " + i : "Shift " + i,
      start: i % 27 === 0 ? "invalid" : i % 3 === 0
        ? "2026-11-01T08:30:00Z" : i % 3 === 1
          ? "2026-11-01T09:30:00Z" : "2026-11-06T18:00:00Z",
      end: i % 3 === 0 ? "2026-11-01T08:50:00Z" : i % 3 === 1
        ? "2026-11-01T09:50:00Z" : "2026-11-06T22:00:00Z",
      notes: "PRIVATE MEMBERSHIP NOTES " + i,
    }, i % 5 === 0, org));
  }
  records.push(record("resource-memberships", "foreign-shared-id", {
    resource: "resource-7", employee: "employee-2",
    title: "FOREIGN PRIVATE MEMBERSHIP",
    start: "2026-11-01T08:30:00Z",
    end: "2026-11-01T09:50:00Z",
  }, false, FOREIGN));
  const before = structuredClone(records);
  const views: ResourceMembershipCsvView[] = [
    baseView,
    { ...baseView, memberSearch: "weekend" },
    { ...baseView, memberSearch: "zone 2" },
    { ...baseView, membershipStatus: "current" },
    { ...baseView, membershipStatus: "archived", resourceSort: "most" },
    { ...baseView, resourceKind: "Worker", enrollment: "enrolled" },
    { ...baseView, resourceKind: "Equipment", resourceSort: "fewest" },
    { ...baseView, resourceSearch: "resource 2", resourceSort: "name-asc" },
    { ...baseView, archivedResources: true },
    { ...baseView, onlyMatchingResources: true, memberSearch: "shift" },
    { ...baseView, onlyWithoutMatchingResources: true, resourceSort: "fewest" },
    { ...baseView, resourceSort: "name-desc" },
    { ...baseView, mode: "overlapping-day", date: "2026-11-01" },
    { ...baseView, mode: "overlapping-day", date: "2026-11-01",
      membershipStatus: "archived", memberSearch: "zone", resourceSort: "most" },
    { ...baseView, mode: "overlapping-day", date: "2026-11-06",
      membershipStatus: "current", resourceSort: "fewest" },
    { ...baseView, mode: "overlapping-day", date: "2026-11-07",
      onlyWithoutMatchingResources: true },
  ];
  for (const view of views) {
    const actual = filteredRosterResourceSummaryCsv(
      records, ORG, "America/Los_Angeles", view,
    );
    expect(actual).toBe(previousCsv(
      records, ORG, "America/Los_Angeles", view,
    ));
  }
  const noSearch = filteredRosterResourceSummaryCsv(records, ORG, "UTC", baseView);
  for (const confidential of [
    "PRIVATE@EXAMPLE.TEST", "FOREIGN PRIVATE MEMBERSHIP",
    "Foreign Duplicate", "Foreign Shadow", "PRIVATE MEMBERSHIP NOTES",
  ]) expect(noSearch).not.toContain(confidential);
  expect(records).toEqual(before);
});

it("preserves retained counts for duplicate local cards and ignores foreign/malformed links", () => {
  const records = [
    record("resources", "shared", { kind: "Crew", name: "First Crew" }),
    record("resources", "shared", { kind: "Worker", name: "Second Worker" }),
    record("resources", "empty", { kind: "Worker", name: "Empty Worker" }),
    record("resources", "machine", { kind: "Equipment", name: "Buffer" }),
    record("resource-memberships", "old", {
      resource: "shared", title: "Old",
      start: "2026-11-01T08:30:00Z", end: "2026-11-01T08:40:00Z",
    }, true),
    record("resource-memberships", "current", {
      resource: "shared", title: "Current",
      start: "2026-11-01T09:30:00Z", end: "2026-11-01T09:40:00Z",
    }),
    record("resource-memberships", "wrong-type", {
      resource: 77, title: "No string resource link",
      start: "2026-11-01T08:30:00Z", end: "2026-11-01T08:40:00Z",
    }),
    record("resource-memberships", "foreign", {
      resource: "empty", title: "Foreign",
      start: "2026-11-01T08:30:00Z", end: "2026-11-01T08:40:00Z",
    }, false, FOREIGN),
  ];
  const view = { ...baseView,
    mode: "overlapping-day" as const,
    date: "2026-11-01",
  };
  const actual = filteredRosterResourceSummaryCsv(
    records, ORG, "America/Los_Angeles", view,
  );
  expect(actual).toBe(previousCsv(records, ORG, "America/Los_Angeles", view));
  for (const row of actual.trimEnd().split("\r\n").slice(1, 3)) {
    expect(row).toContain('"Enrolled","2","2","1","1"');
  }
  expect(actual).toContain('"Empty Worker","Worker","Current","Resource-only","0"');
  expect(actual).toContain('"Buffer","Equipment","Current","Not applicable","0"');
});

it("preserves invalid date/zone validation and header-only summaries", () => {
  const invalid = { ...baseView, mode: "overlapping-day" as const,
    date: "2026-02-30",
  };
  expect(() => filteredRosterResourceSummaryCsv([], ORG, "UTC", invalid))
    .toThrow(/valid membership review date/);
  expect(() => filteredRosterResourceSummaryCsv(
    [], ORG, "Not/AZone", baseView,
  )).toThrow(/valid business time zone/);
  expect(filteredRosterResourceSummaryCsv(
    [], ORG, "UTC", baseView,
  )).toBe(previousCsv([], ORG, "UTC", baseView));
});
