import type { WorkspaceRecord } from "./engine";

export type AvailabilityPeriodTypeFilter =
  | "all" | "Working hours" | "Day off" | "Vacation" | "Unavailable";

/**
 * Filter only already-authorized, selected-date availability periods for
 * presentation. Employee/resource matches use the matching linked record
 * within the period's own organization; unknown/foreign IDs are never searched
 * as raw text. Contacts, notes and internal record IDs are not searchable.
 * The source order, periods, eligibility and appointment reservations remain
 * unchanged.
 */
export function filterAvailabilityPeriods(
  periods: readonly WorkspaceRecord[],
  linkedRecords: readonly WorkspaceRecord[],
  kind: AvailabilityPeriodTypeFilter,
  search: string,
): WorkspaceRecord[] {
  const query = search.trim().toLocaleLowerCase();
  return periods.filter((period) => {
    if (period.entity !== "availability") return false;
    if (kind !== "all" && period.data.kind !== kind) return false;
    if (!query) return true;
    const title = typeof period.data.title === "string"
      ? period.data.title : "";
    const subjectId = period.data.employee || period.data.resource;
    const subject = linkedRecords.find((record) =>
      record.id === subjectId &&
      record.organization_id === period.organization_id &&
      (record.entity === "employees" || record.entity === "resources"),
    );
    const subjectName = subject && typeof subject.data.name === "string"
      ? subject.data.name : "";
    return title.toLocaleLowerCase().includes(query) ||
      subjectName.toLocaleLowerCase().includes(query);
  });
}
