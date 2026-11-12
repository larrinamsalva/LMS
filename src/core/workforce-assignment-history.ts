import type { WorkspaceRecord } from "./engine";
import type { StaffAssignment } from "./workforce";
import { Temporal } from "@js-temporal/polyfill";
import { localDate } from "./time";

export type StaffAssignmentHistoryStatus = "all" | "reserved" | "released";
export const STAFF_HISTORY_PAGE_SIZE = 10;

/**
 * Filter only already-authorized, retained assignment snapshots. Appointment
 * titles and resource names may be searched only if the linked record belongs
 * to the assignment's own organization; absent/foreign records never expose names.
 *
 * Use the snapshot employee name/role rather than mutable current profiles.
 * Do not index identifiers, skills, contacts or unrelated private records.
 * Presentation-only; never changes reservations or archived history.
 */
export function filterStaffAssignmentHistory(
  assignments: readonly StaffAssignment[],
  records: readonly WorkspaceRecord[],
  status: StaffAssignmentHistoryStatus,
  search: string,
): StaffAssignment[] {
  const query = search.trim().toLocaleLowerCase();
  return assignments.filter((assignment) => {
    if (status === "reserved" && !assignment.active) return false;
    if (status === "released" && assignment.active) return false;
    if (!query) return true;
    const appointment = records.find((record) =>
      record.entity === "appointments" &&
      record.id === assignment.appointment_id &&
      record.organization_id === assignment.organization_id,
    );
    const appointmentLabel = appointment?.data.title;
    const resource = records.find((record) =>
      record.entity === "resources" &&
      record.id === assignment.resource_id &&
      record.organization_id === assignment.organization_id,
    );
    const resourceName = resource?.data.name;
    const searchable = [
      assignment.employee_name,
      assignment.employee_role,
      typeof appointmentLabel === "string" ? appointmentLabel : "",
      typeof resourceName === "string" ? resourceName : "",
    ];
    return searchable.some((value) =>
      value.toLocaleLowerCase().includes(query),
    );
  });
}

/** Never infer unique staff or current capacity from retained revisions. */
export function staffAssignmentHistoryCounts(
  assignments: readonly StaffAssignment[],
) {
  let reserved = 0;
  let released = 0;
  for (const assignment of assignments) {
    if (assignment.active) reserved++;
    else released++;
  }
  return { total: reserved + released, reserved, released };
}

/** Show a bounded number of retained revisions without losing the full list. */
export function visibleStaffAssignmentHistory(
  entries: readonly StaffAssignment[],
  requested: number,
): StaffAssignment[] {
  const safe = Number.isFinite(requested)
    ? Math.max(STAFF_HISTORY_PAGE_SIZE, Math.floor(requested))
    : STAFF_HISTORY_PAGE_SIZE;
  return entries.slice(0, safe);
}

/**
 * Date-range bounds refer to the assignment's saved appointment START day in
 * the workspace's display time zone, not when a revision was released.
 * Empty endpoints are unbounded; inputs must be complete, real ISO dates.
 */
export function staffAssignmentStartDateRangeError(
  fromDate: string,
  throughDate: string,
): string | null {
  for (const [label, date] of [
    ["From", fromDate], ["Through", throughDate],
  ] as const) {
    if (!date) continue;
    try {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) ||
          Temporal.PlainDate.from(date, { overflow: "reject" }).toString() !== date) {
        return label + " date must be a valid YYYY-MM-DD calendar date.";
      }
    } catch {
      return label + " date must be a valid YYYY-MM-DD calendar date.";
    }
  }
  return fromDate && throughDate && fromDate > throughDate
    ? "From date must be on or before Through date."
    : null;
}

/**
 * Inclusive local start-day focus over already-authorized snapshot history.
 * The full unfiltered history and status counts remain unchanged.
 * This is independent of the selected Availability day and does not make a
 * current-availability, booking or release-date claim.
 */
export function filterStaffAssignmentHistoryByStartDate(
  assignments: readonly StaffAssignment[],
  zone: string,
  fromDate: string,
  throughDate: string,
): StaffAssignment[] {
  if (staffAssignmentStartDateRangeError(fromDate, throughDate)) return [];
  if (!fromDate && !throughDate) return [...assignments];
  return assignments.filter((assignment) => {
    try {
      const startDay = localDate(
        new Date(assignment.starts_at).toISOString(), zone,
      );
      return (!fromDate || startDay >= fromDate) &&
        (!throughDate || startDay <= throughDate);
    } catch {
      // Malformed retained start dates cannot be assigned a guessed day.
      return false;
    }
  });
}

export type StaffAssignmentHistorySort = "retained" | "newest" | "oldest";

/**
 * Reorder a copy of already-filtered assignment snapshots by their saved
 * scheduled start instant. Invalid dates go last in either direction; ties
 * keep original order. This is NOT revision creation/release chronology and
 * never changes audit history, resource bookings, or persisted records.
 */
export function orderStaffAssignmentHistory(
  entries: readonly StaffAssignment[],
  sort: StaffAssignmentHistorySort,
): StaffAssignment[] {
  if (sort === "retained") return [...entries];
  const millis = (value: string | Date) => {
    const time = new Date(value).getTime();
    return Number.isFinite(time) ? time : null;
  };
  return entries.map((entry, index) => ({
    entry, index, time: millis(entry.starts_at),
  })).sort((a, b) =>
    (a.time === null ? (b.time === null ? 0 : 1)
      : b.time === null ? -1
        : sort === "newest" ? b.time - a.time : a.time - b.time) ||
    a.index - b.index,
  ).map(({ entry }) => entry);
}
