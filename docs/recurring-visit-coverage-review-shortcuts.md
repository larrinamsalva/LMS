# Recurring visit planner — review the next date by saved-record coverage (PR #222)

## Purpose
The existing LMS Schedule repeating-visit planner shows a strictly
bounded, **unsaved** 2–12-date calendar proposal, and #221 added
read-only coverage counts for proposed dates that already overlap
one or more non-archived saved appointments versus those with none.

When a user is working through twelve proposed dates in **Compact view**,
the numbered date cards are hidden. This update adds two convenient
review shortcuts inside the coverage group to navigate to the next
proposed date of each kind, without claiming that any date is free,
available, confirmed, or already booked as part of the proposal.

## Controls
- **Review next proposed date with saved records** navigates to the
  earliest *strictly later* proposed calendar date that overlaps
  at least one existing non-archived saved appointment.
- **Review next proposed date without saved records** navigates to
  the earliest *strictly later* proposed calendar date with zero
  overlapping non-archived saved appointments.
- Both read **only** the same authorized, organization-scoped
  `PlannedDateAppointmentStatuses[]` that the existing date cards,
  selected-visit panel and coverage count already use. An overnight
  appointment may overlap two calendar dates; a cancelled (but
  non-archived) appointment remains an existing saved record.
- The target must be strictly later than the current agenda
  `YYYY-MM-DD` date; the current date itself is never selected.
  There is **no wrap-around**, circular scanning, automatic
  appointment preparation, proposal anchor change, or series edit.
  If no later matching date exists, the corresponding button is
  disabled. This is also true at the last proposed visit date.
- Clicking uses existing `reviewPlannedDate`: it changes the
  local Schedule agenda focus to that proposed date, clears any
  stale open note/copy feedback, and keeps the recurrence anchor,
  rule, count, saved appointments, CSV/TXT export and booking
  safeguards unchanged.
- If the agenda is on a date that is not itself in the proposed
  series, the forward search can still find a later valid proposal.
  Invalid or overflowing plans hide the coverage group and
  both shortcuts, as with the existing plan overview.
- Both buttons have at least 44 px touch height, high-contrast
  light/dark styling, and wrap into a single column on narrow
  phone screens. Native buttons remain keyboard-operable and
  disabled while the workspace is busy.
- Short, explicit text underneath explains that the buttons
  review *record presence* only. No saved records **does not
  establish free capacity or staff/equipment availability**.
  Existing records may be unrelated to the proposed visit.

## Implementation
- Add pure `nextProposedDateBySavedCoverage(statuses, agendaDate,
  "with-saved" | "without-saved")` in the existing
  `src/core/recurring-visit-saved-appointments.ts`.
  It finds the first row whose date is strictly later than the
  agenda date and whose `savedAppointments` count matches the
  requested presence. It returns the proposed YYYY-MM-DD date
  or null. The existing caller already supplies a unique, sorted
  2–12-date proposal and current-organization status rows.
  It does not parse persisted data, query an API, mutate input,
  call any appointment editor or inspect resource availability.
- Compute the two targets when Schedule renders the current
  proposal and add the native buttons inside the existing
  **Saved appointment date coverage** group.

## Testing
- Unit tests verify the first matching strictly later date
  under a mix of saved, archived, cancelled and unsaved rows;
  never selecting the current date; no match at/after the
  final visit; no wrap; off-plan agenda date behavior; fully
  saved, fully empty and empty-input cases; unchanged inputs.
- Extend the **existing** Cleaning Company and Property Manager
  no-login Playwright scheduling session (no extra demo sessions):
  1. Both named buttons appear alongside the exact #221
     saved-date coverage figures and unbooked disclaimers.
  2. For a six-date series, identify expected saved/no-saved
     targets from the already displayed per-date saved counts
     (do not assume seed data), click each enabled shortcut,
     assert matching business-local Schedule date and reviewed
     position, and restore the original visit via the standard
     jump picker.
  3. Assert buttons are disabled when no later matching date
     exists and at the last proposed date, without wrapping.
  4. In twelve-date Compact view the two buttons are still
     visible while numbered cards are hidden.
  5. On invalid/overflowed recurrence, shortcuts disappear with
     the coverage group. After a deliberately saved single
     appointment, coverage navigation remains present without
     performing any extra booking.
  6. Preserve unchanged tests for mobile, WCAG, explicit
     manual Save/Cancel, fixed fictional 24-session cap,
     status counts, clipping/notes, CSV, TXT and clipboard.

## Security and safety
**Navigation only.** No automatic bookings, generated appointment
times, availability claims, resource allocation, notifications,
new server calls, DB/migrations, authorization/session/role changes,
persistent setting, organization or customer data leak, new
sessions, or changes to ForgeOS and other repositories.

## Merge gate
Keep PR #222 **DRAFT / UNMERGED** until all five final-head
GitHub checks pass: Foundation, PostgreSQL, Browser, Release
install Ubuntu and Release install Windows. Fix failures on
**this same branch**, rerun and verify all five. **Never auto-merge.**
