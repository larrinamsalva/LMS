import type { WorkspaceRecord } from "./engine";
import type { StaffAssignment } from "./workforce";

export type StaffAssignmentHistoryStatus = "all" | "reserved" | "released";
export const STAFF_HISTORY_PAGE_SIZE = 10;

/**
 * Filter only already-authorized, retained assignment snapshots. Appointment
 * titles may be searched only if the linked record belongs to the assignment's
 * own organization; absent/foreign records never expose their names.
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
    const searchable = [
      assignment.employee_name,
      assignment.employee_role,
      typeof appointmentLabel === "string" ? appointmentLabel : "",
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
