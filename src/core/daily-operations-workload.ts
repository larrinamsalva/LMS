import { Temporal } from "@js-temporal/polyfill";
import type { summarizeDailyOperations } from "./daily-operations";
import { localDate } from "./time";

type Overview = ReturnType<typeof summarizeDailyOperations>;
export interface DailyWorkload {
  date: string;
  appointments: number;
  unfinishedWork: number;
}

/**
 * Count the next seven business-local calendar dates from the already
 * authorized overview. This is a planning count, NOT staff/resource capacity
 * and not a change to booking or job records.
 *
 * Appointments count by saved START day, not each day an overnight booking
 * overlaps. Jobs/tasks count by saved due date. Undated/overdue/finished work,
 * cancelled/archived and foreign records are already excluded by the overview.
 */
export function sevenDayWorkload(overview: Overview, zone: string): DailyWorkload[] {
  const selected = Temporal.PlainDate.from(overview.date);
  const days: DailyWorkload[] = Array.from({ length: 7 }, (_, offset) => ({
    date: selected.add({ days: offset + 1 }).toString(),
    appointments: 0,
    unfinishedWork: 0,
  }));
  const byDate = new Map(days.map((day) => [day.date, day]));
  for (const item of overview.upcomingAppointments) {
    const date = localDate(String(item.data.start), zone);
    const day = byDate.get(date);
    if (day) day.appointments += 1;
  }
  for (const item of overview.upcoming) {
    const day = byDate.get(item.due);
    if (day) day.unfinishedWork += 1;
  }
  return days;
}
