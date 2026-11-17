# Daily Operations — review the selected chart peak (PR #198)

## Purpose
The seven-day saved activity chart from #195/#197 and per-type disclosure
from #196 now support an accessible **Highest selected chart count** cue.
A user can choose **All saved activity**, **Appointment starts**,
**Unfinished work due**, or **Equipment inspections** (when enabled)
and review the calendar date with the most **saved records** of that type.

## Behavior
- Reuse the existing pure `busiestFocusedDay` count and earliest-date
  tie-breaker on **all seven business-local dates**. The chart's own
  category is independent of the separate date-card category, active/quiet,
  weekday/weekend, sort, comparison and disclosure controls.
- Show one explicit `Review YYYY-MM-DD` button only if the chosen
  category has saved items and that date is a valid Operations date
  in the inclusive 2020-01-01 through 2100-12-31 range.
- Empty categories show a plain-language message **without** a Review button.
  A peak outside the date-picker range still displays its count/date,
  but does not navigate or silently clamp the date.
- Keep the chart bars decorative; the separate shortcut is a full-size
  keyboard-accessible control with an accessible label. Long content and
  44px controls wrap legibly on mobile in light/dark mode.
- The shortcut uses the existing `selectDate` navigation. It is
  **not** an appointment booking, staffing, urgency, hours, capacity,
  equipment safety or resource availability assessment.

## Regression checks
- New unit tests compare peak results against 720 fictional day-card
  chart bar sets for all four categories, enabled/disabled inspections,
  reordered and empty inputs, deterministic ties, and date bounds.
- Existing fictional **no-login Playwright** session checks the empty week
  has no review button, the selected category has a peak, date-card filter
  isolation, and navigation back to the known 2026 work window.
- Existing seven-date bars, exact per-type disclosure, totals, exports,
  saved records, permissions, database/API, demo, MIT license and other
  repositories, including ForgeOS, are untouched.

## Merge gate
Keep PR #198 **draft and unmerged** until **all five final-head GitHub
checks** pass: Foundation, PostgreSQL, Browser, Release install Ubuntu,
Release install Windows. Repair failures on the same PR branch and rerun;
**never auto-merge**.
