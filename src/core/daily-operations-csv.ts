import type { summarizeDailyOperations } from "./daily-operations";
import { displayTime } from "./time";

type DailyOverview = ReturnType<typeof summarizeDailyOperations>;

/**
 * Quote every field; prefix dangerous spreadsheet-cell prefixes with a literal
 * apostrophe so a fictional title cannot become a formula when opened in Excel.
 * Whitespace and control characters before =, +, -, @ must not evade the guard.
 */
export function csvSafeCell(input: string): string {
  const value = String(input);
  const unsafe = /^[\s\uFEFF]*[=+\-@]/u.test(value) || /^[\t\r\n]/u.test(value);
  const safe = unsafe ? "'" + value : value;
  return '"' + safe.replaceAll('"', '""') + '"';
}

/**
 * Export the complete authorized Daily Operations summary, not the first four
 * UI rows. The caller is responsible for using only its current workspace's
 * organization-scoped summary. No addresses, contact data or notes are copied.
 */
export function dailyOperationsCsv(
  overview: DailyOverview,
  zone: string,
  includeEquipment: boolean,
): string {
  const rows: string[][] = [[
    "Selected date", "Type", "Title", "Time or due date",
    "Status or reason", "Business time zone",
  ]];
  // A daily summary can include multiple appointments sharing a scheduled
  // start. Reuse formatted labels for identical immutable strings only within
  // this export; non-string historical values retain per-use conversion.
  const formattedStarts = new Map<string, string>();
  const formattedStart = (value: unknown): string => {
    if (typeof value !== "string") return displayTime(String(value), zone);
    const cached = formattedStarts.get(value);
    if (cached !== undefined) return cached;
    const label = displayTime(value, zone);
    formattedStarts.set(value, label);
    return label;
  };
  for (const appointment of overview.appointments) {
    rows.push([
      overview.date, "Appointment", String(appointment.data.title),
      formattedStart(appointment.data.start),
      String(appointment.data.status), zone,
    ]);
  }
  for (const { record, due } of overview.overdue) {
    rows.push([
      overview.date, "Overdue work", String(record.data.title), due,
      String(record.data.status), zone,
    ]);
  }
  for (const { record, due } of overview.dueToday) {
    rows.push([
      overview.date, "Work due today", String(record.data.title), due,
      String(record.data.status), zone,
    ]);
  }
  if (includeEquipment) {
    for (const { record, reason } of overview.equipment) {
      rows.push([
        overview.date, "Equipment attention", String(record.data.name),
        "", reason, zone,
      ]);
    }
  }
  return rows.map((row) => row.map(csvSafeCell).join(",")).join("\r\n") + "\r\n";
}
