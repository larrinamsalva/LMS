import type { AppointmentAllocation } from "../core/coordinated-scheduling";
import {
  equipmentReservationWarning,
  type EquipmentMapping,
  type EquipmentReservation,
} from "../core/equipment-reservations";
import type { EquipmentState, EquipmentCheckout } from "../core/equipment";
import { useState } from "react";
import { Temporal } from "@js-temporal/polyfill";
import type { WorkspaceRecord } from "../core/engine";
import type { StaffAssignment } from "../core/workforce";
import { displayTime, localDate, shiftDate, instant } from "../core/time";
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
  canWrite,
  busy,
  onAdd,
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
  canWrite: boolean;
  busy: boolean;
  onAdd: () => void;
  onEdit: (record: WorkspaceRecord) => void;
  onArchive: (record: WorkspaceRecord) => void;
}) {
  const appointments = records.filter((r) => r.entity === "appointments");
  const [date, setDate] = useState(() => {
    // A one-time date handoff affects this calendar view only, not stored
    // appointment dates or the business's own time zone.
    if (initialDate) return initialDate;
    const first = appointments.find((r) => !r.archived);
    return first
      ? localDate(String(first.data.start), zone)
      : Temporal.Now.zonedDateTimeISO(zone).toPlainDate().toString();
  });
  const [archived, setArchived] = useState(false);
  let rows: WorkspaceRecord[] = [];
  try {
    const day = Temporal.PlainDate.from(date),
      start = day.toZonedDateTime(zone).epochNanoseconds,
      end = day.add({ days: 1 }).toZonedDateTime(zone).epochNanoseconds;
    rows = appointments
      .filter(
        (r) =>
          r.archived === archived &&
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
      <div className="schedule-toolbar">
        <button
          className="secondary"
          disabled={!date || busy}
          onClick={() => setDate(shiftDate(date, -1))}
        >
          Previous day
        </button>
        <div>
          <label htmlFor="schedule-date">Schedule date</label>
          <input
            id="schedule-date"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </div>
        <button
          className="secondary"
          disabled={!date || busy}
          onClick={() => setDate(shiftDate(date, 1))}
        >
          Next day
        </button>
        <label className="check-label">
          <input
            type="checkbox"
            checked={archived}
            onChange={(e) => setArchived(e.target.checked)}
          />
          Show archived appointments
        </label>
      </div>
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
