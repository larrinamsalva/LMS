import { Temporal } from "@js-temporal/polyfill";

/** Deliberately week-based recurrence; four weeks is NOT a calendar month. */
export type VisitFrequencyWeeks = 1 | 2 | 4;

const EARLIEST = "2020-01-01";
const LATEST = "2100-12-31";

/**
 * Produce DATE-ONLY, unsaved planning suggestions in business-local calendar
 * arithmetic. The caller's selected date is already a business-local date.
 * No clocks, offsets, appointments, resource checks or writes are involved.
 *
 * Strictly bound the preview to 2–12 occurrences, supported intervals and
 * the existing booking date range. This is not a recurrence booking engine.
 */
export function previewRecurringVisitDates(
  startDate: string,
  everyWeeks: VisitFrequencyWeeks,
  occurrences: number,
): string[] {
  if (everyWeeks !== 1 && everyWeeks !== 2 && everyWeeks !== 4) {
    throw new RangeError("Choose weekly, every two weeks, or every four weeks.");
  }
  if (!Number.isInteger(occurrences) || occurrences < 2 || occurrences > 12) {
    throw new RangeError("Choose between 2 and 12 preview dates.");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
    throw new RangeError("Choose a complete schedule date between 2020 and 2100.");
  }
  let start: Temporal.PlainDate;
  try {
    start = Temporal.PlainDate.from(startDate, { overflow: "reject" });
  } catch {
    throw new RangeError("Choose a real calendar date between 2020 and 2100.");
  }
  if (start.toString() < EARLIEST || start.toString() > LATEST) {
    throw new RangeError("Choose a schedule date between 2020 and 2100.");
  }

  const dates: string[] = [];
  for (let index = 0; index < occurrences; index++) {
    const date = start.add({ days: index * everyWeeks * 7 }).toString();
    if (date > LATEST) {
      throw new RangeError("The planned dates must all fall on or before 2100-12-31.");
    }
    dates.push(date);
  }
  return dates;
}
