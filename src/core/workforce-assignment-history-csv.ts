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
  // Index labels once for the already-authorized organization. Keep entity
  // types separate and preserve find()'s first-record-wins behavior, including
  // an invalid/missing first label. Never index contact or private metadata.
  const appointmentTitles = new Map<string, string>();
  const resourceNames = new Map<string, string>();
  for (const record of scopedRecords) {
    if (record.entity === "appointments") {
      if (!appointmentTitles.has(record.id)) {
        const title = record.data.title;
        appointmentTitles.set(record.id,
          typeof title === "string" ? title : "");
      }
    } else if (record.entity === "resources") {
      if (!resourceNames.has(record.id)) {
        const name = record.data.name;
        resourceNames.set(record.id,
          typeof name === "string" ? name : "");
      }
    }
  }
  const linkedName = (id: string, entity: "appointments" | "resources") =>
    (entity === "appointments" ? appointmentTitles : resourceNames).get(id) ?? "";
  // Retained assignment revisions often share start/end strings. Reuse
  // formatted labels for identical strings within this one authorized export.
  // Date objects remain uncached because they are mutable.
  const formattedStrings = new Map<string, string>();
  const formatted = (value: string | Date) => {
    if (typeof value === "string" && formattedStrings.has(value)) {
      return formattedStrings.get(value) ?? "";
    }
    let label: string;
    try {
      const iso = new Date(value).toISOString();
      label = displayTime(iso, zone);
    } catch {
      label = "";
    }
    if (typeof value === "string") formattedStrings.set(value, label);
    return label;
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
    linkedName(assignment.appointment_id, "appointments"),
    linkedName(assignment.resource_id, "resources"),
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
