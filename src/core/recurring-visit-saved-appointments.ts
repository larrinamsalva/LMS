import { Temporal } from "@js-temporal/polyfill";
import type { WorkspaceRecord } from "./engine";
import { instant } from "./time";

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
