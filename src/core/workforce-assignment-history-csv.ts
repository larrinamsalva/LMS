import type { WorkspaceRecord } from "./engine";
import type { StaffAssignment } from "./workforce";
import { csvSafeCell } from "./daily-operations-csv";
import { displayTime } from "./time";
import {
  filterStaffAssignmentHistory,
  filterStaffAssignmentHistoryByStartDate,
  orderStaffAssignmentHistory,
  staffAssignmentStartDateRangeError,
  type StaffAssignmentHistoryStatus,
  type StaffAssignmentHistorySort,
} from "./workforce-assignment-history";

export interface StaffAssignmentCsvView {
  status: StaffAssignmentHistoryStatus;
  search: string;
  fromDate: string;
  throughDate: string;
  sort: StaffAssignmentHistorySort;
}

/**
 * A read-only report of ALL matching retained allocation revisions, not the
 * first ten list entries. Reapply the visible filters/sort to the canonical
 * authorized organization snapshot; do not trust caller-supplied rows or IDs.
 *
 * Historic snapshot names/roles are intentionally included for fictional
 * operator recordkeeping. No email, phone, skills, notes, identifiers or
 * foreign organization linked record titles are included.
 */
export function staffAssignmentHistoryCsv(
  assignments: readonly StaffAssignment[],
  records: readonly WorkspaceRecord[],
  organizationId: string,
  zone: string,
  view: StaffAssignmentCsvView,
): string {
  if (staffAssignmentStartDateRangeError(view.fromDate, view.throughDate)) {
    throw new Error("Correct the assignment date range before exporting.");
  }
  const scoped = assignments.filter(
    (assignment) => assignment.organization_id === organizationId,
  );
  const scopedRecords = records.filter(
    (record) => record.organization_id === organizationId,
  );
  const byStatusAndSearch = filterStaffAssignmentHistory(
    scoped, scopedRecords, view.status, view.search,
  );
  const byDate = filterStaffAssignmentHistoryByStartDate(
    byStatusAndSearch, zone, view.fromDate, view.throughDate,
  );
  const ordered = orderStaffAssignmentHistory(byDate, view.sort);
  const linkedName = (id: string, entity: string, field: "title" | "name") => {
    const record = scopedRecords.find((r) => r.entity === entity && r.id === id);
    const name = record?.data[field];
    return typeof name === "string" ? name : "";
  };
  const formatted = (instant: string | Date) => {
    try {
      const iso = new Date(instant).toISOString();
      return displayTime(iso, zone);
    } catch {
      return "";
    }
  };

  const header = [
    "Employee name (retained)", "Employee role (retained)",
    "Assignment status", "Appointment title", "Worker or crew",
    "Scheduled start (business local)", "Scheduled end (business local)",
    "Appointment revision", "Membership revision", "Business time zone",
  ];
  const rows = ordered.map((assignment) => [
    assignment.employee_name,
    assignment.employee_role,
    assignment.active ? "Reserved" : "Released",
    linkedName(assignment.appointment_id, "appointments", "title"),
    linkedName(assignment.resource_id, "resources", "name"),
    formatted(assignment.starts_at),
    formatted(assignment.ends_at),
    String(assignment.appointment_revision),
    String(assignment.membership_revision),
    zone,
  ]);
  return [header, ...rows]
    .map((row) => row.map(csvSafeCell).join(","))
    .join("\r\n") + "\r\n";
}
