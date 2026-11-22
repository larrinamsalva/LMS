# Recurring visit planner — saved-appointment date coverage (PR #221)

## Goal
The existing LMS Schedule recurring-visit planner offers a strictly
bounded, **unsaved** date-only proposal of 2–12 visits with 1/2/4-week
intervals. Individual date cards, the focused visit panel, and the
optional Compact view already show counts and statuses for existing,
non-archived saved appointments on each proposed business-local date.
The **Plan at a glance** overview, however, previously showed only
calendar totals, weekday/weekend split, first/last dates and span.

This update adds a readable **Saved records on proposed dates**
summary so an operator can quickly see how many of the proposed dates
already overlap any existing saved appointment records versus how many
have none, even in Compact view.

## Behavior
- Add a small, high-contrast panel beneath the existing six-item
  Plan at a glance data list. **Do not add additional `<dd>`**
  cells or modify the existing proposed-only calendar metrics.
- For each currently proposed date, reuse the **existing**
  `savedAppointmentStatusesOnPlannedDates` result computed from the
  authorized current organization's saved `appointments` records
  using the business's configured time zone. No new database query.
- Display two mutually exclusive counts, always totaling the
  proposal's 2–12 valid dates:
  - **X of N proposed dates contain at least one non-archived saved
    appointment**.
  - **Y of N proposed dates contain no non-archived saved appointment**.
- Multiple existing appointments on one proposed date count as **one
  date** with saved records; never count total appointment entries as
  distinct dates. Saved appointments spanning midnight may contribute
  to *both* business-local dates. Cancelled-but-non-archived entries
  are included because the existing per-date status rules already
  include them. Archived records and corrupt/invalid appointment
  intervals do not count.
- Counts update automatically when the user changes the proposal's
  interval, date anchor or number of proposed visits, or after an
  explicit manual appointment Save/Cancellation/Archive changes the
  authorized saved records. The existing single-date manual Save
  operation remains the **only** place an appointment can be created.
- Read-only coverage remains visible in Compact view. Invalid or
  overflowing proposals hide the whole overview and coverage,
  retaining the existing validation message.
- Plain text explicitly states that existing saved appointments may
  be **unrelated** to the proposed recurring dates and **do not prove
  those visits are booked**, and that a date with zero saved
  appointments **does not imply resource/staff availability**.
- Layout uses existing light/dark theme variables, readable text,
  number formatting and mobile wrapping. The group has an accessible
  name **Saved appointment date coverage**, so it can be found
  separately from the six calendar-only metric cells.

## Internal implementation
- Add pure `savedDateCoverage(statuses)` to the existing
  `src/core/recurring-visit-saved-appointments.ts` module, consuming
  the already computed `PlannedDateAppointmentStatuses[]`.
  It returns `{ withSaved, withoutSaved }`. It performs no record
  access, store mutation, booking or staff/resource availability check.
- Compute the two figures directly from the same per-date status
  rows used by the reviewed date and numbered cards, with
  `withSaved` equal to the number of status rows whose
  `savedAppointments > 0`, and
  `withoutSaved = rows.length - withSaved`. Each valid date is
  represented exactly once by the existing strict preview generator.
- The existing six `<dt>/<dd>` items, CSV and clipboard exports,
  one-date TXT file and selectable note preview stay unchanged.

## Tests
- Unit tests in the existing saved-appointments test file:
  several appointments on one day; one overnight, cancelled
  appointment counted on adjacent business-local dates; archived,
  corrupt or unrelated records excluded; records and proposed dates
  unmodified; zero coverage, full coverage, empty input and reversed
  input; cancelled records still count as existing saved records.
- Extend the **same** no-login Playwright scheduling test for
  fictional Cleaning Company and Property Manager, without creating
  additional demo sessions (the fixed 24-session boundary test):
  1. Verify the accessible coverage group and explicit warning.
  2. Compare the four-date coverage to the existing per-card saved
     counts rather than hardcoding seeded fictional records.
  3. Change the proposal to six dates and verify coverage matches
     the six per-date records; confirm the six existing calendar
     overview data cells remain unchanged.
  4. Following a deliberately saved, separately validated single
     appointment, verify the returned overview matches its six
     now-updated date cards and no more than the one explicit new
     record has been saved.
  5. An invalid/overflowing preview hides the coverage group.
  6. Preserve existing unit/e2e coverage for status breakdown,
     booked-vs-proposed disclaimers, Compact view, navigation,
     CSV/TXT/clipboard, accessible mobile layout and manual
     Save/Cancel protections.

## Safety
**This is a read-only comparison of existing saved dates and a
proposed unsaved series, not a booking/availability confirmation.**
No new database/API call, migration, authorization or role change,
persistence, customer export, staff/equipment allocation, automatic
recurring booking, notification, payment, 24-session demo limit
change or ForgeOS/unrelated repo changes.

## Merge gate
Leave **#221 DRAFT / UNMERGED** until all five checks on the
**final head commit** pass: Foundation, PostgreSQL, Browser,
Release install Ubuntu and Release install Windows.
Fix failures **on the same PR branch** and verify a successful
final-head run. **Never auto-merge.**
