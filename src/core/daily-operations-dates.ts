import { localDate, shiftDate } from "./time";

/** Date-only shortcuts, bounded to the existing Operations date input range. */
export const OPERATIONS_DATE_MIN = "2020-01-01";
export const OPERATIONS_DATE_MAX = "2100-12-31";

/**
 * Shared date-only boundary for review shortcuts and workload date cards.
 * Validate the real calendar date, not just a YYYY-MM-DD-shaped string.
 * Never infer booking availability from a reviewable date.
 */
export function isReviewableOperationsDate(date: string): boolean {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    date < OPERATIONS_DATE_MIN ||
    date > OPERATIONS_DATE_MAX
  ) return false;
  try {
    return shiftDate(date, 0) === date;
  } catch {
    return false;
  }
}

function boundedOperationsDate(date: string, days: number): string | null {
  if (!isReviewableOperationsDate(date)) return null;
  try {
    // Calendar days, not UTC +24h: leap days and DST are handled correctly.
    const next = shiftDate(date, days);
    return isReviewableOperationsDate(next) ? next : null;
  } catch {
    return null;
  }
}

/** Preserve the existing daily navigation shortcut. */
export function adjacentOperationsDate(date: string, step: -1 | 1): string | null {
  return boundedOperationsDate(date, step);
}

/** Seven-day navigation through plain local dates, not UTC-hour math. */
export function weeklyOperationsDate(date: string, step: -1 | 1): string | null {
  return boundedOperationsDate(date, step * 7);
}

/** Recomputed at click time, using the configured business time zone. */
export function operationsToday(zone: string, now = new Date().toISOString()) {
  return localDate(now, zone);
}
