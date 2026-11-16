# Daily Operations — download dates with no saved activity (PR #189)

## What changed

Following merged #187 (the seven-day no-saved-activity summary) and
#188 (the review-first-date shortcut), Daily Operations can now
**download only the dates with no recorded activity as a CSV**.

The button appears only if at least one date in the full seven-day
business-local outlook has no saved appointment starts, unfinished
work due or (for equipment-enabled workspaces) upcoming equipment
inspections. It downloads a local UTF-8 CSV with a BOM suitable for
common spreadsheet programs.

The download is a **review worksheet**, not evidence of capacity
or appointment availability. The original onscreen warning remains,
and **each exported date row explicitly states**:

> NOT CONFIRMED AVAILABILITY - check schedules before planning

## Export contract

`src/core/no-saved-activity-dates-csv.ts` exports
`noSavedActivityDatesCsv(overview, zone, includeEquipment)`.

- It **recomputes** the canonical seven-day workload from the already
  organization-scoped `summarizeDailyOperations` result. It never
  accepts a caller-provided date subset, count or selected UI filter.
- It reuses the already-tested `datesWithoutSavedActivity` predicate
  and respects the existing equipment module setting: an inspection-
  only date is considered empty if equipment is disabled.
- The output contains only window start, inclusive end, the exact
  business-local date, the label `None recorded`, a clear caution
  about availability, and the business time-zone name.
- The CSV contains **no** customer, employee, work, appointment or
  equipment names, record IDs, notes, contact details or amounts.
- It preserves sorted business-local dates, including spring/fall
  daylight-saving changes and leap dates. Existing calendar
  calculations, saved records and organization authorization remain
  unchanged.
- Every field is encoded using existing `csvSafeCell` protections,
  with CRLF line endings. An empty result produces header-only CSV;
  the UI hides the download button when there are no dates to report.
- The downloadable filename includes the selected business-local
  date and the seven-day end date.

## Regression verification

`tests/unit/no-saved-activity-dates-csv.test.ts` verifies exact
headers and date rows, the availability caution on **every** row,
enabled/disabled inspection behavior, foreign/archived/cancelled
record exclusion, customer privacy, empty and occupied weeks,
DST/leap boundaries, input immutability and fresh recalculation
after changes to saved work.

The **existing no-login demo session** in
`tests/e2e/workspace.spec.ts` now exercises the real download at
an empty fictional 2035 window, verifies the filename and CSV
contents, then continues the existing first-day review test.
No additional demo session or external service is needed.

## Limitations and merge gate

This is a **read-only informational export**; it does not verify
staffing, schedules in other systems, resource availability,
equipment readiness or bookable slots. It never creates or
changes appointments.

PR #189 remains **draft and unmerged** until all five checks pass
on its final head SHA: Foundation, PostgreSQL, Browser, Release
install Ubuntu and Release install Windows. Repair failures on
the same branch. Never auto-merge.

No business records, schema, migrations, APIs, existing CSV
formats, license, release/deployment or other repositories
(including ForgeOS) are modified.
