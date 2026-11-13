import { Temporal } from "@js-temporal/polyfill";
import type { WorkspaceRecord } from "./engine";
import { instant, isTimeZone } from "./time";

export type ResourceMembershipReviewMode = "all" | "overlapping-day";
export type ResourceMembershipRecordStatus = "all" | "current" | "archived";
export type ResourceMembershipStartSort = "retained" | "newest" | "oldest";

/**
 * Search only displayed membership titles and names of linked employees
 * in the SAME organization as each authorized membership record.
 * Never search raw IDs, contacts, notes, skills or other organizations.
 * Resource-directory selection and roster enrollment are not affected.
 */
export function filterResourceMembershipsByName(
  memberships: readonly WorkspaceRecord[],
  records: readonly WorkspaceRecord[],
  search: string,
): WorkspaceRecord[] {
  const query = search.trim().toLocaleLowerCase();
  return memberships.filter((membership) => {
    if (membership.entity !== "resource-memberships") return false;
    if (!query) return true;
    const title = typeof membership.data.title === "string"
      ? membership.data.title : "";
    if (title.toLocaleLowerCase().includes(query)) return true;
    const employee = records.find((record) =>
      record.entity === "employees" &&
      record.organization_id === membership.organization_id &&
      record.id === membership.data.employee,
    );
    const name = employee && typeof employee.data.name === "string"
      ? employee.data.name : "";
    return name.toLocaleLowerCase().includes(query);
  });
}


/**
 * Stable presentation-only ordering of retained membership records by their
 * original effective-start instant (not the record's creation/archive time).
 * Preserve source order for equal instants; place malformed timestamps last
 * in either direction, without changing the underlying retained history.
 */
export function orderResourceMembershipsByStart(
  memberships: readonly WorkspaceRecord[],
  order: ResourceMembershipStartSort,
): WorkspaceRecord[] {
  const indexed = memberships.map((record, index) => {
    let start: bigint | null = null;
    try {
      start = instant(String(record.data.start)).epochNanoseconds;
    } catch {
      // Historical malformed timestamps remain visible, but never guessed.
    }
    return { record, index, start };
  });
  if (order === "retained") return indexed.map(({ record }) => record);
  indexed.sort((a, b) => {
    if (a.start === null || b.start === null) {
      if (a.start === null && b.start === null) return a.index - b.index;
      return a.start === null ? 1 : -1;
    }
    if (a.start === b.start) return a.index - b.index;
    const compared = a.start < b.start ? -1 : 1;
    return order === "oldest" ? compared : -compared;
  });
  return indexed.map(({ record }) => record);
}

/**
 * Status is a presentation filter over already-authorized retained membership
 * rows. Archived refers to the membership record, not the resource or the
 * employee profile, and does not affect permanent enrollment.
 */
export function filterResourceMembershipRecordStatus(
  memberships: readonly WorkspaceRecord[],
  status: ResourceMembershipRecordStatus,
): WorkspaceRecord[] {
  return memberships.filter((membership) =>
    membership.entity === "resource-memberships" &&
    (status === "all" ||
      (status === "archived" ? membership.archived : !membership.archived)),
  );
}

/** The chosen roster review day uses the business-local calendar, not UTC. */
export function resourceMembershipReviewDateError(
  date: string, zone: string,
): string | null {
  if (!isTimeZone(zone)) return "Choose a valid business time zone.";
  try {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      Temporal.PlainDate.from(date, { overflow: "reject" }).toString() !== date) {
      return "Choose a valid membership review date.";
    }
  } catch {
    return "Choose a valid membership review date.";
  }
  return null;
}

/**
 * Read-only dated roster inspection. A retained membership overlaps a selected
 * local day iff its [start,end) instants overlap [midnight,next midnight)
 * in the display zone; archive status is retained as a historical marker.
 *
 * Enrollment is NEVER derived from this subset: it remains based on any
 * retained membership, including archived records outside the selected date.
 * Neither overlap nor presence of a worker proves eligibility to schedule.
 */
export function resourceMembershipRowsForReview(
  memberships: readonly WorkspaceRecord[],
  resource: WorkspaceRecord,
  mode: ResourceMembershipReviewMode,
  date: string,
  zone: string,
): WorkspaceRecord[] {
  if (resource.entity !== "resources") return [];
  const owned = memberships.filter((membership) =>
    membership.entity === "resource-memberships" &&
    membership.organization_id === resource.organization_id &&
    membership.data.resource === resource.id,
  );
  if (mode === "all") return owned;
  if (resourceMembershipReviewDateError(date, zone)) return [];
  try {
    const day = Temporal.PlainDate.from(date);
    const start = day.toZonedDateTime(zone).epochNanoseconds;
    const end = day.add({ days: 1 }).toZonedDateTime(zone).epochNanoseconds;
    return owned.filter((membership) => {
      try {
        return instant(String(membership.data.start)).epochNanoseconds < end &&
          instant(String(membership.data.end)).epochNanoseconds > start;
      } catch {
        // Never invent a roster day for malformed retained date records.
        return false;
      }
    });
  } catch {
    return [];
  }
}


export interface MatchingRosterResourceView {
  mode: ResourceMembershipReviewMode;
  date: string;
  zone: string;
  status: ResourceMembershipRecordStatus;
  search: string;
}

/**
 * Optional read-only resource-card narrowing: keep a resource only if it has
 * at least one retained membership matching the date, record-status and
 * employee-name/title filters. Never treat an empty daily view as permanent
 * unenrollment or booking authority.
 *
 * Resources and memberships must explicitly belong to the requested
 * organization; linked employee names must belong to that same organization.
 * Returns a stable nonmutating subset without trusting the caller's arrays
 * to have been prefiltered for organization access.
 */
export function resourcesWithMatchingRosterMemberships(
  resources: readonly WorkspaceRecord[],
  memberships: readonly WorkspaceRecord[],
  linkedRecords: readonly WorkspaceRecord[],
  organizationId: string,
  view: MatchingRosterResourceView,
): WorkspaceRecord[] {
  const scopedMemberships = memberships.filter((member) =>
    member.organization_id === organizationId,
  );
  const scopedLinkedRecords = linkedRecords.filter((record) =>
    record.organization_id === organizationId,
  );
  return resources.filter((resource) => {
    if (resource.entity !== "resources" ||
        resource.organization_id !== organizationId) return false;
    const dated = resourceMembershipRowsForReview(
      scopedMemberships, resource, view.mode, view.date, view.zone,
    );
    const byStatus = filterResourceMembershipRecordStatus(dated, view.status);
    return filterResourceMembershipsByName(
      byStatus, scopedLinkedRecords, view.search,
    ).length > 0;
  });
}
