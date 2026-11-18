import type { AppointmentAllocation } from "../core/coordinated-scheduling";
import {
  equipmentReservationWarning,
  type EquipmentMapping,
  type EquipmentReservation,
} from "../core/equipment-reservations";
import type { EquipmentState, EquipmentCheckout } from "../core/equipment";
import { useEffect, useId, useRef, useState } from "react";
import { Temporal } from "@js-temporal/polyfill";
import type { WorkspaceRecord } from "../core/engine";
import type { StaffAssignment } from "../core/workforce";
import { displayTime, localDate, shiftDate, instant } from "../core/time";
import { previewRecurringVisitDates, plannedVisitAppointmentDraft, adjacentPlannedVisitDate, plannedVisitReviewPosition, recurringVisitPreviewCsv, recurringVisitPreviewText, recurringVisitPlanOverview, plannedVisitWeekday, type VisitFrequencyWeeks, type RecurringVisitReturnPlan } from "../core/recurring-visit-preview";
import { savedAppointmentStatusesOnPlannedDates } from "../core/recurring-visit-saved-appointments";
export function relatedLabel(value: unknown, records: WorkspaceRecord[]) {
  const r = records.find((r) => r.id === value);
  return r
    ? `${r.data.title ?? r.data.name ?? r.data.label ?? "Record"}${r.archived ? " (archived)" : ""}`
    : value
      ? "Retained link"
      : "Unassigned";
}
export function Schedule({
  records,
  allocations,
  allocationHistory,
  coordinatedEnabled,
  assignments,
  equipmentMappings,
  equipmentReservations,
  equipmentStates,
  equipmentCheckouts,
  zone,
  initialDate,
  initialRecurringPlan,
  focusedAppointmentId,
  onClearAppointmentFocus,
  canWrite,
  busy,
  onAdd,
  onPrepareAppointment,
  onEdit,
  onArchive,
}: {
  allocations: AppointmentAllocation[];
  allocationHistory: AppointmentAllocation[];
  coordinatedEnabled: boolean;
  records: WorkspaceRecord[];
  assignments: StaffAssignment[];
  equipmentMappings: EquipmentMapping[];
  equipmentReservations: EquipmentReservation[];
  equipmentStates: EquipmentState[];
  equipmentCheckouts: EquipmentCheckout[];
  zone: string;
  /** Optional business-local date chosen from Daily Operations. */
  initialDate?: string;
  /** One-time transient return context after a prepared appointment was saved or cancelled. */
  initialRecurringPlan?: RecurringVisitReturnPlan;
  /** Optional current-organization record ID from Daily Operations. */
  focusedAppointmentId?: string | null;
  onClearAppointmentFocus?: () => void;
  canWrite: boolean;
  busy: boolean;
  onAdd: () => void;
  /** Date-only handoff into the existing manually saved appointment editor. */
  onPrepareAppointment: (plan: RecurringVisitReturnPlan) => void;
  onEdit: (record: WorkspaceRecord) => void;
  onArchive: (record: WorkspaceRecord) => void;
}) {
  const appointments = records.filter((r) => r.entity === "appointments");
  const visitCountLabelId = useId();
  const recurringDetailsRef = useRef<HTMLDetailsElement>(null);
  // Open the resumed plan on entry without controlling the native details
  // open state, so keyboard/pointer users can still collapse it afterward.
  useEffect(() => {
    if (initialRecurringPlan && recurringDetailsRef.current) {
      recurringDetailsRef.current.open = true;
    }
  }, [initialRecurringPlan]);
  const [date, setDate] = useState(() => {
    // A one-time date handoff affects this calendar view only, not stored
    // appointment dates or the business's own time zone.
    if (initialDate) return initialDate;
    const first = appointments.find((r) => !r.archived);
    return first
      ? localDate(String(first.data.start), zone)
      : Temporal.Now.zonedDateTimeISO(zone).toPlainDate().toString();
  });
  // Keep the planned series fixed when reviewing one of its later dates.
  // Direct date-picker and previous/next actions explicitly re-anchor it.
  const [previewStartDate, setPreviewStartDate] = useState(
    () => initialRecurringPlan?.startDate ?? date,
  );
  const [archived, setArchived] = useState(false);
  const [previewIntervalWeeks, setPreviewIntervalWeeks] = useState<VisitFrequencyWeeks>(
    () => initialRecurringPlan?.everyWeeks ?? 1,
  );
  const [previewCount, setPreviewCount] = useState(
    () => initialRecurringPlan?.occurrences ?? 4,
  );
  // Feedback is keyed to the exact transient plan. If a rule or anchor
  // changes before or after a clipboard promise, stale "Copied" text
  // never describes the newly selected proposed dates.
  const [copyFeedback, setCopyFeedback] = useState<{
    planKey: string;
    kind: "copied" | "failed";
  } | null>(null);
  const planKey = `${previewStartDate}/${previewIntervalWeeks}/${previewCount}`;
  const visibleCopyFeedback = copyFeedback?.planKey === planKey
    ? copyFeedback.kind : null;
  let rows: WorkspaceRecord[] = [];
  try {
    const day = Temporal.PlainDate.from(date),
      start = day.toZonedDateTime(zone).epochNanoseconds,
      end = day.add({ days: 1 }).toZonedDateTime(zone).epochNanoseconds;
    rows = appointments
      .filter(
        (r) =>
          r.archived === archived &&
          (!focusedAppointmentId || r.id === focusedAppointmentId) &&
          instant(String(r.data.start)).epochNanoseconds < end &&
          instant(String(r.data.end)).epochNanoseconds > start,
      )
      .sort((a, b) =>
        Temporal.Instant.compare(
          instant(String(a.data.start)),
          instant(String(b.data.start)),
        ),
      );
  } catch {
    /* An incomplete date input has no results. */
  }
  // A local-only recurrence sketch follows the current Schedule date.
  // It never calls onAdd/onEdit or checks/confirms resource availability.
  let plannedVisitDates: string[] = [];
  let savedCountByPlannedDate: ReturnType<typeof savedAppointmentStatusesOnPlannedDates> = [];
  let planOverview: ReturnType<typeof recurringVisitPlanOverview> | null = null;
  let previewError = "";
  try {
    plannedVisitDates = previewRecurringVisitDates(
      previewStartDate, previewIntervalWeeks, previewCount,
    );
    savedCountByPlannedDate = savedAppointmentStatusesOnPlannedDates(
      plannedVisitDates, appointments, zone,
    );
    planOverview = recurringVisitPlanOverview(
      previewStartDate, previewIntervalWeeks, previewCount,
    );
  } catch (error) {
    previewError = error instanceof Error ? error.message : "Choose a valid schedule date.";
  }
  const reviewedVisitPosition = plannedVisitReviewPosition(plannedVisitDates, date);
  const previousPlannedDate = adjacentPlannedVisitDate(plannedVisitDates, date, "previous");
  const nextPlannedDate = adjacentPlannedVisitDate(plannedVisitDates, date, "next");
  function reviewPlannedDate(selected: string) {
    // Review is intentionally read-only. Navigating between proposed
    // dates never re-anchors the recurrence or reserves any resource.
    onClearAppointmentFocus?.();
    setArchived(false);
    setDate(selected);
  }
  async function copyPlannedDates() {
    const selectedPlanKey = planKey;
    try {
      // Revalidate the exact bounded proposal on click. Never copy
      // persisted appointments or arbitrary user-entered record fields.
      const text = recurringVisitPreviewText(
        previewStartDate, previewIntervalWeeks, previewCount,
      );
      if (!navigator.clipboard?.writeText) {
        throw new Error("Clipboard is unavailable.");
      }
      await navigator.clipboard.writeText(text);
      setCopyFeedback({ planKey: selectedPlanKey, kind: "copied" });
    } catch {
      // No false success on denied permission, insecure origins, or
      // unsupported clipboard APIs. CSV download remains available.
      setCopyFeedback({ planKey: selectedPlanKey, kind: "failed" });
    }
  }
  function downloadPlannedDatesCsv() {
    // Regenerate the current bounded date-only series at click time; never
    // read customer, work, resource or appointment records for this export.
    const csv = recurringVisitPreviewCsv(
      previewStartDate, previewIntervalWeeks, previewCount,
    );
    const blobUrl = URL.createObjectURL(
      new Blob([csv], { type: "text/csv;charset=utf-8" }),
    );
    const link = document.createElement("a");
    link.href = blobUrl;
    link.download = `lms-visit-preview-${previewStartDate}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
  }
  return (
    <section className="panel" aria-labelledby="schedule-heading">
      <div className="section-heading">
        <div>
          <span className="eyebrow">Appointments & resources</span>
          <h2 id="schedule-heading">Schedule</h2>
        </div>
        <button disabled={!canWrite || busy} onClick={onAdd}>
          + Add appointment
        </button>
      </div>
      <p className="muted">
        Display time zone: <strong>{zone}</strong>. Booking instants stay fixed
        when the business zone changes. Cancelled or archived appointments
        release their resource; completed work keeps its historical reservation.
      </p>
      <p className="muted">
        {coordinatedEnabled
          ? "An appointment can explicitly reserve one Crew/Worker and one optional mapped machine for exactly the same interval. Both must pass the final database checks."
          : "One resource per appointment: selecting equipment reserves that machine, not an employee or crew. Enable Crew + equipment appointments deliberately to coordinate both."}{" "}
        Equipment must be explicitly mapped; collection requires a separate
        checkout review.
      </p>
      {focusedAppointmentId && (
        <div className="record-focus" role="status">
          <span>Showing the exact appointment selected in Daily Operations.</span>
          <button
            className="secondary"
            type="button"
            onClick={onClearAppointmentFocus}
          >
            Show all appointments
          </button>
        </div>
      )}
      <div className="schedule-toolbar">
        <button
          className="secondary"
          disabled={!date || busy}
          onClick={() => {
            onClearAppointmentFocus?.();
            const prior = shiftDate(date, -1);
            setDate(prior);
            setPreviewStartDate(prior);
          }}
        >
          Previous day
        </button>
        <div>
          <label htmlFor="schedule-date">Schedule date</label>
          <input
            id="schedule-date"
            type="date"
            value={date}
            onChange={(e) => {
              onClearAppointmentFocus?.();
              setDate(e.target.value);
              setPreviewStartDate(e.target.value);
            }}
          />
        </div>
        <button
          className="secondary"
          disabled={!date || busy}
          onClick={() => {
            onClearAppointmentFocus?.();
            const following = shiftDate(date, 1);
            setDate(following);
            setPreviewStartDate(following);
          }}
        >
          Next day
        </button>
        <label className="check-label">
          <input
            type="checkbox"
            checked={archived}
            onChange={(e) => {
              onClearAppointmentFocus?.();
              setArchived(e.target.checked);
            }}
          />
          Show archived appointments
        </label>
      </div>
      <section className="recurring-visit-planner" role="region" aria-label="Repeating visit planner">
        <details ref={recurringDetailsRef}>
          <summary>Preview repeating visit dates (no bookings)</summary>
          {initialRecurringPlan && (
            <p role="status" className="recurring-visit-return">
              Back to your unsaved recurring visit plan. You can review or
              prepare another date. Nothing is automatically booked.
            </p>
          )}
          <p className="muted">
            Plan dates for recurring cleaning or maintenance using the Schedule
            date above as the first visit. This preview uses business-local
            calendar dates in <strong>{zone}</strong>, without times or resources.
            Reviewing a preview date only navigates the agenda; the planned
            series stays anchored until you change the Schedule date directly
            or use Previous day or Next day.
          </p>
          <div className="recurring-visit-controls">
            <label>
              Repeat visits
              <select
                aria-label="Repeat visits"
                value={previewIntervalWeeks}
                onChange={(event) =>
                  setPreviewIntervalWeeks(Number(event.target.value) as VisitFrequencyWeeks)}
              >
                <option value={1}>Every week</option>
                <option value={2}>Every two weeks</option>
                <option value={4}>Every four weeks (not monthly)</option>
              </select>
            </label>
            <label>
              Number of preview visits
              <select
                aria-label="Number of preview visits"
                value={previewCount}
                onChange={(event) => setPreviewCount(Number(event.target.value))}
              >
                {[2, 4, 6, 8, 12].map((count) => (
                  <option key={count} value={count}>{count} dates</option>
                ))}
              </select>
            </label>
          </div>
          {previewError ? (
            <p role="status">{previewError}</p>
          ) : (
            <>
              <p className="muted" aria-live="polite">
                Previewing {plannedVisitDates.length} visit dates starting on{" "}
                {plannedVisitDates[0]}.
              </p>
              {planOverview && (
                <section
                  className="recurring-visit-overview"
                  aria-label="Proposed visit overview"
                >
                  <h3>Plan at a glance — proposed only</h3>
                  <dl>
                    <div>
                      <dt>Proposed visits</dt>
                      <dd>{planOverview.proposedVisits}</dd>
                    </div>
                    <div>
                      <dt>Weekday dates</dt>
                      <dd>{planOverview.weekdayDates}</dd>
                    </div>
                    <div>
                      <dt>Weekend dates</dt>
                      <dd>{planOverview.weekendDates}</dd>
                    </div>
                    <div>
                      <dt>First proposed date</dt>
                      <dd>
                        {plannedVisitWeekday(planOverview.firstDate).weekday}{" "}
                        <time dateTime={planOverview.firstDate}>{planOverview.firstDate}</time>
                      </dd>
                    </div>
                    <div>
                      <dt>Last proposed date</dt>
                      <dd>
                        {plannedVisitWeekday(planOverview.lastDate).weekday}{" "}
                        <time dateTime={planOverview.lastDate}>{planOverview.lastDate}</time>
                      </dd>
                    </div>
                    <div>
                      <dt>First-to-last span</dt>
                      <dd>{planOverview.spanWeeks} calendar weeks</dd>
                    </div>
                  </dl>
                  <p>
                    This is a date-only proposal, not a count of booked
                    appointments. Weekend labels do not establish staffing
                    or availability.
                  </p>
                </section>
              )}
              <p className="muted">
                Counts show saved non-archived appointments on each calendar
                date, including cancelled and completed records and visits
                spanning midnight. Status counts explain the saved records;
                zero or cancelled counts never confirm staff or resource availability.
              </p>
              <div className="recurring-visit-export">
                <button
                  type="button"
                  className="secondary"
                  disabled={busy}
                  onClick={downloadPlannedDatesCsv}
                >
                  Download planned dates CSV
                </button>
                <button
                  type="button"
                  className="secondary"
                  disabled={busy}
                  onClick={() => void copyPlannedDates()}
                >
                  Copy planned dates
                </button>
                <p className="muted">
                  Download a CSV or copy a plain-text proposal with dates and
                  weekdays. Neither action creates bookings, includes customer
                  details, or confirms resource availability.
                </p>
              </div>
              {visibleCopyFeedback && (
                <p className="recurring-visit-copy-feedback" role="status">
                  {visibleCopyFeedback === "copied"
                    ? "Proposed dates copied. Nothing was booked or reserved."
                    : "Could not copy dates. Clipboard access may be blocked; use Download planned dates CSV instead."}
                </p>
              )}
              <p className="recurring-visit-review-state" aria-live="polite">
                {reviewedVisitPosition === null
                  ? "Agenda date is not one of the proposed visit dates. Use the navigation buttons to review a planned visit."
                  : "Currently reviewing planned visit " + reviewedVisitPosition +
                    " of " + plannedVisitDates.length + ": " + date +
                    ". This is a calendar view, not a booking confirmation."}
              </p>
              <div className="recurring-visit-navigation" aria-label="Navigate planned visit dates">
                <p className="muted">
                  Agenda date: <time dateTime={date}>{date}</time>. Move through
                  proposed dates without changing the plan or booking a visit.
                </p>
                <div className="recurring-visit-navigation-actions">
                  <button
                    type="button"
                    className="secondary"
                    disabled={busy || !previousPlannedDate}
                    onClick={() => {
                      if (previousPlannedDate) reviewPlannedDate(previousPlannedDate);
                    }}
                  >
                    Previous planned visit
                  </button>
                  <button
                    type="button"
                    className="secondary"
                    disabled={busy || !nextPlannedDate}
                    onClick={() => {
                      if (nextPlannedDate) reviewPlannedDate(nextPlannedDate);
                    }}
                  >
                    Next planned visit
                  </button>
                </div>
              </div>
              <ol className="recurring-visit-dates" aria-label="Planned visit dates">
                {plannedVisitDates.map((visitDate, index) => (
                  <li
                    key={visitDate}
                    className={visitDate === date ? "recurring-visit-is-reviewed" : undefined}
                    aria-current={visitDate === date ? "date" : undefined}
                  >
                    <span className="recurring-visit-date-text">
                      Visit {index + 1}: <time dateTime={visitDate}>{visitDate}</time>
                    </span>
                    <span className="recurring-visit-weekday">
                      {plannedVisitWeekday(visitDate).weekday}
                      {plannedVisitWeekday(visitDate).isWeekend && (
                        <> · Weekend — verify staffing before booking</>
                      )}
                    </span>
                    {visitDate === date && (
                      <span className="recurring-visit-current-label">
                        Currently reviewing
                      </span>
                    )}
                    <span
                      id={visitCountLabelId + "-" + index}
                      className="recurring-visit-saved-count"
                    >
                      Already saved: {savedCountByPlannedDate[index].savedAppointments}{" "}
                      non-archived {savedCountByPlannedDate[index].savedAppointments === 1
                        ? "appointment" : "appointments"}
                    </span>
                    <span
                      id={visitCountLabelId + "-status-" + index}
                      className="recurring-visit-status-counts"
                    >
                      Saved statuses: Scheduled {savedCountByPlannedDate[index].scheduled}
                      {" · "}In progress {savedCountByPlannedDate[index].inProgress}
                      {" · "}Completed {savedCountByPlannedDate[index].completed}
                      {" · "}Cancelled {savedCountByPlannedDate[index].cancelled}
                      {savedCountByPlannedDate[index].other > 0 && (
                        <>{" · "}Other {savedCountByPlannedDate[index].other}</>
                      )}
                    </span>
                    <button
                      type="button"
                      className="secondary"
                      disabled={busy}
                      aria-label={"Review planned visit " + (index + 1) + " on " + visitDate}
                      aria-describedby={visitCountLabelId + "-" + index +
                        " " + visitCountLabelId + "-status-" + index}
                      onClick={() => reviewPlannedDate(visitDate)}
                    >
                      Review {visitDate}
                    </button>
                    <button
                      type="button"
                      className="secondary"
                      disabled={!canWrite || busy}
                      aria-label={"Prepare appointment for planned visit " + (index + 1) + " on " + visitDate}
                      aria-describedby={visitCountLabelId + "-" + index +
                        " " + visitCountLabelId + "-status-" + index}
                      onClick={() => {
                        // Recheck membership in the current validated series.
                        // This passes only one date; booking still uses the
                        // ordinary required fields and final conflict checks.
                        const dateOnly = plannedVisitAppointmentDraft(
                          previewStartDate, previewIntervalWeeks,
                          previewCount, visitDate,
                        ).scheduled_date;
                        onPrepareAppointment({
                          startDate: previewStartDate,
                          everyWeeks: previewIntervalWeeks,
                          occurrences: previewCount,
                          selectedDate: dateOnly,
                        });
                      }}
                    >
                      Prepare appointment
                    </button>
                  </li>
                ))}
              </ol>
            </>
          )}
          <p className="recurring-visit-warning">
            Preview only — no appointments are created, reserved or checked for
            conflicts, staff availability, equipment readiness or booking slots.
            Choose Prepare appointment to carry a selected date into the
            normal manual appointment form. You must still choose exact
            times, customer, work and resources and save each appointment
            separately with existing authorization and conflict checks.
          </p>
        </details>
      </section>
      <p role="status">
        {rows.length} {rows.length === 1 ? "appointment" : "appointments"} on{" "}
        {date || "the selected date"}
      </p>
      <div className="schedule-list">
        {rows.map((r) => (
          <article
            className="schedule-card"
            key={r.id}
            aria-label={String(r.data.title)}
          >
            <div>
              <span className="badge">
                {String(r.data.status)}
                {r.archived ? " · Archived" : ""}
              </span>
              <h3>{String(r.data.title)}</h3>
              <p>
                <time dateTime={String(r.data.start)}>
                  {displayTime(String(r.data.start), zone)}
                </time>{" "}
                →{" "}
                <time dateTime={String(r.data.end)}>
                  {displayTime(String(r.data.end), zone)}
                </time>
              </p>
            </div>
            <dl>
              <div>
                <dt>Customer</dt>
                <dd>{relatedLabel(r.data.customer, records)}</dd>
              </div>
              <div>
                <dt>Work</dt>
                <dd>{relatedLabel(r.data.work, records)}</dd>
              </div>
              <div>
                <dt>Resource</dt>
                <dd>{relatedLabel(r.data.resource, records)}</dd>
              </div>
              <div>
                <dt>Employee reservation</dt>
                <dd>
                  {assignments
                    .filter((s) => s.appointment_id === r.id && s.active)
                    .map((s) => s.employee_name)
                    .join(", ") ||
                    "No active employee allocation (resource-only or released)"}
                </dd>
              </div>
              {r.data.site && (
                <div>
                  <dt>Site</dt>
                  <dd>{relatedLabel(r.data.site, records)}</dd>
                </div>
              )}
            </dl>
            {[
              ...new Set([
                ...equipmentMappings
                  .filter((m) => m.active && m.resource_id === r.data.resource)
                  .map((m) => m.equipment_id),
                ...equipmentReservations
                  .filter(
                    (v) =>
                      v.appointment_id === r.id &&
                      v.appointment_revision === r.revision,
                  )
                  .map((v) => v.equipment_id),
              ]),
            ].map((equipmentId) => (
              <p key={equipmentId} className="equipment-warning">
                Physical equipment:{" "}
                <strong>{relatedLabel(equipmentId, records)}</strong> ·{" "}
                {equipmentReservationWarning(
                  equipmentStates.find((s) => s.record_id === equipmentId),
                  equipmentCheckouts,
                  equipmentId,
                )}
              </p>
            ))}
            {allocations
              .filter(
                (a) =>
                  a.appointment_id === r.id &&
                  a.slot === "Equipment" &&
                  a.present,
              )
              .map((a) => (
                <p key={a.slot}>
                  <strong>Additional equipment:</strong> {a.resource_name} ·
                  physical {relatedLabel(a.equipment_id, records)} · permanent
                  ID {a.equipment_asset_id} · mapping revision{" "}
                  {a.mapping_revision}.{" "}
                  {a.blocking
                    ? "Reserved with primary for this interval"
                    : "Released; history retained"}
                  .
                </p>
              ))}
            <details>
              <summary>Resource allocation history</summary>
              {allocationHistory
                .filter((a) => a.appointment_id === r.id)
                .map((a) => (
                  <p key={a.appointment_revision + a.slot}>
                    Appointment revision {a.appointment_revision} · {a.slot}:{" "}
                    {a.resource_name} ({a.resource_kind})
                    {a.equipment_asset_id ? " / " + a.equipment_asset_id : ""} ·
                    resource revision {a.resource_revision} ·{" "}
                    {displayTime(new Date(a.starts_at).toISOString(), zone)} →{" "}
                    {displayTime(new Date(a.ends_at).toISOString(), zone)} ·{" "}
                    {a.present
                      ? a.blocking
                        ? "Reserved at this revision"
                        : "Released at this revision"
                      : "Removed by explicit review"}{" "}
                    · {a.origin}
                  </p>
                ))}
            </details>
            {r.data.notes && <p>{String(r.data.notes)}</p>}
            <div className="actions">
              {!r.archived && (
                <button
                  className="secondary"
                  disabled={!canWrite || busy}
                  onClick={() => onEdit(r)}
                  aria-label={`Edit ${r.data.title}`}
                >
                  Edit / reschedule
                </button>
              )}
              <button
                className="quiet"
                disabled={!canWrite || busy}
                onClick={() => onArchive(r)}
                aria-label={`${r.archived ? "Restore" : "Archive"} ${r.data.title}`}
              >
                {r.archived ? "Restore" : "Archive"}
              </button>
            </div>
          </article>
        ))}
      </div>
      {!rows.length && (
        <p className="empty-state">
          No appointments for this day. Choose another date or add an
          appointment.
        </p>
      )}
    </section>
  );
}
