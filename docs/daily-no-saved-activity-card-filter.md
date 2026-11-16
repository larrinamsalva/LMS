# Daily Operations — show only dates without saved activity (PR #190)

## Goal

The seven-day Daily Operations card grid now offers a second view:
**Show dates with no saved activity only**.

This complements merged #187 (full-week count and date list),
#188 (review-first-date shortcut), and #189 (downloadable cautious CSV).
The new filter makes it easier to see and review only the seven-day
business-local dates with **no recorded appointment starts, unfinished
work due, or enabled equipment inspections**.

**This does not confirm availability.** A day without recorded items
may still have unavailable staff, equipment, rooms or time slots.
The existing prominent disclaimer remains visible beside the complete
seven-day summary.

## Controls and compatibility

- The filtered card list reuses the **same authorized**
  `datesWithoutSavedActivity` helper from #187. No new API,
  database query, record mutation, permission or date algorithm.
- The no-saved-only and active-only view toggles are **mutually
  exclusive**. Turning on the no-saved view resets active-only and
  selected activity category to **All recorded activity** to avoid
  silently hiding all zero-count dates.
- Choosing an active-only or a particular activity category exits
  the no-saved-only view. **Reset workload view** restores all seven
  date cards, including when the new filter is active.
- The **Monday–Friday / Saturday–Sunday** filter remains usable
  with the quiet-date view. Existing calendar or most-recorded
  ordering remains available.
- The new filter changes **only displayed cards and the visible
  date-card totals**. All full-week counts, the no-saved-activity
  summary, adjacent-week comparison, and the canonical no-saved CSV
  remain calculated from the **complete seven-date** business-local
  window, independent of screen filters.
- The existing **Download visible workload CSV** is offered when
  the new view is active; it continues to calculate canonical counts
  from the already-authorized summary and never trusts dates/counts
  supplied by the browser.
- When no dates match the selected no-saved view and optional
  weekday/weekend filter, a specific empty-state message appears.
  The user can reset the workload view.
- A business without the equipment module continues to ignore
  inspection-only dates when assessing saved activity. No staff
  availability, bookable capacity or work authorization is inferred.

## Regression tests

`tests/unit/daily-no-saved-activity-card-filter-parity.test.ts`
checks the unchanged full-week totals and view complement, exact
date-card identity/order, optional equipment and weekday/weekend
filters, sorting ties, repeated input day references and empty weeks.

The existing fictional demo browser workflow in
`tests/e2e/workspace.spec.ts` now verifies the actual toggle and
`aria-pressed`, weekend selection, full-week summary stability,
visible-card totals, mutually exclusive active-day mode, restoring
all cards through Reset, and a populated work window whose booked
work dates must disappear from the quiet-only view. The test reuses
the **existing** no-login demo session and then continues the
previous export and review tests.

## Merge gate

PR #190 remains **draft and unmerged** until the final head passes
all five checks: Foundation, PostgreSQL, Browser, Release install
Ubuntu and Release install Windows. Repair failures **on this same
branch** and recheck; **never auto-merge**.

No persisted appointments, jobs, tasks or equipment; organization
authorization; API or database schema; migrations; existing CSV
formats; public demo login; MIT license; deployment, or other
repositories (including ForgeOS) are modified.
