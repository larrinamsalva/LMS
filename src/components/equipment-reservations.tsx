import { useId, useRef, useState } from "react";
import type { WorkspaceRecord } from "../core/engine";
import {
  equipmentMappingSchema,
  mappingConfirmation,
  equipmentReservationWarning,
  reservationNeedsReview,
  type EquipmentMapping,
  type EquipmentMappingCommand,
  type EquipmentReservation,
} from "../core/equipment-reservations";
import type { EquipmentState, EquipmentCheckout } from "../core/equipment";
import {
  displayTime,
  wallToInstant,
  localTime,
  localDate,
  instant,
} from "../core/time";
import { relatedLabel } from "./schedule";
export interface EquipmentCalendarProps {
  enabled: boolean;
  mappings: EquipmentMapping[];
  history: EquipmentMapping[];
  reservations: EquipmentReservation[];
  configRevision: number;
  onMap: (input: EquipmentMappingCommand, operationId: string) => Promise<void>;
}
export function EquipmentCalendar({
  equipment,
  state,
  checkouts,
  records,
  calendar,
  zone,
  canManage,
  busy,
}: {
  equipment: WorkspaceRecord;
  state: EquipmentState;
  checkouts: EquipmentCheckout[];
  records: WorkspaceRecord[];
  calendar: EquipmentCalendarProps;
  zone: string;
  canManage: boolean;
  busy: boolean;
}) {
  const id = useId(),
    command = useRef<{ text: string; id: string } | null>(null);
  const [selected, setSelected] = useState(""),
    [notes, setNotes] = useState(""),
    [confirmed, setConfirmed] = useState(false),
    [error, setError] = useState("");
  const [start, setStart] = useState(() =>
      localTime(
        new Date(Math.floor(Date.now() / 60000) * 60000).toISOString(),
        zone,
      ),
    ),
    [end, setEnd] = useState(() =>
      localTime(
        new Date(
          Math.floor(Date.now() / 60000) * 60000 + 3600000,
        ).toISOString(),
        zone,
      ),
    ),
    [occurrence, setOccurrence] = useState<"reject" | "earlier" | "later">(
      "reject",
    );
  const mapping = calendar.mappings.find(
      (m) => m.equipment_id === equipment.id,
    ),
    resource = records.find(
      (r) => r.id === (mapping?.active ? mapping.resource_id : selected),
    );
  const versions = calendar.reservations.filter(
    (r) => r.equipment_id === equipment.id,
  );
  const bookings = records.filter(
    (r) =>
      r.entity === "appointments" &&
      versions.some(
        (v) =>
          v.appointment_id === r.id && v.appointment_revision === r.revision,
      ),
  );
  let period =
    "Choose a valid period; repeated local times need an explicit occurrence.";
  try {
    const a = instant(wallToInstant(start, zone, occurrence)),
      b = instant(wallToInstant(end, zone, occurrence));
    if (b.epochNanoseconds <= a.epochNanoseconds) throw Error();
    const conflicts = records.filter(
      (r) =>
        r.entity === "appointments" &&
        !r.archived &&
        r.data.status !== "Cancelled" &&
        r.data.resource === mapping?.resource_id &&
        instant(String(r.data.start)).epochNanoseconds < b.epochNanoseconds &&
        instant(String(r.data.end)).epochNanoseconds > a.epochNanoseconds,
    );
    period = !mapping?.active
      ? "No active mapping — reservation unavailable"
      : state.condition !== "Serviceable" || state.maintenance !== "Clear"
        ? "Blocked for inspection or maintenance"
        : checkouts.some(
              (c) => c.equipment_id === equipment.id && !c.returned_at,
            )
          ? "Currently checked out — review physical return first"
          : state.next_inspection &&
              localDate(b.subtract({ nanoseconds: 1 }).toString(), zone) >=
                state.next_inspection
            ? "Inspection is due before this period completes — review service first"
            : conflicts.length
              ? `${conflicts.length} overlapping reservation(s) — choose another time`
              : "No known calendar conflict. Final database checks still apply; future collection is not guaranteed.";
  } catch {
    /* Explained by the period label; no inferred local instants. */
  }
  return (
    <section
      className="stack equipment-calendar"
      aria-label={`Calendar for ${equipment.data.name}`}
    >
      <h4>Equipment calendar</h4>
      <p>
        {mapping?.active
          ? `Mapped calendar resource: ${relatedLabel(mapping.resource_id, records)} · mapping revision ${mapping.revision}`
          : "No active physical-machine mapping"}
      </p>
      <p className="equipment-warning">
        {equipmentReservationWarning(state, checkouts, equipment.id)}
      </p>
      <p>
        One resource per appointment. A machine reservation does not reserve a
        crew or collect equipment. Checkout and return require separate reviews.
      </p>
      {calendar.enabled ? (
        <details>
          <summary>Review calendar mapping</summary>
          <form
            className="stack"
            onSubmit={async (e) => {
              e.preventDefault();
              setError("");
              try {
                if (!confirmed || !resource)
                  throw Error(
                    "Select and explicitly approve an Equipment calendar resource.",
                  );
                const req = equipmentMappingSchema.parse({
                  kind: mapping?.active ? "unmap" : "map",
                  equipmentId: equipment.id,
                  equipmentRevision: equipment.revision,
                  resourceId: resource.id,
                  resourceRevision: resource.revision,
                  mappingRevision: mapping?.revision ?? 0,
                  configRevision: calendar.configRevision,
                  acknowledgement: mappingConfirmation,
                  notes,
                });
                const text = JSON.stringify(req);
                if (command.current?.text !== text)
                  command.current = { text, id: crypto.randomUUID() };
                await calendar.onMap(req, command.current.id);
                setConfirmed(false);
                setNotes("");
              } catch (err) {
                setError(
                  err instanceof Error
                    ? err.message
                    : "Mapping refused. Reload and review.",
                );
              }
            }}
          >
            <label htmlFor={id + "resource"}>Equipment calendar resource</label>
            <select
              id={id + "resource"}
              value={mapping?.active ? mapping.resource_id : selected}
              disabled={!canManage || busy || mapping?.active}
              onChange={(e) => {
                setSelected(e.target.value);
                setConfirmed(false);
              }}
            >
              <option value="">Select an existing Equipment resource…</option>
              {records
                .filter(
                  (r) =>
                    r.entity === "resources" &&
                    !r.archived &&
                    r.data.kind === "Equipment",
                )
                .map((r) => (
                  <option key={r.id} value={r.id}>
                    {String(r.data.name)} · revision {r.revision}
                  </option>
                ))}
            </select>
            <p>
              Owner/admin approval binds this exact physical item and resource.
              Existing names alone establish no identity. Blocking bookings or
              custody prevent unmapping. Previously enrolled resources keep
              their physical identity.
            </p>
            <label htmlFor={id + "notes"}>Mapping review reason</label>
            <textarea
              id={id + "notes"}
              value={notes}
              minLength={8}
              maxLength={1000}
              required
              disabled={!canManage || busy}
              onChange={(e) => setNotes(e.target.value)}
            />
            <label className="check-label">
              <input
                type="checkbox"
                checked={confirmed}
                disabled={!canManage || busy}
                onChange={(e) => setConfirmed(e.target.checked)}
              />
              I reviewed this exact equipment, calendar resource and current
              revisions.
            </label>
            {error && <p role="alert">{error}</p>}
            <button disabled={!canManage || busy || !confirmed || !resource}>
              {mapping?.active
                ? "Confirm unmapping"
                : "Confirm equipment mapping"}
            </button>
          </form>
        </details>
      ) : (
        <p>
          Equipment calendar mapping is disabled. Retained bookings and
          historical links remain protected. Enable the optional capability
          through reviewed configuration controls.
        </p>
      )}
      <details>
        <summary>Check availability for a period</summary>
        <div className="field-grid">
          <label>
            Equipment period start
            <input
              type="datetime-local"
              value={start}
              onChange={(e) => setStart(e.target.value)}
            />
          </label>
          <label>
            Equipment period end
            <input
              type="datetime-local"
              value={end}
              onChange={(e) => setEnd(e.target.value)}
            />
          </label>
          <label>
            Equipment repeated time
            <select
              value={occurrence}
              onChange={(e) =>
                setOccurrence(e.target.value as typeof occurrence)
              }
            >
              <option value="reject">Require explicit occurrence</option>
              <option value="earlier">First occurrence</option>
              <option value="later">Second occurrence</option>
            </select>
          </label>
        </div>
        <p role="status">{period}</p>
        <p>
          Times use {zone}. Create and reschedule reservations through Schedule.
        </p>
      </details>
      <details open={bookings.length > 0}>
        <summary>
          Current, upcoming & historical reservations ({bookings.length})
        </summary>
        {bookings.map((r) => (
          <article key={r.id} className="equipment-event">
            <strong>{String(r.data.title)}</strong>
            <p>
              {String(r.data.status)}
              {r.archived ? " · Archived" : ""} · appointment revision{" "}
              {r.revision}
            </p>
            <p>
              {displayTime(String(r.data.start), zone)} →{" "}
              {displayTime(String(r.data.end), zone)}
            </p>
            <p>
              Customer: {relatedLabel(r.data.customer, records)} · Work:{" "}
              {relatedLabel(r.data.work, records)}
            </p>
            {!r.archived &&
              r.data.status !== "Cancelled" &&
              reservationNeedsReview(
                state,
                checkouts,
                equipment.id,
                String(r.data.end),
                zone,
              ) && (
                <p className="equipment-warning">
                  Safety review required — appointment retained; no cancellation
                  or notification sent.
                </p>
              )}
          </article>
        ))}
        {!bookings.length && (
          <p>
            No retained equipment reservations. Use Schedule after mapping and
            inspection.
          </p>
        )}
      </details>
      <details>
        <summary>Immutable mapping & reservation history</summary>
        {calendar.history
          .filter((m) => m.equipment_id === equipment.id)
          .map((m) => (
            <p key={m.revision}>
              Mapping revision {m.revision}: {m.active ? "Mapped" : "Unmapped"}{" "}
              · {relatedLabel(m.resource_id, records)} · equipment revision{" "}
              {m.equipment_revision}, resource revision {m.resource_revision} ·
              operator {m.actor_id}
            </p>
          ))}
        {versions.map((v) => (
          <p key={v.appointment_id + v.appointment_revision}>
            {relatedLabel(v.appointment_id, records)} · appointment revision{" "}
            {v.appointment_revision} · mapping revision {v.mapping_revision} ·{" "}
            {v.blocking
              ? "Reserved at this revision"
              : "Released at this revision"}
          </p>
        ))}
      </details>
    </section>
  );
}
