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
const FOREIGN = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
function rec(
  entity: string,
  id: string,
  data: WorkspaceRecord["data"],
  archived = false,
  organization_id = ORG,
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

// Independent exporter copied from the verified, merged #156 baseline.
// In this reference the linked member-name/title search is run separately
// inside each resource card after its own status and day filters.

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


it("preserves exact CSV bytes across 720 fictional memberships, filtered views and repeated local IDs", () => {
  const records: WorkspaceRecord[] = [];
  for (let i = 0; i < 25; i++) {
    records.push(rec("resources", "crew-" + i, {
      name: "Fictional Crew " + i,
      kind: i % 3 === 0 ? "Equipment" : i % 3 === 1 ? "Crew" : "Worker",
      notes: "PRIVATE CREW NOTE",
    }, i % 11 === 0));
  }
  records.push(rec("resources", "crew-7", {
    name: "Duplicate Local Crew", kind: "Crew",
  }));
  records.push(rec("resources", "crew-7", {
    name: "FOREIGN RESOURCE", kind: "Worker",
  }, false, FOREIGN));
  for (let i = 0; i < 720; i++) {
    const org = i % 17 === 0 ? FOREIGN : ORG;
    records.push(rec("employees", "employee-" + (i % 350), {
      name: i % 29 === 0 ? 123 : "Fictional Worker Zone " + (i % 13) + " " + i,
      email: "PRIVATE EMAIL", skills: "PRIVATE SKILLS",
    }, i % 6 === 0, org));
    records.push(rec("resource-memberships", "membership-" + (i % 250), {
      resource: i % 71 === 0 ? 77 : "crew-" + (i % 24),
      employee: i % 89 === 0 ? 44 : "employee-" + (i % 350),
      title: i % 19 === 0 ? "=Formula Work" : i % 7 === 0
        ? "Weekend title " + i : "Shift " + i,
      start: i % 27 === 0 ? "not-a-date" : i % 3 === 0
        ? "2026-11-01T08:30:00Z" : i % 3 === 1
          ? "2026-11-01T09:30:00Z" : "2026-11-06T18:00:00Z",
      end: i % 3 === 0 ? "2026-11-01T08:40:00Z" : i % 3 === 1
        ? "2026-11-01T09:40:00Z" : "2026-11-06T22:00:00Z",
      notes: "PRIVATE MEMBERSHIP NOTE",
    }, i % 5 === 0, org));
  }
  records.unshift(rec("employees", "employee-4", { name: 123 }));
  records.push(rec("employees", "employee-4", { name: "Ignored Duplicate" }));
  records.push(rec("contacts", "employee-3", {
    name: "PRIVATE CONTACT",
  }));
  records.push(rec("resource-memberships", "same-local-id", {
    resource: "crew-7", employee: "employee-3", title: "Weekend title duplicate",
    start: "2026-11-06T18:00:00Z", end: "2026-11-06T22:00:00Z",
  }));
  records.push(rec("resource-memberships", "same-local-id", {
    resource: "crew-7", employee: "employee-3", title: "Second unique object",
    start: "2026-11-06T18:00:00Z", end: "2026-11-06T22:00:00Z",
  }));
  const before = structuredClone(records);
  const views: ResourceMembershipCsvView[] = [
    baseView,
    { ...baseView, memberSearch: "   " },
    { ...baseView, memberSearch: "SHIFT" },
    { ...baseView, memberSearch: "weekend title" },
    { ...baseView, memberSearch: "zone 3" },
    { ...baseView, memberSearch: "  Worker   " },
    { ...baseView, memberSearch: "=formula" },
    { ...baseView, memberSearch: "PRIVATE EMAIL" },
    { ...baseView, memberSearch: "employee-3" },
    { ...baseView, memberSearch: "notfound" },
    { ...baseView, memberSearch: "shift", sort: "oldest" },
    { ...baseView, memberSearch: "zone", sort: "newest", resourceSort: "most" },
    { ...baseView, memberSearch: "weekend", resourceSort: "fewest" },
    { ...baseView, memberSearch: "worker", resourceSort: "name-desc" },
    { ...baseView, memberSearch: "shift", membershipStatus: "archived" },
    { ...baseView, memberSearch: "shift", membershipStatus: "current" },
    { ...baseView, memberSearch: "zone", enrollment: "enrolled", resourceKind: "Crew" },
    { ...baseView, memberSearch: "weekend", archivedResources: true },
    { ...baseView, memberSearch: "shift", onlyMatchingResources: true },
    { ...baseView, memberSearch: "notfound", onlyWithoutMatchingResources: true },
    { ...baseView, memberSearch: "shift", mode: "overlapping-day", date: "2026-11-01" },
    { ...baseView, memberSearch: "zone", mode: "overlapping-day", date: "2026-11-06",
      resourceSort: "name-asc", membershipStatus: "archived" },
  ];
  for (const view of views) {
    expect(filteredResourceMembershipsCsv(
      records, ORG, "America/Los_Angeles", view,
    )).toBe(previousCsv(
      records, ORG, "America/Los_Angeles", view,
    ));
  }
  const full = filteredResourceMembershipsCsv(
    records, ORG, "UTC", { ...baseView, memberSearch: "shift" },
  );
  for (const forbidden of [
    "FOREIGN RESOURCE", "PRIVATE EMAIL", "PRIVATE MEMBERSHIP NOTE",
    "PRIVATE CONTACT", "Ignored Duplicate",
  ]) expect(full).not.toContain(forbidden);
  expect(records).toEqual(before);
});

it("retains duplicate record references, different objects sharing IDs and first invalid linked names", () => {
  const membership = rec("resource-memberships", "shared-id", {
    resource: "shared-resource", employee: "person", title: "Specific title",
    start: "2026-11-06T18:00:00Z", end: "2026-11-06T20:00:00Z",
  });
  const records = [
    rec("resources", "shared-resource", { name: "First crew", kind: "Crew" }),
    rec("resources", "shared-resource", { name: "Second crew", kind: "Crew" }),
    rec("employees", "person", { name: 88 }),
    rec("employees", "person", { name: "Duplicate should not match" }),
    rec("employees", "person", { name: "FOREIGN PRIVATE NAME" }, false, FOREIGN),
    membership, membership,
    rec("resource-memberships", "shared-id", {
      resource: "shared-resource", employee: "person", title: "Another title",
      start: "2026-11-06T18:00:00Z", end: "2026-11-06T20:00:00Z",
    }, true),
  ];
  for (const search of ["", "Specific title", "another title", "Duplicate should not match"]) {
    const view = { ...baseView, memberSearch: search };
    expect(filteredResourceMembershipsCsv(records, ORG, "UTC", view))
      .toBe(previousCsv(records, ORG, "UTC", view));
  }
  const specific = filteredResourceMembershipsCsv(
    records, ORG, "UTC", { ...baseView, memberSearch: "Specific title" },
  );
  expect(specific.match(/Specific title/g)).toHaveLength(4);
  const unmatched = filteredResourceMembershipsCsv(
    records, ORG, "UTC", { ...baseView, memberSearch: "Duplicate should not match" },
  );
  expect(unmatched.trimEnd().split("\r\n")).toHaveLength(1);
});

it("keeps invalid review-day and business-zone validation and header-only results", () => {
  expect(() => filteredResourceMembershipsCsv([], ORG, "UTC", {
    ...baseView, mode: "overlapping-day", date: "2026-02-30",
  })).toThrow(/valid membership review date/);
  expect(() => filteredResourceMembershipsCsv([], ORG, "Not/AZone", baseView))
    .toThrow(/valid business time zone/);
  expect(filteredResourceMembershipsCsv([], ORG, "UTC", baseView))
    .toBe(previousCsv([], ORG, "UTC", baseView));
});
