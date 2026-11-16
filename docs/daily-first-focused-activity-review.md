# Daily Operations — review first date for selected activity (PR #194)

## What changed

The seven-day **Daily Operations** workload view already supports
filtering to **appointment starts**, **unfinished work due** or
**upcoming serviceable equipment inspections**. Its existing
**Most recorded selected activity day** points to the highest
saved count in that category.

PR #194 adds a distinct read-only **First selected activity day**
panel. Choosing an activity category reveals the **earliest
business-local date** with a positive saved count in that category,
the number of matching saved items on that date, and an accessible
**Review YYYY-MM-DD** button. This helps teams navigate to the
next relevant recorded appointment, work-due date or enabled
equipment inspection without relying on the busiest-date ranking.

## Definition and safety limits

- `earliestFocusedActivityDay(days, includeInspections, type)`
  operates **only on the already-authorized seven-day snapshot**.
  It reuses the exact `focusedRecordedItemCount` calculation
  used by existing focused totals and sorting.
- Appointments, unfinished work and inspections remain distinct;
  inspection-only days do not qualify when the Equipment module
  is disabled. There is no new organization scope or data query.
- Find the earliest qualifying **business-local calendar date**,
  even if cards are sorted by largest recorded count or the input
  array is reordered. Only a positive saved count qualifies.
- The panel is shown only when a category is selected rather
  than **All recorded activity**. Empty categories show a
  clear no-saved-activity message with no Review button.
- The button uses the existing `selectDate` navigation and
  shared `isReviewableOperationsDate` validator from #193.
  If the earliest matching date lies outside the
  **2020-01-01 through 2100-12-31** supported picker range,
  show an explicit boundary message instead of a misleading
  enabled button. Original counts remain visible.
- The new panel does not change screen filters, ordering, totals,
  work records, appointment assignments, equipment state,
  bookings, CSV downloads, comparison windows, or available
  capacity. **Saved counts do not prove staff availability,
  appointment availability, urgency or resource capacity.**

## Verification

`tests/unit/first-focused-activity-day.test.ts` compares the
single-pass helper against an independently assembled oracle
built from the **existing category filter and saved-count**
functions for **720 fictional date cards**, reversed, duplicated,
filtered and empty inputs, all four activity types, both equipment
settings, and input immutability.

Authorized business-local seven-day summaries additionally test
the DST fall transition, leap day, and foreign/archived record
exclusion.

The **existing fictional no-login Playwright workspace session**
now verifies that an empty selected category has no review
shortcut and that the first unfinished work date can be
reviewed, with the Operations date input updating correctly.
The previous most-recorded and other review tests still run in
the same session.

## Merge gate

PR #194 remains **draft and unmerged** until five checks on the
**final PR head** all pass: Foundation, PostgreSQL, Browser,
Release install Ubuntu and Release install Windows.

Fix any failure on this same branch and recheck; never
automatically merge.

The MIT license, fictional public no-login demo, schema,
migrations, APIs, existing CSV formats, release/deployment,
and all other repositories including ForgeOS remain untouched.
