import { useState } from "react";
import type { WorkspaceRecord, WorkspaceSnapshot } from "../core/engine";
import { summarizeDailyOperations } from "../core/daily-operations";
import {
  sevenDayWorkload, summarizeSevenDayWorkload, visibleWorkloadDays,
  busiestRecordedDay, orderWorkloadDays, filterWorkloadDaysByType,
  summarizeFocusedWorkload, busiestFocusedDay, focusedRecordedItemCount,
  workloadWeekday, filterWorkloadDaysByCalendarDay, compareSevenDayWorkloadTotals,
  type WorkloadActivityType, type WorkloadCalendarDayFilter,
} from "../core/daily-operations-workload";
import { displayTime, localDate } from "../core/time";
import { dailyPage, DAILY_OPERATIONS_PAGE_SIZE } from "../core/daily-operations-pages";
import { dailyOperationsCsv } from "../core/daily-operations-csv";
import { sevenDayOutlookCsv } from "../core/seven-day-outlook-csv";
import { sevenDayWorkloadCsv, visibleWorkloadCsv } from "../core/seven-day-workload-csv";
import { sevenDayComparisonCsv } from "../core/seven-day-comparison-csv";
import { needsSchedulingCsv } from "../core/needs-scheduling-csv";
import { upcomingInspectionsCsv } from "../core/upcoming-equipment-inspections-csv";
import {
  adjacentOperationsDate,
  weeklyOperationsDate,
  operationsToday,
  OPERATIONS_DATE_MIN,
  OPERATIONS_DATE_MAX,
} from "../core/daily-operations-dates";


type OverviewKind = "appointments" | "futureAppointments" | "work" | "upcoming" | "undated" | "equipment" | "inspections";
const initialVisible = (): Record<OverviewKind, number> => ({
  appointments: DAILY_OPERATIONS_PAGE_SIZE,
  futureAppointments: DAILY_OPERATIONS_PAGE_SIZE,
  work: DAILY_OPERATIONS_PAGE_SIZE,
  upcoming: DAILY_OPERATIONS_PAGE_SIZE,
  undated: DAILY_OPERATIONS_PAGE_SIZE,
  equipment: DAILY_OPERATIONS_PAGE_SIZE,
  inspections: DAILY_OPERATIONS_PAGE_SIZE,
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
  const [activityOnly, setActivityOnly] = useState(false);
  const [sortByActivity, setSortByActivity] = useState(false);
  const [comparisonDirection, setComparisonDirection] =
    useState<"none" | "previous" | "following">("none");
  const [activityType, setActivityType] = useState<WorkloadActivityType>("all");
  const [calendarDayFilter, setCalendarDayFilter] =
    useState<WorkloadCalendarDayFilter>("all");
  const previousDay = adjacentOperationsDate(date, -1);
  const nextDay = adjacentOperationsDate(date, 1);
  const previousWeek = weeklyOperationsDate(date, -1);
  const nextWeek = weeklyOperationsDate(date, 1);
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
  const nextSevenDays = summary ? sevenDayWorkload(summary, zone) : [];
  const equipmentEnabled = workspace.config.document.modules.some(
    (module) => module.id === "equipment",
  );
  const weeklyTotals = summarizeSevenDayWorkload(nextSevenDays, equipmentEnabled);
  // Optional adjacent comparisons use the same authorized business snapshot.
  // Previous: delta = current minus previous. Following: delta = following
  // minus current. Neither direction uses screen-only date filters.
  const comparisonAnchor = comparisonDirection === "previous" ? previousWeek
    : comparisonDirection === "following" ? nextWeek : null;
  let comparisonDays: ReturnType<typeof sevenDayWorkload> = [];
  let comparisonSummary: ReturnType<typeof summarizeDailyOperations> | null = null;
  if (comparisonAnchor && summary) {
    try {
      comparisonSummary = summarizeDailyOperations(workspace, zone, comparisonAnchor);
      comparisonDays = sevenDayWorkload(comparisonSummary, zone);
    } catch {
      // Out-of-range or invalid dates cannot break the main operations view.
    }
  }
  const comparisonTotals = comparisonDays.length
    ? summarizeSevenDayWorkload(comparisonDays, equipmentEnabled)
    : null;
  const comparisonChange = comparisonTotals
    ? comparisonDirection === "previous"
      ? compareSevenDayWorkloadTotals(comparisonTotals, weeklyTotals)
      : compareSevenDayWorkloadTotals(weeklyTotals, comparisonTotals)
    : null;
  const comparisonName = comparisonDirection === "previous" ? "Previous" : "Following";
  const comparisonChangeName = comparisonDirection === "previous" ? "current" : "following";
  const changeLabel = (value: number) => value > 0 ? "+" + value : String(value);
  // A selected Equipment-only filter cannot apply after switching to a
  // workspace where that module is disabled.
  const unavailableEquipmentFilter = activityType === "inspections" && !equipmentEnabled;
  const effectiveActivityType = unavailableEquipmentFilter ? "all" : activityType;
  const effectiveActivityOnly = unavailableEquipmentFilter ? false : activityOnly;
  const focusedTotals = summarizeFocusedWorkload(
    nextSevenDays, equipmentEnabled, effectiveActivityType,
  );
  const focusedPeak = effectiveActivityType === "all" ? null : busiestFocusedDay(
    nextSevenDays, equipmentEnabled, effectiveActivityType,
  );
  const focusedLabel = effectiveActivityType === "appointments" ? "appointment starts"
    : effectiveActivityType === "work" ? "unfinished work"
    : "equipment inspections";
  const displayedDays = orderWorkloadDays(
    filterWorkloadDaysByCalendarDay(
      filterWorkloadDaysByType(
        visibleWorkloadDays(nextSevenDays, equipmentEnabled, effectiveActivityOnly),
        equipmentEnabled,
        effectiveActivityType,
      ),
      calendarDayFilter,
    ),
    equipmentEnabled,
    sortByActivity ? "most-recorded" : "calendar",
    effectiveActivityType,
  );
  // The visible summary counts only dates remaining after date filters.
  // It reuses existing authorized data; a category filter selects dates,
  // not individual items on those dates.
  const visibleTotals = summarizeSevenDayWorkload(displayedDays, equipmentEnabled);
  const isFiltered = effectiveActivityOnly ||
    effectiveActivityType !== "all" || calendarDayFilter !== "all";
  // Always use the complete seven-day window, even when filtered on screen.
  const peakDay = busiestRecordedDay(nextSevenDays, equipmentEnabled);
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
  function downloadNeedsScheduling() {
    if (!summary || !summary.needsScheduling.length) return;
    const csv = needsSchedulingCsv(summary, zone);
    const file = new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(file);
    const link = document.createElement("a");
    link.href = url;
    link.download = "lms-needs-scheduling-reviewed-" + summary.date + ".csv";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function downloadUpcomingInspections() {
    if (!summary || !equipmentEnabled) return;
    const csv = upcomingInspectionsCsv(summary, zone);
    const file = new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(file);
    const link = document.createElement("a");
    link.href = url;
    link.download = "lms-upcoming-inspections-" + summary.date +
      "-through-" + summary.upcomingThrough + ".csv";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function downloadSevenDayWorkload() {
    if (!summary) return;
    const csv = sevenDayWorkloadCsv(summary, zone, equipmentEnabled);
    const file = new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(file);
    const link = document.createElement("a");
    link.href = url;
    link.download = "lms-seven-day-workload-" + summary.date +
      "-through-" + summary.upcomingThrough + ".csv";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function downloadVisibleWorkload() {
    if (!summary || !isFiltered) return;
    const csv = visibleWorkloadCsv(summary, zone, equipmentEnabled, displayedDays);
    const file = new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(file);
    const link = document.createElement("a");
    link.href = url;
    link.download = "lms-visible-workload-" + summary.date +
      "-through-" + summary.upcomingThrough + ".csv";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function downloadComparison() {
    if (!summary || !comparisonSummary || !comparisonTotals ||
        comparisonDirection === "none") return;
    const csv = sevenDayComparisonCsv(
      summary, comparisonSummary, zone, equipmentEnabled, comparisonDirection,
    );
    const file = new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(file);
    const link = document.createElement("a");
    link.href = url;
    link.download = "lms-" + comparisonDirection + "-week-comparison-" +
      summary.date + ".csv";
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
            {equipmentEnabled && (
              <div>
                <span className="metric-label">Inspections next 7 days</span>
                <strong>{summary.upcomingEquipmentInspections.length}</strong>
              </div>
            )}
          </div>
          <section className="daily-workload" aria-label="Seven-day workload by date">
            <h3>Next seven days · workload by date</h3>
            <p className="muted">
              Counts reflect saved appointment starts, unfinished work due dates
              {equipmentEnabled ? ", and upcoming inspections" : ""}.
              They are not staff capacity, equipment clearance, or guaranteed availability.
              Select a day to review it.
            </p>
            <div
              className="daily-workload-window-controls"
              role="group"
              aria-label="Seven-day workload window navigation"
            >
              <button
                type="button"
                className="secondary"
                disabled={!previousWeek}
                onClick={() => selectDate(previousWeek)}
                aria-label="Previous seven-day workload window"
              >
                Previous 7 days
              </button>
              <span className="muted" aria-live="polite">
                Viewing {nextSevenDays[0]?.date} through{" "}
                {nextSevenDays[nextSevenDays.length - 1]?.date}
              </span>
              <button
                type="button"
                className="secondary"
                disabled={!nextWeek}
                onClick={() => selectDate(nextWeek)}
                aria-label="Next seven-day workload window"
              >
                Next 7 days
              </button>
            </div>
            <div className="daily-workload-comparison-toggle">
              <button
                type="button"
                className="secondary"
                disabled={!previousWeek && comparisonDirection !== "previous"}
                aria-expanded={comparisonDirection === "previous"}
                onClick={() => setComparisonDirection((current) =>
                  current === "previous" ? "none" : "previous"
                )}
              >
                {comparisonDirection === "previous" ? "Hide previous 7-day comparison" :
                  "Compare previous 7 days"}
              </button>
              <button
                type="button"
                className="secondary"
                disabled={!nextWeek && comparisonDirection !== "following"}
                aria-expanded={comparisonDirection === "following"}
                onClick={() => setComparisonDirection((current) =>
                  current === "following" ? "none" : "following"
                )}
              >
                {comparisonDirection === "following" ? "Hide following 7-day comparison" :
                  "Compare following 7 days"}
              </button>
            </div>
            {comparisonDirection !== "none" && comparisonChange && comparisonTotals && (
              <div
                className="daily-workload-following-comparison"
                role="group"
                aria-label={comparisonName + " seven-day workload comparison"}
              >
                <strong>{comparisonName} {comparisonDays[0]?.date} through{" "}
                  {comparisonDays[comparisonDays.length - 1]?.date}</strong>
                <p className="muted">
                  Compared with the seven days currently selected. Changes show
                  {comparisonDirection === "previous" ?
                    " current minus previous" : " following minus current"}
                  {" "}saved-record counts, not hours or available appointments.
                </p>
                <div className="daily-workload-comparison-grid">
                  <div className="daily-workload-following-appointments">
                    <span>Appointment starts</span>
                    <strong>{comparisonTotals.appointments}</strong>
                    <span>Change to {comparisonChangeName}: {changeLabel(comparisonChange.appointments)}</span>
                  </div>
                  <div className="daily-workload-following-work">
                    <span>Unfinished work due</span>
                    <strong>{comparisonTotals.unfinishedWork}</strong>
                    <span>Change to {comparisonChangeName}: {changeLabel(comparisonChange.unfinishedWork)}</span>
                  </div>
                  {equipmentEnabled && (
                    <div className="daily-workload-following-inspections">
                      <span>Equipment inspections</span>
                      <strong>{comparisonTotals.inspections}</strong>
                      <span>Change to {comparisonChangeName}: {changeLabel(comparisonChange.inspections)}</span>
                    </div>
                  )}
                  <div className="daily-workload-following-active">
                    <span>Days with saved activity</span>
                    <strong>{comparisonTotals.daysWithActivity} of{" "}
                      {comparisonTotals.daysInWindow}</strong>
                    <span>Change to {comparisonChangeName}: {changeLabel(comparisonChange.daysWithActivity)} days</span>
                  </div>
                </div>
                <p className="muted">
                  Both periods use complete seven-day windows, independent
                  of date-card filters. Existing exports are unchanged.
                </p>
                <button
                  type="button"
                  className="secondary"
                  onClick={downloadComparison}
                >
                  Download comparison CSV
                </button>
              </div>
            )}
            {comparisonDirection !== "none" && !comparisonTotals && (
              <p className="muted" role="status">
                {comparisonName} seven-day comparison is unavailable for this date.
              </p>
            )}
            <div className="daily-workload-totals" role="group" aria-label="Seven-day workload totals">
              <div>
                <span className="metric-label">Upcoming appointments · 7 days</span>
                <strong>{weeklyTotals.appointments}</strong>
              </div>
              <div>
                <span className="metric-label">Unfinished work · 7 days</span>
                <strong>{weeklyTotals.unfinishedWork}</strong>
              </div>
              {equipmentEnabled && (
                <div>
                  <span className="metric-label">Equipment inspections · 7 days</span>
                  <strong>{weeklyTotals.inspections}</strong>
                </div>
              )}
              <div>
                <span className="metric-label">Days with saved activity</span>
                <strong>{weeklyTotals.daysWithActivity} of {weeklyTotals.daysInWindow}</strong>
              </div>
            </div>
            <div className="daily-workload-peak" role="group" aria-label="Busiest recorded day">
              {peakDay ? (
                <>
                  <p>
                    <strong>Most recorded activity: {peakDay.date}</strong>
                    <span className="muted">
                      {" "}· {peakDay.recordedItems} saved {peakDay.recordedItems === 1 ? "item" : "items"}
                      {peakDay.tiedDates > 1 ? (
                        <> · {peakDay.tiedDates} dates tied (earliest shown)</>
                      ) : null}
                    </span>
                  </p>
                  <button
                    type="button"
                    className="secondary"
                    aria-label={"Review busiest recorded day " + peakDay.date}
                    onClick={() => selectDate(peakDay.date)}
                  >
                    Review {peakDay.date}
                  </button>
                </>
              ) : (
                <p className="muted">No saved upcoming activity to highlight this week.</p>
              )}
            </div>
            <button
              type="button"
              className="secondary"
              onClick={downloadSevenDayWorkload}
            >
              Download seven-day workload CSV
            </button>
            {isFiltered && (
              <button
                type="button"
                className="secondary"
                onClick={downloadVisibleWorkload}
              >
                Download visible workload CSV
              </button>
            )}
            <div className="daily-workload-filter">
              <button
                type="button"
                className="secondary"
                aria-pressed={effectiveActivityOnly}
                onClick={() => {
                  if (effectiveActivityOnly) {
                    setActivityOnly(false);
                    setActivityType("all");
                    setCalendarDayFilter("all");
                  } else {
                    // An equipment-only choice from a different business is
                    // unavailable here; activate the all-activity filter.
                    if (unavailableEquipmentFilter) setActivityType("all");
                    setActivityOnly(true);
                  }
                }}
              >
                {effectiveActivityOnly ? "Show all seven days" : "Show active days only"}
              </button>
              <label className="daily-workload-category">
                Activity to show
                <select
                  aria-label="Activity to show"
                  value={effectiveActivityType}
                  onChange={(event) => {
                    const nextType = event.target.value as WorkloadActivityType;
                    setActivityType(nextType);
                    if (nextType !== "all") setActivityOnly(true);
                  }}
                >
                  <option value="all">All recorded activity</option>
                  <option value="appointments">Appointment dates</option>
                  <option value="work">Unfinished work due dates</option>
                  {equipmentEnabled && (
                    <option value="inspections">Equipment inspection dates</option>
                  )}
                </select>
              </label>
              <label className="daily-workload-category">
                Calendar days to show
                <select
                  aria-label="Calendar days to show"
                  value={calendarDayFilter}
                  onChange={(event) => setCalendarDayFilter(
                    event.target.value as WorkloadCalendarDayFilter,
                  )}
                >
                  <option value="all">All seven days</option>
                  <option value="weekdays">Monday–Friday dates</option>
                  <option value="weekends">Saturday–Sunday dates</option>
                </select>
              </label>
              <button
                type="button"
                className="secondary"
                aria-pressed={sortByActivity}
                onClick={() => setSortByActivity((value) => !value)}
              >
                {sortByActivity ? "Sort by calendar date" :
                  effectiveActivityType === "appointments" ? "Sort by most appointment starts" :
                  effectiveActivityType === "work" ? "Sort by most unfinished work" :
                  effectiveActivityType === "inspections" ? "Sort by most equipment inspections" :
                  "Sort by most recorded items"}
              </button>
              <button
                type="button"
                className="secondary"
                disabled={!activityOnly && activityType === "all" &&
                  !sortByActivity && calendarDayFilter === "all"}
                onClick={() => {
                  setActivityOnly(false);
                  setActivityType("all");
                  setCalendarDayFilter("all");
                  setSortByActivity(false);
                }}
              >
                Reset workload view
              </button>
              <span className="muted" role="status" aria-live="polite">
                Showing {displayedDays.length} of {nextSevenDays.length} days
              </span>
              <span className="muted">
                Order: {sortByActivity
                  ? effectiveActivityType === "appointments" ? "Most appointment starts first"
                    : effectiveActivityType === "work" ? "Most unfinished work first"
                    : effectiveActivityType === "inspections" ? "Most equipment inspections first"
                    : "Most recorded first"
                  : "Calendar date"}
              </span>
            </div>
            {isFiltered && (
              <div
                className="daily-workload-visible-summary"
                role="group"
                aria-label="Visible date-card totals"
                aria-live="polite"
              >
                <strong>Currently shown: {visibleTotals.daysInWindow} of{" "}
                  {nextSevenDays.length} dates</strong>
                <div className="daily-workload-visible-counts">
                  <span className="daily-workload-visible-appointments">
                    Appointments: <strong>{visibleTotals.appointments}</strong>
                  </span>
                  <span className="daily-workload-visible-work">
                    Unfinished work: <strong>{visibleTotals.unfinishedWork}</strong>
                  </span>
                  {equipmentEnabled && (
                    <span className="daily-workload-visible-inspections">
                      Inspections: <strong>{visibleTotals.inspections}</strong>
                    </span>
                  )}
                </div>
                <p className="muted">
                  Counts include all saved activity types on displayed dates.
                  Filters select dates, not individual records. Full-week totals
                  above and CSV downloads remain unchanged.
                </p>
              </div>
            )}
            {effectiveActivityType !== "all" && (
              <p className="muted daily-workload-focused" aria-live="polite">
                Focused activity: <strong>{focusedTotals.savedItems}</strong>{" "}
                {effectiveActivityType === "appointments" ? "appointment starts"
                  : effectiveActivityType === "work" ? "unfinished work items"
                  : "equipment inspections"} across {focusedTotals.matchingDays} of{" "}
                {focusedTotals.daysInWindow} days. Full-week totals above and CSV
                downloads are unchanged.
              </p>
            )}
            {focusedPeak && (
              <div
                className="daily-workload-peak daily-workload-focused-peak"
                role="group"
                aria-label="Most recorded selected activity day"
              >
                <p>
                  <strong>Most recorded {focusedLabel}: {focusedPeak.date}</strong>
                  <span className="muted">
                    {" "}· {focusedPeak.matchingItems} saved{" "}
                    {focusedPeak.matchingItems === 1 ? "item" : "items"}
                    {focusedPeak.tiedDates > 1 ? (
                      <> · {focusedPeak.tiedDates} dates tied (earliest shown)</>
                    ) : null}
                  </span>
                </p>
                <button
                  type="button"
                  className="secondary"
                  aria-label={"Review top selected activity day " + focusedPeak.date}
                  onClick={() => selectDate(focusedPeak.date)}
                >
                  Review {focusedPeak.date}
                </button>
              </div>
            )}
            {displayedDays.length === 0 && (effectiveActivityOnly ||
              calendarDayFilter !== "all") && (
              <p className="muted" role="status">
                {calendarDayFilter !== "all"
                  ? "No saved activity matches the selected calendar days and activity filters."
                  : effectiveActivityType === "all"
                    ? "No saved activity in the next seven days."
                    : effectiveActivityType === "appointments"
                      ? "No appointment starts in the next seven days."
                      : effectiveActivityType === "work"
                        ? "No unfinished work due in the next seven days."
                        : "No upcoming equipment inspections in the next seven days."}
                {" "}Reset workload view to restore all seven dates.
              </p>
            )}
            <div className="daily-workload-grid">
              {displayedDays.map((day) => (
                <button
                  key={day.date}
                  type="button"
                  className="secondary"
                  onClick={() => selectDate(day.date)}
                  aria-description={"Business-local weekday: " + workloadWeekday(day.date)}
                  aria-label={
                    "Review " + day.date + ": " + day.appointments +
                    " appointments and " + day.unfinishedWork + " unfinished work items" +
                    (equipmentEnabled ? " and " + day.inspections + " equipment inspections" : "")
                  }
                >
                  <span className="daily-workload-weekday" aria-hidden="true">
                    {workloadWeekday(day.date)}
                  </span>
                  <strong>{day.date}</strong>
                  {effectiveActivityType !== "all" && (
                    <span className="daily-workload-selected-count" aria-hidden="true">
                      Selected: {focusedRecordedItemCount(
                        day, equipmentEnabled, effectiveActivityType,
                      )} {focusedLabel}
                    </span>
                  )}
                  <span>{day.appointments} appointments</span>
                  <span>{day.unfinishedWork} work items</span>
                  {equipmentEnabled && <span>{day.inspections} inspections</span>}
                </button>
              ))}
            </div>
          </section>
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
              <button
                type="button"
                className="secondary"
                disabled={!summary.needsScheduling.length}
                onClick={downloadNeedsScheduling}
              >
                Download needs scheduling CSV
              </button>
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
            {equipmentEnabled && (
              <section aria-label="Upcoming equipment inspections next seven days">
                <h3>Equipment inspections coming up</h3>
                <p className="muted">
                  After {date} through {summary.upcomingThrough} ·{" "}
                  {summary.upcomingEquipmentInspections.length} scheduled{" "}
                  {summary.upcomingEquipmentInspections.length === 1
                    ? "inspection" : "inspections"}
                </p>
                {summary.upcomingEquipmentInspections.length ? (
                  <ul>
                    {summary.upcomingEquipmentInspections.slice(
                      0, dailyPage(
                        summary.upcomingEquipmentInspections.length, visible.inspections,
                      ).visible,
                    ).map(({ record, due }) => (
                      <li key={record.id}>
                        <strong>{String(record.data.name)}</strong>
                        <span className="muted">
                          Next inspection {due} · Serviceable
                        </span>
                        <button
                          type="button"
                          className="quiet"
                          aria-label={`Find upcoming inspection for ${String(record.data.name)}`}
                          onClick={() => onEquipment(record)}
                        >
                          Find this equipment
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="muted">
                    No saved equipment inspections due in the next seven days.
                  </p>
                )}
                <DailyMore
                  total={summary.upcomingEquipmentInspections.length}
                  requested={visible.inspections}
                  kind="inspections"
                  label="upcoming inspections"
                  onMore={() => showMore(
                    "inspections", summary.upcomingEquipmentInspections.length,
                  )}
                  onFewer={() => showFewer("inspections")}
                />
                <button
                  className="secondary"
                  type="button"
                  onClick={downloadUpcomingInspections}
                >
                  Download upcoming inspections CSV
                </button>
              </section>
            )}
          </div>
        </>
      )}
    </section>
  );
}
