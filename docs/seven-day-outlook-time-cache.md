# Seven-day Outlook CSV — cache repeated appointment time labels (PR #186)

## Purpose

The read-only seven-day Outlook CSV exports future, already-authorized
appointments and dated unfinished jobs/tasks. The export uses both a
**business-local display label** and a **business-local sort key** for
each scheduled appointment.

Previously, the CSV generator called `displayTime(start, zone)` and
`localTime(start, zone)` separately for every appointment, even when
many saved appointment occurrences shared an identical start string.

PR #186 stores the **pair of derived strings for an identical saved
string start** in one temporary `Map` within each
`sevenDayOutlookCsv` invocation. Repeated starts reuse the same
display label and sort key, reducing redundant time conversions.

## Exact compatibility and safety boundaries

- The original `displayTime` and `localTime` functions,
  date/time zone conversions, and saved input strings are unchanged.
  No UTC-versus-local calendar-day logic is changed.
- Only **original string starts** are memoized. Historical
  non-string values still undergo the original `String(value)`
  coercion and independent formatting for each occurrence.
  Errors from invalid included timestamps are not suppressed.
- The cache lives **inside a single export call**. No global,
  cross-zone, cross-business, cross-date or cross-snapshot state
  persists, and changes to saved starts are reflected in
  subsequent exports.
- Appointment and work rows retain the original fields, titles,
  statuses, order, stable sort ties, and CRLF-delimited CSV format.
  Dated unfinished jobs and tasks are not reformatted.
- The final `sortKey.localeCompare` / `title.localeCompare`
  ordering is untouched, including identical times represented
  with different UTC offset spellings.
- The existing `csvSafeCell` guard still escapes quotes and
  neutralizes dangerous spreadsheet formula prefixes. Private
  contact information, notes, unrelated organizations, archived
  items and cancelled appointments are never added to the export.
- No appointment is booked or changed. This is a
  **read-only presentation optimization**, not a scheduling,
  staffing availability or capacity decision.

## Independent regression checks

`tests/unit/seven-day-outlook-time-cache-parity.test.ts` contains
an **independent full CSV implementation copied from verified
five-green merged LMS #185**. It reconstructs rows, per-item
time conversions, order, `csvSafeCell` escaping and CRLF line endings.

Tests assert **exact whole-string CSV identity** for 720 fictional
appointment revisions plus 240 fictional jobs/tasks over three
business time zones, five selected dates, DST folds, leap days,
two offset spellings for the same instant, duplicate saved records,
same-time title sort ties, spreadsheet-formula input, archived,
foreign and cancelled records, fresh exports after edits,
empty exports and invalid included timestamps.

These are **behavioral parity tests**, not benchmarked speed gains.

## Merge gate

PR #186 remains **draft and unmerged** until the final PR head
passes Foundation, PostgreSQL, Browser, Release install Ubuntu,
and Release install Windows. Fix failed checks on this same PR
branch. Never automatically merge.

No saved records, UI, API/database/migrations, CSV schema,
licensing, deployment, fictional public no-login demo,
or other repositories (including ForgeOS) are modified.
