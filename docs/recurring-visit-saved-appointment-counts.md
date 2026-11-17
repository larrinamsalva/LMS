# Recurring Visit Planner — saved appointments on proposed dates (PR #203)

## Goal
Extend #201's read-only recurrence preview and #202's per-date
**Review** navigation for Cleaning Company and Property Manager.
Show how many already-saved appointment records overlap each proposed
business-local calendar date, so operators know which dates merit a closer
look without assuming the available capacity of people or equipment.

## User behavior
- Open Schedule → **Preview repeating visit dates (no bookings)**.
- Each 1/2/4-week proposed date (2–12 occurrences) now displays
  **Already saved: N non-archived appointments**, including saved
  cancelled and completed appointments.
- A visit spanning midnight counts against each calendar day it
  overlaps. Appointment timestamps are compared to the actual
  business-local date bounds; DST days may be 23 or 25 hours.
- Tap **Review YYYY-MM-DD** to view that date's existing Schedule
  agenda (non-archived by default). The preview remains anchored until
  the operator deliberately edits the Schedule date picker or uses
  Previous/Next. The new saved-count text is also a screen-reader
  description of the Review button, while its original accessible name
  stays unchanged.
- Review buttons and date-count labels remain legible on touch/mobile
  screens in light and dark theme.

## Counting contract
- Pure `savedAppointmentsOnPlannedDates(dates, records, zone)` takes
  only the **already-authorized in-memory workspace appointment
  snapshot**, not a new API or database query.
- Counts non-archived records with entity `appointments` and valid
  start/end instants that overlap each local date
  (`start < localNextMidnight && end > localMidnight`).
  Cancelled/completed non-archived records are included because the
  default Schedule agenda also displays them. Archived records and
  non-appointment records are excluded.
- Malformed/zero-or-negative intervals do not contribute to counts.
  The helper uses each valid record's two instants once for all dates,
  but does not change any item or its organization/identity metadata.
- Counts are **not an estimate of open booking slots**, room/crew
  capacity, resource conflicts, hours required, staff availability,
  urgency, equipment safety, or a statement that zero means free.
  Counts omit archived appointments and may include cancelled ones.
  Final appointment creation always requires the separate existing
  authorized flow and conflict/exclusion checks.

## Verification
- Independent unit tests cover mixed saved statuses and archive flags,
  overnight two-day overlap, exact midnight boundaries, 23/25-hour
  DST transitions, malformed records, empty input, immutability and
  720 fictional dates under all three recurrence intervals.
- The existing no-login Playwright scheduling test is extended for
  **both** business types: count text, screen-reader descriptions,
  six-date interval previews, count stability while reviewing another
  date, overflow refusing all rows, saved-workspace records unchanged,
  device fit and axe accessibility.
- No new persistence, automatic recurring bookings, API/db/migration,
  export/financial/transport, production auth, release packaging,
  MIT license, or ForgeOS/unrelated repo changes.

## Merge gate
#203 must remain **draft / unmerged** until **all five final-head
GitHub checks** pass: Foundation, PostgreSQL, Browser, Release install
Ubuntu, Release install Windows. Fix any failures on this same branch,
re-run and never auto-merge.
