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
import { previewRecurringVisitDates, plannedVisitAppointmentDraft, adjacentPlannedVisitDate, plannedVisitReviewPosition, recurringVisitPreviewCsv, recurringVisitPreviewText, recurringVisitReviewedText, recurringVisitPlanOverview, edgePlannedVisitDate, plannedVisitWeekday, type VisitFrequencyWeeks, type RecurringVisitReturnPlan } from "../core/recurring-visit-preview";
import { savedAppointmentStatusesOnPlannedDates, savedDateCoverage, nextProposedDateBySavedCoverage, previousProposedDateBySavedCoverage, cancelledOnlySavedDateCount, cancelledOnlySavedDateList, isCancelledOnlySavedDate, hasNoSavedAppointmentsOnPlannedDate, noSavedProposedDateList, recurringVisitSavedStatusCsv, recurringVisitReviewedSavedStatusText } from "../core/recurring-visit-saved-appointments";
// Count and copy share the same whole-row interpretation of a selection.
// Input is the already-validated, LF-normalized saved-date review CSV.
function selectedSavedReviewCsvRows(csv: string, start: number, end: number): string[] {
  if (start >= end) return [];
  const rows: string[] = [];
  let offset = 0;
  for (const line of csv.split("\n")) {
    const lineStart = offset;
    const lineEnd = offset + line.length;
    if (lineStart < end && lineEnd > start && /^\d+,\d{4}-\d{2}-\d{2},/.test(line)) {
      rows.push(line);
    }
    offset = lineEnd + 1;
  }
  return rows;
}

type PrintReviewLayout = "full" | "summary" | "details";
const printReviewLayouts: { value: PrintReviewLayout; label: string }[] = [
  { value: "full", label: "Full report" },
  { value: "summary", label: "Summary and charts only" },
  { value: "details", label: "Detailed visit table only" },
];
type SavedReviewRowFilter = "with-saved" | "without-saved" | "cancelled-only";
const savedReviewRowFilters: { value: SavedReviewRowFilter; label: string }[] = [
  { value: "with-saved", label: "With saved appointments" },
  { value: "without-saved", label: "No saved appointments" },
  { value: "cancelled-only", label: "Cancelled-only appointments" },
];

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
  const plannedJumpId = useId();
  const reviewedNoteId = useId();
  const reviewedStatusNoteId = useId();
  const savedReviewCsvNoteId = useId();
  const recurringDetailsRef = useRef<HTMLDetailsElement>(null);
  const savedReviewCsvTextareaRef = useRef<HTMLTextAreaElement>(null);
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
  // Read-only presentation state returns only through the existing
  // volatile, organization-scoped one-appointment route. Ordinary
  // Schedule entry always starts with all date cards visible.
  const [compactPreview, setCompactPreview] = useState(
    () => initialRecurringPlan?.compactPreview === true,
  );
  // Feedback is keyed to the exact transient plan. If a rule or anchor
  // changes before or after a clipboard promise, stale "Copied" text
  // never describes the newly selected proposed dates.
  const [copyFeedback, setCopyFeedback] = useState<{
    planKey: string;
    kind: "copied" | "failed";
  } | null>(null);
  // Separate clipboard feedback for the date-level status CSV, never for
  // the old date-only text or selected-visit status copy.
  const [savedReviewCsvCopyFeedback, setSavedReviewCsvCopyFeedback] = useState<{
    reviewCsvKey: string;
    kind: "copied" | "failed";
  } | null>(null);
  const [reviewCopyFeedback, setReviewCopyFeedback] = useState<{
    reviewKey: string;
    kind: "copied" | "failed";
  } | null>(null);
  // Keep date-only copy feedback independent from status-count copying.
  // Key it to the exact selected proposal AND currently displayed counts.
  const [statusCopyFeedback, setStatusCopyFeedback] = useState<{
    statusKey: string;
    kind: "copied" | "failed";
  } | null>(null);
  // Transient, per-reviewed-date display only. No browser storage,
  // appointment write, clipboard access or automatic booking.
  const [visibleNoteKey, setVisibleNoteKey] = useState<string | null>(null);
  // Separate read-only status-note state: date-only sharing remains unchanged.
  const [visibleStatusNoteKey, setVisibleStatusNoteKey] = useState<string | null>(null);
  // Collapsed on entry and on every changed plan; never stored remotely.
  const [visibleCancelledListPlan, setVisibleCancelledListPlan] = useState<string | null>(null);
  const [visibleNoSavedListPlan, setVisibleNoSavedListPlan] = useState<string | null>(null);
  // A selectable full-table preview is ephemeral, not an appointment or export.
  const [visibleSavedReviewCsvPreviewKey, setVisibleSavedReviewCsvPreviewKey] =
    useState<string | null>(null);
  const [selectedRowsCopyFeedback, setSelectedRowsCopyFeedback] = useState<{
    reviewCsvKey: string;
    kind: "copied" | "failed" | "empty";
  } | null>(null);
  const [selectedRowsDownloadFeedback, setSelectedRowsDownloadFeedback] = useState<{
    reviewCsvKey: string;
    kind: "started" | "failed";
  } | null>(null);
  const [selectedRowsPrintErrorKey, setSelectedRowsPrintErrorKey] = useState<string | null>(null);
  // Optional user-entered print annotations are never included in CSV or saved.
  const [printReviewAnnotations, setPrintReviewAnnotations] = useState<{
    reviewCsvKey: string;
    title: string;
    notes: string;
  } | null>(null);
  const [printReviewLayout, setPrintReviewLayout] = useState<{
    reviewCsvKey: string;
    layout: PrintReviewLayout;
  } | null>(null);
  const [savedReviewRowSelection, setSavedReviewRowSelection] = useState<{
    reviewCsvKey: string;
    count: number;
  } | null>(null);
  const [savedReviewStatusSelection, setSavedReviewStatusSelection] = useState<{
    reviewCsvKey: string;
    filter: SavedReviewRowFilter;
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
  // Each authorized proposed-date row contributes only canonical date and
  // numeric aggregate status totals. A changed saved appointment hides old
  // clipboard feedback even if the user keeps the same recurrence rules.
  const savedReviewCsvKey = planKey + "|" + savedCountByPlannedDate.map((row) =>
    [row.date, row.savedAppointments, row.scheduled, row.inProgress,
      row.completed, row.cancelled, row.other].join(":"),
  ).join("|");
  const visibleSavedReviewCsvCopyFeedback =
    savedReviewCsvCopyFeedback?.reviewCsvKey === savedReviewCsvKey
      ? savedReviewCsvCopyFeedback.kind : null;
  const visibleSelectedRowsCopyFeedback =
    selectedRowsCopyFeedback?.reviewCsvKey === savedReviewCsvKey
      ? selectedRowsCopyFeedback.kind : null;
  const visibleSelectedRowsDownloadFeedback =
    selectedRowsDownloadFeedback?.reviewCsvKey === savedReviewCsvKey
      ? selectedRowsDownloadFeedback.kind : null;
  const isSavedReviewCsvPreviewVisible = plannedVisitDates.length > 0 &&
    visibleSavedReviewCsvPreviewKey === savedReviewCsvKey;
  const activePrintReviewAnnotations = isSavedReviewCsvPreviewVisible &&
    printReviewAnnotations?.reviewCsvKey === savedReviewCsvKey
      ? printReviewAnnotations : null;
  const activePrintReviewLayout: PrintReviewLayout = isSavedReviewCsvPreviewVisible &&
    printReviewLayout?.reviewCsvKey === savedReviewCsvKey ? printReviewLayout.layout : "full";
  const activeSavedReviewFilter = isSavedReviewCsvPreviewVisible &&
    savedReviewStatusSelection?.reviewCsvKey === savedReviewCsvKey
      ? savedReviewStatusSelection.filter : null;
  const filteredSavedReviewIndices = activeSavedReviewFilter === null ? [] :
    savedCountByPlannedDate.flatMap((row, index) => {
      const matches = activeSavedReviewFilter === "with-saved"
        ? !hasNoSavedAppointmentsOnPlannedDate(row)
        : activeSavedReviewFilter === "without-saved"
          ? hasNoSavedAppointmentsOnPlannedDate(row)
          : isCancelledOnlySavedDate(row);
      return matches ? [index] : [];
    });
  const selectedSavedReviewRowCount = activeSavedReviewFilter !== null
    ? filteredSavedReviewIndices.length
    : isSavedReviewCsvPreviewVisible && savedReviewRowSelection?.reviewCsvKey === savedReviewCsvKey
      ? savedReviewRowSelection.count : 0;
  const savedCoverage = savedDateCoverage(savedCountByPlannedDate);
  const cancelledOnlyDates = cancelledOnlySavedDateCount(savedCountByPlannedDate);
  const cancelledDateList = cancelledOnlySavedDateList(savedCountByPlannedDate);
  const noSavedDateList = noSavedProposedDateList(savedCountByPlannedDate);
  const isCancelledListVisible = cancelledDateList.length > 0 && visibleCancelledListPlan === planKey;
  const isNoSavedListVisible = noSavedDateList.length > 0 && visibleNoSavedListPlan === planKey;
  // Both directions use the same authorized, bounded, date-only status
  // series and existing read-only agenda navigation. The counts never
  // claim availability, confirmation, or an appointment for this proposal.
  const previousDateWithSaved = previousProposedDateBySavedCoverage(
    savedCountByPlannedDate, date, "with-saved",
  );
  const previousDateWithoutSaved = previousProposedDateBySavedCoverage(
    savedCountByPlannedDate, date, "without-saved",
  );
  const nextDateWithSaved = nextProposedDateBySavedCoverage(
    savedCountByPlannedDate, date, "with-saved",
  );
  const nextDateWithoutSaved = nextProposedDateBySavedCoverage(
    savedCountByPlannedDate, date, "without-saved",
  );
  const reviewedVisitPosition = plannedVisitReviewPosition(plannedVisitDates, date);
  const reviewedPlannedDate = reviewedVisitPosition === null
    ? null : plannedVisitDates[reviewedVisitPosition - 1];
  const reviewKey = `${planKey}/${reviewedPlannedDate ?? ""}`;
  const isNotePreviewVisible = reviewedPlannedDate !== null && visibleNoteKey === reviewKey;
  const isStatusNotePreviewVisible = reviewedPlannedDate !== null &&
    visibleStatusNoteKey === reviewKey;
  const visibleReviewCopyFeedback = reviewedPlannedDate &&
    reviewCopyFeedback?.reviewKey === reviewKey
    ? reviewCopyFeedback.kind : null;
  const reviewedDateStatuses = reviewedVisitPosition === null
    ? null : savedCountByPlannedDate[reviewedVisitPosition - 1] ?? null;
  const reviewedStatusKey = reviewedDateStatuses === null ? null
    : [reviewKey, reviewedDateStatuses.savedAppointments,
      reviewedDateStatuses.scheduled, reviewedDateStatuses.inProgress,
      reviewedDateStatuses.completed, reviewedDateStatuses.cancelled,
      reviewedDateStatuses.other].join("/");
  const visibleStatusCopyFeedback = reviewedStatusKey !== null &&
    statusCopyFeedback?.statusKey === reviewedStatusKey
    ? statusCopyFeedback.kind : null;
  const firstPlannedDate = edgePlannedVisitDate(plannedVisitDates, "first");
  const lastPlannedDate = edgePlannedVisitDate(plannedVisitDates, "last");
  const previousPlannedDate = adjacentPlannedVisitDate(plannedVisitDates, date, "previous");
  const nextPlannedDate = adjacentPlannedVisitDate(plannedVisitDates, date, "next");
  function reviewPlannedDate(selected: string) {
    // Review is intentionally read-only. Navigating between proposed
    // dates never re-anchors the recurrence or reserves any resource.
    onClearAppointmentFocus?.();
    setArchived(false);
    setReviewCopyFeedback(null);
    setVisibleNoteKey(null);
    setVisibleStatusNoteKey(null);
    setStatusCopyFeedback(null);
    setDate(selected);
  }
  function preparePlannedDate(visitDate: string) {
    // Both the selected-visit shortcut and each numbered row must use
    // the same single-date validation and existing manual editor.
    // A preview never creates a booked appointment or assigns resources.
    const selectedDate = plannedVisitAppointmentDraft(
      previewStartDate, previewIntervalWeeks, previewCount, visitDate,
    ).scheduled_date;
    onPrepareAppointment({
      startDate: previewStartDate,
      everyWeeks: previewIntervalWeeks,
      occurrences: previewCount,
      selectedDate,
      compactPreview,
    });
  }
  async function copyReviewedVisit() {
    const selectedDate = reviewedPlannedDate;
    const selectedReviewKey = reviewKey;
    if (!selectedDate) return;
    try {
      // Re-validate exact membership in the current bounded date-only
      // series; never inspect the saved appointments shown in the panel.
      const text = recurringVisitReviewedText(
        previewStartDate, previewIntervalWeeks, previewCount, selectedDate,
      );
      if (!navigator.clipboard?.writeText) {
        throw new Error("Clipboard is unavailable.");
      }
      await navigator.clipboard.writeText(text);
      setReviewCopyFeedback({ reviewKey: selectedReviewKey, kind: "copied" });
    } catch {
      setReviewCopyFeedback({ reviewKey: selectedReviewKey, kind: "failed" });
    }
  }
  async function copyReviewedSavedStatus() {
    const selectedDate = reviewedPlannedDate;
    const selectedStatusKey = reviewedStatusKey;
    if (!selectedDate || !selectedStatusKey || !reviewedDateStatuses) return;
    try {
      // Regenerate from the current authorized date/status totals using
      // the same strict validator as TXT download and read-only preview.
      const text = recurringVisitReviewedSavedStatusText(
        previewStartDate, previewIntervalWeeks, previewCount, selectedDate,
        savedCountByPlannedDate,
      );
      if (!navigator.clipboard?.writeText) {
        throw new Error("Clipboard is unavailable.");
      }
      await navigator.clipboard.writeText(text);
      setStatusCopyFeedback({ statusKey: selectedStatusKey, kind: "copied" });
    } catch {
      // Never claim success if the browser denies access or rejects copying.
      setStatusCopyFeedback({ statusKey: selectedStatusKey, kind: "failed" });
    }
  }
  async function copySavedDateReviewCsv() {
    const selectedReviewCsvKey = savedReviewCsvKey;
    try {
      // Use precisely the same fail-closed generator as the existing
      // downloaded status CSV. Never copy raw appointment records.
      const csv = recurringVisitSavedStatusCsv(
        previewStartDate, previewIntervalWeeks, previewCount,
        savedCountByPlannedDate,
      );
      if (!navigator.clipboard?.writeText) {
        throw new Error("Clipboard is unavailable.");
      }
      await navigator.clipboard.writeText(csv);
      setSavedReviewCsvCopyFeedback({
        reviewCsvKey: selectedReviewCsvKey, kind: "copied",
      });
    } catch {
      // A denied/missing clipboard API must not show false success.
      setSavedReviewCsvCopyFeedback({
        reviewCsvKey: selectedReviewCsvKey, kind: "failed",
      });
    }
  }
  function updateSavedReviewRowSelection(textarea: HTMLTextAreaElement) {
    setSelectedRowsPrintErrorKey(null);
    setSelectedRowsDownloadFeedback(null);
    try {
      const csv = recurringVisitSavedStatusCsv(
        previewStartDate, previewIntervalWeeks, previewCount,
        savedCountByPlannedDate,
      ).replace(/\r\n/g, "\n");
      if (textarea.value !== csv) {
        setSavedReviewRowSelection(null);
        return;
      }
      const count = selectedSavedReviewCsvRows(
        csv, textarea.selectionStart, textarea.selectionEnd,
      ).length;
      setSavedReviewRowSelection({ reviewCsvKey: savedReviewCsvKey, count });
    } catch {
      setSavedReviewRowSelection(null);
    }
  }
  function selectSavedReviewRowsByStatus(filter: SavedReviewRowFilter) {
    const textarea = savedReviewCsvTextareaRef.current;
    if (!textarea || !isSavedReviewCsvPreviewVisible) return;
    // Non-adjacent rows cannot be highlighted by a single native selection.
    // Keep the full preview intact and show the explicit status selection separately.
    textarea.setSelectionRange(0, 0);
    setSavedReviewRowSelection(null);
    setSelectedRowsCopyFeedback(null);
    setSelectedRowsPrintErrorKey(null);
    setSelectedRowsDownloadFeedback(null);
    setSavedReviewStatusSelection({ reviewCsvKey: savedReviewCsvKey, filter });
  }
  function returnToManualSavedReviewSelection() {
    if (activeSavedReviewFilter !== null) {
      setSavedReviewStatusSelection(null);
      setSavedReviewRowSelection(null);
      setSelectedRowsCopyFeedback(null);
      setSelectedRowsPrintErrorKey(null);
      setSelectedRowsDownloadFeedback(null);
    }
  }
  function clearSavedReviewRowSelection() {
    setSavedReviewStatusSelection(null);
    const textarea = savedReviewCsvTextareaRef.current;
    if (textarea) {
      textarea.focus();
      textarea.setSelectionRange(textarea.selectionStart, textarea.selectionStart);
    }
    setSavedReviewRowSelection(null);
    setSelectedRowsCopyFeedback(null);
    setSelectedRowsPrintErrorKey(null);
    setSelectedRowsDownloadFeedback(null);
  }
  function selectAllSavedReviewRows() {
    setSavedReviewStatusSelection(null);
    const textarea = savedReviewCsvTextareaRef.current;
    if (!textarea) return;
    try {
      // Revalidate the same bounded, date/count-only CSV used by the preview.
      // Visually select only the visit rows, excluding header and trailing blank.
      const csv = recurringVisitSavedStatusCsv(
        previewStartDate, previewIntervalWeeks, previewCount,
        savedCountByPlannedDate,
      ).replace(/\r\n/g, "\n");
      if (textarea.value !== csv) return;
      const headerEnd = csv.indexOf("\n");
      if (headerEnd < 0) return;
      const start = headerEnd + 1;
      const end = csv.endsWith("\n") ? csv.length - 1 : csv.length;
      if (start >= end) return;
      textarea.focus();
      textarea.setSelectionRange(start, end);
      updateSavedReviewRowSelection(textarea);
      setSelectedRowsCopyFeedback(null);
      setSelectedRowsPrintErrorKey(null);
      setSelectedRowsDownloadFeedback(null);
    } catch {
      // Invalid recurrence never selects unvalidated or stale text.
    }
  }
  // Copy and download share the exact validated, complete selected rows.
  // The original column header, visit ordinals and NOT BOOKED notes survive.
  function selectedSavedReviewCsv(): string | null {
    const textarea = savedReviewCsvTextareaRef.current;
    if (!textarea || !isSavedReviewCsvPreviewVisible || (activeSavedReviewFilter === null &&
      textarea.selectionStart === textarea.selectionEnd)) return null;
    const csv = recurringVisitSavedStatusCsv(
      previewStartDate, previewIntervalWeeks, previewCount,
      savedCountByPlannedDate,
    ).replace(/\r\n/g, "\n");
    if (textarea.value !== csv) throw new Error("Stale review preview");
    const lines = csv.split("\n");
    const rows = activeSavedReviewFilter === null
      ? selectedSavedReviewCsvRows(csv, textarea.selectionStart, textarea.selectionEnd)
      : filteredSavedReviewIndices.map((index) => lines[index + 1]);
    return rows.length ? [lines[0], ...rows].join("\r\n") + "\r\n" : null;
  }
  async function copySelectedSavedReviewRows() {
    const reviewCsvKey = savedReviewCsvKey;
    try {
      const csv = selectedSavedReviewCsv();
      if (!csv) {
        setSelectedRowsCopyFeedback({ reviewCsvKey, kind: "empty" });
        return;
      }
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(csv);
      setSelectedRowsCopyFeedback({ reviewCsvKey, kind: "copied" });
    } catch {
      setSelectedRowsCopyFeedback({ reviewCsvKey, kind: "failed" });
    }
  }
  function downloadSelectedSavedReviewRows() {
    const reviewCsvKey = savedReviewCsvKey;
    setSelectedRowsDownloadFeedback(null);
    let blobUrl: string | undefined;
    let link: HTMLAnchorElement | undefined;
    try {
      const csv = selectedSavedReviewCsv();
      if (!csv) return;
      blobUrl = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
      link = document.createElement("a");
      link.href = blobUrl;
      link.download = `lms-selected-visit-review-${previewStartDate}-NOT-BOOKED.csv`;
      document.body.appendChild(link);
      link.click();
      setSelectedRowsDownloadFeedback({ reviewCsvKey, kind: "started" });
    } catch {
      setSelectedRowsDownloadFeedback({ reviewCsvKey, kind: "failed" });
    } finally {
      link?.remove();
      const urlToRelease = blobUrl;
      if (urlToRelease) window.setTimeout(() => URL.revokeObjectURL(urlToRelease), 1000);
    }
  }
  function updatePrintReviewAnnotations(field: "title" | "notes", value: string) {
    setPrintReviewAnnotations({
      reviewCsvKey: savedReviewCsvKey,
      title: activePrintReviewAnnotations?.title ?? "",
      notes: activePrintReviewAnnotations?.notes ?? "",
      [field]: value.slice(0, field === "title" ? 100 : 500),
    });
  }
  function openSelectedSavedReviewPrintReport() {
    setSelectedRowsPrintErrorKey(null);
    let reportWindow: Window | null = null;
    try {
      const csv = selectedSavedReviewCsv();
      if (!csv) return;
      // The fixed validated CSV has no quoted cells or arbitrary record text.
      const [header, ...dataRows] = csv.trimEnd().split("\r\n").map((line) => line.split(","));
      reportWindow = window.open("", "_blank");
      if (!reportWindow) throw new Error("Print window blocked");
      reportWindow.opener = null;
      const doc = reportWindow.document;
      doc.title = "LMS selected visit review — NOT BOOKED";
      doc.documentElement.lang = "en";
      const style = doc.createElement("style");
      style.textContent = `
        body { font: 14px system-ui, sans-serif; color: #171717; background: white; margin: 24px; }
        h1 { font-size: 24px; } p { max-width: 80ch; }
        table { border-collapse: collapse; width: 100%; font-size: 11px; }
        th, td { border: 1px solid #999; padding: 5px; text-align: left; overflow-wrap: anywhere; }
        th { background: #eee; } button { padding: 12px 20px; margin: 0 0 16px; cursor: pointer; }
        .table-scroll { overflow-x: auto; }
        .report-annotations { overflow-wrap: anywhere; white-space: pre-wrap; margin: 10px 0; }
        .report-annotations h2 { font-size: 17px; margin: 0 0 5px; }
        .report-annotations p { margin: 4px 0; }
        .report-summary { margin: 12px 0; break-inside: avoid; }
        .report-summary h2 { font-size: 17px; margin: 0 0 6px; }
        .report-summary dl { display: grid; grid-template-columns: repeat(auto-fit, minmax(145px, 1fr)); gap: 6px; margin: 0; }
        .report-summary dl div { border: 1px solid #999; padding: 7px; }
        .report-summary dt { font-size: 12px; }
        .report-summary dd { font-size: 18px; font-weight: 700; margin: 3px 0 0; font-variant-numeric: tabular-nums; }
        .report-status-chart { margin: 12px 0; break-inside: avoid; }
        .report-status-chart h2 { font-size: 17px; margin: 0 0 6px; }
        .report-status-chart ul { list-style: none; margin: 0; padding: 0; }
        .report-status-chart li { display: grid; grid-template-columns: 90px minmax(0, 1fr) auto; gap: 8px; align-items: center; margin: 5px 0; font-size: 12px; }
        .report-status-chart svg { display: block; width: 100%; height: 14px; }
        .report-status-chart .status-chart-value { font-variant-numeric: tabular-nums; text-align: right; }
        @page { size: landscape; margin: 12mm; }
        @media print { body { margin: 0; } button { display: none; } .table-scroll { overflow: visible; }
          thead { display: table-header-group; } tr { break-inside: avoid; } }
      `;
      doc.head.appendChild(style);
      const heading = doc.createElement("h1");
      heading.textContent = "LMS selected visit review — NOT BOOKED";
      const notice = doc.createElement("p");
      notice.textContent = "Planning report only. No visits are booked or confirmed. Staff and resource availability is not confirmed. Counts describe existing non-archived saved appointment records.";
      // Keep the fixed NOT BOOKED heading and warning above any user text.
      // Text nodes render annotations literally, never as executable HTML.
      const annotations = doc.createElement("section");
      annotations.className = "report-annotations";
      const customTitle = activePrintReviewAnnotations?.title.trim() ?? "";
      const customNotes = activePrintReviewAnnotations?.notes.trim() ?? "";
      if (customTitle) {
        const title = doc.createElement("h2");
        title.textContent = customTitle;
        annotations.appendChild(title);
      }
      if (customNotes) {
        const notesLabel = doc.createElement("h2");
        notesLabel.textContent = "Manager's planning notes (user-entered)";
        const notesText = doc.createElement("p");
        notesText.textContent = customNotes;
        annotations.append(notesLabel, notesText);
      }
      const summary = doc.createElement("p");
      summary.textContent = dataRows.length + " selected visit rows. Original proposed visit numbers retained.";
      // Sum ONLY the selected, validated CSV rows. BigInt preserves exact
      // integer counts even when a sum exceeds Number.MAX_SAFE_INTEGER.
      // Counts are date overlaps, not a count of distinct appointments.
      const totals = [2, 3, 4, 5, 6, 7].map((column) =>
        dataRows.reduce((total, cells) => total + BigInt(cells[column]), BigInt(0)),
      );
      const summarySection = doc.createElement("section");
      summarySection.className = "report-summary";
      summarySection.setAttribute("aria-labelledby", "selected-review-summary-heading");
      const summaryHeading = doc.createElement("h2");
      summaryHeading.id = "selected-review-summary-heading";
      summaryHeading.textContent = "Selected dates summary";
      const summaryList = doc.createElement("dl");
      const summaryItems: [string, string][] = [
        ["Selected proposed dates", String(dataRows.length)],
        ["Saved appointment date overlaps", String(totals[0])],
        ["Scheduled", String(totals[1])],
        ["In progress", String(totals[2])],
        ["Completed", String(totals[3])],
        ["Cancelled", String(totals[4])],
        ["Other", String(totals[5])],
        ["Dates without saved records", String(dataRows.filter((cells) => cells[2] === "0").length)],
        ["Cancelled-only dates", String(dataRows.filter((cells) => cells[2] !== "0" && cells[2] === cells[6]).length)],
      ];
      for (const [label, value] of summaryItems) {
        const item = doc.createElement("div");
        const term = doc.createElement("dt");
        term.textContent = label;
        const count = doc.createElement("dd");
        count.textContent = value;
        item.append(term, count);
        summaryList.appendChild(item);
      }
      const countingNote = doc.createElement("p");
      countingNote.textContent = "Totals count saved appointment overlaps with selected dates, not unique appointments. An appointment spanning multiple selected dates can be counted more than once. Zero saved records does not establish availability.";
      summarySection.append(summaryHeading, summaryList, countingNote);
      // All bars use a common denominator: saved appointment/date overlaps.
      // Keep the exact integer count visible and avoid division by zero.
      const chart = doc.createElement("section");
      chart.className = "report-status-chart";
      chart.setAttribute("aria-labelledby", "selected-review-chart-heading");
      const chartHeading = doc.createElement("h2");
      chartHeading.id = "selected-review-chart-heading";
      chartHeading.textContent = "Saved appointment status breakdown";
      const chartNote = doc.createElement("p");
      chartNote.textContent = totals[0] === BigInt(0)
        ? "No saved appointment date overlaps in the selected rows. This does not establish availability."
        : "Each bar shows its share of saved appointment date overlaps across selected dates, not unique appointments.";
      const chartList = doc.createElement("ul");
      const chartStatuses = ["Scheduled", "In progress", "Completed", "Cancelled", "Other"];
      const chartColors = ["#345b87", "#735820", "#24664b", "#963d45", "#606060"];
      chartStatuses.forEach((label, index) => {
        const count = totals[index + 1];
        // Integer basis points, rounded to the nearest tenth of a percent.
        const tenths = totals[0] === BigInt(0) ? BigInt(0)
          : (count * BigInt(1000) + totals[0] / BigInt(2)) / totals[0];
        const percent = (Number(tenths) / 10).toFixed(1);
        const item = doc.createElement("li");
        const statusLabel = doc.createElement("span");
        statusLabel.textContent = label;
        const bar = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
        bar.setAttribute("viewBox", "0 0 1000 14");
        bar.setAttribute("preserveAspectRatio", "none");
        bar.setAttribute("aria-hidden", "true");
        const track = doc.createElementNS("http://www.w3.org/2000/svg", "rect");
        track.setAttribute("x", "1");
        track.setAttribute("y", "1");
        track.setAttribute("width", "998");
        track.setAttribute("height", "12");
        track.setAttribute("fill", "white");
        track.setAttribute("stroke", "#555");
        const fill = doc.createElementNS("http://www.w3.org/2000/svg", "rect");
        fill.setAttribute("x", "1");
        fill.setAttribute("y", "1");
        fill.setAttribute("height", "12");
        fill.setAttribute("width", String(Number(tenths) * 0.998));
        fill.setAttribute("fill", chartColors[index]);
        bar.append(track, fill);
        const value = doc.createElement("span");
        value.className = "status-chart-value";
        value.textContent = String(count) + " (" + percent + "%)";
        item.append(statusLabel, bar, value);
        chartList.appendChild(item);
      });
      chart.append(chartHeading, chartNote, chartList);
      const print = doc.createElement("button");
      print.type = "button";
      print.textContent = "Print report";
      const targetWindow = reportWindow;
      print.addEventListener("click", () => targetWindow.print());
      const table = doc.createElement("table");
      const caption = table.createCaption();
      caption.textContent = "Selected proposed visit dates and saved status counts";
      const head = table.createTHead().insertRow();
      for (const label of header) {
        const cell = doc.createElement("th");
        cell.scope = "col";
        cell.textContent = label;
        head.appendChild(cell);
      }
      const body = table.createTBody();
      for (const values of dataRows) {
        const row = body.insertRow();
        for (const value of values) row.insertCell().textContent = value;
      }
      const tableWrapper = doc.createElement("div");
      tableWrapper.className = "table-scroll";
      tableWrapper.appendChild(table);
      // All layouts retain the fixed safety notice, selection size and
      // optional print-only annotations. Omitted sections are not attached.
      const layoutLabel = doc.createElement("p");
      layoutLabel.textContent = "Report layout: " + (printReviewLayouts.find(
        (option) => option.value === activePrintReviewLayout,
      )?.label ?? "Full report");
      doc.body.replaceChildren(heading, notice,
        ...(annotations.childElementCount ? [annotations] : []),
        summary, layoutLabel, print,
        ...(activePrintReviewLayout !== "details" ? [summarySection, chart] : []),
        ...(activePrintReviewLayout !== "summary" ? [tableWrapper] : []));
    } catch {
      reportWindow?.close();
      setSelectedRowsPrintErrorKey(savedReviewCsvKey);
    }
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
  function downloadReviewedVisitText() {
    const selectedDate = reviewedPlannedDate;
    if (!selectedDate) return;
    // Use the exact same date-only, membership-validated text as the
    // clipboard action. No saved-status, customer, or resource data.
    const text = recurringVisitReviewedText(
      previewStartDate, previewIntervalWeeks, previewCount, selectedDate,
    );
    const blobUrl = URL.createObjectURL(
      new Blob([text + "\n"], { type: "text/plain;charset=utf-8" }),
    );
    const link = document.createElement("a");
    link.href = blobUrl;
    // The generated filename is safe: selectedDate is a strict
    // YYYY-MM-DD member of the validated proposed-date list.
    link.download = `lms-proposed-visit-${selectedDate}-NOT-BOOKED.txt`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
  }
  function downloadReviewedSavedStatusText() {
    const selectedDate = reviewedPlannedDate;
    if (!selectedDate || !reviewedDateStatuses) return;
    // Validate all authorized date/count rows and the selected date before
    // exporting this read-only, one-date status summary. Never export
    // appointment identities, staff/resource fields or times.
    const text = recurringVisitReviewedSavedStatusText(
      previewStartDate, previewIntervalWeeks, previewCount,
      selectedDate, savedCountByPlannedDate,
    );
    const blobUrl = URL.createObjectURL(
      new Blob([text + "\n"], { type: "text/plain;charset=utf-8" }),
    );
    const link = document.createElement("a");
    link.href = blobUrl;
    link.download = `lms-reviewed-visit-status-${selectedDate}-NOT-BOOKED.txt`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
  }
  function downloadSavedDateReviewCsv() {
    // The pure generator revalidates the exact bounded proposal and every
    // numeric status count before allowing a local export. Only already
    // visible, organization-scoped date/status totals leave the browser.
    // This never books a date or exports customer, resource or time fields.
    const csv = recurringVisitSavedStatusCsv(
      previewStartDate, previewIntervalWeeks, previewCount,
      savedCountByPlannedDate,
    );
    const blobUrl = URL.createObjectURL(
      new Blob([csv], { type: "text/csv;charset=utf-8" }),
    );
    const link = document.createElement("a");
    link.href = blobUrl;
    link.download = `lms-visit-saved-date-review-${previewStartDate}-NOT-BOOKED.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
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
            setVisibleNoteKey(null);
    setVisibleStatusNoteKey(null);
    setStatusCopyFeedback(null);
            setVisibleCancelledListPlan(null);
                  setVisibleNoSavedListPlan(null);
                  setSavedReviewCsvCopyFeedback(null);
                  setVisibleSavedReviewCsvPreviewKey(null);
                  setPrintReviewLayout(null);
                  setPrintReviewAnnotations(null);
                  setSelectedRowsCopyFeedback(null);
                  setSelectedRowsPrintErrorKey(null);
                  setSelectedRowsDownloadFeedback(null);
                  setSavedReviewRowSelection(null);
                  setSavedReviewStatusSelection(null);
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
              setVisibleNoteKey(null);
    setVisibleStatusNoteKey(null);
    setStatusCopyFeedback(null);
              setVisibleCancelledListPlan(null);
                  setVisibleNoSavedListPlan(null);
                  setSavedReviewCsvCopyFeedback(null);
                  setVisibleSavedReviewCsvPreviewKey(null);
                  setPrintReviewLayout(null);
                  setPrintReviewAnnotations(null);
                  setSelectedRowsCopyFeedback(null);
                  setSelectedRowsPrintErrorKey(null);
                  setSelectedRowsDownloadFeedback(null);
                  setSavedReviewRowSelection(null);
                  setSavedReviewStatusSelection(null);
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
            setVisibleNoteKey(null);
    setVisibleStatusNoteKey(null);
    setStatusCopyFeedback(null);
            setVisibleCancelledListPlan(null);
                  setVisibleNoSavedListPlan(null);
                  setSavedReviewCsvCopyFeedback(null);
                  setVisibleSavedReviewCsvPreviewKey(null);
                  setPrintReviewLayout(null);
                  setPrintReviewAnnotations(null);
                  setSelectedRowsCopyFeedback(null);
                  setSelectedRowsPrintErrorKey(null);
                  setSelectedRowsDownloadFeedback(null);
                  setSavedReviewRowSelection(null);
                  setSavedReviewStatusSelection(null);
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
                onChange={(event) => {
                  // A new recurrence rule always closes an opened note,
                  // even if someone later restores the previous rule.
                  setVisibleNoteKey(null);
    setVisibleStatusNoteKey(null);
    setStatusCopyFeedback(null);
                  setVisibleCancelledListPlan(null);
                  setVisibleNoSavedListPlan(null);
                  setSavedReviewCsvCopyFeedback(null);
                  setVisibleSavedReviewCsvPreviewKey(null);
                  setPrintReviewLayout(null);
                  setPrintReviewAnnotations(null);
                  setSelectedRowsCopyFeedback(null);
                  setSelectedRowsPrintErrorKey(null);
                  setSelectedRowsDownloadFeedback(null);
                  setSavedReviewRowSelection(null);
                  setSavedReviewStatusSelection(null);
                  setPreviewIntervalWeeks(Number(event.target.value) as VisitFrequencyWeeks);
                }}
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
                onChange={(event) => {
                  // Never resurrect a previously opened note after changing
                  // the number of proposed visits back and forth.
                  setVisibleNoteKey(null);
    setVisibleStatusNoteKey(null);
    setStatusCopyFeedback(null);
                  setVisibleCancelledListPlan(null);
                  setVisibleNoSavedListPlan(null);
                  setSavedReviewCsvCopyFeedback(null);
                  setVisibleSavedReviewCsvPreviewKey(null);
                  setPrintReviewLayout(null);
                  setPrintReviewAnnotations(null);
                  setSelectedRowsCopyFeedback(null);
                  setSelectedRowsPrintErrorKey(null);
                  setSelectedRowsDownloadFeedback(null);
                  setSavedReviewRowSelection(null);
                  setSavedReviewStatusSelection(null);
                  setPreviewCount(Number(event.target.value));
                }}
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
                  <div
                    className="recurring-visit-coverage"
                    role="group"
                    aria-label="Saved appointment date coverage"
                  >
                    <h4>Saved records on proposed dates</h4>
                    <p>
                      <strong className="recurring-visit-coverage-with-saved">
                        {savedCoverage.withSaved}
                      </strong>{" "}
                      of {plannedVisitDates.length} proposed dates contain
                      at least one non-archived saved appointment.
                    </p>
                    <p>
                      <strong className="recurring-visit-coverage-without-saved">
                        {savedCoverage.withoutSaved}
                      </strong>{" "}
                      of {plannedVisitDates.length} proposed dates contain
                      no non-archived saved appointment.
                    </p>
                    <p className="recurring-visit-coverage-cancelled-only">
                      <strong className="recurring-visit-coverage-cancelled-only-count">
                        {cancelledOnlyDates}
                      </strong>{" "}
                      of {savedCoverage.withSaved} proposed dates with saved
                      records contain only cancelled, non-archived appointments.
                    </p>
                    <button
                      type="button"
                      className="secondary recurring-visit-cancelled-list-toggle"
                      aria-expanded={isCancelledListVisible}
                      disabled={busy || cancelledDateList.length === 0}
                      onClick={() => setVisibleCancelledListPlan(
                        isCancelledListVisible ? null : planKey,
                      )}
                    >
                      {isCancelledListVisible
                        ? "Hide cancelled-only proposed dates"
                        : `Show cancelled-only proposed dates (${cancelledDateList.length})`}
                    </button>
                    {isCancelledListVisible && (
                      <div className="recurring-visit-cancelled-list">
                        <p>
                          Review-only proposed calendar dates with saved
                          cancelled records. They are NOT BOOKED by this
                          plan or confirmed available.
                        </p>
                        <ul aria-label="Cancelled-only proposed visit dates">
                          {cancelledDateList.map((cancelledDate) => (
                            <li
                              key={cancelledDate}
                              aria-current={cancelledDate === date ? "date" : undefined}
                              className={cancelledDate === date
                                ? "recurring-visit-cancelled-is-reviewed"
                                : undefined}
                            >
                              <div className="recurring-visit-cancelled-date-info">
                                <span className="recurring-visit-cancelled-position">
                                  Proposed visit {plannedVisitReviewPosition(plannedVisitDates, cancelledDate)}{" "}
                                  of {plannedVisitDates.length}
                                </span>
                                <time dateTime={cancelledDate}>
                                  {plannedVisitWeekday(cancelledDate).weekday}{" "}
                                  {cancelledDate}
                                </time>
                                {cancelledDate === date && (
                                  <span className="recurring-visit-cancelled-current-label">
                                    Currently reviewing
                                  </span>
                                )}
                              </div>
                              <button
                                type="button"
                                className="secondary"
                                disabled={busy || cancelledDate === date}
                                onClick={() => reviewPlannedDate(cancelledDate)}
                              >
                                Review cancelled-only proposed date {cancelledDate}
                              </button>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    <button
                      type="button"
                      className="secondary recurring-visit-no-saved-list-toggle"
                      aria-expanded={isNoSavedListVisible}
                      disabled={busy || noSavedDateList.length === 0}
                      onClick={() => setVisibleNoSavedListPlan(
                        isNoSavedListVisible ? null : planKey,
                      )}
                    >
                      {isNoSavedListVisible
                        ? "Hide proposed dates without saved appointments"
                        : `Show proposed dates without saved appointments (${noSavedDateList.length})`}
                    </button>
                    {isNoSavedListVisible && (
                      <div className="recurring-visit-no-saved-list">
                        <p>
                          No non-archived saved appointments on these
                          proposed calendar dates. These visits are
                          NOT BOOKED, and staff or equipment
                          availability has not been checked.
                        </p>
                        <ul aria-label="Proposed dates without saved appointments">
                          {noSavedDateList.map((emptyDate) => (
                            <li
                              key={emptyDate}
                              aria-current={emptyDate === date ? "date" : undefined}
                              className={emptyDate === date
                                ? "recurring-visit-no-saved-is-reviewed"
                                : undefined}
                            >
                              <div className="recurring-visit-no-saved-date-info">
                                <span className="recurring-visit-no-saved-position">
                                  Proposed visit {plannedVisitReviewPosition(plannedVisitDates, emptyDate)}{" "}
                                  of {plannedVisitDates.length}
                                </span>
                                <time dateTime={emptyDate}>
                                  {plannedVisitWeekday(emptyDate).weekday}{" "}
                                  {emptyDate}
                                </time>
                                {emptyDate === date && (
                                  <span className="recurring-visit-no-saved-current-label">
                                    Currently reviewing
                                  </span>
                                )}
                              </div>
                              <button
                                type="button"
                                className="secondary"
                                disabled={busy || emptyDate === date}
                                onClick={() => reviewPlannedDate(emptyDate)}
                              >
                                Review proposed date without saved appointments {emptyDate}
                              </button>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    <p>
                      Existing records may be unrelated to this proposal,
                      and cancelled records still count if not archived.
                      Dates with only cancelled records still count as dates
                      with saved records. Neither a cancelled-only date nor
                      an empty date proves staff or equipment is available.
                      Neither count confirms proposed bookings. The
                      cancelled-only count does not confirm any booking either.
                    </p>
                    <div className="recurring-visit-coverage-actions">
                      <button
                        type="button"
                        className="secondary"
                        disabled={busy || !previousDateWithSaved}
                        onClick={() => {
                          if (previousDateWithSaved) reviewPlannedDate(previousDateWithSaved);
                        }}
                      >
                        Review previous proposed date with saved records
                      </button>
                      <button
                        type="button"
                        className="secondary"
                        disabled={busy || !previousDateWithoutSaved}
                        onClick={() => {
                          if (previousDateWithoutSaved) reviewPlannedDate(previousDateWithoutSaved);
                        }}
                      >
                        Review previous proposed date without saved records
                      </button>
                      <button
                        type="button"
                        className="secondary"
                        disabled={busy || !nextDateWithSaved}
                        onClick={() => {
                          if (nextDateWithSaved) reviewPlannedDate(nextDateWithSaved);
                        }}
                      >
                        Review next proposed date with saved records
                      </button>
                      <button
                        type="button"
                        className="secondary"
                        disabled={busy || !nextDateWithoutSaved}
                        onClick={() => {
                          if (nextDateWithoutSaved) reviewPlannedDate(nextDateWithoutSaved);
                        }}
                      >
                        Review next proposed date without saved records
                      </button>
                    </div>
                    <p className="muted">
                      Review only: jumps backward or forward to the closest
                      matching proposed calendar date without wrapping. These
                      shortcuts do not check free time, reserve anything, or
                      book a visit.
                    </p>
                  </div>
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
                  onClick={downloadSavedDateReviewCsv}
                >
                  Download saved-date review CSV
                </button>
                <button
                  type="button"
                  className="secondary"
                  disabled={busy}
                  onClick={() => void copySavedDateReviewCsv()}
                >
                  Copy saved-date review CSV
                </button>
                <button
                  type="button"
                  className="secondary"
                  aria-expanded={isSavedReviewCsvPreviewVisible}
                  aria-controls={isSavedReviewCsvPreviewVisible
                    ? savedReviewCsvNoteId + "-wrapper" : undefined}
                  onClick={() => {
                    setSavedReviewRowSelection(null);
                    setSavedReviewStatusSelection(null);
                    setSelectedRowsCopyFeedback(null);
                    setSelectedRowsPrintErrorKey(null);
                    setSelectedRowsDownloadFeedback(null);
                    setPrintReviewAnnotations(null);
                    setPrintReviewLayout(null);
                    setVisibleSavedReviewCsvPreviewKey(
                      isSavedReviewCsvPreviewVisible ? null : savedReviewCsvKey,
                    );
                  }}
                >
                  {isSavedReviewCsvPreviewVisible
                    ? "Hide saved-date review CSV preview"
                    : "Preview saved-date review CSV"}
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
                  Download planned-date CSV or copy a plain-text proposal.
                  Download or copy the separate saved-date review CSV with
                  date-level counts and status categories only (no names
                  or appointment times).
                  None of these actions creates bookings, includes customer
                  details, or confirms resource availability.
                </p>
              </div>
              {isSavedReviewCsvPreviewVisible && (
                <div
                  id={savedReviewCsvNoteId + "-wrapper"}
                  className="recurring-visit-note-preview recurring-visit-full-csv-preview"
                >
                  <label htmlFor={savedReviewCsvNoteId}>
                    Selectable saved-date review CSV — NOT BOOKED
                  </label>
                  <textarea
                    id={savedReviewCsvNoteId}
                    ref={savedReviewCsvTextareaRef}
                    onSelect={(event) => updateSavedReviewRowSelection(event.currentTarget)}
                    onPointerDown={returnToManualSavedReviewSelection}
                    onKeyDown={returnToManualSavedReviewSelection}
                    aria-label="Selectable saved-date review CSV — NOT BOOKED"
                    readOnly
                    rows={10}
                    spellCheck={false}
                    value={recurringVisitSavedStatusCsv(
                      previewStartDate, previewIntervalWeeks, previewCount,
                      savedCountByPlannedDate,
                    )}
                  />
                  <button
                    type="button"
                    className="secondary"
                    onClick={selectAllSavedReviewRows}
                  >
                    Select all visit rows
                  </button>
                  <button
                    type="button"
                    className="secondary"
                    onClick={clearSavedReviewRowSelection}
                  >
                    Clear selection
                  </button>
                  <div className="recurring-visit-navigation-actions" role="group" aria-label="Select visit rows by saved status">
                    {savedReviewRowFilters.map(({ value, label }) => (
                      <button
                        key={value}
                        type="button"
                        className="secondary"
                        aria-pressed={activeSavedReviewFilter === value}
                        onClick={() => selectSavedReviewRowsByStatus(value)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  {activeSavedReviewFilter !== null && (
                    <p className="muted">
                      Status selection: {savedReviewRowFilters.find(
                        ({ value }) => value === activeSavedReviewFilter,
                      )?.label}. {filteredSavedReviewIndices.length
                        ? "Selected visit numbers: " + filteredSavedReviewIndices.map((index) => index + 1).join(", ") + "."
                        : "No matching visit rows."}
                      {" "}Copy, download and print selected review rows use this status selection. No visits are booked.
                    </p>
                  )}
                  <p className="muted" aria-live="polite">
                    {selectedSavedReviewRowCount} of {plannedVisitDates.length} visit rows selected
                  </p>
                  <button
                    type="button"
                    className="secondary"
                    disabled={busy}
                    onClick={() => void copySelectedSavedReviewRows()}
                  >
                    Copy selected review rows
                  </button>
                  <button
                    type="button"
                    className="secondary"
                    disabled={busy || selectedSavedReviewRowCount === 0}
                    onClick={downloadSelectedSavedReviewRows}
                  >
                    Download selected review rows
                  </button>
                  <div className="recurring-visit-controls recurring-visit-print-layout">
                    <div className="recurring-visit-note-preview">
                      <label htmlFor={savedReviewCsvNoteId + "-print-layout"}>Print report layout</label>
                      <select
                        id={savedReviewCsvNoteId + "-print-layout"}
                        value={activePrintReviewLayout}
                        onChange={(event) => {
                          const layout = printReviewLayouts.find((option) => option.value === event.target.value);
                          if (layout) setPrintReviewLayout({ reviewCsvKey: savedReviewCsvKey, layout: layout.value });
                        }}
                      >
                        {printReviewLayouts.map((option) => (
                          <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <details className="recurring-visit-note-preview">
                    <summary>Optional print report title and notes</summary>
                    <p className="muted">
                      Print-only, temporary text. Do not enter private customer, staff or resource details.
                      These notes are included in the report you print or share, not in CSV exports.
                    </p>
                    <label htmlFor={savedReviewCsvNoteId + "-print-title"}>Custom report title (optional)</label>
                    <input
                      id={savedReviewCsvNoteId + "-print-title"}
                      type="text"
                      maxLength={100}
                      value={activePrintReviewAnnotations?.title ?? ""}
                      onChange={(event) => updatePrintReviewAnnotations("title", event.target.value)}
                    />
                    <label htmlFor={savedReviewCsvNoteId + "-print-notes"}>Manager's planning notes (optional)</label>
                    <textarea
                      id={savedReviewCsvNoteId + "-print-notes"}
                      maxLength={500}
                      rows={3}
                      value={activePrintReviewAnnotations?.notes ?? ""}
                      onChange={(event) => updatePrintReviewAnnotations("notes", event.target.value)}
                    />
                    <button type="button" className="secondary" onClick={() => setPrintReviewAnnotations(null)}>
                      Clear print title and notes
                    </button>
                  </details>
                  <button
                    type="button"
                    className="secondary"
                    disabled={busy || selectedSavedReviewRowCount === 0}
                    onClick={openSelectedSavedReviewPrintReport}
                  >
                    Print selected review rows
                  </button>
                  {selectedRowsPrintErrorKey === savedReviewCsvKey && (
                    <p role="status">Could not open the print report. Allow pop-ups or download the selected CSV instead.</p>
                  )}
                  {visibleSelectedRowsDownloadFeedback && (
                    <p role="status" className="recurring-visit-selected-download-feedback">
                      {visibleSelectedRowsDownloadFeedback === "started"
                        ? "Selected review CSV download requested. No visits were booked."
                        : "Could not start the selected review CSV download. Try copying the selected rows."}
                    </p>
                  )}
                  {visibleSelectedRowsCopyFeedback && (
                    <p role="status" className="recurring-visit-saved-review-csv-copy-feedback">
                      {visibleSelectedRowsCopyFeedback === "copied"
                        ? "Selected review rows copied with column headers. No visits were booked."
                        : visibleSelectedRowsCopyFeedback === "empty"
                          ? activeSavedReviewFilter !== null
                            ? "No matching visit rows to copy. Choose another status or clear selection."
                            : "Select text within one or more visit rows first."
                          : "Could not copy selected review rows. Select text manually or download the full CSV."}
                    </p>
                  )}
                  <p className="muted">
                    Select any visit rows, select all, or choose a saved status, then copy, download or print selected review rows.
                    Only complete visit rows and column headers are copied or downloaded.
                    Read-only proposed dates and saved status counts; no customer
                    details or appointment times. Select or long-press text to
                    copy manually. No visits are booked and availability is
                    not confirmed.
                  </p>
                </div>
              )}
              {visibleSavedReviewCsvCopyFeedback && (
                <p className="recurring-visit-saved-review-csv-copy-feedback" role="status">
                  {visibleSavedReviewCsvCopyFeedback === "copied"
                    ? "Saved-date review CSV copied. No visits were booked or confirmed."
                    : "Could not copy saved-date review CSV. Clipboard access may be blocked; use Download saved-date review CSV instead."}
                </p>
              )}
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
                <div className="recurring-visit-jump">
                  <label htmlFor={plannedJumpId}>Jump to planned visit</label>
                  <select
                    id={plannedJumpId}
                    value={reviewedVisitPosition === null ? "" : date}
                    disabled={busy}
                    onChange={(event) => {
                      const selected = event.target.value;
                      // Accept only a date in this exact validated preview.
                      // This changes agenda focus, never the series anchor
                      // or a booking/resource assignment.
                      if (plannedVisitReviewPosition(plannedVisitDates, selected) !== null) {
                        reviewPlannedDate(selected);
                      }
                    }}
                  >
                    <option value="">Choose a proposed visit</option>
                    {plannedVisitDates.map((visitDate, index) => (
                      <option key={visitDate} value={visitDate}>
                        Visit {index + 1} — {plannedVisitWeekday(visitDate).weekday}, {visitDate}
                      </option>
                    ))}
                  </select>
                  <p className="muted">Select any proposed date to review its agenda. No appointment is booked.</p>
                </div>
                {reviewedPlannedDate && reviewedDateStatuses && (
                  <section
                    className="recurring-visit-selected"
                    aria-label="Reviewed proposed visit details"
                  >
                    <h3>Reviewed visit {reviewedVisitPosition} of {plannedVisitDates.length}</h3>
                    <p className="recurring-visit-selected-date">
                      {plannedVisitWeekday(reviewedPlannedDate).weekday}{" "}
                      <time dateTime={reviewedPlannedDate}>{reviewedPlannedDate}</time>
                    </p>
                    <p className="recurring-visit-selected-count">
                      Saved on this date: {reviewedDateStatuses.savedAppointments}{" "}
                      non-archived {reviewedDateStatuses.savedAppointments === 1
                        ? "appointment" : "appointments"}
                    </p>
                    <p className="recurring-visit-selected-statuses">
                      Saved statuses: Scheduled {reviewedDateStatuses.scheduled}
                      {" · "}In progress {reviewedDateStatuses.inProgress}
                      {" · "}Completed {reviewedDateStatuses.completed}
                      {" · "}Cancelled {reviewedDateStatuses.cancelled}
                      {reviewedDateStatuses.other > 0 && (
                        <>{" · "}Other {reviewedDateStatuses.other}</>
                      )}
                    </p>
                    {hasNoSavedAppointmentsOnPlannedDate(reviewedDateStatuses) && (
                      <p className="recurring-visit-selected-no-saved">
                        No saved appointments on this calendar date.
                        The proposed visit is NOT BOOKED, and staff or
                        equipment availability is not confirmed.
                      </p>
                    )}
                    {isCancelledOnlySavedDate(reviewedDateStatuses) && (
                      <p className="recurring-visit-selected-cancelled-only">
                        Only cancelled saved appointments on this date.
                        This proposed visit is NOT BOOKED and availability
                        is not confirmed.
                      </p>
                    )}
                    <p className="muted">
                      Counts include saved records on this calendar date, not
                      confirmed bookings for this proposal. They do not prove
                      staff or equipment availability.
                    </p>
                    <button
                      type="button"
                      className="secondary"
                      disabled={!canWrite || busy}
                      aria-label={"Prepare currently reviewed visit " +
                        reviewedVisitPosition + " on " + reviewedPlannedDate}
                      onClick={() => preparePlannedDate(reviewedPlannedDate)}
                    >
                      Prepare this visit manually
                    </button>
                    <button
                      type="button"
                      className="secondary"
                      disabled={busy}
                      onClick={() => void copyReviewedVisit()}
                    >
                      Copy reviewed visit
                    </button>
                    <button
                      type="button"
                      className="secondary"
                      disabled={busy}
                      onClick={downloadReviewedVisitText}
                    >
                      Download reviewed visit TXT
                    </button>
                    <button
                      type="button"
                      className="secondary"
                      disabled={busy}
                      onClick={downloadReviewedSavedStatusText}
                    >
                      Download reviewed visit status TXT
                    </button>
                    <button
                      type="button"
                      className="secondary"
                      disabled={busy}
                      onClick={() => void copyReviewedSavedStatus()}
                    >
                      Copy saved status summary
                    </button>
                    <button
                      type="button"
                      className="secondary"
                      aria-expanded={isNotePreviewVisible}
                      onClick={() => setVisibleNoteKey(isNotePreviewVisible ? null : reviewKey)}
                    >
                      {isNotePreviewVisible ? "Hide visit note" : "Preview visit note"}
                    </button>
                    {isNotePreviewVisible && (
                      <div
                        id={reviewedNoteId + "-wrapper"}
                        className="recurring-visit-note-preview"
                      >
                        <label htmlFor={reviewedNoteId}>
                          Selectable proposed visit note — NOT BOOKED
                        </label>
                        <textarea
                          id={reviewedNoteId}
                          aria-label="Selectable proposed visit note — NOT BOOKED"
                          readOnly
                          rows={4}
                          spellCheck={false}
                          value={recurringVisitReviewedText(
                            previewStartDate, previewIntervalWeeks,
                            previewCount, reviewedPlannedDate,
                          )}
                        />
                        <p className="muted">
                          Read-only: select the text or long-press on a phone
                          to copy it manually. This is not a booked visit.
                        </p>
                      </div>
                    )}
                    <button
                      type="button"
                      className="secondary"
                      aria-expanded={isStatusNotePreviewVisible}
                      aria-controls={isStatusNotePreviewVisible
                        ? reviewedStatusNoteId + "-wrapper" : undefined}
                      onClick={() => setVisibleStatusNoteKey(
                        isStatusNotePreviewVisible ? null : reviewKey,
                      )}
                    >
                      {isStatusNotePreviewVisible
                        ? "Hide saved status summary"
                        : "Preview saved status summary"}
                    </button>
                    {isStatusNotePreviewVisible && (
                      <div
                        id={reviewedStatusNoteId + "-wrapper"}
                        className="recurring-visit-note-preview"
                      >
                        <label htmlFor={reviewedStatusNoteId}>
                          Selectable saved appointment status summary — NOT BOOKED
                        </label>
                        <textarea
                          id={reviewedStatusNoteId}
                          aria-label="Selectable saved appointment status summary — NOT BOOKED"
                          readOnly
                          rows={8}
                          spellCheck={false}
                          value={recurringVisitReviewedSavedStatusText(
                            previewStartDate, previewIntervalWeeks, previewCount,
                            reviewedPlannedDate, savedCountByPlannedDate,
                          )}
                        />
                        <p className="muted">
                          Read-only status counts, not customer details or
                          appointment times. Select text or long-press on a phone
                          to copy it manually. No visit is booked, and staff or
                          equipment availability is not confirmed.
                        </p>
                      </div>
                    )}
                    {visibleStatusCopyFeedback && (
                      <p className="recurring-visit-reviewed-status-copy-feedback" role="status">
                        {visibleStatusCopyFeedback === "copied"
                          ? "Saved status summary copied. No visit was booked or confirmed."
                          : "Could not copy saved status summary. Clipboard access may be blocked; use Download reviewed visit status TXT or Preview saved status summary instead."}
                      </p>
                    )}
                    {visibleReviewCopyFeedback && (
                      <p className="recurring-visit-reviewed-copy-feedback" role="status">
                        {visibleReviewCopyFeedback === "copied"
                          ? "Selected proposed visit copied. Nothing was booked."
                          : "Could not copy selected visit. Clipboard access may be blocked; use Download reviewed visit TXT or Preview visit note instead."}
                      </p>
                    )}
                  </section>
                )}
                <div className="recurring-visit-navigation-actions">
                  <button
                    type="button"
                    className="secondary"
                    disabled={busy || !firstPlannedDate || date === firstPlannedDate}
                    onClick={() => {
                      if (firstPlannedDate) reviewPlannedDate(firstPlannedDate);
                    }}
                  >
                    First planned visit
                  </button>
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
                  <button
                    type="button"
                    className="secondary"
                    disabled={busy || !lastPlannedDate || date === lastPlannedDate}
                    onClick={() => {
                      if (lastPlannedDate) reviewPlannedDate(lastPlannedDate);
                    }}
                  >
                    Last planned visit
                  </button>
                </div>
              </div>
              <div className="recurring-visit-compact-control">
                <label>
                  <input
                    type="checkbox"
                    checked={compactPreview}
                    disabled={busy}
                    onChange={(event) => setCompactPreview(event.target.checked)}
                  />
                  Compact view — hide date cards
                </label>
                <p className="muted">
                  Hide only the long date-card list. The selected visit details,
                  date picker, exports and manual preparation stay available.
                </p>
              </div>
              {compactPreview ? (
                <p className="recurring-visit-compact-note">
                  Date cards hidden for easier review. Choose a visit above or
                  uncheck Compact view to show all {plannedVisitDates.length} cards.
                  Your proposed dates and saved appointments are unchanged.
                </p>
              ) : (
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
                    {hasNoSavedAppointmentsOnPlannedDate(savedCountByPlannedDate[index]) && (
                      <span className="recurring-visit-card-no-saved">
                        No saved appointments on this calendar date —
                        NOT BOOKED by this proposal; availability not confirmed.
                      </span>
                    )}
                    {isCancelledOnlySavedDate(savedCountByPlannedDate[index]) && (
                      <span className="recurring-visit-card-cancelled-only">
                        Only cancelled saved appointments — NOT BOOKED by
                        this proposal; availability not confirmed.
                      </span>
                    )}
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
                      onClick={() => preparePlannedDate(visitDate)}
                    >
                      Prepare appointment
                    </button>
                  </li>
                  ))}
                </ol>
              )}
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
