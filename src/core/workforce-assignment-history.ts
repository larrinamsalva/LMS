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
  // With no search text, neither linked names nor indexes are needed.
  if (!query) return assignments.filter((assignment) =>
    (status !== "reserved" || assignment.active) &&
    (status !== "released" || !assignment.active),
  );
  // Index only display labels for appointments and resources, scoped by
  // organization and entity. Preserve find()'s first-record-wins rule,
  // including when the first duplicate record has an invalid display label.
  const appointmentTitles = new Map<string, Map<string, string>>();
  const resourceNames = new Map<string, Map<string, string>>();
  for (const record of records) {
    const isAppointment = record.entity === "appointments";
    if (!isAppointment && record.entity !== "resources") continue;
    const index = isAppointment ? appointmentTitles : resourceNames;
    let names = index.get(record.organization_id);
    if (!names) {
      names = new Map<string, string>();
      index.set(record.organization_id, names);
    }
    if (!names.has(record.id)) {
      const label = isAppointment ? record.data.title : record.data.name;
      names.set(record.id, typeof label === "string" ? label : "");
    }
  }
  return assignments.filter((assignment) => {
    if (status === "reserved" && !assignment.active) return false;
    if (status === "released" && assignment.active) return false;
    const organizationId = assignment.organization_id;
    const searchable = [
      assignment.employee_name,
      assignment.employee_role,
      appointmentTitles.get(organizationId)?.get(assignment.appointment_id) ?? "",
      resourceNames.get(organizationId)?.get(assignment.resource_id) ?? "",
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
  // Retained revisions often reuse the same scheduled-start string.
  // Cache only strings within this call; Date objects are mutable and must
  // retain their original per-use conversion and validation behavior.
  const startDays = new Map<string, string | null>();
  return assignments.filter((assignment) => {
    const value = assignment.starts_at;
    let startDay: string | null;
    if (typeof value === "string" && startDays.has(value)) {
      startDay = startDays.get(value) ?? null;
    } else {
      try {
        startDay = localDate(new Date(value).toISOString(), zone);
      } catch {
        // Malformed retained start dates cannot be assigned a guessed day.
        startDay = null;
      }
      if (typeof value === "string") startDays.set(value, startDay);
    }
    return startDay !== null &&
      (!fromDate || startDay >= fromDate) &&
      (!throughDate || startDay <= throughDate);
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
  // Archived revisions can share the same scheduled-start string. Reuse
  // that instant only for immutable string values within one sort call.
  // Date objects are mutable and remain parsed for each occurrence.
  const startTimes = new Map<string, number | null>();
  const millis = (value: string | Date): number | null => {
    if (typeof value === "string" && startTimes.has(value)) {
      return startTimes.get(value) ?? null;
    }
    const time = new Date(value).getTime();
    const parsed = Number.isFinite(time) ? time : null;
    if (typeof value === "string") startTimes.set(value, parsed);
    return parsed;
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
