import { Temporal } from "@js-temporal/polyfill";
import type { WorkspaceRecord } from "./engine";
import { instant } from "./time";
import { previewRecurringVisitDates, type VisitFrequencyWeeks } from "./recurring-visit-preview";

type ScopedAppointment = Pick<WorkspaceRecord, "entity" | "archived" | "data">;
export type PlannedDateAppointmentStatuses = {
  date: string;
  savedAppointments: number;
  scheduled: number;
  inProgress: number;
  completed: number;
  cancelled: number;
  other: number;
};

/**
 * Counts each already-authorized, non-archived saved appointment overlapping
 * each proposed business-local date, including midnight-spanning records.
 * Breakdown statuses match the saved record verbatim; unknown retained values
 * are disclosed as "other" rather than silently counted as scheduled.
 *
 * It is read-only; these counts NEVER imply availability, resource safety,
 * capacity or booking permission. No cross-organization data is queried.
 */
export function savedAppointmentStatusesOnPlannedDates(
  dates: readonly string[],
  authorizedAppointments: readonly ScopedAppointment[],
  zone: string,
): PlannedDateAppointmentStatuses[] {
  // Parse each valid instant only once across the entire bounded preview.
  // Corrupt/zero-length intervals cannot contribute to any count.
  const intervals: { start: bigint; end: bigint; status: unknown }[] = [];
  for (const appointment of authorizedAppointments) {
    if (appointment.entity !== "appointments" || appointment.archived) continue;
    try {
      const start = instant(String(appointment.data.start)).epochNanoseconds;
      const end = instant(String(appointment.data.end)).epochNanoseconds;
      if (end > start) intervals.push({
        start, end, status: appointment.data.status,
      });
    } catch {
      // A corrupt saved record is not evidence of a valid booking interval.
    }
  }
  return dates.map((date) => {
    const day = Temporal.PlainDate.from(date);
    const start = day.toZonedDateTime(zone).epochNanoseconds;
    const end = day.add({ days: 1 }).toZonedDateTime(zone).epochNanoseconds;
    const counts: PlannedDateAppointmentStatuses = {
      date, savedAppointments: 0, scheduled: 0, inProgress: 0,
      completed: 0, cancelled: 0, other: 0,
    };
    for (const interval of intervals) {
      if (interval.start >= end || interval.end <= start) continue;
      counts.savedAppointments++;
      switch (interval.status) {
        case "Scheduled": counts.scheduled++; break;
        case "In progress": counts.inProgress++; break;
        case "Completed": counts.completed++; break;
        case "Cancelled": counts.cancelled++; break;
        default: counts.other++; break;
      }
    }
    return counts;
  });
}

/**
 * Backward-compatible total view for existing saved-count consumers.
 * Use the SAME source calculation as the status breakdown; no separate
 * exclusion policy or altered archived/cancelled/overnight semantics.
 */
export function savedAppointmentsOnPlannedDates(
  dates: readonly string[],
  authorizedAppointments: readonly ScopedAppointment[],
  zone: string,
): { date: string; savedAppointments: number }[] {
  return savedAppointmentStatusesOnPlannedDates(dates, authorizedAppointments, zone)
    .map(({ date, savedAppointments }) => ({ date, savedAppointments }));
}

/**
 * Count how many proposed calendar dates have at least one already saved,
 * non-archived appointment overlapping that date (vs none). These dates
 * are NOT confirmations of the proposed recurring visits or availability.
 *
 * Reuse the caller's already-computed, organization-scoped per-date status
 * rows instead of introducing a second record query or different policy.
 * More than one saved appointment on the same date counts as ONE date.
 */
export function savedDateCoverage(
  statuses: readonly PlannedDateAppointmentStatuses[],
): { withSaved: number; withoutSaved: number } {
  const withSaved = statuses.filter((row) => row.savedAppointments > 0).length;
  return { withSaved, withoutSaved: statuses.length - withSaved };
}

/**
 * Find the next strictly later PROPOSED calendar date with or without an
 * already saved, non-archived appointment. Input is the same ascending,
 * unique and organization-scoped per-date status series shown on Schedule.
 * No wrapping or skipping beyond the proposal; a null result disables
 * the review shortcut. This is not a search for available booking slots.
 */
export function nextProposedDateBySavedCoverage(
  statuses: readonly PlannedDateAppointmentStatuses[],
  agendaDate: string,
  kind: "with-saved" | "without-saved",
): string | null {
  return statuses.find((row) =>
    row.date > agendaDate &&
    (kind === "with-saved"
      ? row.savedAppointments > 0
      : row.savedAppointments === 0),
  )?.date ?? null;
}

/**
 * Review the latest strictly EARLIER proposed date with/without existing
 * saved records. Input is the same ascending, organization-scoped status
 * series as the forward shortcut; no wrapping, resource availability
 * checks, booking or mutation.
 */
export function previousProposedDateBySavedCoverage(
  statuses: readonly PlannedDateAppointmentStatuses[],
  agendaDate: string,
  kind: "with-saved" | "without-saved",
): string | null {
  for (let index = statuses.length - 1; index >= 0; index--) {
    const row = statuses[index];
    if (row.date < agendaDate &&
      (kind === "with-saved"
        ? row.savedAppointments > 0
        : row.savedAppointments === 0)) {
      return row.date;
    }
  }
  return null;
}

/**
 * Number of distinct proposed dates whose ONLY existing, non-archived
 * saved appointments have the exact retained "Cancelled" status.
 * A zero-record date does not qualify; nor does one containing any other
 * status (Scheduled, In progress, Completed, or unknown Other).
 *
 * The shared date/status calculation already applies organization scope,
 * archival rules, local-midnight overlap and interval validation. This
 * helper reads only those existing bounded rows, never stored records
 * directly and never makes an availability or booking claim.
 */
export function cancelledOnlySavedDateCount(
  statuses: readonly PlannedDateAppointmentStatuses[],
): number {
  return cancelledOnlySavedDateList(statuses).length;
}

/**
 * List only proposed calendar dates where every non-archived,
 * already-saved appointment has status Cancelled. Empty dates
 * never qualify. Preserve the exact input order from the validated
 * business-local preview; no bookings, mutation or availability tests.
 */
export function cancelledOnlySavedDateList(
  statuses: readonly PlannedDateAppointmentStatuses[],
): string[] {
  return statuses.filter(isCancelledOnlySavedDate).map((row) => row.date);
}

/**
 * Classify a single already-authorized business-local proposed date.
 * Cancelled-only means at least one SAVED non-archived appointment
 * exists and every saved appointment on that date is Cancelled.
 * It never means available, rescheduled, or booked by this proposal.
 */
export function isCancelledOnlySavedDate(
  status: PlannedDateAppointmentStatuses,
): boolean {
  return status.savedAppointments > 0 &&
    status.cancelled === status.savedAppointments;
}

/**
 * A proposed business-local date has no overlapping, non-archived
 * saved appointment records in the current authorized organization.
 * This is a record-presence check, NEVER staff/equipment availability
 * or confirmation that the proposal has been booked.
 */
export function hasNoSavedAppointmentsOnPlannedDate(
  status: PlannedDateAppointmentStatuses,
): boolean {
  return status.savedAppointments === 0;
}

/**
 * Only proposed business-local dates with zero overlapping non-archived
 * saved appointment records. Reuse existing authorized status rows:
 * this list never certifies staff, equipment or calendar availability,
 * never creates a booking, and does not expose saved record content.
 */
export function noSavedProposedDateList(
  statuses: readonly PlannedDateAppointmentStatuses[],
): string[] {
  return statuses.filter(hasNoSavedAppointmentsOnPlannedDate)
    .map((row) => row.date);
}

/**
 * Export an UNSAVED, strictly bounded recurring-date proposal together with
 * date-level status counts already visible to the authorized organization.
 *
 * The input statuses MUST correspond exactly to the regenerated date-only
 * proposal. Only fixed headers/labels, canonical ISO dates, and validated
 * nonnegative safe integers can reach CSV cells: no saved record fields,
 * appointment times, customer/resource names, or formula injection.
 * A non-archived Cancelled record still counts as saved. An empty date
 * is not an available slot and none of these dates is booked by export.
 */
export function recurringVisitSavedStatusCsv(
  startDate: string,
  everyWeeks: VisitFrequencyWeeks,
  occurrences: number,
  statuses: readonly PlannedDateAppointmentStatuses[],
): string {
  const dates = validatedSavedDateProposal(
    startDate, everyWeeks, occurrences, statuses,
  );
  const rows = [
    "Visit,Proposed date,Existing non-archived saved appointments,Scheduled,In progress,Completed,Cancelled,Other,Saved-date classification,Note",
  ];
  statuses.forEach((row, index) => {
    const classification = savedDateClassification(row);
    rows.push([
      index + 1, dates[index], row.savedAppointments,
      row.scheduled, row.inProgress, row.completed, row.cancelled, row.other,
      classification, "Proposal only - NOT BOOKED - availability not confirmed",
    ].join(","));
  });
  return rows.join("\r\n") + "\r\n";
}


/**
 * Strictly validate status rows against the exact bounded proposal; both
 * full-CSV and single-date TXT exports use this same fail-closed guard.
 */
function validatedSavedDateProposal(
  startDate: string,
  everyWeeks: VisitFrequencyWeeks,
  occurrences: number,
  statuses: readonly PlannedDateAppointmentStatuses[],
): string[] {
  const dates = previewRecurringVisitDates(startDate, everyWeeks, occurrences);
  if (statuses.length !== dates.length) {
    throw new RangeError("Saved-date counts do not match this proposed recurrence.");
  }
  const columns: (keyof Omit<PlannedDateAppointmentStatuses, "date">)[] = [
    "savedAppointments", "scheduled", "inProgress", "completed",
    "cancelled", "other",
  ];
  statuses.forEach((row, index) => {
    if (row.date !== dates[index] ||
      columns.some((key) => !Number.isSafeInteger(row[key]) || row[key] < 0) ||
      row.scheduled + row.inProgress + row.completed + row.cancelled +
        row.other !== row.savedAppointments) {
      throw new RangeError("Invalid saved-date status summary for this proposal.");
    }
  });
  return dates;
}

function savedDateClassification(row: PlannedDateAppointmentStatuses): string {
  return hasNoSavedAppointmentsOnPlannedDate(row)
    ? "No saved appointment records"
    : isCancelledOnlySavedDate(row)
      ? "Cancelled-only saved records"
      : "Has non-cancelled saved records";
}

/**
 * A one-date, unsaved proposed visit review note with ONLY existing
 * date-level saved appointment count categories from the current
 * authorized business organization. Does not export raw record values,
 * customer/work names, staff/equipment, times or availability checks.
 */
export function recurringVisitReviewedSavedStatusText(
  startDate: string,
  everyWeeks: VisitFrequencyWeeks,
  occurrences: number,
  selectedDate: string,
  statuses: readonly PlannedDateAppointmentStatuses[],
): string {
  const dates = validatedSavedDateProposal(
    startDate, everyWeeks, occurrences, statuses,
  );
  const index = dates.indexOf(selectedDate);
  if (index < 0) {
    throw new RangeError("Selected calendar date is not in this proposed recurrence.");
  }
  const row = statuses[index];
  return [
    `LMS proposed visit ${index + 1} of ${dates.length} - NOT BOOKED`,
    `Reviewed date: ${selectedDate} (business-local calendar date; no appointment time)`,
    `Existing non-archived saved appointments on date: ${row.savedAppointments}`,
    `Saved statuses: Scheduled ${row.scheduled} | In progress ${row.inProgress} | Completed ${row.completed} | Cancelled ${row.cancelled} | Other ${row.other}`,
    `Saved-date classification: ${savedDateClassification(row)}`,
    "These saved records are not bookings for this proposed recurring visit.",
    "No staff, equipment, or appointment availability is confirmed.",
  ].join("\n");
}
