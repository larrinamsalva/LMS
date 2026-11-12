import type { WorkspaceRecord } from "./engine";

/** A read-only count of recorded availability-period entries, not staffing
 * availability, free hours, booking capacity, or permission to schedule.
 * Pass only the already-authorized date-overlapping current/archived list.
 * Text search, type filters and sort never change these base totals.
 */
export interface AvailabilityPeriodSummary {
  workingHours: number;
  daysOff: number;
  vacations: number;
  unavailable: number;
  total: number;
}

export function summarizeAvailabilityPeriodTypes(
  periods: readonly WorkspaceRecord[],
): AvailabilityPeriodSummary {
  const summary: AvailabilityPeriodSummary = {
    workingHours: 0, daysOff: 0, vacations: 0, unavailable: 0, total: 0,
  };
  for (const period of periods) {
    if (period.entity !== "availability") continue;
    switch (period.data.kind) {
      case "Working hours": summary.workingHours++; break;
      case "Day off": summary.daysOff++; break;
      case "Vacation": summary.vacations++; break;
      case "Unavailable": summary.unavailable++; break;
      default: continue;
    }
    summary.total++;
  }
  return summary;
}
