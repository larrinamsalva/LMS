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

/**
 * Prepare ONLY the date field for a single manual appointment draft, and
 * only when it belongs to the current validated plan. No time, resource,
 * customer, work link, reservation or save operation is invented.
 */
export function plannedVisitAppointmentDraft(
  startDate: string,
  everyWeeks: VisitFrequencyWeeks,
  occurrences: number,
  selectedDate: string,
): { scheduled_date: string } {
  const dates = previewRecurringVisitDates(startDate, everyWeeks, occurrences);
  if (!dates.includes(selectedDate)) {
    throw new RangeError("Choose a date from the current recurring visit preview.");
  }
  return { scheduled_date: selectedDate };
}


/** A transient, date-only UI return route. No customer, resource, or draft data. */
export type RecurringVisitReturnPlan = {
  startDate: string;
  everyWeeks: VisitFrequencyWeeks;
  occurrences: number;
  selectedDate: string;
};

/** Validate the return route against the same bounded preview as preparation. */
export function validateRecurringVisitReturnPlan(
  plan: RecurringVisitReturnPlan,
): RecurringVisitReturnPlan {
  plannedVisitAppointmentDraft(
    plan.startDate, plan.everyWeeks, plan.occurrences, plan.selectedDate,
  );
  return { ...plan };
}

/**
 * Find the nearest proposed date STRICTLY before/after the agenda date.
 * Dates come from previewRecurringVisitDates: unique, sorted, canonical
 * YYYY-MM-DD strings. A return of null means there is no date in that
 * direction. This is agenda navigation, not availability or booking.
 */
export function adjacentPlannedVisitDate(
  plannedDates: readonly string[],
  agendaDate: string,
  direction: "previous" | "next",
): string | null {
  if (direction === "next") {
    return plannedDates.find((plannedDate) => plannedDate > agendaDate) ?? null;
  }
  for (let index = plannedDates.length - 1; index >= 0; index--) {
    if (plannedDates[index] < agendaDate) return plannedDates[index];
  }
  return null;
}

/**
 * One-based position of the currently reviewed agenda date in the
 * already-validated preview. An arbitrary agenda date is not a visit.
 * This reports UI focus, NOT saved/completed/available appointment status.
 */
export function plannedVisitReviewPosition(
  plannedDates: readonly string[], agendaDate: string,
): number | null {
  const index = plannedDates.indexOf(agendaDate);
  return index < 0 ? null : index + 1;
}

/**
 * Export an UNSAVED recurring-date preview as machine-readable CSV.
 * All variable cells come from our strict date-only generator or bounded
 * integers, so no arbitrary input/PII/formula can enter the CSV.
 * Exports do not book, reserve, or imply staff/resource availability.
 */
export function recurringVisitPreviewCsv(
  startDate: string,
  everyWeeks: VisitFrequencyWeeks,
  occurrences: number,
): string {
  const dates = previewRecurringVisitDates(startDate, everyWeeks, occurrences);
  const rows = [
    "Visit,Proposed date,Repeat every (weeks),Note",
    ...dates.map((date, index) =>
      `${index + 1},${date},${everyWeeks},Preview only - no appointment booked by export`,
    ),
  ];
  return rows.join("\r\n") + "\r\n";
}
