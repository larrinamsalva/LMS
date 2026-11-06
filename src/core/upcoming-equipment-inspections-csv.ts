import type { summarizeDailyOperations } from "./daily-operations";
import { csvSafeCell } from "./daily-operations-csv";

type DailyOverview = ReturnType<typeof summarizeDailyOperations>;

/**
 * Export all inspection dates in the already-authorized, organization-scoped
 * seven-day equipment outlook. The selected day is an as-of date, not an
 * inspection due date. Excludes notes, serials, costs, and personal data.
 */
export function upcomingInspectionsCsv(overview: DailyOverview, zone: string): string {
  const rows: string[][] = [[
    "Starting after", "Through (inclusive)", "Equipment name",
    "Business equipment ID", "Next inspection date", "Recorded condition",
    "Business time zone",
  ]];
  for (const { record, due } of overview.upcomingEquipmentInspections) {
    rows.push([
      overview.date, overview.upcomingThrough, String(record.data.name),
      String(record.data.asset_id ?? ""), due, "Serviceable", zone,
    ]);
  }
  // Use the same formula-safe, RFC-style CSV quoting as the existing exports.
  return rows.map((row) => row.map(csvSafeCell).join(",")).join("\r\n") + "\r\n";
}
