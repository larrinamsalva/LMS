# Daily Operations — chart share of weekly saved activity (PR #199)

## Why
PRs #195–#198 introduced a seven-day saved-record chart, chart-only
activity selector, expandable type breakdown and a peak-date review.
The **bar height** measures one date against the *largest daily count*
in the seven-day window; it does **not** mean the day's share of the
week or percent of staffing/resource capacity.

PR #199 adds explicit **Share of week** text to each date card in the
chart, so viewers can tell how much of the **selected category's**
saved activity falls on each date without interpreting bar heights.

## Calculation and interpretation
- The new pure `recordedActivityWeekShares(bars)` consumes the chart's
  already-authorized `recordedActivityBars` result. It reads only
  `date` and `savedItems`. It neither queries nor writes records.
- Divide each date's selected saved count by the sum of counts across
  the **full seven-day window**. Present a rounded one-decimal percent.
  For zero items, including empty weeks, show **0%**. A tiny positive
  share below 0.1% displays **<0.1%**, never a misleading zero.
  Rounding can prevent displayed percentages from summing to exactly 100%.
- Calculations follow the chart's own **All, Appointments, Unfinished
  work, Equipment inspections** selection and already exclude equipment
  counts when that workspace module is disabled.
- The chart remains exactly seven business-local dates even if
  date cards are limited to quiet/active days, weekdays/weekends,
  a different category, or a display sort.
- Each share is visible as **text**, not solely color or bar height.
  It is also connected as a screen-reader description of its date's
  existing labeled list item, using React `useId` for unique IDs.
- Light/dark styling and mobile horizontal keyboard scrolling remain
  intact; none of the chart's old accessible names are changed.

**Not a capacity metric:** a percentage is a share of **saved-record
counts**, not hours, urgency, utilization, booking availability, staffing
capacity, equipment readiness or schedule fill.

## Verification
- Unit tests check exact share examples, bars versus weekly shares,
  zero and tiny positive values, 720 fictional days, all categories,
  equipment on/off, reverse/duplicate input, immutability and empty data.
- The existing fictional no-login Playwright session checks the seven
  empty-week labels, unique accessible descriptions, nonzero recorded
  work, category updates, and invariance under date-card filters.
- No changed bookings, saved data, APIs, migrations, database,
  organization access, CSVs, MIT license, demo auth, deployment,
  or any other repo (including ForgeOS).

## Merge gate
Keep #199 draft and unmerged until five checks on its **final head**
pass: Foundation, PostgreSQL, Browser, Release install Ubuntu,
and Release install Windows. Repair failures on this same PR branch,
recheck and **never auto-merge**.
