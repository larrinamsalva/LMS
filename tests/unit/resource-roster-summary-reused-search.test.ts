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
  archivedResources: false, resourceSearch: "", resourceKind: "all",
  enrollment: "all", mode: "all", membershipStatus: "all",
  memberSearch: "", onlyMatchingResources: false,
  onlyWithoutMatchingResources: false, resourceSort: "directory",
  sort: "retained", date: "",
};

// Independent reference copied from merged, five-green #157 source.
// It still runs the full linked membership name/title search per card.

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


it("keeps exact summary CSV bytes for 720 fictional roster entries across member-search and filter combinations", () => {
  const records: WorkspaceRecord[] = [];
  for (let i = 0; i < 32; i++) {
    records.push(record("resources", "resource-" + i, {
      kind: i % 3 === 0 ? "Equipment" : i % 3 === 1 ? "Crew" : "Worker",
      name: i % 17 === 0 ? "=Formula resource" : "Fictional Resource " + i,
      notes: "PRIVATE RESOURCE NOTES",
    }, i % 11 === 0));
  }
  records.push(record("resources", "resource-7", {
    kind: "Crew", name: "Duplicate card",
  }));
  records.push(record("resources", "resource-7", {
    kind: "Crew", name: "FOREIGN SHADOW",
  }, false, FOREIGN));
  for (let i = 0; i < 720; i++) {
    const org = i % 19 === 0 ? FOREIGN : ORG;
    records.push(record("employees", "employee-" + (i % 370), {
      name: i % 29 === 0 ? 42 : "Fictional Worker Zone " + (i % 13) + " " + i,
      notes: "PRIVATE EMPLOYEE NOTES", phone: "PRIVATE PHONE",
    }, i % 7 === 0, org));
    records.push(record("resource-memberships", "membership-" + (i % 260), {
      resource: i % 73 === 0 ? 99 : "resource-" + (i % 31),
      employee: i % 89 === 0 ? 66 : "employee-" + (i % 370),
      title: i % 17 === 0 ? "@Formula" : i % 7 === 0
        ? "Weekend history " + i : "Work shift " + i,
      start: i % 29 === 0 ? "invalid" : i % 3 === 0
        ? "2026-11-01T08:30:00Z" : i % 3 === 1
          ? "2026-11-01T09:30:00Z" : "2026-11-06T18:00:00Z",
      end: i % 3 === 0 ? "2026-11-01T08:45:00Z" : i % 3 === 1
        ? "2026-11-01T09:45:00Z" : "2026-11-06T22:00:00Z",
      notes: "PRIVATE MEMBER NOTES",
    }, i % 5 === 0, org));
  }
  records.unshift(record("employees", "employee-4", { name: 44 }));
  records.push(record("employees", "employee-4", { name: "Ignored local duplicate" }));
  records.push(record("contacts", "employee-4", { name: "PRIVATE CONTACT" }));
  const before = structuredClone(records);
  const views: ResourceMembershipCsvView[] = [
    baseView,
    { ...baseView, memberSearch: "   " },
    { ...baseView, memberSearch: "  WORK  " },
    { ...baseView, memberSearch: "WEEKEND" },
    { ...baseView, memberSearch: "worker zone 2" },
    { ...baseView, memberSearch: "@Formula" },
    { ...baseView, memberSearch: "Ignored local duplicate" },
    { ...baseView, memberSearch: "PRIVATE PHONE" },
    { ...baseView, memberSearch: "employee-4" },
    { ...baseView, memberSearch: "notfound" },
    { ...baseView, memberSearch: "shift", membershipStatus: "current" },
    { ...baseView, memberSearch: "weekend", membershipStatus: "archived" },
    { ...baseView, memberSearch: "zone 3", resourceSort: "most" },
    { ...baseView, memberSearch: "work", resourceSort: "fewest" },
    { ...baseView, memberSearch: "weekend", resourceSort: "name-desc" },
    { ...baseView, memberSearch: "work", resourceKind: "Crew", enrollment: "enrolled" },
    { ...baseView, memberSearch: "shift", archivedResources: true },
    { ...baseView, memberSearch: "work", onlyMatchingResources: true },
    { ...baseView, memberSearch: "notfound", onlyWithoutMatchingResources: true },
    { ...baseView, memberSearch: "weekend", mode: "overlapping-day", date: "2026-11-01" },
    { ...baseView, memberSearch: "zone 4", mode: "overlapping-day", date: "2026-11-06",
      membershipStatus: "archived", resourceSort: "most" },
    { ...baseView, memberSearch: "work", mode: "overlapping-day", date: "2026-11-07",
      onlyWithoutMatchingResources: true },
  ];
  for (const view of views) {
    const actual = filteredRosterResourceSummaryCsv(records, ORG, "America/Los_Angeles", view);
    expect(actual).toBe(previousCsv(records, ORG, "America/Los_Angeles", view));
  }
  const summary = filteredRosterResourceSummaryCsv(
    records, ORG, "UTC", { ...baseView, memberSearch: "work" },
  );
  for (const secret of [
    "FOREIGN SHADOW", "PRIVATE MEMBER NOTES", "PRIVATE EMPLOYEE NOTES",
    "PRIVATE CONTACT", "Ignored local duplicate",
  ]) expect(summary).not.toContain(secret);
  expect(records).toEqual(before);
});

it("preserves duplicate record references and distinct revisions sharing the same ID", () => {
  const membership = record("resource-memberships", "same-id", {
    resource: "shared", employee: "person", title: "Special title",
    start: "2026-11-06T18:00:00Z", end: "2026-11-06T20:00:00Z",
  });
  const records = [
    record("resources", "shared", { name: "First Crew", kind: "Crew" }),
    record("resources", "shared", { name: "Second Crew", kind: "Crew" }),
    record("resources", "empty", { name: "Empty Worker", kind: "Worker" }),
    record("employees", "person", { name: 77 }),
    record("employees", "person", { name: "Ignored duplicate" }),
    record("employees", "person", { name: "FOREIGN SECRET" }, false, FOREIGN),
    membership, membership,
    record("resource-memberships", "same-id", {
      resource: "shared", employee: "person", title: "Different title",
      start: "2026-11-06T18:00:00Z", end: "2026-11-06T20:00:00Z",
    }, true),
  ];
  for (const search of ["", "special title", "different title", "ignored duplicate"]) {
    const view = { ...baseView, memberSearch: search };
    expect(filteredRosterResourceSummaryCsv(records, ORG, "UTC", view))
      .toBe(previousCsv(records, ORG, "UTC", view));
  }
  const selected = filteredRosterResourceSummaryCsv(
    records, ORG, "UTC", { ...baseView, memberSearch: "Special title" },
  );
  const matchingRows = selected.trimEnd().split("\r\n").filter((line) =>
    line.includes('"First Crew"') || line.includes('"Second Crew"'),
  );
  expect(matchingRows).toHaveLength(2);
  for (const row of matchingRows) {
    expect(row).toContain('"3","2","2","0"');
  }
  expect(selected).not.toContain("FOREIGN SECRET");
});

it("retains bad date/zone errors and header-only CSV for empty authorized sets", () => {
  expect(() => filteredRosterResourceSummaryCsv([], ORG, "UTC", {
    ...baseView, mode: "overlapping-day", date: "2026-02-30",
  })).toThrow(/valid membership review date/);
  expect(() => filteredRosterResourceSummaryCsv([], ORG, "Not/AZone", baseView))
    .toThrow(/valid business time zone/);
  expect(filteredRosterResourceSummaryCsv([], ORG, "UTC", baseView))
    .toBe(previousCsv([], ORG, "UTC", baseView));
});
