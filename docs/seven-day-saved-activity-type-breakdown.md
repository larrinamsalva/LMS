# Daily Operations — expand seven-day chart by saved activity type (PR #196)

## Purpose

The full-week saved-activity chart introduced by merged #195 reports
**one exact saved item count per business-local calendar day**. PR #196
adds an optional **Show saved activity types by date** disclosure below
that chart, so users can tell whether recorded items are appointment
starts, unfinished work due, or upcoming equipment inspections.

This helps teams interpret an unusually busy date. The disclosure
starts closed to keep the mobile interface compact and uses the native
HTML `details` / `summary` keyboard and screen-reader semantics.

## Data and authorization

- `savedActivityTypeBreakdown(days, includeInspections)` operates only
  on the **already-authorized complete seven-date workload**, not
  browser-supplied dates, filter selections, contact fields or extra
  database queries.
- Each calendar date displays exact **appointment starts**, **unfinished
  work due**, and (when the Equipment module is enabled) **upcoming
  inspections**, plus **total saved items**.
- These counts match the same day total in the existing seven-day
  chart, including the optional Equipment setting. An equipment-disabled
  organization does not show inspection counts or count them toward
  the total.
- Records that the preexisting authorized Daily Operations summary
  excludes—foreign, archived, cancelled, finished, undated or outside
  the seven-day window—remain excluded. The breakdown contains no
  customer names, IDs, phone numbers, notes, addresses or financials.
- The disclosure always uses all seven **business-local** upcoming
  dates. It does not change when users filter/sort the date cards,
  turn on active-only or quiet-only, select an activity type, or
  filter weekdays/weekends. Existing chart bars, counts, navigation,
  review shortcuts, comparisons and CSV downloads remain unchanged.
- It never modifies stored appointments, tasks, jobs or equipment.

**Important:** These are SAVED RECORD COUNTS, not work hours,
resource or staffing capacity, appointment availability, scheduling
priority or equipment clearance. A high count does not imply more
time or less availability. The visible caution states this plainly.

## Layout and accessibility

- The disclosure is collapsed by default; users activate a native
  `summary` with mouse, touch, Enter or Space. No new JavaScript
  state or keyboard trap is introduced.
- Opening it presents seven responsive text cards. Each has a full
  date, readable numeric category counts and saved total. The
  layout wraps on narrow screens instead of introducing a second
  horizontal scrolling region beside the existing chart.
- All content uses existing light/dark theme variables and a native
  focus-visible outline. The original chart's keyboard-scrollable,
  labeled horizontal list from #195 stays intact.
- No information relies solely on color or the height of a bar.

## Regression coverage

`tests/unit/saved-activity-type-breakdown.test.ts` checks exact per-type
counts, optional equipment inclusion, unchanged data and identity,
the equality between per-day breakdown totals and existing chart
totals, and a **720-day fictional parity matrix** with reversed,
filtered, duplicated and empty lists.

A separate authorized Daily Operations test fixture checks the
fall daylight-saving transition, leap day and foreign/archived
record exclusion.

`tests/e2e/workspace.spec.ts` extends the **existing fictional
no-login browser session**: it expands the disclosure for seven
empty days, verifies zero counts, selects a known recorded-work week
and checks that its detailed total matches the chart's saved count.
It then filters the date cards and verifies neither the original
chart nor the expanded breakdown changes.

## Merge gate

**PR #196 remains draft and unmerged** until **all five GitHub checks
pass on its final head**: Foundation, PostgreSQL, Browser,
Release install Ubuntu and Release install Windows.

Repair failures on this same PR branch. Never auto-merge.

No migrations, database/API changes, login behavior, MIT license,
deployment/release, existing CSV formats or unrelated repositories
(including ForgeOS) are modified.
