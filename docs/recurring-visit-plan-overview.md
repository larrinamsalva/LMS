# Recurring visit planner — proposed-date overview (PR #212)

## Mission
The Living Management System recurring planner currently supports a
bounded **unsaved** date-only plan, manual appointment preparation and
return, per-day saved appointment counts and statuses, Previous/Next
agenda review, a highlighted reviewed visit, CSV export, weekday
labels and copy-to-clipboard.

PR #212 adds **Plan at a glance — proposed only** directly under the
recurrence controls so Cleaning Company and Property Manager
operators can understand the shape of the draft plan without reading
every date card.

## Display
- **Proposed visits:** 2–12, from the existing validated preview.
- **Weekday dates:** number of proposed ISO calendar dates falling
  Monday–Friday.
- **Weekend dates:** number falling Saturday/Sunday.
- **First proposed date:** weekday name and canonical business-local
  YYYY-MM-DD date.
- **Last proposed date:** weekday name and canonical business-local
  YYYY-MM-DD date.
- **First-to-last span:** exact number of *calendar weeks between the
  first and last visit*, **not the number of appointments actually
  scheduled**. E.g., six proposed four-week visits cover 20 weeks.

For example, six proposed four-week visits starting on Friday,
2026-11-06 show **6 proposed / 6 weekdays / 0 weekends /
Friday 2026-11-06 to Friday 2027-03-26 / 20 calendar weeks**.
Starting the exact same interval on Saturday, 2026-11-07 shows
**0 weekdays / 6 weekend dates**. This is simply calendar arithmetic:
**a weekend is not a business closure or unavailable time slot.**

## Data and security boundaries
- Pure `recurringVisitPlanOverview(startDate, everyWeeks, count)`
  reuses the existing strict `previewRecurringVisitDates` for
  bounded 1/2/4-week, 2–12-occurrence calendar schedules and rejects
  malformed dates or dates after 2100-12-31. It uses
  `plannedVisitWeekday` and a deterministic (count - 1) * weeks
  span. No current clock, UTC timezone conversion or live resource
  information is read.
- The UI derives the overview from the same transient, validated
  plan as the cards and only renders it when validation succeeds.
  Changing the plan anchor, interval or count recomputes the
  overview. Reviewing a later date **does not re-anchor it**.
- Cancelling or successfully saving one **manual** appointment and
  resuming the plan preserves the same overview. Successful manual
  Save still runs the existing authorization and resource checks;
  the summary itself saves **nothing**.
- The heading and bottom line explicitly state **proposed only /
  not a count of booked appointments / weekend labels do not
  establish staffing or availability**. The separate per-date
  "Already saved" and status counts remain the only display of
  actual saved appointment data.
- The summary reads no customer, business names, resource/crew
  availability, work, PII, payments, invoices, booking times or
  historical booking status and creates no messages, API calls,
  database writes or persistent recurrence.
- Accessible semantic `<section>`, `<h3>`, and `<dl>` provide
  labeled values with normal light/dark theme contrast, a responsive
  mobile layout and machine-readable `<time>` dates. No
  color-only meaning.
- Existing CSV and copy text formats are **unchanged**. No new
  demo session (24-session limit unchanged), role, authentication,
  migration or other repository (including ForgeOS) change.

## Verification
- Vitest: exact Friday/weekend/Sunday summaries; all 1/2/4-week
  intervals; 2/4/6/8/12 occurrences; DST, leap/year boundaries;
  exact first/last and span; no mutated preview; strict rejection
  of invalid/out-of-range proposals.
- Existing no-login Playwright **Cleaning Company and Property
  Manager** scheduling test (no new demo sessions): initial
  four-date overview, updated six-date four-week overview,
  hidden overview for invalid/overflowed plan, six weekend dates
  after Saturday re-anchor, restored weekday counts after
  re-anchor and manual Cancel. Existing checks for unchanged
  persisted records, responsive UI/axe accessibility, CSV/copy,
  and explicit one-appointment Save remain intact.

## Merge gate
**Draft / unmerged** until all FIVE GitHub quality jobs succeed
for the **final PR head**: Foundation, PostgreSQL, Browser,
Release install Ubuntu, Release install Windows. Fix any failure
on **this branch**, rerun and verify all five; **never auto-merge**.
