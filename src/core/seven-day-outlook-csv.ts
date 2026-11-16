import type { summarizeDailyOperations } from "./daily-operations";
import { csvSafeCell } from "./daily-operations-csv";
import { displayTime, localTime } from "./time";

type Outlook = ReturnType<typeof summarizeDailyOperations>;

interface OutlookRow {
  sortKey: string;
  title: string;
  values: string[];
}

/**
 * A separate, local seven-day planning export. Receives an already-authorized,
 * organization-scoped summary, and includes only upcoming bookings and dated
 * unfinished work. No private contact/notes/financial fields are exported.
 */
export function sevenDayOutlookCsv(outlook: Outlook, zone: string): string {
  const header = [
    "Starting after", "Through (inclusive)", "Type", "Title",
    "Appointment time or work due date", "Status", "Business time zone",
  ];
  const rows: OutlookRow[] = [];
  // Duplicate saved string starts share both a display label and business-
  // local sort key within this export. Never carry labels between workspaces,
  // time zones or exports; non-string historical values are not cached.
  const appointmentTimes = new Map<string, { display: string; sortKey: string }>();
  function formattedAppointmentTime(value: unknown): { display: string; sortKey: string } {
    const start = String(value);
    if (typeof value === "string") {
      const cached = appointmentTimes.get(start);
      if (cached !== undefined) return cached;
    }
    const times = { display: displayTime(start, zone), sortKey: localTime(start, zone) };
    if (typeof value === "string") appointmentTimes.set(start, times);
    return times;
  }
  function row(type: string, title: string, when: string, status: string, key: string) {
    rows.push({
      sortKey: key,
      title,
      values: [outlook.date, outlook.upcomingThrough, type, title, when, status, zone],
    });
  }

  for (const appointment of outlook.upcomingAppointments) {
    const times = formattedAppointmentTime(appointment.data.start);
    row(
      "Appointment", String(appointment.data.title),
      times.display, String(appointment.data.status),
      times.sortKey,
    );
  }
  for (const { record, due } of outlook.upcoming) {
    row(
      record.entity === "jobs" ? "Cleaning job" : "Task",
      String(record.data.title), due, String(record.data.status),
      due + "T00:00",
    );
  }
  // Business-local date/time order; dated work without a time goes first that day.
  rows.sort(
    (a, b) => a.sortKey.localeCompare(b.sortKey) ||
      a.title.localeCompare(b.title),
  );
  return [header, ...rows.map((entry) => entry.values)]
    .map((fields) => fields.map(csvSafeCell).join(","))
    .join("\r\n") + "\r\n";
}
