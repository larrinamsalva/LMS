import type { WorkspaceRecord } from "./engine";
import { csvSafeCell } from "./daily-operations-csv";
import { isTimeZone } from "./time";
import { filterWorkforceResourceDirectory } from "./workforce-resource-directory";
import {
  filterResourceMembershipRecordStatus,
  filterResourceMembershipsByName,
  orderRosterResourcesByMatchingCount,
  resourceMembershipReviewDateError,
  resourceMembershipRowsForReview,
  resourcesWithMatchingRosterMemberships,
  resourcesWithoutMatchingRosterMemberships,
} from "./resource-membership-review";
import type { ResourceMembershipCsvView } from "./resource-membership-review-csv";

/**
 * One row per authorized, directory-visible resource (including zero-match
 * cards unless the match-only toggle is on), not one row per employee.
 * Recompute the entire selection from original same-organization records;
 * never trust caller-supplied resource IDs, counts, or names.
 *
 * Matching counts are retained historical membership RECORDS, not distinct
 * employees, active workers, availability, or booking eligibility.
 */
export function filteredRosterResourceSummaryCsv(
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
  ]];
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
    ]);
  }
  return rows.map((row) => row.map(csvSafeCell).join(",")).join("\r\n") +
    "\r\n";
}
