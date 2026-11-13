import type { WorkspaceRecord } from "./engine";
import { csvSafeCell } from "./daily-operations-csv";
import { instant, isTimeZone, localTime } from "./time";
import {
  filterWorkforceResourceDirectory,
  type WorkforceResourceTypeFilter,
  type WorkforceResourceEnrollmentFilter,
} from "./workforce-resource-directory";
import {
  resourceMembershipRowsForReview,
  resourceMembershipReviewDateError,
  filterResourceMembershipRecordStatus,
  filterResourceMembershipsByName,
  resourcesWithMatchingRosterMemberships,
  resourcesWithoutMatchingRosterMemberships,
  orderRosterResourcesByMatchingCount,
  orderResourceMembershipsByStart,
  type ResourceMembershipStartSort,
  type RosterResourceCountSort,
  type ResourceMembershipRecordStatus,
  type ResourceMembershipReviewMode,
} from "./resource-membership-review";

export interface ResourceMembershipCsvView {
  archivedResources: boolean;
  resourceSearch: string;
  resourceKind: WorkforceResourceTypeFilter;
  enrollment: WorkforceResourceEnrollmentFilter;
  mode: ResourceMembershipReviewMode;
  membershipStatus: ResourceMembershipRecordStatus;
  memberSearch: string;
  onlyMatchingResources: boolean;
  onlyWithoutMatchingResources: boolean;
  resourceSort: RosterResourceCountSort;
  sort: ResourceMembershipStartSort;
  date: string;
}

/**
 * Read-only CSV of all membership rows in the current authorized Resource
 * Directory view, including dated history when requested. Recomputes both
 * resource and membership filters from original scoped records; arbitrary UI
 * display rows and identifiers are never trusted as export authority.
 *
 * No contacts, notes, skills, customer data, IDs, or foreign linked names.
 * An effective membership is not evidence of staff availability or booking
 * eligibility. Counts and enrollment categories are not inferred from the
 * selected date, and an archived membership remains historical.
 */
export function filteredResourceMembershipsCsv(
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
