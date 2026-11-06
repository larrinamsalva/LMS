import { useState } from "react";
import type { WorkspaceRecord, WorkspaceSnapshot } from "../core/engine";
import { summarizeDailyOperations } from "../core/daily-operations";
import { displayTime, localDate } from "../core/time";
import { dailyPage, DAILY_OPERATIONS_PAGE_SIZE } from "../core/daily-operations-pages";
import { dailyOperationsCsv } from "../core/daily-operations-csv";
import { sevenDayOutlookCsv } from "../core/seven-day-outlook-csv";
import {
  adjacentOperationsDate,
  operationsToday,
  OPERATIONS_DATE_MIN,
  OPERATIONS_DATE_MAX,
} from "../core/daily-operations-dates";


type OverviewKind = "appointments" | "futureAppointments" | "work" | "upcoming" | "undated" | "equipment";
const initialVisible = (): Record<OverviewKind, number> => ({
  appointments: DAILY_OPERATIONS_PAGE_SIZE,
  futureAppointments: DAILY_OPERATIONS_PAGE_SIZE,
  work: DAILY_OPERATIONS_PAGE_SIZE,
  upcoming: DAILY_OPERATIONS_PAGE_SIZE,
  undated: DAILY_OPERATIONS_PAGE_SIZE,
  equipment: DAILY_OPERATIONS_PAGE_SIZE,
});

function DailyMore({
  total, requested, kind, label, onMore, onFewer,
}: {
  total: number;
  requested: number;
  kind: OverviewKind;
  label: string;
  onMore: () => void;
  onFewer: () => void;
}) {
  const page = dailyPage(total, requested);
  if (total <= DAILY_OPERATIONS_PAGE_SIZE) return null;
  return (
    <div className="daily-more" data-daily-list={kind}>
      <p className="muted" aria-live="polite">
        Showing {page.visible} of {total} {label}
      </p>
      <div className="daily-more-actions">
        {page.remaining > 0 && (
          <button type="button" className="secondary" onClick={onMore}>
            Show {page.next} more {label}
          </button>
        )}
        {page.canCollapse && (
          <button type="button" className="secondary" onClick={onFewer}>
            Show fewer {label}
          </button>
        )}
      </div>
    </div>
  );
}

export function DailyOperations({
  workspace, onSchedule, onAppointment, onWork, onEquipment,
}: {
  workspace: WorkspaceSnapshot;
  onSchedule: (selectedDate: string) => void;
  onAppointment: (record: WorkspaceRecord, selectedDate: string) => void;
  onWork: (record: WorkspaceRecord) => void;
  onEquipment: (record?: WorkspaceRecord) => void;
}) {
  const zone = workspace.config.document.timeZone ?? "UTC";
  const [date, setDate] = useState(() => localDate(new Date().toISOString(), zone));
  const [visible, setVisible] = useState(initialVisible);
  const previousDay = adjacentOperationsDate(date, -1);
  const nextDay = adjacentOperationsDate(date, 1);
  function selectDate(next: string | null) {
    if (next === null || next === date) return;
    setDate(next);
    setVisible(initialVisible());
  }
  function showMore(kind: OverviewKind, total: number) {
    setVisible((previous) => ({
      ...previous,
      [kind]: Math.min(total, previous[kind] + DAILY_OPERATIONS_PAGE_SIZE),
    }));
  }
  function showFewer(kind: OverviewKind) {
    setVisible((previous) => ({
      ...previous,
      [kind]: DAILY_OPERATIONS_PAGE_SIZE,
    }));
  }
  let summary: ReturnType<typeof summarizeDailyOperations> | null = null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    try {
      summary = summarizeDailyOperations(workspace, zone, date);
    } catch {
      // A partially entered date cannot break the entire workspace.
    }
  }
  const workItems = summary ? [...summary.overdue, ...summary.dueToday] : [];
  const equipmentEnabled = workspace.config.document.modules.some(
    (module) => module.id === "equipment",
  );
  function downloadDailyPlan() {
    // Build only from the current business's authorized in-memory summary.
    // No API calls, record mutations, or separate demo sessions are involved.
    if (!summary) return;
    const csv = dailyOperationsCsv(summary, zone, equipmentEnabled);
    const file = new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(file);
    const link = document.createElement("a");
    link.href = url;
    link.download = `lms-daily-operations-${summary.date}.csv`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function downloadSevenDayOutlook() {
    if (!summary) return;
    const csv = sevenDayOutlookCsv(summary, zone);
    const file = new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(file);
    const link = document.createElement("a");
    link.href = url;
    link.download = "lms-seven-day-outlook-" + summary.date +
      "-through-" + summary.upcomingThrough + ".csv";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
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
            type="date"
            min={OPERATIONS_DATE_MIN}
            max={OPERATIONS_DATE_MAX}
            value={date}
            onChange={(event) => selectDate(event.target.value)}
          />
        </label>
      </div>
      <div className="daily-day-controls" role="group" aria-label="Operations day shortcuts">
        <button
          className="secondary"
          type="button"
          disabled={!previousDay}
          onClick={() => selectDate(previousDay)}
          aria-label="Previous operations day"
        >
          Previous day
        </button>
        <button
          className="secondary"
          type="button"
          onClick={() => selectDate(operationsToday(zone))}
          aria-label="Today in business time zone"
        >
          Today
        </button>
        <button
          className="secondary"
          type="button"
          disabled={!nextDay}
          onClick={() => selectDate(nextDay)}
          aria-label="Next operations day"
        >
          Next day
        </button>
      </div>
      <div className="daily-export">
        <button
          className="secondary"
          type="button"
          disabled={!summary}
          onClick={downloadDailyPlan}
        >
          Download daily plan CSV
        </button>
        <button
          className="secondary"
          type="button"
          disabled={!summary}
          onClick={downloadSevenDayOutlook}
        >
          Download seven-day outlook CSV
        </button>
        <p className="muted">
          Daily plan: selected day. Seven-day outlook: upcoming appointments,
          jobs and tasks only. Includes all matching fictional records, never
          customer contact details, notes or financial data.
        </p>
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
            <div><span className="metric-label">Work needing a date</span><strong>{summary.needsScheduling.length}</strong></div>
            {equipmentEnabled && (
              <div><span className="metric-label">Equipment attention</span><strong>{summary.equipment.length}</strong></div>
            )}
          </div>
          <div className="daily-sections">
            <section aria-label="Appointments for operations date">
              <h3>Appointments</h3>
              {summary.appointments.length ? (
                <ul>
                  {summary.appointments.slice(0, dailyPage(summary.appointments.length, visible.appointments).visible).map((item) => (
                    <li key={item.id}>
                      <strong>{String(item.data.title)}</strong>
                      <span className="muted">
                        {displayTime(String(item.data.start), zone)} · {String(item.data.status)}
                      </span>
                      {workspace.config.document.modules.some((module) => module.id === "scheduling") && (
                        <button
                          type="button"
                          className="quiet"
                          aria-label={`Find appointment ${String(item.data.title)}`}
                          onClick={() => onAppointment(item, date)}
                        >
                          Find this appointment
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="muted">No non-cancelled appointments on this date.</p>
              )}
              <DailyMore
                total={summary.appointments.length}
                requested={visible.appointments}
                kind="appointments"
                label="appointments"
                onMore={() => showMore("appointments", summary.appointments.length)}
                onFewer={() => showFewer("appointments")}
              />
              {workspace.config.document.modules.some((module) => module.id === "scheduling") ? (
                <button
                  className="secondary"
                  type="button"
                  onClick={() => onSchedule(date)}
                >
                  Open Schedule for {date}
                </button>
              ) : (
                <p className="muted">Enable Scheduling in BuildPlan Studio to use the calendar.</p>
              )}
            </section>
            <section aria-label="Upcoming appointments next seven days">
              <h3>Coming up · appointments</h3>
              <p className="muted">
                Starts after {date} through {summary.upcomingThrough} ·{" "}
                {summary.upcomingAppointments.length}{" "}
                {summary.upcomingAppointments.length === 1 ? "appointment" : "appointments"}
              </p>
              {summary.upcomingAppointments.length ? (
                <ul>
                  {summary.upcomingAppointments.slice(
                    0, dailyPage(
                      summary.upcomingAppointments.length, visible.futureAppointments,
                    ).visible,
                  ).map((item) => {
                    const startDate = localDate(String(item.data.start), zone);
                    return (
                      <li key={item.id}>
                        <strong>{String(item.data.title)}</strong>
                        <span className="muted">
                          {displayTime(String(item.data.start), zone)} · {String(item.data.status)}
                        </span>
                        {workspace.config.document.modules.some(
                          (module) => module.id === "scheduling",
                        ) && (
                          <button
                            type="button"
                            className="quiet"
                            aria-label={`Find upcoming appointment ${String(item.data.title)}`}
                            onClick={() => onAppointment(item, startDate)}
                          >
                            Find this appointment
                          </button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="muted">No appointments start in the following seven days.</p>
              )}
              <DailyMore
                total={summary.upcomingAppointments.length}
                requested={visible.futureAppointments}
                kind="futureAppointments"
                label="upcoming appointments"
                onMore={() => showMore(
                  "futureAppointments", summary.upcomingAppointments.length,
                )}
                onFewer={() => showFewer("futureAppointments")}
              />
            </section>
            <section aria-label="Unfinished work due or overdue">
              <h3>Work to review</h3>
              {summary.dueToday.length + summary.overdue.length ? (
                <ul>
                  {workItems.slice(0, dailyPage(workItems.length, visible.work).visible).map(({ record, due }) => (
                    <li key={record.id}>
                      <strong>{String(record.data.title)}</strong>
                      <span className="muted">{due < date ? "Overdue" : "Due on date"} · {due}</span>
                      <button
                        type="button"
                        className="quiet"
                        aria-label={`Find ${String(record.data.title)} in ${record.entity === "jobs" ? "cleaning jobs" : "tasks"}`}
                        onClick={() => onWork(record)}
                      >
                        Find this work
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="muted">No dated unfinished work due by this date.</p>
              )}
              <DailyMore
                total={workItems.length}
                requested={visible.work}
                kind="work"
                label="work items"
                onMore={() => showMore("work", workItems.length)}
                onFewer={() => showFewer("work")}
              />
            </section>
            <section aria-label="Upcoming work next seven days">
              <h3>Coming up · next 7 days</h3>
              <p className="muted">
                After {date} through {summary.upcomingThrough} ·{" "}
                {summary.upcoming.length} unfinished{" "}
                {summary.upcoming.length === 1 ? "job or task" : "jobs or tasks"}
              </p>
              {summary.upcoming.length ? (
                <ul>
                  {summary.upcoming.slice(
                    0, dailyPage(summary.upcoming.length, visible.upcoming).visible,
                  ).map(({ record, due }) => (
                    <li key={record.id}>
                      <strong>{String(record.data.title)}</strong>
                      <span className="muted">
                        Due {due} · {String(record.data.status)}
                      </span>
                      <button
                        type="button"
                        className="quiet"
                        aria-label={`Find upcoming ${String(record.data.title)} in ${record.entity === "jobs" ? "cleaning jobs" : "tasks"}`}
                        onClick={() => onWork(record)}
                      >
                        Find this work
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="muted">
                  No dated unfinished jobs or tasks in the next seven days.
                </p>
              )}
              <DailyMore
                total={summary.upcoming.length}
                requested={visible.upcoming}
                kind="upcoming"
                label="upcoming work items"
                onMore={() => showMore("upcoming", summary.upcoming.length)}
                onFewer={() => showFewer("upcoming")}
              />
            </section>
            <section aria-label="Undated work needing scheduling">
              <h3>Needs scheduling</h3>
              <p className="muted">
                {summary.needsScheduling.length} unfinished{" "}
                {summary.needsScheduling.length === 1 ? "task or job" : "tasks or jobs"}{" "}
                without a due date. No deadline has been assumed.
              </p>
              {summary.needsScheduling.length ? (
                <ul>
                  {summary.needsScheduling.slice(
                    0, dailyPage(
                      summary.needsScheduling.length, visible.undated,
                    ).visible,
                  ).map((record) => (
                    <li key={record.id}>
                      <strong>{String(record.data.title)}</strong>
                      <span className="muted">
                        No due date · {String(record.data.status)}
                      </span>
                      <button
                        type="button"
                        className="quiet"
                        aria-label={
                          "Find undated " + String(record.data.title) +
                          " in " + (record.entity === "jobs" ? "cleaning jobs" : "tasks")
                        }
                        onClick={() => onWork(record)}
                      >
                        Find this work
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="muted">
                  No unfinished tasks or jobs missing a due date.
                </p>
              )}
              <DailyMore
                total={summary.needsScheduling.length}
                requested={visible.undated}
                kind="undated"
                label="undated work items"
                onMore={() => showMore("undated", summary.needsScheduling.length)}
                onFewer={() => showFewer("undated")}
              />
            </section>
            {equipmentEnabled && (
              <section aria-label="Equipment needing attention">
                <h3>Equipment to review</h3>
                {summary.equipment.length ? (
                  <ul>
                    {summary.equipment.slice(0, dailyPage(summary.equipment.length, visible.equipment).visible).map(({ record, reason }) => (
                      <li key={record.id}>
                        <strong>{String(record.data.name)}</strong>
                        <span className="muted">{reason}</span>
                        <button
                          type="button"
                          className="quiet"
                          aria-label={`Find equipment ${String(record.data.name)}`}
                          onClick={() => onEquipment(record)}
                        >
                          Find this equipment
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="muted">No recorded equipment condition or inspection warnings.</p>
                )}
                <DailyMore
                  total={summary.equipment.length}
                  requested={visible.equipment}
                  kind="equipment"
                  label="equipment warnings"
                  onMore={() => showMore("equipment", summary.equipment.length)}
                  onFewer={() => showFewer("equipment")}
                />
                <button className="secondary" type="button" onClick={() => onEquipment()}>
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
