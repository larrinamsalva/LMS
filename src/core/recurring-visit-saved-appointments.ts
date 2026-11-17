import { Temporal } from "@js-temporal/polyfill";
import type { WorkspaceRecord } from "./engine";
import { instant } from "./time";

/**
 * Count already-saved, NON-ARCHIVED appointments overlapping each proposed
 * business-local calendar date. Includes cancelled/completed saved records,
 * matching the default Schedule agenda's inclusive status presentation.
 * An appointment spanning midnight counts on BOTH dates.
 *
 * Input records must be from the caller's already-authorized workspace.
 * No resource allocation, capacity, availability, timeslot validation,
 * cross-organization reads, writes or booking decisions are performed.
 */
export function savedAppointmentsOnPlannedDates(
  dates: readonly string[],
  authorizedAppointments: readonly Pick<WorkspaceRecord, "entity" | "archived" | "data">[],
  zone: string,
): { date: string; savedAppointments: number }[] {
  // Parse once per saved record so a twelve-date preview stays bounded.
  // Invalid saved timestamps are ignored, not treated as reliable evidence.
  const intervals: { start: bigint; end: bigint }[] = [];
  for (const appointment of authorizedAppointments) {
    if (appointment.entity !== "appointments" || appointment.archived) continue;
    try {
      const start = instant(String(appointment.data.start)).epochNanoseconds;
      const end = instant(String(appointment.data.end)).epochNanoseconds;
      if (end > start) intervals.push({ start, end });
    } catch {
      // Defensive rendering of a partially corrupted read-only snapshot.
    }
  }
  return dates.map((date) => {
    const startDay = Temporal.PlainDate.from(date);
    const start = startDay.toZonedDateTime(zone).epochNanoseconds;
    const end = startDay.add({ days: 1 }).toZonedDateTime(zone).epochNanoseconds;
    let savedAppointments = 0;
    for (const interval of intervals) {
      if (interval.start < end && interval.end > start) savedAppointments++;
    }
    return { date, savedAppointments };
  });
}
