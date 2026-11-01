import { useState } from "react";
import { Temporal } from "@js-temporal/polyfill";
import type { WorkspaceRecord } from "../core/engine";
import type { StaffAssignment } from "../core/workforce";
import { displayTime, localDate, instant } from "../core/time";
import { relatedLabel } from "./schedule";

export function Workforce({
  records,
  assignments,
  zone,
  canManage,
  busy,
  onAdd,
  onEdit,
  onArchive,
}: {
  records: WorkspaceRecord[];
  assignments: StaffAssignment[];
  zone: string;
  canManage: boolean;
  busy: boolean;
  onAdd: (entity: string) => void;
  onEdit: (record: WorkspaceRecord) => void;
  onArchive: (record: WorkspaceRecord) => void;
}) {
  const employees = records.filter((r) => r.entity === "employees"),
    resources = records.filter((r) => r.entity === "resources"),
    memberships = records.filter((r) => r.entity === "resource-memberships"),
    windows = records.filter((r) => r.entity === "availability");
  const [date, setDate] = useState(() => {
    const first = records.find(
      (r) => r.entity === "appointments" && !r.archived,
    );
    return first
      ? localDate(String(first.data.start), zone)
      : Temporal.Now.zonedDateTimeISO(zone).toPlainDate().toString();
  });
  const [history, setHistory] = useState(false);
  const range = (r: WorkspaceRecord) =>
    `${displayTime(String(r.data.start), String(r.data.time_zone ?? zone))} → ${displayTime(String(r.data.end), String(r.data.time_zone ?? zone))}`;
  let visible: WorkspaceRecord[] = [];
  try {
    const day = Temporal.PlainDate.from(date),
      start = day.toZonedDateTime(zone).epochNanoseconds,
      end = day.add({ days: 1 }).toZonedDateTime(zone).epochNanoseconds;
    visible = windows.filter(
      (r) =>
        r.archived === history &&
        instant(String(r.data.start)).epochNanoseconds < end &&
        instant(String(r.data.end)).epochNanoseconds > start,
    );
  } catch {
    /* Incomplete date input. */
  }
  const actions = (r: WorkspaceRecord) => (
    <div className="actions">
      {!r.archived && (
        <button
          className="secondary"
          disabled={!canManage || busy}
          aria-label={`Edit ${r.data.name ?? r.data.title}`}
          onClick={() => onEdit(r)}
        >
          Edit
        </button>
      )}
      <button
        className="quiet"
        disabled={!canManage || busy}
        aria-label={`${r.archived ? "Restore" : "Archive"} ${r.data.name ?? r.data.title}`}
        onClick={() => onArchive(r)}
      >
        {r.archived ? "Restore" : "Archive"}
      </button>
    </div>
  );
  return (
    <div className="stack">
      <section className="panel" aria-labelledby="workforce-heading">
        <div className="section-heading">
          <div>
            <span className="eyebrow">People behind the work</span>
            <h2 id="workforce-heading">Crews & availability</h2>
          </div>
          <button
            disabled={!canManage || busy}
            onClick={() => onAdd("employees")}
          >
            + Add employee profile
          </button>
        </div>
        <p className="muted">
          Fictional employee profiles are separate from login accounts and
          access roles. Owners and admins manage this directory. Publish finite
          work windows before assigning people; days off and vacation take
          priority. Skills are descriptive, not certification checks.
        </p>
        <div className="workforce-grid">
          {employees
            .filter((r) => r.archived === history)
            .map((r) => (
              <article
                className="workforce-card"
                key={r.id}
                aria-label={`Employee ${r.data.name}`}
              >
                <span className="badge">
                  {String(r.data.status)}
                  {r.archived ? " · Archived" : ""}
                </span>
                <h3>{String(r.data.name)}</h3>
                <p>
                  <strong>{String(r.data.role)}</strong>
                </p>
                <p>Skills: {String(r.data.skills || "Not listed")}</p>
                {r.data.email && <p>{String(r.data.email)}</p>}
                {r.data.phone && <p>{String(r.data.phone)}</p>}
                <p className="muted">
                  Work windows:{" "}
                  {
                    windows.filter(
                      (w) =>
                        !w.archived &&
                        w.data.employee === r.id &&
                        w.data.kind === "Working hours",
                    ).length
                  }
                </p>
                {actions(r)}
              </article>
            ))}
        </div>
      </section>
      <section className="panel" aria-labelledby="crew-heading">
        <div className="section-heading">
          <h2 id="crew-heading">Resource directory</h2>
          <button
            disabled={!canManage || busy}
            onClick={() => onAdd("resource-memberships")}
          >
            + Add dated membership
          </button>
        </div>
        <p className="muted">
          One Worker resource represents one employee at a time; a Crew can
          contain several. The entire effective roster must cover each
          appointment. Enrollment persists after membership archive. Cancel or
          archive reserved work before changing its roster.
        </p>
        <div className="workforce-grid">
          {resources
            .filter((r) => r.archived === history)
            .map((r) => {
              const rows = memberships.filter((m) => m.data.resource === r.id);
              return (
                <article
                  className="workforce-card"
                  key={r.id}
                  aria-label={`Resource ${r.data.name}`}
                >
                  <span className="badge">{String(r.data.kind)}</span>
                  <h3>{String(r.data.name)}</h3>
                  <p className="muted">
                    {r.data.kind === "Equipment"
                      ? "Equipment — no employee roster"
                      : rows.length
                        ? "Enrolled — employee reservations required"
                        : "Resource-only — no employee reservations"}
                  </p>
                  <ul className="workforce-members">
                    {rows.map((m) => (
                      <li key={m.id}>
                        <strong>
                          {relatedLabel(m.data.employee, records)}
                        </strong>
                        {m.archived ? " · Membership archived" : ""}
                        <br />
                        <span>{range(m)}</span>
                        <p>{String(m.data.title)}</p>
                        {actions(m)}
                      </li>
                    ))}
                  </ul>
                  {!rows.length && <p>No dated memberships.</p>}
                </article>
              );
            })}
        </div>
      </section>
      <section className="panel" aria-labelledby="availability-heading">
        <div className="section-heading">
          <h2 id="availability-heading">Availability</h2>
          <button
            disabled={!canManage || busy}
            onClick={() => onAdd("availability")}
          >
            + Add availability period
          </button>
        </div>
        <p className="muted">
          Dates display in {zone}. Each employee needs one work window covering
          the whole appointment. Resource work windows are optional
          restrictions. Time-off periods block every overlapping instant. These
          are dated periods; weekly recurrence is deferred.
        </p>
        <div className="schedule-toolbar">
          <div>
            <label htmlFor="availability-date">Availability date</label>
            <input
              id="availability-date"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>
          <label className="check-label">
            <input
              type="checkbox"
              checked={history}
              onChange={(e) => setHistory(e.target.checked)}
            />
            Show archived workforce records
          </label>
        </div>
        <p role="status">
          {visible.length} availability periods on {date || "the selected date"}
        </p>
        <div className="workforce-grid">
          {visible.map((r) => (
            <article
              className="workforce-card"
              key={r.id}
              aria-label={String(r.data.title)}
            >
              <span className="badge">
                {String(r.data.kind)}
                {r.archived ? " · Archived" : ""}
              </span>
              <h3>{String(r.data.title)}</h3>
              <p>{relatedLabel(r.data.employee || r.data.resource, records)}</p>
              <p>{range(r)}</p>
              {r.data.notes && <p>{String(r.data.notes)}</p>}
              {actions(r)}
            </article>
          ))}
        </div>
        {!visible.length && (
          <p className="empty-state">
            No periods for this day. Employees without a covering work window
            cannot be booked.
          </p>
        )}
      </section>
      <section className="panel">
        <details>
          <summary>
            Assignment history · {assignments.length} retained employee
            allocations
          </summary>
          <p className="muted">
            Snapshots preserve names, descriptive roles and effective membership
            revisions at assignment time. Released rows remain in the database
            and workspace export.
          </p>
          <ul className="workforce-members">
            {assignments.map((s) => (
              <li
                key={`${s.appointment_id}-${s.appointment_revision}-${s.employee_id}`}
              >
                <strong>{s.employee_name}</strong> · {s.employee_role} ·{" "}
                {s.active ? "Reserved" : "Released"}
                <br />
                {relatedLabel(s.appointment_id, records)} · appointment v
                {s.appointment_revision} · membership v{s.membership_revision}
                <br />
                {displayTime(new Date(s.starts_at).toISOString(), zone)} →{" "}
                {displayTime(new Date(s.ends_at).toISOString(), zone)}
              </li>
            ))}
          </ul>
        </details>
      </section>
    </div>
  );
}
