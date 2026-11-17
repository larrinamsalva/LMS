# Recurring visit planner — highlight the reviewed date (PR #208)

## Purpose
PR #207 added Previous/Next planned visit navigation to the **unsaved**
recurring visit preview. With up to 12 suggested visits, a user still
needed to scan the entire list to see which proposed date the Schedule
agenda was currently displaying, especially after returning from a
prepared manual appointment.

PR #208 adds a read-only visual and accessible **review focus indicator**
without changing dates, booking behavior or any stored record.

## UX
- For a valid proposed series, show one explicit status line:
  **"Currently reviewing planned visit X of Y: YYYY-MM-DD. This is a
  calendar view, not a booking confirmation."**
- Exactly one proposed visit row receives a distinct high-contrast
  accent outline, the visible label **"Currently reviewing"**, and
  semantic `aria-current="date"` **when** the agenda date exactly
  matches that visit's canonical business-local date.
- If the agenda date is not among the proposed dates, **no row is
  selected**. The status explains that the agenda date is outside
  the plan and recommends using Previous/Next planned visit controls.
- An invalid/overflowed proposal renders its **existing validation
  message only**, never a misleading selected date or "X of Y".
- Existing row Review, Previous/Next planned visit, normal
  Schedule Previous day/Next day/date picker, 1/2/4-week frequency,
  2–12 dates, Review shortcuts, and single appointment preparation
  retain their original behavior and re-anchoring rules.
- Returning after manual **Cancel or successful Save** reopens the
  original plan with the manually selected date highlighted, and
  current saved-record counts refreshed after Save.
- All status text is explicitly **review focus**. It does NOT mean
  a visit was booked, completed, reserved, conflict-free, available
  or assigned. Existing "Already saved" and status counts remain
  separate and unchanged.

## Implementation
- Pure `plannedVisitReviewPosition(dates, agendaDate)` finds the
  exact proposed-date index and returns its **one-based** position
  or null. No date mutation, clock conversion, resource lookups,
  server call or permission change.
- Agenda review state is derived in-memory from the current
  already-validated visit preview and calendar selected date.
  Native `aria-current="date"` and high-contrast theme variables
  convey the same review focus independently of color, including
  light/dark themes and narrow screens.
- No new session, API, storage, migration, recurring booking,
  scheduled automation, invoice, payment, outbound message,
  resource availability claim or ForgeOS/unrelated repo change.

## Tests
- Unit tests cover 6-date four-week plan, position 1..N, non-matching
  dates, empty lists, all supported intervals, 12 dates,
  DST/leap/year boundary dates, and input immutability.
- Add assertions **inside the existing fictional Playwright session
  for Cleaning Company and Property Manager**. Verify position
  changes when reviewing next/previous and final dates, exactly one
  `aria-current="date"` row, no selected state for invalid
  proposals, focus restoration after Cancel and successful one-record
  Save. Retain all existing mobile, WCAG, authorization, count and
  no-auto-booking tests; do not create additional demo sessions
  or raise the fixed 24-session cap.

## Merge gate
Keep #208 **draft/unmerged** until all five CI checks on its
**final head SHA** pass: Foundation, PostgreSQL, Browser,
Release install Ubuntu and Release install Windows.
Fix any failure on **this same branch**, re-run final-head checks,
and **never auto-merge**.
