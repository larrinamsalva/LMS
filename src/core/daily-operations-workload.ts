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
function recordedItemCount(day: DailyWorkload, includeInspections: boolean) {
  return day.appointments + day.unfinishedWork +
    (includeInspections ? day.inspections : 0);
}

export function busiestRecordedDay(
  days: readonly DailyWorkload[],
  includeInspections: boolean,
): { date: string; recordedItems: number; tiedDates: number } | null {
  let result: { date: string; recordedItems: number; tiedDates: number } | null = null;
  for (const day of days) {
    const count = recordedItemCount(day, includeInspections);
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


/**
 * Optional presentation-only ordering of the same authorized calendar days.
 * Largest *saved record count* first, with earliest date winning any tie.
 * The default preserves ascending business-local dates. An optional activity
 * category changes only the ranking, not dates or saved records. No mutation.
 */
export function orderWorkloadDays(
  days: readonly DailyWorkload[],
  includeInspections: boolean,
  mode: "calendar" | "most-recorded",
  activityType: WorkloadActivityType = "all",
): DailyWorkload[] {
  const result = [...days];
  if (mode === "calendar") {
    return result.sort((a, b) => a.date.localeCompare(b.date));
  }
  return result.sort((a, b) =>
    focusedRecordedItemCount(b, includeInspections, activityType) -
      focusedRecordedItemCount(a, includeInspections, activityType) ||
    a.date.localeCompare(b.date),
  );
}


/** Optional date-card focus, using only current-business saved record counts. */
export type WorkloadActivityType = "all" | "appointments" | "work" | "inspections";

/** Count the chosen category without mixing in unrelated saved records. */
function focusedRecordedItemCount(
  day: DailyWorkload,
  includeInspections: boolean,
  type: WorkloadActivityType,
): number {
  switch (type) {
    case "appointments": return day.appointments;
    case "work": return day.unfinishedWork;
    case "inspections": return includeInspections ? day.inspections : 0;
    case "all": return recordedItemCount(day, includeInspections);
  }
}

export function filterWorkloadDaysByType(
  days: readonly DailyWorkload[],
  includeInspections: boolean,
  type: WorkloadActivityType,
): DailyWorkload[] {
  if (type === "all") return [...days];
  return days.filter((day) => {
    switch (type) {
      case "appointments": return day.appointments > 0;
      case "work": return day.unfinishedWork > 0;
      case "inspections": return includeInspections && day.inspections > 0;
    }
  });
}

// Focused activity is a display-only rollup of the same authorized seven-day
// business-local snapshot. It never alters full-week totals, saved data or CSV.
export function summarizeFocusedWorkload(
  days: readonly DailyWorkload[],
  includeInspections: boolean,
  type: WorkloadActivityType,
): { savedItems: number; matchingDays: number; daysInWindow: number } {
  return days.reduce((result, day) => {
    const saved = focusedRecordedItemCount(day, includeInspections, type);
    return {
      savedItems: result.savedItems + saved,
      matchingDays: result.matchingDays + Number(saved > 0),
      daysInWindow: result.daysInWindow + 1,
    };
  }, { savedItems: 0, matchingDays: 0, daysInWindow: 0 });
}


/**
 * Largest selected-category saved-record count in the authorized business's
 * seven-day snapshot. The date and tie result are independent of UI sorting
 * and caller ordering. Never estimates staffing, duration or availability.
 */
export function busiestFocusedDay(
  days: readonly DailyWorkload[],
  includeInspections: boolean,
  type: WorkloadActivityType,
): { date: string; matchingItems: number; tiedDates: number } | null {
  let result: { date: string; matchingItems: number; tiedDates: number } | null = null;
  for (const day of days) {
    const count = focusedRecordedItemCount(day, includeInspections, type);
    if (count <= 0) continue;
    if (!result || count > result.matchingItems) {
      result = { date: day.date, matchingItems: count, tiedDates: 1 };
    } else if (count === result.matchingItems) {
      result.tiedDates += 1;
      if (day.date < result.date) result.date = day.date;
    }
  }
  return result;
}
