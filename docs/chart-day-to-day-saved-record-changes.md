# Daily Operations — saved activity chart day-to-day count changes (PR #200)

## Goal
At the milestone PR #200, make the existing seven-day saved-activity
distribution chart easier to understand. Users already see saved counts,
relative-to-peak bars, weekly shares, the category selector, a saved-count
peak shortcut and expandable per-type totals. PR #200 adds a **difference
in saved-record count from the preceding chart date** for each day.

## Exact behavior
- The existing `recordedActivityBars` values for the **full seven
  authorized business-local dates** feed pure
  `recordedActivityDailyChanges(bars)`.
- The first displayed date says **First date in view**: there is no
  earlier date in this authorized chart snapshot. The other six dates
  show **Change vs prior date: +N**, **-N**, or **0** from the preceding
  date's count.
- Use the selected **chart category**: all saved activity,
  appointment starts, unfinished work due or enabled equipment
  inspections. Changes are recomputed when this selector changes.
- The date-card category, active/quiet filter, weekday/weekend
  filter, sort and comparison controls **do not change chart values**.
- The text is associated with its date's existing accessible label via
  an additional `aria-describedby` ID, without changing existing
  screen-reader date/count names. Display is readable, neutral,
  non-color-coded and horizontally scrollable on narrow screens.
- Every difference is a **difference in saved counts**, never a change
  in actual schedule, urgency, time spent, staffing, workload or
  available capacity. It does not infer whether appointments may be
  booked or equipment is ready.
- The labels are read-only and derived from an already authorized
  snapshot; they do not mutate dates, items, records or exports.

## Verification
- Independent unit regression checks explicit positive/negative/zero
  changes, first-date baseline, empty arrays and weeks, preservation of
  exact source counts/order, 720 fictional days, all chart categories,
  enabled/disabled inspections, reversed/duplicated lists and immutability.
- The existing fictional no-login Playwright browser session checks
  all-seven empty-week labels, accessibility descriptions, exact
  count differences in the saved-work week, chart category changes
  and independence from date-card filters.
- No APIs, DB schema/migrations, permissions, CSV formats, license,
  login barriers, deployment changes or other repositories
  (including ForgeOS).

## Merge gate
Keep this PR **draft and unmerged** until **all five checks pass on the
final head**: Foundation, PostgreSQL, Browser, Release install Ubuntu,
Release install Windows. Fix failures on this same branch and recheck.
**Never auto-merge.**
