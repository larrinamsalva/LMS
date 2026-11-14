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
 * For a nonblank query, index employee display names once per organization
 * instead of searching all linked records for every membership. First-record
 * matching is retained exactly for duplicate employee IDs.
 * Resource-directory selection and roster enrollment are not affected.
 */
export function filterResourceMembershipsByName(
  memberships: readonly WorkspaceRecord[],
  records: readonly WorkspaceRecord[],
  search: string,
): WorkspaceRecord[] {
  const query = search.trim().toLocaleLowerCase();
  if (!query) return memberships.filter(
    (membership) => membership.entity === "resource-memberships",
  );
  // Index only employee display names, keeping organizations separate.
  // Preserve find()'s first-record-wins behavior if duplicate IDs occur,
  // including a first employee record without a valid display name.
  const employeeNames = new Map<string, Map<string, string>>();
  for (const record of records) {
    if (record.entity !== "employees") continue;
    let organizationNames = employeeNames.get(record.organization_id);
    if (!organizationNames) {
      organizationNames = new Map<string, string>();
      employeeNames.set(record.organization_id, organizationNames);
    }
    if (!organizationNames.has(record.id)) {
      organizationNames.set(record.id,
        typeof record.data.name === "string"
          ? record.data.name.toLocaleLowerCase() : "");
    }
  }
  return memberships.filter((membership) => {
    if (membership.entity !== "resource-memberships") return false;
    const title = typeof membership.data.title === "string"
      ? membership.data.title : "";
    if (title.toLocaleLowerCase().includes(query)) return true;
    const id = membership.data.employee;
    if (typeof id !== "string") return false;
    const name = employeeNames.get(membership.organization_id)?.get(id) ?? "";
    return name.includes(query);
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


interface MatchedRosterResourceCounts {
  current: number;
  archived: number;
}

/**
 * Build one organization-scoped, read-only index for historic resource-card
 * match, summary and count-sort views. One pass over retained memberships
 * replaces the former full scan and employee-name lookup for EVERY resource.
 * The dated [start, end) overlap and invalid-date behavior match the
 * per-resource review exactly, including business-local DST boundaries.
 *
 * These are matching RECORD counts, not distinct employees or availability.
 */
function matchedRosterCountsByResource(
  memberships: readonly WorkspaceRecord[],
  linkedRecords: readonly WorkspaceRecord[],
  organizationId: string,
  view: MatchingRosterResourceView,
): Map<string, MatchedRosterResourceCounts> {
  const counts = new Map<string, MatchedRosterResourceCounts>();
  let scoped = memberships.filter((membership) =>
    membership.entity === "resource-memberships" &&
    membership.organization_id === organizationId,
  );
  if (view.mode !== "all") {
    if (resourceMembershipReviewDateError(view.date, view.zone)) return counts;
    try {
      const day = Temporal.PlainDate.from(view.date);
      const start = day.toZonedDateTime(view.zone).epochNanoseconds;
      const end = day.add({ days: 1 }).toZonedDateTime(view.zone).epochNanoseconds;
      scoped = scoped.filter((membership) => {
        try {
          return instant(String(membership.data.start)).epochNanoseconds < end &&
            instant(String(membership.data.end)).epochNanoseconds > start;
        } catch {
          // Malformed retained dates are not inferred or silently repaired.
          return false;
        }
      });
    } catch {
      return counts;
    }
  }
  const byStatus = filterResourceMembershipRecordStatus(scoped, view.status);
  const matching = filterResourceMembershipsByName(
    byStatus,
    linkedRecords.filter((record) => record.organization_id === organizationId),
    view.search,
  );
  for (const membership of matching) {
    // A malformed resource link cannot match a valid string resource ID.
    const resourceId = membership.data.resource;
    if (typeof resourceId !== "string") continue;
    let count = counts.get(resourceId);
    if (!count) {
      count = { current: 0, archived: 0 };
      counts.set(resourceId, count);
    }
    if (membership.archived) count.archived += 1;
    else count.current += 1;
  }
  return counts;
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
  const matching = matchedRosterCountsByResource(
    memberships, linkedRecords, organizationId, view,
  );
  return resources.filter((resource) =>
    resource.entity === "resources" &&
    resource.organization_id === organizationId &&
    matching.has(resource.id),
  );
}

/**
 * Complement of the match-only resource view. A missing roster match is a
 * historical reporting result for this date/status/search, never evidence
 * that a worker is unassigned, free to book, or permanently unenrolled.
 * Recheck organization and resource entity before comparing IDs.
 */
export function resourcesWithoutMatchingRosterMemberships(
  resources: readonly WorkspaceRecord[],
  memberships: readonly WorkspaceRecord[],
  linkedRecords: readonly WorkspaceRecord[],
  organizationId: string,
  view: MatchingRosterResourceView,
): WorkspaceRecord[] {
  const matchingIds = new Set(
    resourcesWithMatchingRosterMemberships(
      resources, memberships, linkedRecords, organizationId, view,
    ).map((resource) => resource.id),
  );
  return resources.filter((resource) =>
    resource.entity === "resources" &&
    resource.organization_id === organizationId &&
    !matchingIds.has(resource.id),
  );
}

export interface UnmatchedRosterResourceOverview {
  withoutMatching: number;
  enrolledWithoutMatching: number;
  resourceOnlyWithoutMatching: number;
  equipmentWithoutMatching: number;
}

/**
 * Classification of resources with zero membership RECORDS matching the
 * selected historic filters. Enrolled means a Worker/Crew has ever had a
 * retained membership, even if archived or outside the selected day. Equipment
 * never has employee enrollment; do not treat no-match as free-to-book.
 *
 * Caller directory filtering is preserved, but authorization and resource
 * kind are revalidated against explicit organization scope.
 */
export function summarizeUnmatchedRosterResources(
  resources: readonly WorkspaceRecord[],
  memberships: readonly WorkspaceRecord[],
  linkedRecords: readonly WorkspaceRecord[],
  organizationId: string,
  view: MatchingRosterResourceView,
): UnmatchedRosterResourceOverview {
  const selected = resources.filter((resource) =>
    resource.entity === "resources" &&
    resource.organization_id === organizationId &&
    (resource.data.kind === "Crew" ||
      resource.data.kind === "Worker" ||
      resource.data.kind === "Equipment"),
  );
  const unmatched = resourcesWithoutMatchingRosterMemberships(
    selected, memberships, linkedRecords, organizationId, view,
  );
  // Classify historical enrollment once for the full directory view.
  // Keep archived retained records; only same-organization, valid string
  // resource links can match an authorized resource ID.
  const historicallyEnrolledResourceIds = new Set<string>();
  for (const membership of memberships) {
    if (membership.entity !== "resource-memberships" ||
        membership.organization_id !== organizationId ||
        typeof membership.data.resource !== "string") continue;
    historicallyEnrolledResourceIds.add(membership.data.resource);
  }
  let enrolledWithoutMatching = 0;
  let resourceOnlyWithoutMatching = 0;
  let equipmentWithoutMatching = 0;
  for (const resource of unmatched) {
    if (resource.data.kind === "Equipment") {
      equipmentWithoutMatching += 1;
    } else if (historicallyEnrolledResourceIds.has(resource.id)) {
      enrolledWithoutMatching += 1;
    } else {
      resourceOnlyWithoutMatching += 1;
    }
  }
  return {
    withoutMatching: unmatched.length,
    enrolledWithoutMatching,
    resourceOnlyWithoutMatching,
    equipmentWithoutMatching,
  };
}

export interface RosterMembershipOverview {
  directoryResources: number;
  matchingResources: number;
  matchingMemberships: number;
  currentMemberships: number;
  archivedMemberships: number;
}

/**
 * Counts dated membership RECORDS across directory-selected resources, not
 * distinct employees, staffing capacity, available shifts or appointments.
 * The match-only card toggle deliberately has no effect on these counts:
 * hidden empty cards have zero matching rows. Recheck the organization
 * boundary even when arrays supplied by a caller contain foreign records.
 */
export function summarizeMatchingRosterMemberships(
  resources: readonly WorkspaceRecord[],
  memberships: readonly WorkspaceRecord[],
  linkedRecords: readonly WorkspaceRecord[],
  organizationId: string,
  view: MatchingRosterResourceView,
): RosterMembershipOverview {
  const scopedResources = resources.filter((resource) =>
    resource.entity === "resources" &&
    resource.organization_id === organizationId,
  );
  const counts = matchedRosterCountsByResource(
    memberships, linkedRecords, organizationId, view,
  );
  let matchingResources = 0;
  let currentMemberships = 0;
  let archivedMemberships = 0;
  for (const resource of scopedResources) {
    const count = counts.get(resource.id);
    if (!count) continue;
    matchingResources += 1;
    currentMemberships += count.current;
    archivedMemberships += count.archived;
  }
  return {
    directoryResources: scopedResources.length,
    matchingResources,
    matchingMemberships: currentMemberships + archivedMemberships,
    currentMemberships,
    archivedMemberships,
  };
}

export type RosterResourceCountSort =
  "directory" | "most" | "fewest" | "name-asc" | "name-desc";

/**
 * Read-only sorting of resource CARDS by their displayed names or the number
 * of retained membership records matching current roster filters. Matching
 * counts are not headcount, availability or scheduling capacity. Rechecks the
 * organization boundary even if the caller gives mixed input. Equal
 * counts/names preserve the original directory order.
 */
export function orderRosterResourcesByMatchingCount(
  resources: readonly WorkspaceRecord[],
  memberships: readonly WorkspaceRecord[],
  linkedRecords: readonly WorkspaceRecord[],
  organizationId: string,
  view: MatchingRosterResourceView,
  sort: RosterResourceCountSort,
): WorkspaceRecord[] {
  const scopedResources = resources.filter((resource) =>
    resource.entity === "resources" &&
    resource.organization_id === organizationId,
  );
  if (sort === "directory") return [...scopedResources];
  if (sort === "name-asc" || sort === "name-desc") {
    const collator = new Intl.Collator("en", {
      sensitivity: "base", numeric: true,
    });
    return scopedResources
      .map((resource, index) => ({ resource, index }))
      .sort((a, b) => {
        const nameA = typeof a.resource.data.name === "string"
          ? a.resource.data.name : "";
        const nameB = typeof b.resource.data.name === "string"
          ? b.resource.data.name : "";
        const compared = collator.compare(nameA, nameB);
        return (sort === "name-asc" ? compared : -compared) ||
          a.index - b.index;
      })
      .map(({ resource }) => resource);
  }
  const counts = matchedRosterCountsByResource(
    memberships, linkedRecords, organizationId, view,
  );
  const counted = scopedResources.map((resource, index) => {
    const match = counts.get(resource.id);
    return {
      resource, index,
      count: match ? match.current + match.archived : 0,
    };
  });
  counted.sort((a, b) =>
    (sort === "most" ? b.count - a.count : a.count - b.count) ||
    a.index - b.index,
  );
  return counted.map(({ resource }) => resource);
}
