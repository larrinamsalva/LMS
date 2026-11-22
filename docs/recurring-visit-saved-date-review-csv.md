# Recurring visit planner — saved-date review CSV (PR #230)

## Goal

Provide a useful, exportable **date-level status checklist** for the unsaved repeating-visit proposal after PRs #221–#229 added coverage counts, no-saved and cancelled-only lists, and read-only navigation. A manager can review those proposed calendar dates and already-saved appointment **counts** in a spreadsheet without exporting customer, staff, resource, time, or other record details.

## User experience

- Inside the already validated repeating-visit planner's export actions, retain the existing **Download planned dates CSV** and **Copy planned dates** buttons unchanged.
- Add a distinct action **Download saved-date review CSV**, disabled only while the existing Schedule is busy, present for valid 2–12-date recurrence previews (including Compact view), and hidden with the whole preview for invalid/overflowed date rules.
- Download filename: `lms-visit-saved-date-review-YYYY-MM-DD-NOT-BOOKED.csv` using the canonical proposal start date only.
- The CSV is UTF-8, CRLF terminated, fixed-header, one row per proposed business-local date, with the columns:
  `Visit,Proposed date,Existing non-archived saved appointments,Scheduled,In progress,Completed,Cancelled,Other,Saved-date classification,Note`.
- The Visit number is the original **one-based position within the complete unsaved proposal**; date is validated ISO YYYY-MM-DD. All quantities are nonnegative integers. The saved-date classification is a fixed, safe label from the existing status helpers:
  - `No saved appointment records` when `savedAppointments === 0`
  - `Cancelled-only saved records` when `savedAppointments > 0 && cancelled === savedAppointments`
  - `Has non-cancelled saved records` otherwise (includes Scheduled, In progress, Completed and unknown Other; **not** a claim that any visit is actively scheduled)
- Every row ends with the literal **Proposal only - NOT BOOKED - availability not confirmed**. No CSV cell ever includes names, titles, free text, status-label strings from saved records, appointment times, resource IDs, customer data, organization IDs, or dynamic unescaped user input.
- The existing, separate **Download planned dates CSV** stays unchanged and date-only. The new export deliberately has a different name and status-count columns; it does not create, update, cancel, confirm or reserve any appointments or recurring series.
- The status counts come from the same **already calculated authorized organization-scoped `PlannedDateAppointmentStatuses[]`** displayed on the Schedule date cards and coverage summary. No additional server or database query is needed. Cancelled non-archived appointments still count as saved. Overnight local-date overlap and DST still use the existing business-local date rules.
- The pure generator regenerates and validates the bounded proposal at click time and strictly checks that every status row matches the exact date at that position, each count is a nonnegative safe integer, and all status categories sum to the total saved count. It fails closed on mismatched, malicious, inconsistent or malformed rows before downloading anything. Classification values are constant strings, preventing CSV formula injection.

## Technical changes

- `src/core/recurring-visit-saved-appointments.ts`: add `recurringVisitSavedStatusCsv(startDate, everyWeeks, occurrences, statuses)`, using the existing `previewRecurringVisitDates`, `hasNoSavedAppointmentsOnPlannedDate` and `isCancelledOnlySavedDate` helpers. CSV formatting uses fixed string labels and validated numbers only.
- `src/components/schedule.tsx`: add a local-only CSV Blob/download function and button next to existing export actions. The only source data is current, already-rendered per-date authorized status rows.
- No new CSS, new state, new browser sessions, API, migration, user record access, or change to existing appointment Save and conflict safeguards.

## Tests

- Unit tests cover original visit ordinals, 2-week proposals, mixed Scheduled+Cancelled, cancelled-only, empty, Completed, archived-only, Other unknown and unrelated records, immutable inputs, CRLF rows, strict header and note, and rejection of stale/misaligned dates, malformed/date-like CSV formulas, negative/non-integer/non-finite/unsafe counts, invalid sums, mismatched lengths and overflowing proposals. Unknown raw status values never appear in CSV.
- Extend the **existing two-organization no-login Playwright scheduling session** (no new sessions):
  - Download the new CSV for an existing six-visit preview; compare each date, visit number, total and status breakdown with actual on-screen card values, and check the exact constant classification/note.
  - Check filename and privacy: no customer, work, resource, or ISO appointment timestamp is exported.
  - Keep the button visible when Compact view hides cards; hide it on invalid/overflowing recurrence.
  - After an **explicit manual one-appointment Save**, download the updated CSV and verify the changed proposed date has at least one Scheduled saved record, is correctly classified as having non-cancelled saved records, and still says NOT BOOKED by the proposed series.
  - Preserve the existing browser WCAG/mobile, customer isolation, 24-demo-session limit, all established read-only lists, and existing proposal clipboard/CSV behavior.

## Safety and merge gate

This is an **authorized, read-only date and numeric-count export**, not an availability search, appointment export, booking confirmation, resource assignment or automatic recurring booking. No customer PII, no mutation or new persistence.

Leave **#230 DRAFT / UNMERGED** until all five checks on the **final PR head SHA** pass: Foundation, PostgreSQL, Browser, Release install Ubuntu and Release install Windows. Fix any failure on this same PR branch and rerun/reverify all five. **Never auto-merge.**
