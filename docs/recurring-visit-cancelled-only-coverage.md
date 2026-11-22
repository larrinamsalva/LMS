# Recurring visit planner — cancelled-only saved-date coverage (PR #224)

## Goal

LMS #221 introduced counts of proposed business-local dates with
and without existing non-archived saved appointments; #222 and #223
added forward/backward review shortcuts. A date may have existing
records that are **all Cancelled**, which can be mistaken for a
currently scheduled visit. Add a clearly labelled read-only
cancelled-only subset of the saved-date coverage, with no
availability or booking implication.

## Behavior

- Inside the existing **Saved appointment date coverage** group in
  Schedule's **Plan at a glance — proposed only**, show one extra
  sentence: **X of Y proposed dates with saved records contain
  only cancelled, non-archived appointments.**
- Y is the existing #221 count of proposed dates with at least one
  non-archived saved appointment. X counts only dates with
  `savedAppointments > 0` and `cancelled === savedAppointments`
  in the **already-computed per-date status breakdown**.
- A date with no saved record is **not** cancelled-only (0/0 is
  excluded). A date with any Scheduled, In progress, Completed or
  unknown/Other status is **not** cancelled-only even when other
  records on it are Cancelled. Multiple Cancelled records on one
  date count as **one date**, not multiple appointments.
- **Retained Cancelled entries still count as saved records.**
  Archived appointments, corrupt intervals and non-appointment
  records remain excluded by the existing shared date/status
  computation. Midnight-spanning appointments and DST retain the
  current business-local date overlap semantics; a record may
  contribute to two dates.
- Text explicitly explains that cancelled-only and empty dates
  **do not prove that a worker or machine is free** or that a
  proposed visit has been booked. No statuses are inferred.
- The number updates when the proposal start/interval/count changes,
  when the authorized organization changes, and after the user
  explicitly saves or changes an appointment through the existing
  editor. It remains readable in Compact view and disappears with
  the rest of the overview for invalid/overflowed proposals.
- Existing six date-only `<dt>/<dd>` overview cells, coverage
  counts, all four review shortcuts, read-only notes, CSV and TXT
  exports, calendar navigation, permission/authorization checks,
  and manual appointment creation remain unchanged.
- The new metric is highlighted with a subtle theme-aware border
  and contrast, no color-coded availability or warning statuses.

## Implementation

A new pure `cancelledOnlySavedDateCount(statuses)` function in
`src/core/recurring-visit-saved-appointments.ts` consumes the
**same** organization-scoped `PlannedDateAppointmentStatuses[]`
that the date cards, overview and review shortcuts use. It is
read-only, deterministic, bounded by the existing 2–12-date
preview, never queries the server or reads customer information,
and returns a distinct-date count, not a booking count.

## Test coverage

- Unit tests: multiple Cancelled records on one date count as one;
  a date with Cancelled + Scheduled is not cancelled-only;
  zero-record dates, archived-only dates, unknown Other,
  completed-only dates, corrupt intervals and other entities
  are excluded; zero-length and empty lists work; input arrays
  and records remain unchanged.
- Business-local overnight/DST unit test: a Cancelled appointment
  that spans two local dates counts on each until another
  non-Cancelled saved appointment overlaps one of the dates.
- Extend the **existing** two-business no-login Playwright
  scheduling scenario (Cleaning Company and Property Manager,
  **no additional demo sessions**) to derive the exact
  cancelled-only count from the already displayed date-card
  saved totals and Cancelled-status subtotals, assert the
  new figure for four-date and six-date previews, and recheck
  after a manually saved appointment. Verify the explanatory
  disclaimer and disappearance for an overflowing plan.
- Preserve existing WCAG/mobile tests, 24-session demo cap,
  organization isolation, one-appointment Save/Cancel and
  copy/TXT/CSV safeguards. No data assertions assume a particular
  seeded appointment status.

## Safety

**Read-only status clarification, not availability, reservation or
booking advice.** Do not create any appointments, assignments,
notifications, recurrence rules, resources, payments, files or
persisted data. No API, schema, migration, session, permission,
authorization, customer export, or unrelated repository change.
ForgeOS remains untouched.

## Merge gate

Leave #224 **DRAFT / UNMERGED** until all five checks pass on the
**final PR head SHA**: Foundation, PostgreSQL, Browser, Release
install Ubuntu, Release install Windows. Fix any failure **on
the same branch** and rerun all five. **Never auto-merge**.
