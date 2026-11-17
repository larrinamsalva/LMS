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
  // Upcoming appointments often share a saved start instant. Cache only
  // identical string starts inside one authorized seven-day calculation.
  // Non-string retained values preserve their original per-use conversion.
  const localStartDays = new Map<string, string>();
  for (const item of overview.upcomingAppointments) {
    const value = item.data.start;
    let date: string;
    if (typeof value === "string") {
      const cached = localStartDays.get(value);
      if (cached !== undefined) {
        date = cached;
      } else {
        date = localDate(value, zone);
        localStartDays.set(value, date);
      }
    } else {
      date = localDate(String(value), zone);
    }
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
  // Keep one private accumulator instead of allocating a new totals object
  // for every recorded day. Preserve reduce's sparse-array semantics and
  // the exact activity and optional-inspection predicates.
  return days.reduce(
    (totals, day) => {
      totals.appointments += day.appointments;
      totals.unfinishedWork += day.unfinishedWork;
      totals.inspections += includeInspections ? day.inspections : 0;
      totals.daysWithActivity += Number(
        day.appointments > 0 || day.unfinishedWork > 0 ||
        (includeInspections && day.inspections > 0),
      );
      totals.daysInWindow += 1;
      return totals;
    },
    {
      appointments: 0, unfinishedWork: 0,
      inspections: 0, daysWithActivity: 0, daysInWindow: 0,
    },
  );
}

/**
 * Display-only seven-day relative saved-record activity bars.
 * The tallest bar is 100% of the busiest saved COUNT in this snapshot,
 * not percent utilization, available capacity, duration or staffing.
 * The optional category is a chart-only view, never a filter of input dates.
 * Preserve every supplied day and its order without changing inputs.
 */
export function recordedActivityBars(
  days: readonly DailyWorkload[],
  includeInspections: boolean,
  activityType: WorkloadActivityType = "all",
): { date: string; savedItems: number; relativePercent: number }[] {
  const counts = days.map((day) =>
    focusedRecordedItemCount(day, includeInspections, activityType));
  let largest = 0;
  for (const count of counts) if (count > largest) largest = count;
  return days.map((day, index) => ({
    date: day.date,
    savedItems: counts[index],
    // A positive saved count always remains visible, even when tiny.
    relativePercent: largest > 0 && counts[index] > 0
      ? Math.max(1, Math.round(100 * counts[index] / largest)) : 0,
  }));
}

/**
 * A date's share of the selected chart category's SAVED items in the same
 * full business-local window. This is distinct from `relativePercent`,
 * which scales bars against the largest saved count on one day.
 *
 * These display-only labels do not indicate staffing, effort, utilization
 * or confirmed booking/resource availability. Display precision is one
 * decimal place; a tiny positive share never appears as zero.
 * Reuse the already-authorized/filtered chart bars instead of querying data.
 */
export function recordedActivityWeekShares(
  bars: readonly { date: string; savedItems: number }[],
): { date: string; savedItems: number; shareLabel: string }[] {
  const total = bars.reduce((sum, bar) => sum + bar.savedItems, 0);
  return bars.map(({ date, savedItems }) => {
    let shareLabel = "0%";
    if (total > 0 && savedItems > 0) {
      shareLabel = savedItems * 1000 < total
        ? "<0.1%"
        : (Math.round((savedItems / total) * 1000) / 10).toFixed(1) + "%";
    }
    return { date, savedItems, shareLabel };
  });
}

/**
 * Daily differences in SAVED counts for the chart's selected activity type.
 * Each value compares with the immediately preceding date in the supplied
 * canonical seven-day sequence. The first date has no prior chart baseline.
 * This is a historical/saved-record display cue, NOT a change to a schedule,
 * staffing, urgency, capacity, or bookable appointments. Never mutates input.
 */
export function recordedActivityDailyChanges(
  bars: readonly { date: string; savedItems: number }[],
): { date: string; savedItems: number; change: number | null; changeLabel: string }[] {
  return bars.map((bar, index) => {
    const change = index === 0 ? null : bar.savedItems - bars[index - 1].savedItems;
    return {
      date: bar.date,
      savedItems: bar.savedItems,
      change,
      changeLabel: change === null ? "First date in view"
        : "Change vs prior date: " + (change > 0 ? "+" : "") + change,
    };
  });
}

/**
 * Exact per-type saved counts behind the full seven-day chart.
 * Business-local day ordering is supplied by the authorized workload;
 * inspections are excluded when Equipment is not enabled.
 * This is not occupancy, resource availability or staff capacity.
 */
export function savedActivityTypeBreakdown(
  days: readonly DailyWorkload[],
  includeInspections: boolean,
): { date: string; appointments: number; unfinishedWork: number;
  inspections: number; savedItems: number }[] {
  return days.map((day) => {
    const appointments = day.appointments;
    const unfinishedWork = day.unfinishedWork;
    const inspections = includeInspections ? day.inspections : 0;
    return {
      date: day.date,
      appointments,
      unfinishedWork,
      inspections,
      savedItems: appointments + unfinishedWork + inspections,
    };
  });
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
 * Calendar dates with no SAVED activity in the authorized workload snapshot.
 * This is a read-only planning cue, never evidence of staff availability,
 * bookable spaces, operating hours, or confirmed resource capacity.
 * Preserve the original order, references and duplicates of supplied days.
 */
export function datesWithoutSavedActivity(
  days: readonly DailyWorkload[],
  includeInspections: boolean,
): DailyWorkload[] {
  return days.filter((day) =>
    !(day.appointments > 0 || day.unfinishedWork > 0 ||
      (includeInspections && day.inspections > 0)),
  );
}

/**
 * Earliest business-local date with at least one positive SAVED count.
 * Compare calendar date strings rather than relying on the caller's order.
 * This is a read-only review cue, not confirmed appointments, capacity,
 * urgency or evidence that a resource is available.
 */
export function earliestRecordedActivityDay(
  days: readonly DailyWorkload[],
  includeInspections: boolean,
): { date: string; recordedItems: number } | null {
  let first: { date: string; recordedItems: number } | null = null;
  for (const day of days) {
    const count = recordedItemCount(day, includeInspections);
    if (count <= 0) continue;
    if (first === null || day.date < first.date) {
      first = { date: day.date, recordedItems: count };
    }
  }
  return first;
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
  // The comparator revisits dates during sorting. Count each input day at
  // most once for this sort, keeping the exact prior descending-count and
  // ascending-date tie-breaks. Duplicate references retain their occurrences.
  const counts = new Map<DailyWorkload, number>();
  const savedCount = (day: DailyWorkload): number => {
    const cached = counts.get(day);
    if (cached !== undefined) return cached;
    const count = focusedRecordedItemCount(day, includeInspections, activityType);
    counts.set(day, count);
    return count;
  };
  return result.sort((a, b) =>
    savedCount(b) - savedCount(a) || a.date.localeCompare(b.date),
  );
}


/** Optional date-card focus, using only current-business saved record counts. */
export type WorkloadActivityType = "all" | "appointments" | "work" | "inspections";

/** Count the chosen category without mixing in unrelated saved records. */
export function focusedRecordedItemCount(
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
  // Keep one private accumulator per call, as for the full-week totals.
  // Retain reduce's sparse-array behavior, category focus, and inspection
  // toggle while avoiding a new result object for each day.
  return days.reduce((result, day) => {
    const saved = focusedRecordedItemCount(day, includeInspections, type);
    result.savedItems += saved;
    result.matchingDays += Number(saved > 0);
    result.daysInWindow += 1;
    return result;
  }, { savedItems: 0, matchingDays: 0, daysInWindow: 0 });
}


/**
 * First business-local day with a positive count of the selected SAVED
 * activity category. Use dates, not UI display ordering or activity volume.
 * Appointments, unfinished due work and enabled inspections are distinct.
 * Never infer booking availability, staffing, urgency or capacity.
 */
export function earliestFocusedActivityDay(
  days: readonly DailyWorkload[],
  includeInspections: boolean,
  type: WorkloadActivityType,
): { date: string; matchingItems: number } | null {
  let first: { date: string; matchingItems: number } | null = null;
  for (const day of days) {
    const count = focusedRecordedItemCount(day, includeInspections, type);
    if (count <= 0) continue;
    if (first === null || day.date < first.date) {
      first = { date: day.date, matchingItems: count };
    }
  }
  return first;
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


/**
 * Name the weekday of a saved business-local YYYY-MM-DD date without passing
 * through UTC or the browser's/system's time zone. ISO Monday=1 ... Sunday=7.
 * This is presentation metadata only and never a staffing/availability claim.
 */
export function workloadWeekday(date: string): string {
  return [
    "Monday", "Tuesday", "Wednesday", "Thursday",
    "Friday", "Saturday", "Sunday",
  ][Temporal.PlainDate.from(date).dayOfWeek - 1];
}


/**
 * Optional calendar-day focus on the already authorized business-local
 * workload snapshot. Monday-Friday and Saturday-Sunday are only day labels,
 * never assumptions about the business's operating hours or staffing.
 */
export type WorkloadCalendarDayFilter = "all" | "weekdays" | "weekends";

export function filterWorkloadDaysByCalendarDay(
  days: readonly DailyWorkload[],
  filter: WorkloadCalendarDayFilter,
): DailyWorkload[] {
  if (filter === "all") return [...days];
  return days.filter((day) => {
    const weekday = Temporal.PlainDate.from(day.date).dayOfWeek;
    return filter === "weekdays" ? weekday <= 5 : weekday >= 6;
  });
}


/**
 * Pure saved-record count change for two non-overlapping seven-date windows.
 * Positive means more recorded items in the following window, not increased
 * workload hours, staffing needs, equipment safety or bookable capacity.
 */
export function compareSevenDayWorkloadTotals(
  current: ReturnType<typeof summarizeSevenDayWorkload>,
  following: ReturnType<typeof summarizeSevenDayWorkload>,
): { appointments: number; unfinishedWork: number; inspections: number;
  daysWithActivity: number } {
  return {
    appointments: following.appointments - current.appointments,
    unfinishedWork: following.unfinishedWork - current.unfinishedWork,
    inspections: following.inspections - current.inspections,
    daysWithActivity: following.daysWithActivity - current.daysWithActivity,
  };
}
