import { localDate, shiftDate } from "./time";

/** Date-only shortcuts, bounded to the existing Operations date input range. */
export const OPERATIONS_DATE_MIN = "2020-01-01";
export const OPERATIONS_DATE_MAX = "2100-12-31";

export function adjacentOperationsDate(
  date: string,
  step: -1 | 1,
): string | null {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    date < OPERATIONS_DATE_MIN ||
    date > OPERATIONS_DATE_MAX
  ) return null;
  try {
    // Calendar days, not UTC +24h: leap days and DST are handled correctly.
    const next = shiftDate(date, step);
    return next >= OPERATIONS_DATE_MIN && next <= OPERATIONS_DATE_MAX
      ? next
      : null;
  } catch {
    return null;
  }
}

/** Recomputed at click time, using the configured business time zone. */
export function operationsToday(zone: string, now = new Date().toISOString()) {
  return localDate(now, zone);
}
