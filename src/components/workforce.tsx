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
  orderStaffAssignmentHistory,
  staffAssignmentStartDateRangeError,
  staffAssignmentHistoryCounts,
  visibleStaffAssignmentHistory,
  STAFF_HISTORY_PAGE_SIZE,
  type StaffAssignmentHistoryStatus,
  type StaffAssignmentHistorySort,
} from "../core/workforce-assignment-history";
import { staffAssignmentHistoryCsv } from "../core/workforce-assignment-history-csv";
import { filteredAvailabilityPeriodsCsv } from "../core/workforce-availability-csv";
import {
  filteredResourceMembershipsCsv,
  type ResourceMembershipCsvView,
} from "../core/resource-membership-review-csv";
import {
  filteredRosterResourceSummaryCsv,
  rosterSummaryFilterContext,
} from "../core/resource-roster-summary-csv";
import { membershipReviewFiltersActive } from "../core/roster-review-reset";
import {
  rosterGapCategoryFilters,
  type RosterGapCategory,
} from "../core/roster-gap-quick-view";
import {
  rosterCardCollapseKey,
  setShownRosterCardsCollapsed,
} from "../core/roster-card-visibility";
import {
  resourceMembershipRowsForReview,
  resourceMembershipReviewDateError,
  filterResourceMembershipRecordStatus,
  filterResourceMembershipsByName,
  resourcesWithMatchingRosterMemberships,
  resourcesWithoutMatchingRosterMemberships,
  summarizeMatchingRosterMemberships,
  summarizeUnmatchedRosterResources,
  orderRosterResourcesByMatchingCount,
  orderResourceMembershipsByStart,
  type ResourceMembershipReviewMode,
  type ResourceMembershipRecordStatus,
  type ResourceMembershipStartSort,
  type RosterResourceCountSort,
} from "../core/resource-membership-review";

export function Workforce({
  records,
  assignments,
  organizationId,
  zone,
  canManage,
  busy,
  onAdd,
  onEdit,
  onArchive,
}: {
  records: WorkspaceRecord[];
  assignments: StaffAssignment[];
  organizationId: string;
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
  const [historySort, setHistorySort] =
    useState<StaffAssignmentHistorySort>("retained");
  const [historyShown, setHistoryShown] = useState(STAFF_HISTORY_PAGE_SIZE);
  const [resourceSearch, setResourceSearch] = useState("");
  const [resourceType, setResourceType] =
    useState<WorkforceResourceTypeFilter>("all");
  const [resourceEnrollment, setResourceEnrollment] =
    useState<WorkforceResourceEnrollmentFilter>("all");
  const [rosterMode, setRosterMode] =
    useState<ResourceMembershipReviewMode>("all");
  const [rosterStatus, setRosterStatus] =
    useState<ResourceMembershipRecordStatus>("all");
  const [rosterSort, setRosterSort] =
    useState<ResourceMembershipStartSort>("retained");
  const [rosterSearch, setRosterSearch] = useState("");
  const [resourceCountSort, setResourceCountSort] =
    useState<RosterResourceCountSort>("directory");
  const [onlyMatchingRosterResources, setOnlyMatchingRosterResources] =
    useState(false);
  const [onlyWithoutMatchingRosterResources, setOnlyWithoutMatchingRosterResources] =
    useState(false);
  // Presentation-only collapse state, keyed by organization + resource.
  // Never changes retained membership records or export selection.
  const [collapsedRosterCards, setCollapsedRosterCards] =
    useState<string[]>([]);
  const [rosterDate, setRosterDate] = useState(date);
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
  const scopedResources = resources.filter((r) =>
    r.organization_id === organizationId,
  );
  const scopedMemberships = memberships.filter((m) =>
    m.organization_id === organizationId,
  );
  const scopedRosterRecords = records.filter((r) =>
    r.organization_id === organizationId,
  );
  const currentResources = filterWorkforceResourceDirectory(
    scopedResources, scopedMemberships, history, "", "all", "all",
  );
  const displayedResources = filterWorkforceResourceDirectory(
    scopedResources, scopedMemberships, history, resourceSearch, resourceType,
    resourceEnrollment,
  );
  const rosterDateError = rosterMode === "overlapping-day"
    ? resourceMembershipReviewDateError(rosterDate, zone)
    : null;
  const matchingRosterResources = resourcesWithMatchingRosterMemberships(
    displayedResources, scopedMemberships, scopedRosterRecords,
    organizationId, {
      mode: rosterMode, date: rosterDate, zone,
      status: rosterStatus, search: rosterSearch,
    },
  );
  const withoutMatchingRosterResources = resourcesWithoutMatchingRosterMemberships(
    displayedResources, scopedMemberships, scopedRosterRecords,
    organizationId, {
      mode: rosterMode, date: rosterDate, zone,
      status: rosterStatus, search: rosterSearch,
    },
  );
  const shownRosterResources = orderRosterResourcesByMatchingCount(
    onlyMatchingRosterResources ? matchingRosterResources
      : onlyWithoutMatchingRosterResources ? withoutMatchingRosterResources
      : displayedResources,
    scopedMemberships, scopedRosterRecords, organizationId, {
      mode: rosterMode, date: rosterDate, zone,
      status: rosterStatus, search: rosterSearch,
    }, resourceCountSort,
  );
  const collapsedShownRosterCount = shownRosterResources.filter((resource) =>
    collapsedRosterCards.includes(
      rosterCardCollapseKey(organizationId, resource.id),
    ),
  ).length;
  const rosterOverview = summarizeMatchingRosterMemberships(
    displayedResources, scopedMemberships, scopedRosterRecords,
    organizationId, {
      mode: rosterMode, date: rosterDate, zone,
      status: rosterStatus, search: rosterSearch,
    },
  );
  const rosterUnmatchedOverview = summarizeUnmatchedRosterResources(
    displayedResources, scopedMemberships, scopedRosterRecords,
    organizationId, {
      mode: rosterMode, date: rosterDate, zone,
      status: rosterStatus, search: rosterSearch,
    },
  );
  const exportableRosterRows = !rosterDateError &&
    !onlyWithoutMatchingRosterResources &&
    matchingRosterResources.length > 0;
  // A summary can document zero matching records for visible resources,
  // unlike the detail report which needs at least one matching member row.
  const exportableRosterSummary = !rosterDateError &&
    shownRosterResources.length > 0;
  const rosterExportView: ResourceMembershipCsvView = {
    archivedResources: history,
    resourceSearch,
    resourceKind: resourceType,
    enrollment: resourceEnrollment,
    mode: rosterMode,
    membershipStatus: rosterStatus,
    memberSearch: rosterSearch,
    onlyMatchingResources: onlyMatchingRosterResources,
    onlyWithoutMatchingResources: onlyWithoutMatchingRosterResources,
    resourceSort: resourceCountSort,
    sort: rosterSort,
    date: rosterDate,
  };
  const reviewContext = rosterSummaryFilterContext(rosterExportView);
  function reviewRosterGapCategory(category: RosterGapCategory) {
    const filters = rosterGapCategoryFilters(category, resourceType);
    setResourceType(filters.resourceKind);
    setResourceEnrollment(filters.enrollment);
    setOnlyMatchingRosterResources(false);
    setOnlyWithoutMatchingRosterResources(true);
  }
  function showAllRosterResourceCategories() {
    // Undo category/card-only narrowing without losing the chosen review.
    // Keep resource-name search, date, record status, member search, sort
    // and independently controlled resource-card collapse state intact.
    setResourceType("all");
    setResourceEnrollment("all");
    setOnlyMatchingRosterResources(false);
    setOnlyWithoutMatchingRosterResources(false);
  }
  const rosterCategoryNarrowed =
    resourceType !== "all" || resourceEnrollment !== "all" ||
    onlyMatchingRosterResources || onlyWithoutMatchingRosterResources;
  const memberReviewFiltersActive = membershipReviewFiltersActive(
    rosterMode, rosterStatus, rosterSort, rosterSearch,
  );
  const resourceFiltersActive = resourceSearch.trim().length > 0 ||
    resourceType !== "all" || resourceEnrollment !== "all" ||
    rosterMode !== "all" || rosterStatus !== "all" ||
    rosterSort !== "retained" || rosterSearch.trim().length > 0 ||
    onlyMatchingRosterResources || onlyWithoutMatchingRosterResources ||
    resourceCountSort !== "directory";
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
  const dateFilteredHistory = filterStaffAssignmentHistoryByStartDate(
    textStatusHistory, zone, historyFromDate, historyThroughDate,
  );
  const matchingHistory = orderStaffAssignmentHistory(
    dateFilteredHistory, historySort,
  );
  const shownHistory = visibleStaffAssignmentHistory(matchingHistory, historyShown);
  const historyFiltersActive = historyStatus !== "all" ||
    historySort !== "retained" || historySearch.trim().length > 0 ||
    historyFromDate !== "" || historyThroughDate !== "";
  function downloadFilteredAssignmentHistory() {
    if (historyDateError || !matchingHistory.length) return;
    // Recompute the complete filtered set from authorized organization data;
    // never export only the current first-ten page or accept client-picked IDs.
    const csv = staffAssignmentHistoryCsv(
      assignments, records, organizationId, zone, {
        status: historyStatus, search: historySearch,
        fromDate: historyFromDate, throughDate: historyThroughDate,
        sort: historySort,
      },
    );
    const file = new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(file);
    const link = document.createElement("a");
    link.href = url;
    link.download = "lms-filtered-assignment-history.csv";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function downloadRosterReview() {
    if (!exportableRosterRows) return;
    // Reapply organization, resource and membership filters from the
    // canonical authorized workspace before creating any report rows.
    const csv = filteredResourceMembershipsCsv(
      records, organizationId, zone, rosterExportView,
    );
    const file = new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(file);
    const link = document.createElement("a");
    link.href = url;
    link.download = "lms-resource-roster-review" +
      (rosterMode === "overlapping-day" ? "-" + rosterDate : "-all-history") +
      ".csv";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function downloadRosterSummary() {
    if (!exportableRosterSummary) return;
    const csv = filteredRosterResourceSummaryCsv(
      records, organizationId, zone, rosterExportView,
    );
    const file = new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(file);
    const link = document.createElement("a");
    link.href = url;
    link.download = "lms-resource-roster-summary" +
      (rosterMode === "overlapping-day" ? "-" + rosterDate : "-all-history") +
      ".csv";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function downloadFilteredAvailabilityPeriods() {
    if (!displayedPeriods.length) return;
    // The report recomputes the date/type/name filter from organization-scoped
    // records instead of trusting the displayed subset.
    const csv = filteredAvailabilityPeriodsCsv(
      records, organizationId, zone, {
        date, archived: history, kind: availabilityKind,
        search: availabilitySearch,
      },
    );
    const file = new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(file);
    const link = document.createElement("a");
    link.href = url;
    link.download = "lms-availability-periods-" + date +
      (history ? "-archived" : "-current") + ".csv";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
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
          <div>
            <label htmlFor="resource-membership-view">
              Show resource memberships
            </label>
            <select id="resource-membership-view" value={rosterMode}
              onChange={(event) => setRosterMode(
                event.target.value as ResourceMembershipReviewMode,
              )}>
              <option value="all">All retained membership history</option>
              <option value="overlapping-day">Overlapping selected day</option>
            </select>
          </div>
          <div>
            <label htmlFor="resource-membership-status">
              Filter membership record status
            </label>
            <select id="resource-membership-status" value={rosterStatus}
              onChange={(event) => setRosterStatus(
                event.target.value as ResourceMembershipRecordStatus,
              )}>
              <option value="all">All retained memberships</option>
              <option value="current">Current membership records</option>
              <option value="archived">Archived membership records</option>
            </select>
          </div>
          <div>
            <label htmlFor="resource-membership-search">
              Search roster memberships
            </label>
            <input id="resource-membership-search" type="search"
              placeholder="Membership title or employee name"
              value={rosterSearch}
              onChange={(event) => setRosterSearch(event.target.value)}
            />
          </div>
          <label className="check-label">
            <input type="checkbox"
              checked={onlyMatchingRosterResources}
              onChange={(event) => {
                setOnlyMatchingRosterResources(event.target.checked);
                if (event.target.checked) setOnlyWithoutMatchingRosterResources(false);
              }}
            />
            Show only resources with matching memberships
          </label>
          <label className="check-label">
            <input type="checkbox"
              checked={onlyWithoutMatchingRosterResources}
              onChange={(event) => {
                setOnlyWithoutMatchingRosterResources(event.target.checked);
                if (event.target.checked) setOnlyMatchingRosterResources(false);
              }}
            />
            Show only resources without matching memberships
          </label>
          <div>
            <label htmlFor="resource-card-count-sort">
              Sort resource cards
            </label>
            <select id="resource-card-count-sort" value={resourceCountSort}
              onChange={(event) => setResourceCountSort(
                event.target.value as RosterResourceCountSort,
              )}>
              <option value="directory">Original directory order</option>
              <option value="name-asc">Resource name A–Z</option>
              <option value="name-desc">Resource name Z–A</option>
              <option value="most">Most matching memberships first</option>
              <option value="fewest">Fewest matching memberships first</option>
            </select>
          </div>
          <div>
            <label htmlFor="resource-membership-sort">
              Sort membership history
            </label>
            <select id="resource-membership-sort" value={rosterSort}
              onChange={(event) => setRosterSort(
                event.target.value as ResourceMembershipStartSort,
              )}>
              <option value="retained">Retained record order</option>
              <option value="newest">Newest effective start first</option>
              <option value="oldest">Oldest effective start first</option>
            </select>
          </div>
          {rosterMode === "overlapping-day" && (
            <div>
              <label htmlFor="resource-membership-date">
                Membership review date
              </label>
              <input id="resource-membership-date" type="date"
                value={rosterDate}
                onChange={(event) => setRosterDate(event.target.value)}
              />
            </div>
          )}
          <button type="button" className="secondary"
            disabled={!memberReviewFiltersActive}
            onClick={() => {
              // Reset only membership review controls; resource-directory
              // search/type/enrollment, card selection, card order and
              // per-card collapse state remain untouched.
              setRosterMode("all");
              setRosterStatus("all");
              setRosterSort("retained");
              setRosterSearch("");
              setRosterDate(date);
            }}>
            Reset membership review (keep resource filters)
          </button>
          {resourceFiltersActive && (
            <button type="button" className="secondary" onClick={() => {
              setResourceSearch("");
              setResourceType("all");
              setResourceEnrollment("all");
              setRosterMode("all");
              setRosterStatus("all");
              setRosterSort("retained");
              setRosterSearch("");
              setOnlyMatchingRosterResources(false);
              setOnlyWithoutMatchingRosterResources(false);
              setResourceCountSort("directory");
              setRosterDate(date);
            }}>
              Clear resource filters
            </button>
          )}
        </div>
        <p role="status" aria-live="polite">
          Showing {shownRosterResources.length} of {currentResources.length}
          {" "}{history ? "archived" : "current"} resources.
        </p>
        <div role="group" aria-label="Roster membership overview">
          <h3>Roster membership overview</h3>
          <div role="group" aria-label="Current roster review scope">
            <p className="muted">
              Resource records: {history ? "Archived" : "Current"}.
              {" "}Membership period: {rosterMode === "all"
                ? "All retained history"
                : "Overlapping selected day " + (rosterDate || "(not selected)")}.
              {" "}Membership status: {reviewContext.membershipStatus}.
              {" "}Resource type: {reviewContext.resourceType}.
              {" "}Enrollment: {reviewContext.enrollment}.
              {" "}Card selection: {reviewContext.cardSelection}.
              {" "}Card order: {reviewContext.resourceOrder}.
            </p>
            <p className="muted">
              Resource-name search applied: {reviewContext.resourceSearchApplied}.
              {" "}Employee-name/title search applied: {reviewContext.memberSearchApplied}.
              {" "}Search terms are not repeated here.
            </p>
          </div>
          <p>
            Matching resources: {rosterOverview.matchingResources}
            {" "}of {rosterOverview.directoryResources} directory resources.
          </p>
          <p>
            Matching membership records: {rosterOverview.matchingMemberships}.
            {" "}Current records: {rosterOverview.currentMemberships}.
            {" "}Archived records: {rosterOverview.archivedMemberships}.
          </p>
          <div role="group" aria-label="Resources without matching roster records">
            <p>
              Resources without matches: {rosterUnmatchedOverview.withoutMatching}.
              {" "}Enrolled workers/crews: {rosterUnmatchedOverview.enrolledWithoutMatching}.
              {" "}Resource-only workers/crews: {rosterUnmatchedOverview.resourceOnlyWithoutMatching}.
              {" "}Equipment: {rosterUnmatchedOverview.equipmentWithoutMatching}.
            </p>
            <div className="schedule-toolbar" role="group"
              aria-label="Review resources without matching memberships by category">
              <button type="button" className="secondary"
                disabled={rosterUnmatchedOverview.enrolledWithoutMatching === 0}
                onClick={() => reviewRosterGapCategory("enrolled")}>
                Review enrolled worker/crew gaps
              </button>
              <button type="button" className="secondary"
                disabled={rosterUnmatchedOverview.resourceOnlyWithoutMatching === 0}
                onClick={() => reviewRosterGapCategory("resource-only")}>
                Review resource-only worker/crew gaps
              </button>
              <button type="button" className="secondary"
                disabled={rosterUnmatchedOverview.equipmentWithoutMatching === 0}
                onClick={() => reviewRosterGapCategory("equipment")}>
                Review equipment gaps
              </button>
              <button type="button" className="secondary"
                disabled={!rosterCategoryNarrowed}
                onClick={showAllRosterResourceCategories}>
                Show all resource categories (keep roster filters)
              </button>
            </div>
          </div>
          <p className="muted">
            Counts are retained membership records matching the selected
            resource, date, status and name/title filters, not unique
            employees, available workers or staffing capacity.
            The no-match breakdown groups resources by retained enrollment,
            not worker availability or booking eligibility. Review buttons
            narrow the directory to the selected historic no-match category
            without changing the roster date or saved records. Show all
            resource categories clears only resource kind, enrollment and
            card-only narrowing while retaining roster date and searches.
          </p>
          <button type="button" className="secondary"
            disabled={!exportableRosterSummary}
            onClick={downloadRosterSummary}>
            Download roster overview CSV
          </button>
          <p className="muted">
            One row per visible resource, including zero-match cards when
            shown. No employee names, contacts or raw IDs are exported.
          </p>
        </div>
        <p className="muted">
          Enrollment means a Worker or Crew has retained membership history,
          even when its last membership is archived. Equipment has no employee
          enrollment and appears only with All enrollment types.
          Membership review shows periods overlapping any part of the selected
          local day. Status filters describe the membership record's archive
          state. Sorting uses the original effective start instant, not the
          archive or creation date, and only changes row order. Neither
          filtering nor sorting changes enrollment, employee activity or
          booking eligibility. Search matches membership titles and linked
          employee names, not contact details or IDs. Match-only hides
          resource cards with no matching retained memberships; the
          complementary without-matches view shows only such cards.
          Neither selection changes enrollment, history or booking rights.
          Resource-card sort
          orders recorded membership counts, not distinct staff or capacity.
          Each resource card shows a matching Current/Archived record
          breakdown. Membership entries can be collapsed without hiding
          counts, changing filters, enrollment or either CSV report.
          Expand all / Collapse all affect only the currently shown
          resource cards, preserving hidden cards' individual choices.
          The review date is independent of Availability below.
        </p>
        {rosterDateError && <p role="alert">{rosterDateError}</p>}
        <button type="button" className="secondary"
          disabled={!exportableRosterRows}
          onClick={downloadRosterReview}>
          Download filtered roster memberships CSV
        </button>
        <p className="muted">
          Export includes all membership rows shown by resource search,
          type, enrollment, record status, member search, resource-card and
          membership sorting, and selected-day controls.
          No contact details or internal IDs are included.
          This is a dated roster record, not booking eligibility.
        </p>
        <div className="schedule-toolbar" role="group"
          aria-label="Shown resource membership entry visibility">
          <button type="button" className="secondary"
            disabled={shownRosterResources.length === 0 ||
              collapsedShownRosterCount === shownRosterResources.length}
            onClick={() => setCollapsedRosterCards((previous) =>
              setShownRosterCardsCollapsed(
                previous, shownRosterResources, organizationId, true,
              ))}>
            Collapse all shown membership entries
          </button>
          <button type="button" className="secondary"
            disabled={collapsedShownRosterCount === 0}
            onClick={() => setCollapsedRosterCards((previous) =>
              setShownRosterCardsCollapsed(
                previous, shownRosterResources, organizationId, false,
              ))}>
            Expand all shown membership entries
          </button>
        </div>
        <div className="workforce-grid">
          {shownRosterResources.map((r) => {
              const allRows = resourceMembershipRowsForReview(
                scopedMemberships, r, "all", rosterDate, zone,
              );
              const dateRows = resourceMembershipRowsForReview(
                scopedMemberships, r, rosterMode, rosterDate, zone,
              );
              const statusRows = filterResourceMembershipRecordStatus(
                dateRows, rosterStatus,
              );
              const searchedRows = filterResourceMembershipsByName(
                statusRows, scopedRosterRecords, rosterSearch,
              );
              const rows = orderResourceMembershipsByStart(
                searchedRows, rosterSort,
              );
              const archivedMatching = searchedRows.filter(
                (membership) => membership.archived,
              ).length;
              const currentMatching = searchedRows.length - archivedMatching;
              const cardKey = rosterCardCollapseKey(organizationId, r.id);
              const membershipListId = "resource-membership-entries-" + r.id;
              const collapsed = collapsedRosterCards.includes(cardKey);
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
                      : allRows.length
                        ? "Enrolled — employee reservations required"
                        : "Resource-only — no employee reservations"}
                  </p>
                  <p className="muted">
                    Showing {rows.length} of {allRows.length}
                    {" "}retained dated memberships
                    {rosterMode === "overlapping-day"
                      ? " overlapping " + (rosterDate || "the selected day")
                      : ""}.
                  </p>
                  <div role="group" aria-label="Matching membership status breakdown">
                    <p className="muted">
                      Matching records: {rows.length}.
                      {" "}Current: {currentMatching}.
                      {" "}Archived: {archivedMatching}.
                    </p>
                  </div>
                  <button type="button" className="secondary"
                    aria-expanded={!collapsed}
                    aria-controls={membershipListId}
                    onClick={() => setCollapsedRosterCards((previous) =>
                      previous.includes(cardKey)
                        ? previous.filter((key) => key !== cardKey)
                        : [...previous, cardKey]
                    )}>
                    {collapsed ? "Show membership entries" : "Hide membership entries"}
                  </button>
                  <div id={membershipListId}>
                    {!collapsed && (
                      <>
                        <ul className="workforce-members">
                          {rows.map((m) => (
                      <li key={m.id}>
                        <strong>
                          {relatedLabel(m.data.employee, scopedRosterRecords)}
                        </strong>
                        {m.archived ? " · Membership archived" : ""}
                        <br />
                        <span>{range(m)}</span>
                        <p>{String(m.data.title)}</p>
                        {actions(m)}
                      </li>
                          ))}
                        </ul>
                        {!rows.length && (
                          <p className="empty-state">
                      {rosterDateError
                        ? "Choose a valid membership review date."
                        : allRows.length === 0
                          ? "No dated memberships."
                          : rosterMode === "overlapping-day" &&
                            dateRows.length === 0
                            ? "No retained memberships overlap the selected day."
                            : rosterStatus !== "all" && statusRows.length === 0
                              ? "No retained memberships match this status filter."
                              : rosterSearch.trim().length > 0
                                ? "No retained memberships match this roster search."
                                : "No dated memberships."}
                          </p>
                        )}
                      </>
                    )}
                  </div>
                </article>
              );
            })}
        </div>
        {shownRosterResources.length === 0 && (
          <p className="empty-state">
            {currentResources.length === 0
              ? "No resources in this view."
              : onlyMatchingRosterResources && displayedResources.length > 0
                ? "No resources have memberships matching these roster filters."
                : onlyWithoutMatchingRosterResources && displayedResources.length > 0
                  ? "Every selected resource has a matching membership record."
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
        <button type="button" className="secondary"
          disabled={displayedPeriods.length === 0}
          onClick={downloadFilteredAvailabilityPeriods}>
          Download filtered availability periods CSV
        </button>
        <p className="muted">
          Downloads only the periods matching this day, current/archived
          view, type and search. Local times include UTC instants for
          daylight-saving clarity. These are recorded periods, not
          verified staffing capacity or booking eligibility.
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
                placeholder="Employee, appointment or crew/worker name"
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
            <div>
              <label htmlFor="assignment-history-sort">
                Sort assignment history
              </label>
              <select
                id="assignment-history-sort"
                value={historySort}
                onChange={(event) => {
                  setHistorySort(event.target.value as StaffAssignmentHistorySort);
                  setHistoryShown(STAFF_HISTORY_PAGE_SIZE);
                }}
              >
                <option value="retained">Retained record order</option>
                <option value="newest">Newest scheduled start first</option>
                <option value="oldest">Oldest scheduled start first</option>
              </select>
            </div>
            {historyFiltersActive && (
              <button type="button" className="secondary" onClick={() => {
                setHistorySearch("");
                setHistoryStatus("all");
                setHistorySort("retained");
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
            Search also matches the linked crew or worker name when it belongs
            to this business. Newest/oldest sorts use the saved scheduled
            start instant, not when a revision was created or released.
          </p>
          {historyDateError && (
            <p role="alert">{historyDateError}</p>
          )}
          <p role="status" aria-live="polite">
            Showing {shownHistory.length} of {matchingHistory.length} matching
            retained assignments ({historyCounts.total} total).
          </p>
          <button type="button" className="secondary"
            disabled={!!historyDateError || matchingHistory.length === 0}
            onClick={downloadFilteredAssignmentHistory}>
            Download filtered assignment history CSV
          </button>
          <p className="muted">
            Download includes every matching retained allocation (not only
            the first ten shown here), using the current search, dates, status
            and sort. This fictional employee history includes names and
            work roles; handle the file as business records.
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
