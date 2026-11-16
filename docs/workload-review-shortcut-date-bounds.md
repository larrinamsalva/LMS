# Daily Operations — consistent review-date boundaries (PR #193)

## Problem and fix

The Operations date input is limited to **2020-01-01 through
2100-12-31**. PR #191 disabled individual seven-day date cards beyond
that range. PR #192 added an earliest-saved-activity shortcut that
already suppresses out-of-range navigation.

Two **existing peak summary** shortcuts, however, still rendered
enabled **Review** buttons for dates outside the Operations picker
range. Clicking those buttons could not navigate because the shared
`selectDate` handler blocked the action. An enabled but nonworking
button is confusing, especially for keyboard and screen-reader users.

PR #193 closes that gap:

- **Busiest recorded day** and **Most recorded selected activity day**
  still show their full recorded counts and date, even when a seven-day
  window extends into 2101.
- When a peak date is **inside** the Operations picker range,
  its existing accessible Review button remains fully functional.
- When a peak date is **outside** the range, the misleading enabled
  Review button is replaced with an explicit **outside supported
  Operations date range** explanation.
- `isReviewableOperationsDate` in
  `src/core/daily-operations-dates.ts` now provides **one shared
  calendar-validated date boundary** for both peak shortcuts, the
  earliest activity and quiet-day shortcuts, date cards, daily
  navigation shortcuts and the defensive `selectDate` guard.
- The date validator checks the complete YYYY-MM-DD format,
  real calendar dates (including leap years), and existing
  inclusive minimum/maximum bounds. It does not convert UTC instants
  or alter existing business-local day calculations.

## Scope and safety

This change only affects **read-only navigation controls** and
validation. A missing saved appointment does not imply staff or
resource availability; a saved count does not measure occupancy,
availability, urgency or equipment safety.

All existing full-week counts, work dates, UI filters and sorting,
the no-saved-activity summary and CSV exports remain unchanged.
No record storage, permissions, organization access, scheduling,
database migrations, release installation or API contracts change.

## Regression coverage

`tests/unit/daily-operations-dates.test.ts` now tests the shared
boundary with valid start/end dates, daylight-saving and leap
dates, malformed inputs, impossible dates and 2101 dates.

`tests/unit/workload-peak-review-bounds.test.ts` checks that
a future seven-day snapshot spanning into 2101 retains its
correct **busiest and focused saved counts**, while the shared
predicate rejects each out-of-range review date. It tests valid
in-range peak dates and preserved caller records.

The **existing no-login fictional workspace browser test** now
clicks the two peak buttons for valid saved-work dates, verifies
date-input navigation, and restores the prior date and filter
state before continuing subsequent tests. No additional demo
session or external data is used.

## Merge gate

PR #193 remains **draft and unmerged** until all five checks on
its **final commit** pass: Foundation, PostgreSQL, Browser,
Release install Ubuntu and Release install Windows. Fix any
failure on this same PR branch and recheck. Never auto-merge.

The MIT license, fictional public no-login demo, existing CSV
schemas, release/deployment and other repositories (including
ForgeOS) are untouched.
