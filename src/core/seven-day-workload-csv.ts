import type { summarizeDailyOperations } from "./daily-operations";
import {
  sevenDayWorkload, summarizeSevenDayWorkload,
  type DailyWorkload,
} from "./daily-operations-workload";
import { csvSafeCell } from "./daily-operations-csv";

type Overview = ReturnType<typeof summarizeDailyOperations>;

/** A separate local-only count report. No titles, contacts, notes or amounts. */
export function sevenDayWorkloadCsv(
  overview: Overview, zone: string, equipmentEnabled: boolean,
): string {
  // Reuse the exact same authorized, business-local grouping as the UI.
  const days = sevenDayWorkload(overview, zone);
  const totals = summarizeSevenDayWorkload(days, equipmentEnabled);
  const header = [
    "Starting after", "Through (inclusive)", "Business-local date",
    "Appointments starting", "Unfinished work due",
    ...(equipmentEnabled ? ["Equipment inspections due"] : []),
    "Has saved activity", "Business time zone",
  ];
  function dayRow(day: DailyWorkload): string[] {
    const hasActivity = day.appointments > 0 || day.unfinishedWork > 0 ||
      (equipmentEnabled && day.inspections > 0);
    return [
      overview.date, overview.upcomingThrough, day.date,
      String(day.appointments), String(day.unfinishedWork),
      ...(equipmentEnabled ? [String(day.inspections)] : []),
      hasActivity ? "Yes" : "No", zone,
    ];
  }
  const totalRow = [
    overview.date, overview.upcomingThrough, "TOTAL (7 days)",
    String(totals.appointments), String(totals.unfinishedWork),
    ...(equipmentEnabled ? [String(totals.inspections)] : []),
    String(totals.daysWithActivity) + " of " +
      String(totals.daysInWindow) + " days", zone,
  ];
  return [header, ...days.map(dayRow), totalRow]
    .map((row) => row.map(csvSafeCell).join(","))
    .join("\r\n") + "\r\n";
}
