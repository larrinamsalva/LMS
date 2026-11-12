import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { WorkspaceRecord } from "../core/engine";
import {
  minorToDecimal,
  money,
  type EstimatePricing,
  type EstimateVersion,
} from "../core/pricing";
import { invoiceLabel } from "../core/invoices";
import type { RecordData } from "../core/config";
import { relatedLabel } from "./schedule";
import { serviceRateCardCsv, serviceRateCardRows } from "../core/service-rate-card-csv";
import { rateCoverageAudit } from "../core/service-rate-coverage";
import { serviceRateCoverageReviewCsv } from "../core/service-rate-coverage-csv";
import {
  allAreaRateCoverage, allAreaRateCoverageCsv, allAreaMissingRateReviewCsv,
} from "../core/service-rate-coverage-overview";
import { filterPricingCatalogCards } from "../core/pricing-catalog-search";
import {
  upcomingServiceRateDates,
  nextUpcomingRateChangeDate,
  upcomingRateEventReviewDate,
  type RateDateWindow,
} from "../core/upcoming-service-rate-dates";
import { upcomingServiceRateDatesCsv } from "../core/upcoming-service-rate-dates-csv";
import { reviewServiceRateContinuity } from "../core/service-rate-continuity";
import { summarizeContinuityActions } from "../core/service-rate-continuity-action-summary";
import { investigateRateContinuityGap } from "../core/service-rate-continuity-investigation";
import { rateGapAuditTarget } from "../core/service-rate-gap-audit-target";
import { localCalendarDate } from "../core/local-calendar-date";
import {
  rememberRateReviewJump,
  returnableRateReviewDate,
  type RateReviewJump,
} from "../core/rate-review-navigation";
import {
  serviceRateContinuityReviewCsv,
  serviceRateContinuityFilteredCsv,
  serviceRateContinuitySelectedCsv,
} from "../core/service-rate-continuity-csv";
import {
  selectedContinuityReviewIssues,
  updateVisibleContinuitySelection,
  type VisibleContinuitySelectionAction,
} from "../core/service-rate-continuity-selection";
import {
  filterContinuityWarnings,
  type ContinuityWarningFilter,
  type ContinuityWarningSort,
} from "../core/service-rate-continuity-filter";
interface Actions {
  canManage: boolean;
  busy: boolean;
  onAdd: (entity: string) => void;
  onEdit: (record: WorkspaceRecord) => void;
  onArchive: (record: WorkspaceRecord) => void;
}
export function Catalog({
  records,
  canManage,
  busy,
  onAdd,
  onEdit,
  onArchive,
  organizationId,
}: Actions & { records: WorkspaceRecord[]; organizationId: string }) {
  const [archived, setArchived] = useState(false);
  const [asOfDate, setAsOfDate] = useState("");
  const [selectedAreaId, setSelectedAreaId] = useState("");
  const [catalogSearch, setCatalogSearch] = useState("");
  const [upcomingWindowDays, setUpcomingWindowDays] = useState<RateDateWindow>(30);
  const [expandedContinuityRateId, setExpandedContinuityRateId] = useState("");
  const [continuityWarningType, setContinuityWarningType] =
    useState<ContinuityWarningFilter>("all");
  const [continuityWarningSearch, setContinuityWarningSearch] = useState("");
  const [continuityWarningSort, setContinuityWarningSort] =
    useState<ContinuityWarningSort>("soonest");
  const [continuitySelection, setContinuitySelection] = useState<{
    scopeKey: string; rateIds: string[];
  }>({ scopeKey: "", rateIds: [] });
  const [previousCoverageSelection, setPreviousCoverageSelection] = useState<{
    date: string;
    areaId: string;
  } | null>(null);
  const [previousNextRateReview, setPreviousNextRateReview] =
    useState<RateReviewJump | null>(null);
  const { services, rates, zones } = filterPricingCatalogCards(
    records, organizationId, archived, asOfDate, selectedAreaId, catalogSearch,
  );
  const areaOptions = records.filter((r) =>
    r.organization_id === organizationId && r.entity === "pricing-zones",
  ).sort((a, b) => String(a.data.name).localeCompare(String(b.data.name)));
  const exportRows = serviceRateCardRows(
    records, organizationId, archived, asOfDate, selectedAreaId,
  );
  const coverage = rateCoverageAudit(
    records, organizationId, selectedAreaId, asOfDate,
  );
  const areaOverview = allAreaRateCoverage(records, organizationId, asOfDate);
  const upcomingDates = upcomingServiceRateDates(
    records, organizationId, asOfDate, selectedAreaId, upcomingWindowDays,
  );
  const nextRateReviewDate = nextUpcomingRateChangeDate(upcomingDates);
  const returnRateReviewDate = returnableRateReviewDate(
    previousNextRateReview, organizationId, asOfDate, selectedAreaId,
  );
  const continuity = reviewServiceRateContinuity(
    records, organizationId, asOfDate, selectedAreaId, upcomingWindowDays,
  );
  const continuityActions = summarizeContinuityActions(continuity);
  const continuityScopeKey = JSON.stringify([
    organizationId, asOfDate, selectedAreaId, upcomingWindowDays,
  ]);
  const selectedContinuityIds = continuitySelection.scopeKey === continuityScopeKey
    ? continuitySelection.rateIds : [];
  const selectedContinuityItems = selectedContinuityReviewIssues(
    continuity, selectedContinuityIds,
  );
  const selectedContinuityIdSet = new Set(
    selectedContinuityItems.map((issue) => issue.rateId),
  );
  useEffect(() => {
    setContinuitySelection({ scopeKey: "", rateIds: [] });
  }, [organizationId, asOfDate, selectedAreaId, upcomingWindowDays]);
  const continuityFilterActive =
    continuityWarningType !== "all" || continuityWarningSearch.trim().length > 0;
  const visibleContinuityIssues = continuity.status === "ready"
    ? filterContinuityWarnings(
      continuity.issues, continuityWarningType, continuityWarningSearch,
      continuityWarningSort,
    ) : [];
  const selectedVisibleCount = visibleContinuityIssues.filter((issue) =>
    selectedContinuityIdSet.has(issue.rateId),
  ).length;
  const expandedContinuityIssue = visibleContinuityIssues.find((issue) =>
    issue.rateId === expandedContinuityRateId && issue.status === "Uncovered",
  );
  function chooseContinuityWarning(rateId: string, checked: boolean) {
    if (continuity.status !== "ready" ||
        !continuity.issues.some((issue) => issue.rateId === rateId)) return;
    setContinuitySelection((previous) => {
      const existing = previous.scopeKey === continuityScopeKey
        ? previous.rateIds.filter((id) =>
            continuity.issues.some((issue) => issue.rateId === id))
        : [];
      return {
        scopeKey: continuityScopeKey,
        rateIds: checked
          ? [...new Set([...existing, rateId])]
          : existing.filter((id) => id !== rateId),
      };
    });
  }
  function clearContinuitySelection() {
    setContinuitySelection({ scopeKey: continuityScopeKey, rateIds: [] });
  }
  function changeVisibleContinuitySelection(action: VisibleContinuitySelectionAction) {
    if (continuity.status !== "ready" || visibleContinuityIssues.length === 0)
      return;
    const visibleIds = visibleContinuityIssues.map((issue) => issue.rateId);
    setContinuitySelection((previous) => ({
      scopeKey: continuityScopeKey,
      rateIds: updateVisibleContinuitySelection(
        continuity,
        previous.scopeKey === continuityScopeKey ? previous.rateIds : [],
        visibleIds,
        action,
      ),
    }));
  }
  function focusContinuityWarnings(filter: ContinuityWarningFilter) {
    setContinuityWarningType(filter);
    setContinuityWarningSearch("");
    setExpandedContinuityRateId("");
  }
  const investigation = expandedContinuityIssue
    ? investigateRateContinuityGap(
      records, organizationId, asOfDate, selectedAreaId,
      upcomingWindowDays, expandedContinuityIssue.rateId,
    )
    : { status: "unavailable" as const };
  function reviewGapOnEndDate(rateId: string) {
    const target = rateGapAuditTarget(
      records, organizationId, asOfDate, selectedAreaId,
      upcomingWindowDays, rateId,
    );
    if (target.status !== "ready") return;
    setPreviousCoverageSelection({ date: asOfDate, areaId: selectedAreaId });
    setSelectedAreaId(target.areaId);
    setAsOfDate(target.date);
    setExpandedContinuityRateId("");
    setPreviousNextRateReview(null);
  }
  function restoreCoverageSelection() {
    if (!previousCoverageSelection) return;
    setSelectedAreaId(previousCoverageSelection.areaId);
    setAsOfDate(previousCoverageSelection.date);
    setPreviousCoverageSelection(null);
    setPreviousNextRateReview(null);
  }
  function jumpToRateReviewDate(date: string) {
    const jump = rememberRateReviewJump(
      organizationId, asOfDate, selectedAreaId, date,
    );
    if (!jump) return;
    setAsOfDate(date);
    setPreviousCoverageSelection(null);
    setPreviousNextRateReview(jump);
  }
  function reviewNextRateChange() {
    if (nextRateReviewDate) jumpToRateReviewDate(nextRateReviewDate);
  }
  function reviewSpecificRateChange(
    rateId: string, kind: "Starts" | "Ends", date: string,
  ) {
    const currentReview = upcomingServiceRateDates(
      records, organizationId, asOfDate, selectedAreaId, upcomingWindowDays,
    );
    const verifiedDate = upcomingRateEventReviewDate(
      currentReview, { rateId, kind, date },
    );
    if (verifiedDate) jumpToRateReviewDate(verifiedDate);
  }
  function restoreNextRateReviewDate() {
    if (!returnRateReviewDate) return;
    setAsOfDate(returnRateReviewDate);
    setPreviousNextRateReview(null);
    setPreviousCoverageSelection(null);
  }
  function useTodayForReview() {
    const today = localCalendarDate(new Date());
    if (today === null) return;
    setAsOfDate(today);
    setPreviousCoverageSelection(null);
    setPreviousNextRateReview(null);
  }
  function changeRateReviewDate(date: string) {
    setAsOfDate(date);
    setPreviousCoverageSelection(null);
    setPreviousNextRateReview(null);
  }
  function changeRateReviewArea(areaId: string) {
    setSelectedAreaId(areaId);
    setPreviousCoverageSelection(null);
    setPreviousNextRateReview(null);
  }
  function downloadContinuityReview() {
    if (continuity.status !== "ready" || continuity.issues.length === 0) return;
    const csv = serviceRateContinuityReviewCsv(
      records, organizationId, asOfDate, selectedAreaId, upcomingWindowDays,
    );
    const file = new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(file);
    const link = document.createElement("a");
    link.href = url;
    link.download = "lms-service-rate-continuity-review.csv";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function downloadFilteredContinuityReview() {
    if (continuity.status !== "ready" || !continuityFilterActive ||
        visibleContinuityIssues.length === 0) return;
    const csv = serviceRateContinuityFilteredCsv(
      records, organizationId, asOfDate, selectedAreaId, upcomingWindowDays,
      continuityWarningType, continuityWarningSearch, continuityWarningSort,
    );
    const file = new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(file);
    const link = document.createElement("a");
    link.href = url;
    link.download = "lms-filtered-rate-continuity-review.csv";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function downloadSelectedContinuityReview() {
    if (continuity.status !== "ready" || selectedContinuityItems.length === 0)
      return;
    const csv = serviceRateContinuitySelectedCsv(
      records, organizationId, asOfDate, selectedAreaId, upcomingWindowDays,
      selectedContinuityItems.map((issue) => issue.rateId),
      continuityWarningSort,
    );
    const file = new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(file);
    const link = document.createElement("a");
    link.href = url;
    link.download = "lms-selected-rate-continuity-review.csv";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function downloadUpcomingRateDates() {
    if (upcomingDates.status !== "ready" ||
        upcomingDates.events.length === 0) return;
    const csv = upcomingServiceRateDatesCsv(
      records, organizationId, asOfDate, selectedAreaId, upcomingWindowDays,
    );
    const file = new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(file);
    const link = document.createElement("a");
    link.href = url;
    link.download = "lms-upcoming-service-rate-dates.csv";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function downloadAllAreaMissingRates() {
    if (areaOverview.status !== "ready" ||
        areaOverview.missingCandidateTotal === 0) return;
    const csv = allAreaMissingRateReviewCsv(records, organizationId, asOfDate);
    const file = new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(file);
    const link = document.createElement("a");
    link.href = url;
    link.download = "lms-all-area-missing-rates-review.csv";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function downloadAreaOverview() {
    if (areaOverview.status !== "ready" || areaOverview.areas.length === 0) return;
    const csv = allAreaRateCoverageCsv(records, organizationId, asOfDate);
    const file = new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(file);
    const link = document.createElement("a");
    link.href = url;
    link.download = "lms-all-area-rate-coverage.csv";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function downloadMissingRateReview() {
    if (coverage.status !== "ready" || coverage.gaps.length === 0) return;
    const csv = serviceRateCoverageReviewCsv(
      records, organizationId, selectedAreaId, asOfDate,
    );
    const file = new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(file);
    const link = document.createElement("a");
    link.href = url;
    link.download = "lms-missing-service-rates-review.csv";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function downloadRateCard() {
    if (!exportRows.length) return;
    const csv = serviceRateCardCsv(
      records, organizationId, archived, asOfDate, selectedAreaId,
    );
    const file = new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(file);
    const link = document.createElement("a");
    link.href = url;
    link.download = archived
      ? "lms-archived-service-rates.csv"
      : "lms-active-service-rates.csv";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const actions = (r: WorkspaceRecord) => (
    <div className="actions">
      {!r.archived && (
        <button
          disabled={!canManage || busy}
          className="secondary"
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
      <section className="panel" aria-labelledby="catalog-heading">
        <div className="section-heading">
          <div>
            <span className="eyebrow">Reusable pricing · fictional USD</span>
            <h2 id="catalog-heading">Services & Rates</h2>
          </div>
          <button
            disabled={!canManage || busy}
            onClick={() => onAdd("services")}
          >
            + Add service
          </button>
        </div>
        <p className="muted">
          Owners and admins maintain services and dated area rates. Estimates
          load applicable prices automatically and retain their original
          descriptions and amounts. Area selection is explicit; no
          address/geographic inference or currency conversion runs.
        </p>
        <div className="actions">
          <button
            className="secondary"
            disabled={!canManage || busy}
            onClick={() => onAdd("service-rates")}
          >
            + Add service rate
          </button>
          <button
            className="secondary"
            disabled={!canManage || busy}
            onClick={() => onAdd("pricing-zones")}
          >
            + Add pricing zone
          </button>
          <label className="check-label">
            <input
              type="checkbox"
              checked={archived}
              onChange={(e) => setArchived(e.target.checked)}
            />
            Show archived catalog records
          </label>
          <div>
            <label htmlFor="catalog-card-search">Search catalog cards</label>
            <input
              id="catalog-card-search"
              type="search"
              placeholder="Service, rate or area"
              value={catalogSearch}
              onChange={(event) => setCatalogSearch(event.target.value)}
            />
          </div>
          {catalogSearch !== "" && (
            <button className="secondary" type="button"
              onClick={() => setCatalogSearch("")}>
              Clear catalog search
            </button>
          )}
          <div>
            <label htmlFor="service-rate-date">Rates covering date (optional)</label>
            <input
              id="service-rate-date"
              type="date"
              value={asOfDate}
              onChange={(event) => changeRateReviewDate(event.target.value)}
            />
            <div className="actions">
              <button type="button" className="secondary"
                onClick={useTodayForReview}>
                Use today's date
              </button>
              <button type="button" className="secondary"
                disabled={!asOfDate} onClick={() => changeRateReviewDate("")}>
                Clear review date
              </button>
            </div>
          </div>
          <div>
            <label htmlFor="service-rate-area">Filter service rates by area</label>
            <select
              id="service-rate-area"
              value={selectedAreaId}
              onChange={(event) => changeRateReviewArea(event.target.value)}
            >
              <option value="">All service areas</option>
              {areaOptions.map((area) => (
                <option key={area.id} value={area.id}>
                  {String(area.data.name)}{area.archived ? " (archived)" : ""}
                </option>
              ))}
            </select>
          </div>
          <button
            className="secondary"
            type="button"
            disabled={exportRows.length === 0}
            onClick={downloadRateCard}
          >
            Download {archived ? "archived" : "active"} service rates CSV
          </button>
        </div>
        <p className="muted">
          Use today's date selects the device's local calendar day only
          when clicked; clearing the review date restores the undated
          rate-card view. Neither action updates a saved business record.
          Search only narrows the catalog cards shown below and never changes
          the audit counts or any CSV export. Clear the search to return
          to the complete visible catalog. The read-only rate card lists
          saved prices by service and area,
          with effective dates, USD amounts and archived-link status.
          It follows the active/archived catalog view and the optional
          date filter on saved rate ranges, plus the explicitly chosen
          service-area filter. Clear either filter to see every matching
          saved rate. Effective-until dates are exclusive. Archived rates
          and linked services or areas are not automatically available for
          quoting even when a date matches. Exporting does not create a quote,
          update prices or contact a customer.
        </p>
        {catalogSearch.trim() && (
          <p role="status">
            Search results: {services.length} services, {rates.length} saved rates,
            {" "}{zones.length} pricing areas.
          </p>
        )}
      </section>
      <section className="panel">
        <h2>Services</h2>
        <div className="workforce-grid">
          {services.map((s) => (
            <article
              key={s.id}
              className="workforce-card"
              aria-label={`Service ${s.data.name}`}
            >
              <span className="badge">
                {String(s.data.kind)} · {String(s.data.mode)}
                {s.archived ? " · Archived" : ""}
              </span>
              <h3>{String(s.data.name)}</h3>
              <p>{String(s.data.description ?? "")}</p>
              <p className="muted">
                Unit: {String(s.data.unit)}
                {s.data.category ? " · " + String(s.data.category) : ""}
              </p>
              {s.data.parent && (
                <p>Extra for {relatedLabel(s.data.parent, records)}</p>
              )}
              {actions(s)}
            </article>
          ))}
        </div>
        {!services.length && (
          <p className="empty-state">
            {catalogSearch.trim()
              ? "No services match your catalog search."
              : "Add a service to begin your fictional catalog."}
          </p>
        )}
      </section>
      <section className="panel">
        <h2>Saved rates</h2>
        <p className="muted">
          One active rate per service and area on each date. Effective-until
          dates are exclusive. Close the previous date range before adding
          another; archived rates can only be restored if their range is
          available.
        </p>
        <div className="workforce-grid">
          {rates.map((r) => (
            <article
              key={r.id}
              className="workforce-card"
              aria-label={`Rate ${r.data.title}`}
            >
              <span className="badge">
                v{r.revision}
                {r.archived ? " · Archived" : ""}
              </span>
              <h3>{String(r.data.title)}</h3>
              <p>
                {relatedLabel(r.data.service, records)} ·{" "}
                {relatedLabel(r.data.zone, records)}
              </p>
              <p>
                <strong>{money(String(r.data.amount))}</strong> per configured
                unit
              </p>
              <p>
                {String(r.data.effective_from)} →{" "}
                {String(r.data.effective_until || "Open end")}
              </p>
              {actions(r)}
            </article>
          ))}
        </div>
        {!rates.length && (
          <p className="empty-state">
            {catalogSearch.trim()
              ? "No saved rates match this search and the selected filters."
              : "No saved rates match the selected status, date and service area."}
          </p>
        )}
      </section>
      <section className="panel" aria-labelledby="upcoming-rate-dates-heading">
        <div className="section-heading">
          <h2 id="upcoming-rate-dates-heading">Upcoming rate dates</h2>
          <div className="actions">
            <div>
              <label htmlFor="rate-dates-window">Review upcoming period</label>
              <select
                id="rate-dates-window"
                value={upcomingWindowDays}
                onChange={(event) =>
                  setUpcomingWindowDays(Number(event.target.value) as RateDateWindow)}
              >
                <option value={7}>Next 7 days</option>
                <option value={30}>Next 30 days</option>
                <option value={90}>Next 90 days</option>
              </select>
            </div>
            <button
              type="button"
              className="secondary"
              disabled={!nextRateReviewDate}
              onClick={reviewNextRateChange}
            >
              Review next saved-rate date
            </button>
            {returnRateReviewDate && (
              <button
                type="button"
                className="secondary"
                onClick={restoreNextRateReviewDate}
              >
                Return to previous rate review date
              </button>
            )}
            <button
              type="button"
              className="secondary"
              disabled={upcomingDates.status !== "ready" ||
                upcomingDates.events.length === 0}
              onClick={downloadUpcomingRateDates}
            >
              Download upcoming rate dates CSV
            </button>
          </div>
        </div>
        <p className="muted">
          Review saved active-rate start dates and exclusive end dates
          after the selected rate date above. The chosen area filter also
          applies, but catalog search does not. Archived rate records
          are excluded; archived or unavailable service/area links are
          labeled for manual review. This does not change prices,
          approve quotes, create reminders or notify anyone.
          The optional CSV has blank decision and notes columns for
          review, without private customer details or rate amounts.
          Review next saved-rate date moves the selected review date
          to the earliest saved start or exclusive end boundary within
          the chosen area and lookahead period. This is a manual
          date selection, not approval or application of a rate.
          Each saved-rate event also offers Review this date to
          inspect a specific listed start or exclusive end, even if it
          is not the first upcoming event. The temporary return button
          restores the previous date; manual date/area changes dismiss it.
        </p>
        {returnRateReviewDate && (
          <p>Previous review date: <strong>{returnRateReviewDate}</strong>.</p>
        )}
        {nextRateReviewDate && (
          <p>Next saved-rate review date: <strong>{nextRateReviewDate}</strong>.</p>
        )}
        {upcomingDates.status === "choose" && (
          <p>Choose a rate date above to review upcoming saved-rate dates.</p>
        )}
        {upcomingDates.status === "invalid-date" && (
          <p>Choose a valid rate date to review upcoming saved-rate dates.</p>
        )}
        {upcomingDates.status === "invalid-area" && (
          <p>Choose an available service area to review upcoming rate dates.</p>
        )}
        {upcomingDates.status === "ready" && (
          <>
            <p role="status">
              {upcomingDates.events.length} upcoming rate date events through
              {" "}{upcomingDates.through}.
            </p>
            {upcomingDates.events.length === 0 ? (
              <p>No saved active-rate start or end dates in this period.</p>
            ) : (
              <div className="workforce-grid">
                {upcomingDates.events.map((event) => (
                  <article
                    className="workforce-card"
                    key={event.rateId + ":" + event.kind}
                    aria-label={"Upcoming " + event.kind.toLowerCase() +
                      " for " + event.rateTitle}
                  >
                    <span className="badge">
                      {event.kind === "Starts" ? "Starts" : "Ends (exclusive)"}
                    </span>
                    <h3>{event.rateTitle}</h3>
                    <p>{event.date}</p>
                    <p>{event.serviceName} · {event.areaName}</p>
                    {event.linkStatus !== "Active" && (
                      <p className="muted">Linked catalog status: {event.linkStatus}</p>
                    )}
                    <button
                      type="button"
                      className="secondary"
                      onClick={() => reviewSpecificRateChange(
                        event.rateId, event.kind, event.date,
                      )}
                    >
                      Review this date
                    </button>
                  </article>
                ))}
              </div>
            )}
          </>
        )}
      </section>
      <section className="panel" aria-labelledby="rate-continuity-heading">
        <div className="section-heading">
          <h2 id="rate-continuity-heading">Rate continuity review</h2>
          <div className="actions">
            <button
              type="button"
              className="secondary"
              disabled={continuity.status !== "ready" ||
                continuity.issues.length === 0}
              onClick={downloadContinuityReview}
            >
              Download rate continuity review CSV
            </button>
            <button
              type="button"
              className="secondary"
              disabled={continuity.status !== "ready" ||
                !continuityFilterActive || visibleContinuityIssues.length === 0}
              onClick={downloadFilteredContinuityReview}
            >
              Download filtered continuity review CSV
            </button>
            <button
              type="button"
              className="secondary"
              disabled={continuity.status !== "ready" ||
                selectedContinuityItems.length === 0}
              onClick={downloadSelectedContinuityReview}
            >
              Download selected continuity review CSV
            </button>
          </div>
        </div>
        <p className="muted">
          When a saved active rate ends, check whether another saved active
          rate for the same service and area covers the exclusive end date.
          Reuses the selected rate date, upcoming period and service-area
          filter. This is a planning review, not an automatic rate extension,
          price approval or promise that every service must be offered.
          Archived or unavailable catalog links require separate review.
          Inspect a flagged gap to see saved history for that service
          and area without editing any record.
          Download a formula-safe checklist with blank decision and notes
          columns; exports contain no prices, customers or record IDs.
          The action summary separates missing later rates, known
          delayed starts and catalog links needing review, without
          suggesting any rate is automatically approved. Use a Focus
          button to see a category's warnings and clear any old text
          search. Search, warning-type filters and sorting only change
          the warning cards;
          counts and the original full checklist cover the complete
          selected date, area and review period. A separate filtered
          checklist includes only matching warning cards in their
          current sort order, with the same safe columns and blank
          operator notes; it is disabled when no filter or matches exist.
          Select individual warning cards for a separate selected-only
          follow-up checklist. Selections are temporary, tied to this
          business/date/area/window, and may include hidden-by-filter
          warnings until cleared. Use Select all visible warnings or
          Deselect visible warnings to update only the current filtered
          list; selections hidden by filters are left alone.
        </p>
        <div className="actions">
          <div>
            <label htmlFor="continuity-warning-type">
              Filter continuity warning type
            </label>
            <select id="continuity-warning-type" value={continuityWarningType}
              onChange={(event) => setContinuityWarningType(
                event.target.value as ContinuityWarningFilter,
              )}>
              <option value="all">All warnings</option>
              <option value="uncovered">Uncovered rate gaps</option>
              <option value="no-later">No later saved rate</option>
              <option value="delayed">Delayed replacement</option>
              <option value="review-links">Linked-record review</option>
            </select>
          </div>
          <div>
            <label htmlFor="continuity-warning-search">Search continuity warnings</label>
            <input id="continuity-warning-search" type="search"
              placeholder="Rate, service, area or end date"
              value={continuityWarningSearch}
              onChange={(event) => setContinuityWarningSearch(event.target.value)}
            />
          </div>
          <div>
            <label htmlFor="continuity-warning-sort">Sort continuity warnings</label>
            <select id="continuity-warning-sort" value={continuityWarningSort}
              onChange={(event) => setContinuityWarningSort(
                event.target.value as ContinuityWarningSort,
              )}>
              <option value="soonest">Soonest end date first</option>
              <option value="latest">Latest end date first</option>
              <option value="service">Service name A to Z</option>
              <option value="area">Area name A to Z</option>
              <option value="area-desc">Area name Z to A</option>
            </select>
          </div>
          {(continuityWarningType !== "all" || continuityWarningSearch !== "") && (
            <button className="secondary" type="button" onClick={() => {
              setContinuityWarningType("all");
              setContinuityWarningSearch("");
            }}>
              Clear continuity filters
            </button>
          )}
        </div>
        {continuity.status === "choose" && (
          <p>Choose a rate date above to review saved-rate continuity.</p>
        )}
        {continuity.status === "invalid-date" && (
          <p>Choose a valid date to review saved-rate continuity.</p>
        )}
        {continuity.status === "invalid-area" && (
          <p>Choose an available service area to review saved-rate continuity.</p>
        )}
        {continuity.status === "ready" && (
          <>
            <p role="status">
              {continuity.reviewedEnds} upcoming saved-rate ends reviewed
              through {" "}{continuity.through}:{" "}
              <strong>{continuity.uncoveredCount} without next-day saved-rate coverage</strong>
              {" "}and {continuity.linkedReviewCount} requiring linked-record review.
            </p>
            {continuityActions.status === "ready" && (
              <div role="group" aria-label="Rate continuity action summary"
                className="workforce-grid">
                <div className="workforce-card">
                  <h3>No later saved rate</h3>
                  <p><strong>{continuityActions.withoutLaterRate}</strong>
                    {" "}ending rates with no later active saved rate recorded.
                  </p>
                  {continuityActions.firstWithoutLaterEnd && (
                    <p>Earliest exclusive end:{" "}
                      {continuityActions.firstWithoutLaterEnd}</p>
                  )}
                  <button type="button" className="secondary"
                    disabled={continuityActions.withoutLaterRate === 0}
                    onClick={() => focusContinuityWarnings("no-later")}>
                    Focus no later saved rates
                  </button>
                </div>
                <div className="workforce-card">
                  <h3>Later saved rate starts after end</h3>
                  <p><strong>{continuityActions.delayedReplacement}</strong>
                    {" "}ending rates with a known uncovered period before
                    a later saved rate starts.
                  </p>
                  {continuityActions.firstDelayedEnd && (
                    <p>Earliest exclusive end: {continuityActions.firstDelayedEnd}</p>
                  )}
                  <button type="button" className="secondary"
                    disabled={continuityActions.delayedReplacement === 0}
                    onClick={() => focusContinuityWarnings("delayed")}>
                    Focus delayed replacement gaps
                  </button>
                </div>
                <div className="workforce-card">
                  <h3>Linked catalog records to review</h3>
                  <p><strong>{continuityActions.reviewLinks}</strong>
                    {" "}ending rates whose service or area links need
                    manual confirmation.
                  </p>
                  {continuityActions.firstReviewLinksEnd && (
                    <p>Earliest exclusive end: {continuityActions.firstReviewLinksEnd}</p>
                  )}
                  <button type="button" className="secondary"
                    disabled={continuityActions.reviewLinks === 0}
                    onClick={() => focusContinuityWarnings("review-links")}>
                    Focus linked-record reviews
                  </button>
                </div>
              </div>
            )}
            <div className="actions" role="group"
              aria-label="Selected continuity warnings">
              <p>
                Selected for follow-up: {selectedContinuityItems.length} of
                {" "}{continuity.issues.length} continuity warnings.
                {selectedContinuityItems.length > selectedVisibleCount && (
                  <> {" "}{selectedContinuityItems.length - selectedVisibleCount}
                    {" "}selected warnings are hidden by current filters.</>
                )}
              </p>
              <button type="button" className="secondary"
                disabled={visibleContinuityIssues.length === 0 ||
                  selectedVisibleCount === visibleContinuityIssues.length}
                onClick={() => changeVisibleContinuitySelection("select-visible")}>
                Select all visible warnings
              </button>
              <button type="button" className="secondary"
                disabled={selectedVisibleCount === 0}
                onClick={() => changeVisibleContinuitySelection("deselect-visible")}>
                Deselect visible warnings
              </button>
              <button type="button" className="secondary"
                disabled={selectedContinuityItems.length === 0}
                onClick={clearContinuitySelection}>
                Clear selected warnings
              </button>
            </div>
            {(continuityWarningType !== "all" || continuityWarningSearch.trim()) && (
              <p>
                Showing {visibleContinuityIssues.length} of {continuity.issues.length}
                {" "}continuity warnings.
              </p>
            )}
            {continuity.issues.length === 0 ? (
              <p>No continuity-review candidates found for this period.</p>
            ) : (
              <div className="workforce-grid">
                {visibleContinuityIssues.map((item) => (
                  <article key={item.rateId} className="workforce-card"
                    aria-label={"Continuity review for " + item.rateTitle}>
                    <label>
                      <input type="checkbox"
                        aria-label={"Select " + item.rateTitle + " in " +
                          item.areaName + " for follow-up"}
                        checked={selectedContinuityIdSet.has(item.rateId)}
                        onChange={(event) =>
                          chooseContinuityWarning(item.rateId, event.target.checked)}
                      />
                      Select for follow-up
                    </label>
                    <span className="badge">{item.status}</span>
                    <h3>{item.rateTitle}</h3>
                    <p>{item.serviceName} · {item.areaName}</p>
                    <p>Saved rate ends (exclusive): {item.endDate}</p>
                    {item.status === "Uncovered" ? (
                      <p className="muted">
                        No other active saved rate covers this service/area
                        on {item.endDate}.
                        {item.nextStart
                          ? " Next saved rate starts on " + item.nextStart + "."
                          : " No later saved rate found."}
                      </p>
                    ) : (
                      <p className="muted">
                        Review archived or unavailable linked service/area records
                        before deciding whether a replacement is needed.
                      </p>
                    )}
                    {item.status === "Uncovered" && (
                      <>
                        <button type="button" className="secondary"
                          onClick={() => reviewGapOnEndDate(item.rateId)}>
                          Review coverage on end date
                        </button>
                        <button
                          type="button"
                          className="secondary"
                          aria-expanded={expandedContinuityRateId === item.rateId &&
                            investigation.status === "ready"}
                          onClick={() => setExpandedContinuityRateId(
                            expandedContinuityRateId === item.rateId
                              ? "" : item.rateId,
                          )}
                        >
                          {expandedContinuityRateId === item.rateId
                            ? "Close saved-rate history"
                            : "Inspect saved-rate history"}
                        </button>
                        {expandedContinuityRateId === item.rateId &&
                          investigation.status === "ready" && (
                          <div aria-label={"Saved rate history for " + item.rateTitle}>
                            <h4>Saved rate history</h4>
                            <p>
                              {investigation.gapDays === null
                                ? "No later active saved rate; the duration is unknown."
                                : investigation.gapDays +
                                  " calendar days without active saved-rate coverage."}
                            </p>
                            <ul>
                              {investigation.entries.map((entry) => (
                                <li key={entry.rateId}>
                                  <strong>{entry.title}</strong> —{" "}
                                  {entry.from} to {entry.until}
                                  {" "}{entry.archived ? "(Archived; not coverage)"
                                    : "(Active saved rate)"}
                                  {entry.isEnding ? " · Ending rate" : ""}
                                </li>
                              ))}
                            </ul>
                            <p className="muted">
                              Historical dates and archived rates are for review
                              only; no saved rate is automatically quotable.
                            </p>
                          </div>
                        )}
                      </>
                    )}
                  </article>
                ))}
              </div>
            )}
            {continuity.issues.length > 0 &&
              visibleContinuityIssues.length === 0 && (
              <p className="empty-state">
                No continuity warnings match these review filters.
              </p>
            )}
          </>
        )}
      </section>
      <section className="panel" aria-labelledby="rate-coverage-heading">
        <div className="section-heading">
          <h2 id="rate-coverage-heading">Rate coverage audit</h2>
          <div className="actions">
            {previousCoverageSelection && (
              <button
                type="button"
                className="secondary"
                onClick={restoreCoverageSelection}
              >
                Return to previous date and area
              </button>
            )}
            <button
              type="button"
              className="secondary"
              disabled={coverage.status !== "ready" || coverage.gaps.length === 0}
              onClick={downloadMissingRateReview}
            >
              Download missing-rate review CSV
            </button>
          </div>
        </div>
        {previousCoverageSelection && coverage.status === "ready" && (
          <p role="status">
            Reviewing saved-rate coverage for {coverage.areaName} on
            {" "}{coverage.date}. No prices were changed.
          </p>
        )}
        <p className="muted">
          Check which active catalog services lack a live saved rate for
          a chosen service area and date. This is an informational check,
          not a promise that every service is offered in every area. A
          matching rate is not a verified quote or price approval.
          Nothing is saved or automatically priced. The optional CSV
          contains missing candidates with blank decision and notes
          columns; downloading cannot create a saved rate.
        </p>
        {coverage.status === "choose" && (
          <p>Choose a service area and a rate date above to audit coverage.</p>
        )}
        {coverage.status === "invalid-date" && (
          <p>Choose a valid rate date to audit coverage.</p>
        )}
        {coverage.status === "unavailable-area" && (
          <p>Choose an active service area for live rate coverage.
            Archived areas remain available for historical rate review only.</p>
        )}
        {coverage.status === "ready" && (
          <>
            <p role="status">
              {coverage.coveredServices} of {coverage.totalActiveServices} active
              catalog services have a saved active rate covering {coverage.date}
              in {coverage.areaName}.{" "}
              <strong>{coverage.gaps.length} missing rate candidates.</strong>
            </p>
            {coverage.gaps.length === 0 ? (
              <p>No missing active saved-rate coverage found for this selection.</p>
            ) : (
              <div className="workforce-grid">
                {coverage.gaps.map((gap) => (
                  <article
                    className="workforce-card"
                    key={gap.serviceId}
                    aria-label={"Missing rate for " + gap.serviceName}
                  >
                    <h3>{gap.serviceName}</h3>
                    <p>{gap.kind} · {gap.mode} · {gap.unit}</p>
                    <p className="muted">
                      No active rate for this area/date. Review whether this
                      service should be offered here before adding a rate.
                    </p>
                  </article>
                ))}
              </div>
            )}
          </>
        )}
      </section>
      <section className="panel" aria-labelledby="all-area-rate-coverage-heading">
        <div className="section-heading">
          <h2 id="all-area-rate-coverage-heading">All-area rate coverage</h2>
          <div className="actions">
            <button
              className="secondary"
              type="button"
              disabled={areaOverview.status !== "ready" || areaOverview.areas.length === 0}
              onClick={downloadAreaOverview}
            >
              Download all-area rate coverage CSV
            </button>
            <button
              className="secondary"
              type="button"
              disabled={areaOverview.status !== "ready" ||
                areaOverview.missingCandidateTotal === 0}
              onClick={downloadAllAreaMissingRates}
            >
              Download all-area missing-rate review CSV
            </button>
          </div>
        </div>
        <p className="muted">
          See missing saved-rate candidates across every active service area
          for the selected date above. Each count is a service/area pair,
          not a unique service or a requirement to offer that service.
          Archived areas are excluded. The missing-rate review CSV
          lists each uncovered area/service pair with blank decision
          and notes columns. Neither download creates rates or offers
          services automatically. This is a read-only planning view.
        </p>
        {areaOverview.status === "choose" && (
          <p>Choose a rate date above to review all active service areas.</p>
        )}
        {areaOverview.status === "invalid-date" && (
          <p>Choose a valid date to review all active service areas.</p>
        )}
        {areaOverview.status === "ready" && (
          <>
            <p role="status">
              {areaOverview.missingCandidateTotal} missing-rate candidates
              across {areaOverview.areas.length} active service areas on
              {" "}{areaOverview.date}.
            </p>
            {areaOverview.areas.length === 0 && (
              <p>No active service areas to review.</p>
            )}
            <div className="workforce-grid">
              {areaOverview.areas.map((area) => (
                <article
                  className="workforce-card"
                  key={area.areaId}
                  aria-label={"Coverage for " + area.areaName}
                >
                  <h3>{area.areaName}</h3>
                  <p>
                    <strong>{area.missingCandidates} missing-rate candidates.</strong>
                    {" "}{area.coveredServices} of {area.totalActiveServices}
                    {" "}active catalog services have a saved rate.
                  </p>
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => setSelectedAreaId(area.areaId)}
                    aria-label={"Review missing rates in " + area.areaName}
                  >
                    Review this area
                  </button>
                </article>
              ))}
            </div>
          </>
        )}
      </section>
      <section className="panel">
        <h2>Pricing zones / service areas</h2>
        <div className="workforce-grid">
          {zones.map((z) => (
            <article
              key={z.id}
              className="workforce-card"
              aria-label={`Pricing area ${z.data.name}`}
            >
              <h3>{String(z.data.name)}</h3>
              <p>{String(z.data.description ?? "")}</p>
              {actions(z)}
            </article>
          ))}
        </div>
        {catalogSearch.trim() && zones.length === 0 && (
          <p className="empty-state">No pricing areas match your catalog search.</p>
        )}
      </section>
    </div>
  );
}
export function EstimatePreview({
  record,
  version,
  businessName,
  theme,
  onClose,
  invoice = false,
}: {
  record: WorkspaceRecord;
  invoice?: boolean;
  version?: { data: RecordData; revision: number; archived?: boolean };
  businessName: string;
  theme: "light" | "dark";
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null),
    title = useId();
  const data = version?.data ?? record.data,
    p = data.pricing as EstimatePricing;
  useEffect(() => {
    const previous = document.activeElement;
    ref.current?.showModal();
    return () => {
      ref.current?.close();
      if (previous instanceof HTMLElement) previous.focus();
    };
  }, []);
  return createPortal(
    <dialog
      ref={ref}
      id="estimate-print-root"
      className="app estimate-print"
      data-theme={theme}
      aria-labelledby={title}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <div className="actions print-controls">
        <button className="secondary" onClick={onClose}>
          Close preview
        </button>
        <button onClick={() => window.print()}>Print fictional draft</button>
      </div>
      <p className="eyebrow">{businessName}</p>
      <h2 id={title}>{String(data.title)}</h2>
      <p>
        <strong>
          {invoice ? invoiceLabel : "FICTIONAL INTERNAL ESTIMATE DRAFT"}
        </strong>
      </p>
      <p>
        {invoice
          ? "Unissued internal demonstration. No payment, receipt or customer communication."
          : "No invoice, payment request or customer communication."}{" "}
        {String(data.status)} · revision {version?.revision ?? record.revision}
        {(version?.archived ?? record.archived) ? " · Archived" : ""}
      </p>
      {invoice && (
        <p>
          Originating estimate {String(data.estimate)} · exact revision{" "}
          {String(data.estimate_revision)}. Revision reason:{" "}
          {String(data.reason)}
        </p>
      )}
      <dl>
        <div>
          <dt>Customer snapshot</dt>
          <dd>{p.customerName}</dd>
        </div>
        <div>
          <dt>Pricing date / area</dt>
          <dd>
            {String(data.as_of)} · {p.lines[0]?.snapshot.zoneName}
          </dd>
        </div>
        {p.workTitle && (
          <div>
            <dt>Work</dt>
            <dd>{p.workTitle}</dd>
          </div>
        )}
        {p.appointmentTitle && (
          <div>
            <dt>Appointment</dt>
            <dd>{p.appointmentTitle}</dd>
          </div>
        )}
      </dl>
      <ol className="estimate-preview-lines">
        {p.lines.map((l) => (
          <li key={l.id}>
            <h3>
              {l.snapshot.name}
              {l.snapshot.kind === "Extra" ? " · Extra" : ""}
            </h3>
            <p>{l.snapshot.description}</p>
            <p>
              {l.quantity} {l.snapshot.unit} × {money(l.snapshot.amountMinor)} ·{" "}
              {l.snapshot.mode}
            </p>
            {l.note && <p>{l.note}</p>}
            <strong>{money(l.amountMinor)}</strong>
          </li>
        ))}
      </ol>
      <dl className="money-totals">
        <div>
          <dt>Subtotal</dt>
          <dd>{money(p.subtotalMinor)}</dd>
        </div>
        <div>
          <dt>Discount</dt>
          <dd>{money(p.discountMinor)}</dd>
        </div>
        <div>
          <dt>
            {p.tax.mode === "Manual"
              ? `${p.tax.label} (${minorToDecimal(p.tax.basisPoints)}%)`
              : "No tax configured"}
          </dt>
          <dd>{money(p.taxMinor)}</dd>
        </div>
        <div>
          <dt>Total</dt>
          <dd>{money(p.totalMinor)}</dd>
        </div>
      </dl>
      {data.notes && <p>{String(data.notes)}</p>}
      <p className="muted">
        USD. Half-up rounding per line, then discount, then exclusive manual tax
        on net. Manual tax is fictional configuration, not automated tax-law
        compliance.
      </p>
    </dialog>,
    document.body,
  );
}
export function Estimates({
  records,
  versions,
  businessName,
  theme,
  canManage,
  busy,
  onAdd,
  onEdit,
  onArchive,
  onConvert,
}: Actions & {
  onConvert?: (record: WorkspaceRecord) => void;
  records: WorkspaceRecord[];
  versions: EstimateVersion[];
  businessName: string;
  theme: "light" | "dark";
}) {
  const [archived, setArchived] = useState(false),
    [preview, setPreview] = useState<{
      record: WorkspaceRecord;
      version?: EstimateVersion;
    } | null>(null);
  const rows = records.filter(
    (r) => r.entity === "estimates" && r.archived === archived,
  );
  return (
    <section className="panel" aria-labelledby="estimates-heading">
      <div className="section-heading">
        <div>
          <span className="eyebrow">Saved pricing snapshots</span>
          <h2 id="estimates-heading">Estimates</h2>
        </div>
        <button
          disabled={!canManage || busy}
          onClick={() => onAdd("estimates")}
        >
          + Add estimate draft
        </button>
      </div>
      <p className="muted">
        Fictional drafts stay internal. Reviewed drafts are locked until
        explicitly reopened; void is terminal. Every saved revision and archive
        action remains in history. No sending, issuance or payment action is
        available.
        {onConvert &&
          " Reviewed estimates can be explicitly converted to fictional unissued invoice drafts."}
      </p>
      <label className="check-label">
        <input
          type="checkbox"
          checked={archived}
          onChange={(e) => setArchived(e.target.checked)}
        />
        Show archived estimate drafts
      </label>
      <div className="workforce-grid">
        {rows.map((r) => {
          const p = r.data.pricing as EstimatePricing;
          return (
            <article
              className="workforce-card"
              key={r.id}
              aria-label={`Estimate ${r.data.title}`}
            >
              <span className="badge">
                {String(r.data.status)} · v{r.revision}
              </span>
              <h3>{String(r.data.title)}</h3>
              <p>
                {p.customerName} · {String(r.data.as_of)}
              </p>
              <p>
                <strong>{money(p.totalMinor)}</strong>
              </p>
              <div className="actions">
                {onConvert &&
                  !r.archived &&
                  r.data.status === "Reviewed draft" && (
                    <button
                      disabled={
                        !canManage ||
                        busy ||
                        records.some(
                          (d) =>
                            d.entity === "invoice-drafts" &&
                            d.data.estimate === r.id,
                        )
                      }
                      onClick={() => onConvert(r)}
                    >
                      Create Invoice Draft from Estimate
                    </button>
                  )}
                <button
                  className="secondary"
                  onClick={() => setPreview({ record: r })}
                  aria-label={`Preview ${r.data.title}`}
                >
                  Preview / print
                </button>
                {!r.archived && r.data.status !== "Void" && (
                  <button
                    className="secondary"
                    disabled={!canManage || busy}
                    onClick={() => onEdit(r)}
                    aria-label={`Edit ${r.data.title}`}
                  >
                    Edit draft
                  </button>
                )}
                <button
                  className="quiet"
                  disabled={!canManage || busy}
                  onClick={() => onArchive(r)}
                  aria-label={`${r.archived ? "Restore" : "Archive"} ${r.data.title}`}
                >
                  {r.archived ? "Restore" : "Archive"}
                </button>
              </div>
              <details>
                <summary>Status and pricing history</summary>
                <ul className="history">
                  {versions
                    .filter((v) => v.record_id === r.id)
                    .map((v) => (
                      <li key={v.revision}>
                        <span>
                          v{v.revision} · {String(v.data.status)}
                          {v.archived ? " · Archived" : ""}
                        </span>
                        <button
                          className="quiet"
                          onClick={() => setPreview({ record: r, version: v })}
                          aria-label={`Preview ${r.data.title} version ${v.revision}`}
                        >
                          View snapshot
                        </button>
                      </li>
                    ))}
                </ul>
              </details>
            </article>
          );
        })}
      </div>
      {!rows.length && (
        <p className="empty-state">
          No estimate drafts here. Add a fictional draft from saved services and
          rates.
        </p>
      )}
      {preview && (
        <EstimatePreview
          {...preview}
          businessName={businessName}
          theme={theme}
          onClose={() => setPreview(null)}
        />
      )}
    </section>
  );
}
