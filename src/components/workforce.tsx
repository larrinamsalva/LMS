import { useState } from "react";
import { Temporal } from "@js-temporal/polyfill";
import type { WorkspaceRecord } from "../core/engine";
import type { StaffAssignment } from "../core/workforce";
import { displayTime, localDate, instant } from "../core/time";
import { relatedLabel } from "./schedule";
import {
  filterEmployeeDirectory,
  type EmployeeDirectoryStatus,
} from "../core/workforce-directory";
import {
  filterAvailabilityPeriods,
  type AvailabilityPeriodTypeFilter,
} from "../core/workforce-availability-filter";
import {
  filterWorkforceResourceDirectory,
  type WorkforceResourceTypeFilter,
  type WorkforceResourceEnrollmentFilter,
} from "../core/workforce-resource-directory";
import { summarizeAvailabilityPeriodTypes } from "../core/workforce-availability-summary";
import {
  filterStaffAssignmentHistory,
  filterStaffAssignmentHistoryByStartDate,
  staffAssignmentStartDateRangeError,
  staffAssignmentHistoryCounts,
  visibleStaffAssignmentHistory,
  STAFF_HISTORY_PAGE_SIZE,
  type StaffAssignmentHistoryStatus,
} from "../core/workforce-assignment-history";

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
  const [employeeSearch, setEmployeeSearch] = useState("");
  const [historySearch, setHistorySearch] = useState("");
  const [historyFromDate, setHistoryFromDate] = useState("");
  const [historyThroughDate, setHistoryThroughDate] = useState("");
  const [historyStatus, setHistoryStatus] =
    useState<StaffAssignmentHistoryStatus>("all");
  const [historyShown, setHistoryShown] = useState(STAFF_HISTORY_PAGE_SIZE);
  const [resourceSearch, setResourceSearch] = useState("");
  const [resourceType, setResourceType] =
    useState<WorkforceResourceTypeFilter>("all");
  const [resourceEnrollment, setResourceEnrollment] =
    useState<WorkforceResourceEnrollmentFilter>("all");
  const [availabilitySearch, setAvailabilitySearch] = useState("");
  const [availabilityKind, setAvailabilityKind] =
    useState<AvailabilityPeriodTypeFilter>("all");
  const [employeeStatus, setEmployeeStatus] =
    useState<EmployeeDirectoryStatus>("all");
  const currentEmployees = filterEmployeeDirectory(employees, history, "", "all");
  const displayedEmployees = filterEmployeeDirectory(
    employees, history, employeeSearch, employeeStatus,
  );
  const employeeFiltersActive = employeeSearch.trim().length > 0 ||
    employeeStatus !== "all";
  const currentResources = filterWorkforceResourceDirectory(
    resources, memberships, history, "", "all", "all",
  );
  const displayedResources = filterWorkforceResourceDirectory(
    resources, memberships, history, resourceSearch, resourceType,
    resourceEnrollment,
  );
  const resourceFiltersActive = resourceSearch.trim().length > 0 ||
    resourceType !== "all" || resourceEnrollment !== "all";
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
  const displayedPeriods = filterAvailabilityPeriods(
    visible, records, availabilityKind, availabilitySearch,
  );
  const availabilityCounts = summarizeAvailabilityPeriodTypes(visible);
  const availabilityOverviewCards = [
    { kind: "Working hours", countKey: "workingHours",
      label: "Working hours", action: "View working hours periods" },
    { kind: "Day off", countKey: "daysOff",
      label: "Days off", action: "View days off periods" },
    { kind: "Vacation", countKey: "vacations",
      label: "Vacations", action: "View vacation periods" },
    { kind: "Unavailable", countKey: "unavailable",
      label: "Unavailable", action: "View unavailable periods" },
  ] as const;
  const availabilityFiltersActive = availabilityKind !== "all" ||
    availabilitySearch.trim().length > 0;
  const historyCounts = staffAssignmentHistoryCounts(assignments);
  const textStatusHistory = filterStaffAssignmentHistory(
    assignments, records, historyStatus, historySearch,
  );
  const historyDateError = staffAssignmentStartDateRangeError(
    historyFromDate, historyThroughDate,
  );
  const matchingHistory = filterStaffAssignmentHistoryByStartDate(
    textStatusHistory, zone, historyFromDate, historyThroughDate,
  );
  const shownHistory = visibleStaffAssignmentHistory(matchingHistory, historyShown);
  const historyFiltersActive = historyStatus !== "all" ||
    historySearch.trim().length > 0 ||
    historyFromDate !== "" || historyThroughDate !== "";
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
        <div className="schedule-toolbar">
          <div>
            <label htmlFor="employee-directory-search">Search employee directory</label>
            <input
              id="employee-directory-search"
              type="search"
              placeholder="Name, work role or skill"
              value={employeeSearch}
              onChange={(event) => setEmployeeSearch(event.target.value)}
            />
          </div>
          <div>
            <label htmlFor="employee-directory-status">Filter employee status</label>
            <select
              id="employee-directory-status"
              value={employeeStatus}
              onChange={(event) =>
                setEmployeeStatus(event.target.value as EmployeeDirectoryStatus)}
            >
              <option value="all">All statuses</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </div>
          {employeeFiltersActive && (
            <button type="button" className="secondary" onClick={() => {
              setEmployeeSearch("");
              setEmployeeStatus("all");
            }}>
              Clear employee filters
            </button>
          )}
        </div>
        <p role="status" aria-live="polite">
          Showing {displayedEmployees.length} of {currentEmployees.length}
          {" "}{history ? "archived" : "current"} employee profiles.
        </p>
        <div className="workforce-grid">
          {displayedEmployees.map((r) => (
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
        {displayedEmployees.length === 0 && (
          <p className="empty-state">
            {currentEmployees.length === 0
              ? "No employee profiles in this view."
              : "No employee profiles match these filters."}
          </p>
        )}
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
        <div className="schedule-toolbar">
          <div>
            <label htmlFor="resource-directory-search">Search resource directory</label>
            <input
              id="resource-directory-search"
              type="search"
              placeholder="Crew, worker or equipment name"
              value={resourceSearch}
              onChange={(event) => setResourceSearch(event.target.value)}
            />
          </div>
          <div>
            <label htmlFor="resource-directory-type">Filter resource type</label>
            <select id="resource-directory-type" value={resourceType}
              onChange={(event) =>
                setResourceType(event.target.value as WorkforceResourceTypeFilter)}>
              <option value="all">All resource types</option>
              <option value="Crew">Crew</option>
              <option value="Worker">Worker</option>
              <option value="Equipment">Equipment</option>
            </select>
          </div>
          <div>
            <label htmlFor="resource-directory-enrollment">
              Filter employee enrollment
            </label>
            <select id="resource-directory-enrollment" value={resourceEnrollment}
              onChange={(event) =>
                setResourceEnrollment(
                  event.target.value as WorkforceResourceEnrollmentFilter,
                )}>
              <option value="all">All enrollment types</option>
              <option value="enrolled">Enrolled workers/crews</option>
              <option value="resource-only">Resource-only workers/crews</option>
            </select>
          </div>
          {resourceFiltersActive && (
            <button type="button" className="secondary" onClick={() => {
              setResourceSearch("");
              setResourceType("all");
              setResourceEnrollment("all");
            }}>
              Clear resource filters
            </button>
          )}
        </div>
        <p role="status" aria-live="polite">
          Showing {displayedResources.length} of {currentResources.length}
          {" "}{history ? "archived" : "current"} resources.
        </p>
        <p className="muted">
          Enrollment means a Worker or Crew has retained membership history,
          even when its last membership is archived. Equipment has no employee
          enrollment and appears only with All enrollment types.
          These filters do not determine booking eligibility.
        </p>
        <div className="workforce-grid">
          {displayedResources.map((r) => {
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
        {displayedResources.length === 0 && (
          <p className="empty-state">
            {currentResources.length === 0
              ? "No resources in this view."
              : "No resources match these filters."}
          </p>
        )}
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
          <div>
            <label htmlFor="availability-period-kind">Filter availability period type</label>
            <select
              id="availability-period-kind"
              value={availabilityKind}
              onChange={(event) =>
                setAvailabilityKind(event.target.value as AvailabilityPeriodTypeFilter)}
            >
              <option value="all">All period types</option>
              <option value="Working hours">Working hours</option>
              <option value="Day off">Day off</option>
              <option value="Vacation">Vacation</option>
              <option value="Unavailable">Unavailable</option>
            </select>
          </div>
          <div>
            <label htmlFor="availability-period-search">Search availability periods</label>
            <input
              id="availability-period-search"
              type="search"
              placeholder="Period title or employee/crew name"
              value={availabilitySearch}
              onChange={(event) => setAvailabilitySearch(event.target.value)}
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
          {availabilityFiltersActive && (
            <button type="button" className="secondary" onClick={() => {
              setAvailabilityKind("all");
              setAvailabilitySearch("");
            }}>
              Clear availability filters
            </button>
          )}
        </div>
        <p role="status" aria-live="polite">
          Showing {displayedPeriods.length} of {visible.length}
          {" "}{history ? "archived" : "current"} availability periods
          {" "}on {date || "the selected date"}.
        </p>
        <p className="muted">
          Daily period overview counts records overlapping this local day,
          including those hidden by search or type filters. Multiple periods
          for one person count separately. This is not a headcount, staffing
          capacity or confirmation that someone can be booked.
          {history && " Archived period records are historical only."}
        </p>
        <div className="workforce-grid" role="group"
          aria-label="Availability period overview">
          {availabilityOverviewCards.map((card) => (
            <div className="workforce-card" key={card.kind}>
              <h3>{card.label}</h3>
              <p><strong>{availabilityCounts[card.countKey]}</strong>
                {" "}recorded periods</p>
              <button type="button" className="secondary"
                disabled={availabilityCounts[card.countKey] === 0}
                onClick={() => {
                  setAvailabilityKind(card.kind);
                  setAvailabilitySearch("");
                }}>
                {card.action}
              </button>
            </div>
          ))}
        </div>
        <div className="workforce-grid">
          {displayedPeriods.map((r) => (
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
        {displayedPeriods.length === 0 && (
          <p className="empty-state">
            {visible.length === 0
              ? "No periods for this day. Employees without a covering work window cannot be booked."
              : "No availability periods match these filters."}
          </p>
        )}
      </section>
      <section className="panel">
        <details>
          <summary>
            Assignment history · {historyCounts.total} retained employee
            allocations
          </summary>
          <p className="muted">
            Snapshots preserve names, descriptive roles and effective membership
            revisions at assignment time. Released rows remain in the database
            and workspace export. Each revision is one entry, not a unique
            employee or an available staff member.
          </p>
          <p>
            Reserved: <strong>{historyCounts.reserved}</strong> · Released:{" "}
            <strong>{historyCounts.released}</strong>
          </p>
          <div className="schedule-toolbar">
            <div>
              <label htmlFor="assignment-history-search">Search assignment history</label>
              <input
                id="assignment-history-search"
                type="search"
                placeholder="Employee name, role or appointment title"
                value={historySearch}
                onChange={(event) => {
                  setHistorySearch(event.target.value);
                  setHistoryShown(STAFF_HISTORY_PAGE_SIZE);
                }}
              />
            </div>
            <div>
              <label htmlFor="assignment-history-status">Filter assignment status</label>
              <select
                id="assignment-history-status"
                value={historyStatus}
                onChange={(event) => {
                  setHistoryStatus(event.target.value as StaffAssignmentHistoryStatus);
                  setHistoryShown(STAFF_HISTORY_PAGE_SIZE);
                }}
              >
                <option value="all">All retained assignments</option>
                <option value="reserved">Reserved</option>
                <option value="released">Released</option>
              </select>
            </div>
            <div>
              <label htmlFor="assignment-history-from-date">
                Assignment start from
              </label>
              <input id="assignment-history-from-date" type="date"
                value={historyFromDate}
                onChange={(event) => {
                  setHistoryFromDate(event.target.value);
                  setHistoryShown(STAFF_HISTORY_PAGE_SIZE);
                }}
              />
            </div>
            <div>
              <label htmlFor="assignment-history-through-date">
                Assignment start through
              </label>
              <input id="assignment-history-through-date" type="date"
                value={historyThroughDate}
                onChange={(event) => {
                  setHistoryThroughDate(event.target.value);
                  setHistoryShown(STAFF_HISTORY_PAGE_SIZE);
                }}
              />
            </div>
            {historyFiltersActive && (
              <button type="button" className="secondary" onClick={() => {
                setHistorySearch("");
                setHistoryStatus("all");
                setHistoryFromDate("");
                setHistoryThroughDate("");
                setHistoryShown(STAFF_HISTORY_PAGE_SIZE);
              }}>
                Clear assignment filters
              </button>
            )}
          </div>
          <p className="muted">
            Start-date bounds are inclusive, based on the scheduled appointment
            start in {zone}, not the date a history revision was released.
            They do not affect the Availability day above or stored assignments.
          </p>
          {historyDateError && (
            <p role="alert">{historyDateError}</p>
          )}
          <p role="status" aria-live="polite">
            Showing {shownHistory.length} of {matchingHistory.length} matching
            retained assignments ({historyCounts.total} total).
          </p>
          <ul className="workforce-members">
            {shownHistory.map((s) => (
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
          {matchingHistory.length === 0 && (
            <p className="empty-state">
              {historyCounts.total === 0
                ? "No retained employee assignments yet."
                : historyDateError
                  ? "Fix the assignment start date range to see history."
                  : "No retained assignments match these filters."}
            </p>
          )}
          {matchingHistory.length > STAFF_HISTORY_PAGE_SIZE && (
            <div className="actions">
              {historyShown < matchingHistory.length && (
                <button type="button" className="secondary" onClick={() =>
                  setHistoryShown((n) => Math.min(
                    matchingHistory.length, n + STAFF_HISTORY_PAGE_SIZE,
                  ))}>
                  Show more assignment history
                </button>
              )}
              {historyShown > STAFF_HISTORY_PAGE_SIZE && (
                <button type="button" className="secondary"
                  onClick={() => setHistoryShown(STAFF_HISTORY_PAGE_SIZE)}>
                  Show fewer assignment history
                </button>
              )}
            </div>
          )}
        </details>
      </section>
    </div>
  );
}
