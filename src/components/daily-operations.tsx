import { useState } from "react";
import type { WorkspaceSnapshot } from "../core/engine";
import { summarizeDailyOperations } from "../core/daily-operations";
import { displayTime, localDate } from "../core/time";

export function DailyOperations({
  workspace, onSchedule, onWork, onEquipment,
}: {
  workspace: WorkspaceSnapshot;
  onSchedule: () => void;
  onWork: (entity: "tasks" | "jobs") => void;
  onEquipment: () => void;
}) {
  const zone = workspace.config.document.timeZone ?? "UTC";
  const [date, setDate] = useState(() => localDate(new Date().toISOString(), zone));
  let summary: ReturnType<typeof summarizeDailyOperations> | null = null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    try {
      summary = summarizeDailyOperations(workspace, zone, date);
    } catch {
      // A partially entered date cannot break the entire workspace.
    }
  }
  const equipmentEnabled = workspace.config.document.modules.some(
    (module) => module.id === "equipment",
  );
  return (
    <section className="panel daily-operations" aria-label="Daily operations">
      <div className="section-heading daily-heading">
        <div>
          <span className="eyebrow">Read-only business snapshot</span>
          <h2>Daily operations</h2>
        </div>
        <label className="daily-date">
          Operations date
          <input
            type="date" min="2020-01-01" max="2100-12-31"
            value={date} onChange={(event) => setDate(event.target.value)}
          />
        </label>
      </div>
      <p className="muted">
        Times and due dates use the business time zone ({zone}). Counts reflect
        saved records only—not live staff availability or automatic reminders.
      </p>
      {!summary ? (
        <p role="status">Choose a valid operations date.</p>
      ) : (
        <>
          <div className="daily-metrics">
            <div><span className="metric-label">Appointments on date</span><strong>{summary.appointments.length}</strong></div>
            <div><span className="metric-label">Work due on date</span><strong>{summary.dueToday.length}</strong></div>
            <div><span className="metric-label">Overdue unfinished work</span><strong>{summary.overdue.length}</strong></div>
            {equipmentEnabled && (
              <div><span className="metric-label">Equipment attention</span><strong>{summary.equipment.length}</strong></div>
            )}
          </div>
          <div className="daily-sections">
            <section aria-label="Appointments for operations date">
              <h3>Appointments</h3>
              {summary.appointments.length ? (
                <ul>
                  {summary.appointments.slice(0, 4).map((item) => (
                    <li key={item.id}>
                      <strong>{String(item.data.title)}</strong>
                      <span className="muted">
                        {displayTime(String(item.data.start), zone)} · {String(item.data.status)}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="muted">No non-cancelled appointments on this date.</p>
              )}
              <button className="secondary" type="button" onClick={onSchedule}>Open Schedule</button>
            </section>
            <section aria-label="Unfinished work due or overdue">
              <h3>Work to review</h3>
              {summary.dueToday.length + summary.overdue.length ? (
                <ul>
                  {[...summary.overdue, ...summary.dueToday].slice(0, 4).map(({ record, due }) => (
                    <li key={record.id}>
                      <strong>{String(record.data.title)}</strong>
                      <span className="muted">{due < date ? "Overdue" : "Due on date"} · {due}</span>
                      <button
                        type="button" className="quiet"
                        onClick={() => onWork(record.entity as "jobs" | "tasks")}
                      >
                        Open {record.entity === "jobs" ? "cleaning jobs" : "tasks"}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="muted">No dated unfinished work due by this date.</p>
              )}
            </section>
            {equipmentEnabled && (
              <section aria-label="Equipment needing attention">
                <h3>Equipment to review</h3>
                {summary.equipment.length ? (
                  <ul>
                    {summary.equipment.slice(0, 4).map(({ record, reason }) => (
                      <li key={record.id}>
                        <strong>{String(record.data.name)}</strong>
                        <span className="muted">{reason}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="muted">No recorded equipment condition or inspection warnings.</p>
                )}
                <button className="secondary" type="button" onClick={onEquipment}>
                  Open Equipment &amp; Tools
                </button>
              </section>
            )}
          </div>
        </>
      )}
    </section>
  );
}
