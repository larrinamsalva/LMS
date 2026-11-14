import { Temporal } from "@js-temporal/polyfill";
import type { WorkspaceRecord } from "./engine";
import { csvSafeCell } from "./daily-operations-csv";
import { isTimeZone, instant, localTime } from "./time";
import {
  filterAvailabilityPeriods,
  type AvailabilityPeriodTypeFilter,
} from "./workforce-availability-filter";

export interface AvailabilityPeriodsCsvView {
  date: string;
  archived: boolean;
  kind: AvailabilityPeriodTypeFilter;
  search: string;
}

/**
 * Export only already-authorized, same-organization availability periods
 * overlapping the selected business-local day. Recompute date/kind/search
 * from canonical records rather than trusting arbitrary UI-supplied rows.
 *
 * Includes minimal fictional period labels and linked subject names for a
 * planning report; no IDs, contacts, skills, notes, customers or allocations.
 * Local times are paired with UTC instants to distinguish DST fold hours.
 * This report never implies scheduling eligibility or unique staff capacity.
 */
export function filteredAvailabilityPeriodsCsv(
  records: readonly WorkspaceRecord[],
  organizationId: string,
  zone: string,
  view: AvailabilityPeriodsCsvView,
): string {
  if (!isTimeZone(zone)) throw new Error("Choose a valid business time zone.");
  let day: Temporal.PlainDate;
  try {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(view.date)) throw new Error("Invalid date");
    day = Temporal.PlainDate.from(view.date, { overflow: "reject" });
    if (day.toString() !== view.date) throw new Error("Invalid date");
  } catch {
    throw new Error("Choose a valid availability calendar date.");
  }
  const start = day.toZonedDateTime(zone).epochNanoseconds;
  const end = day.add({ days: 1 }).toZonedDateTime(zone).epochNanoseconds;
  const scoped = records.filter((r) => r.organization_id === organizationId);
  const periods = scoped.filter((r) => {
    if (r.entity !== "availability" || r.archived !== view.archived) return false;
    try {
      return instant(String(r.data.start)).epochNanoseconds < end &&
        instant(String(r.data.end)).epochNanoseconds > start;
    } catch {
      // Bad historical entries cannot be placed on a fabricated calendar day.
      return false;
    }
  });
  const matching = filterAvailabilityPeriods(
    periods, scoped, view.kind, view.search,
  );
  const header = [
    "Selected business-local date", "Period title", "Period type",
    "Subject type", "Employee or resource",
    "Start (business local)", "End (business local)",
    "Start (UTC)", "End (UTC)", "Record status", "Business time zone",
  ];
  // Index authorized linked display names once rather than scanning scoped
  // records for every exported period. Keep entity types separate; preserve
  // first-record-wins even when the first label is missing or malformed.
  const employeeNames = new Map<string, string>();
  const resourceNames = new Map<string, string>();
  for (const record of scoped) {
    if (record.entity === "employees") {
      if (!employeeNames.has(record.id)) {
        const name = record.data.name;
        employeeNames.set(record.id, typeof name === "string" ? name : "");
      }
    } else if (record.entity === "resources") {
      if (!resourceNames.has(record.id)) {
        const name = record.data.name;
        resourceNames.set(record.id, typeof name === "string" ? name : "");
      }
    }
  }
  const rows = matching.map((period) => {
    const employeeId = period.data.employee;
    const resourceId = period.data.resource;
    const subjectType = employeeId ? "Employee" : resourceId ? "Resource" : "";
    const subjectId = employeeId || resourceId;
    const subjectEntity = employeeId ? "employees" : "resources";
    const subjectName = typeof subjectId === "string"
      ? (subjectEntity === "employees" ? employeeNames : resourceNames)
        .get(subjectId) ?? ""
      : "";
    const startInstant = instant(String(period.data.start)).toString();
    const endInstant = instant(String(period.data.end)).toString();
    return [
      view.date,
      typeof period.data.title === "string" ? period.data.title : "",
      typeof period.data.kind === "string" ? period.data.kind : "",
      subjectType,
      subjectName,
      localTime(startInstant, zone),
      localTime(endInstant, zone),
      startInstant,
      endInstant,
      period.archived ? "Archived" : "Current",
      zone,
    ];
  });
  return [header, ...rows]
    .map((row) => row.map(csvSafeCell).join(","))
    .join("\r\n") + "\r\n";
}
