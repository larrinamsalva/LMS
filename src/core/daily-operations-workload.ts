import { Temporal } from "@js-temporal/polyfill";
import type { summarizeDailyOperations } from "./daily-operations";
import { localDate } from "./time";

type Overview = ReturnType<typeof summarizeDailyOperations>;
export interface DailyWorkload {
  date: string;
  appointments: number;
  unfinishedWork: number;
  inspections: number;
}

/**
 * Count the next seven business-local calendar dates from the already
 * authorized overview. This is a planning count, NOT staff/resource capacity
 * and not a change to booking or job records.
 *
 * Appointments count by saved START day, not each day an overnight booking
 * overlaps. Jobs/tasks count by saved due date. Upcoming equipment inspections
 * count by their recorded next-inspection date, only for serviceable assets.
 * Undated/overdue/finished/cancelled/archived/foreign records are already
 * excluded by the authorized overview. These are planning counts, not
 * evidence of resource availability or safety.
 */
export function sevenDayWorkload(overview: Overview, zone: string): DailyWorkload[] {
  const selected = Temporal.PlainDate.from(overview.date);
  const days: DailyWorkload[] = Array.from({ length: 7 }, (_, offset) => ({
    date: selected.add({ days: offset + 1 }).toString(),
    appointments: 0,
    unfinishedWork: 0,
    inspections: 0,
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
  for (const item of overview.upcomingEquipmentInspections) {
    const day = byDate.get(item.due);
    if (day) day.inspections += 1;
  }
  return days;
}

/**
 * Small, read-only weekly rollup of the exact same seven dates shown on screen.
 * Equipment counts only affect active-day totals for equipment-enabled
 * workspaces. The totals never infer staff availability, urgency or capacity.
 */
export function summarizeSevenDayWorkload(
  days: readonly DailyWorkload[],
  includeInspections: boolean,
) {
  return days.reduce(
    (totals, day) => ({
      appointments: totals.appointments + day.appointments,
      unfinishedWork: totals.unfinishedWork + day.unfinishedWork,
      inspections: totals.inspections + (includeInspections ? day.inspections : 0),
      daysWithActivity: totals.daysWithActivity + Number(
        day.appointments > 0 || day.unfinishedWork > 0 ||
        (includeInspections && day.inspections > 0),
      ),
      daysInWindow: totals.daysInWindow + 1,
    }),
    {
      appointments: 0, unfinishedWork: 0,
      inspections: 0, daysWithActivity: 0, daysInWindow: 0,
    },
  );
}

/** The activity-only display filter uses exactly the same definition as totals. */
export function visibleWorkloadDays(
  days: readonly DailyWorkload[],
  includeInspections: boolean,
  activityOnly: boolean,
): DailyWorkload[] {
  if (!activityOnly) return [...days];
  return days.filter((day) =>
    day.appointments > 0 || day.unfinishedWork > 0 ||
    (includeInspections && day.inspections > 0),
  );
}

/**
 * The date with the most *recorded items*, not the most work hours.
 * Appointments, due work, and enabled inspections each count as one.
 * For ties, choose the earliest business-local calendar date, regardless
 * of caller input ordering. No-record weeks have no peak date.
 */
export function busiestRecordedDay(
  days: readonly DailyWorkload[],
  includeInspections: boolean,
): { date: string; recordedItems: number; tiedDates: number } | null {
  let result: { date: string; recordedItems: number; tiedDates: number } | null = null;
  for (const day of days) {
    const count = day.appointments + day.unfinishedWork +
      (includeInspections ? day.inspections : 0);
    if (count <= 0) continue;
    if (!result || count > result.recordedItems) {
      result = { date: day.date, recordedItems: count, tiedDates: 1 };
    } else if (count === result.recordedItems) {
      result.tiedDates++;
      if (day.date < result.date) result.date = day.date;
    }
  }
  return result;
}
