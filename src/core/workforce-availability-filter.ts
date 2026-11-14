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
  // Empty searches only use the selected type, not linked records.
  if (!query) return periods.filter((period) =>
    period.entity === "availability" &&
    (kind === "all" || period.data.kind === kind),
  );

  // Search names in the same organization as each retained period.
  // Preserve the original find() behavior: the FIRST employee/resource
  // record with a matching organization and ID wins, including when
  // that first record has an invalid or missing name. Do not index
  // private fields, other entities, or foreign organizations.
  const namesByOrganization = new Map<string, Map<string, string>>();
  for (const record of linkedRecords) {
    if (record.entity !== "employees" && record.entity !== "resources") continue;
    let names = namesByOrganization.get(record.organization_id);
    if (!names) {
      names = new Map<string, string>();
      namesByOrganization.set(record.organization_id, names);
    }
    if (!names.has(record.id)) {
      const name = record.data.name;
      names.set(record.id, typeof name === "string" ? name.toLocaleLowerCase() : "");
    }
  }

  return periods.filter((period) => {
    if (period.entity !== "availability") return false;
    if (kind !== "all" && period.data.kind !== kind) return false;
    const title = typeof period.data.title === "string"
      ? period.data.title : "";
    if (title.toLocaleLowerCase().includes(query)) return true;
    // Preserve employee-first fallback if both links are present:
    // an unknown employee ID does not fall back to the resource ID.
    const subjectId = period.data.employee || period.data.resource;
    if (typeof subjectId !== "string") return false;
    const name = namesByOrganization.get(period.organization_id)?.get(subjectId) ?? "";
    return name.includes(query);
  });
}
