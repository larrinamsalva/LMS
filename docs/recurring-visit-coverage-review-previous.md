# Recurring visit planner — previous saved-record date review shortcuts (PR #223)

## Goal

LMS #222 introduced read-only **next** review shortcuts in Schedule's
**Saved appointment date coverage** group. These let operators move
forward to the next proposed date that has at least one existing
non-archived saved appointment record, or the next date that has none.

PR #223 adds the symmetrical **previous** review shortcuts so an
operator can navigate backward through a proposed 2–12-date series
without reopening hidden cards in Compact view.

## Behavior

- **Review previous proposed date with saved records**: navigate to
  the closest *strictly earlier* proposed calendar date with at least
  one existing non-archived saved appointment.
- **Review previous proposed date without saved records**: navigate
  to the closest *strictly earlier* proposed calendar date with zero
  non-archived saved appointments.
- Both buttons are in the existing coverage group alongside the two
  forward shortcuts. The existing button styles provide 44px minimum
  touch targets, responsive wrapping and accessible keyboard focus.
- Targets are sourced **only** from the already calculated, authorized
  and organization-scoped per-date status rows. Existing cancelled
  appointments still count if not archived; archived, corrupt or
  unrelated records continue to be excluded by the existing shared
  status calculation.
- The previous helper scans in reverse through the already-sorted
  2–12 proposed dates and returns the *nearest* strictly earlier
  match. It returns `null` when no earlier date matches. It never
  chooses the currently reviewed date and **never wraps around**.
- If there is no earlier match (including at the first date) or the
  workspace is busy, its button is disabled. Invalid or overflowing
  recurrence proposals hide the entire coverage group and all four
  shortcuts as before.
- Clicking uses the already existing `reviewPlannedDate` pathway,
  changing the local Schedule agenda focus only. It closes any open
  stale reviewed-note preview/copy feedback, keeps the proposal's
  first date, interval, and visit count unchanged, and never invokes
  appointment creation or editing.
- Both new shortcuts are visible in Compact view, even when the
  individual proposed-date cards are hidden. They also remain
  present after the user has explicitly saved a single appointment,
  using the normal return route.
- The explanatory text beneath the shortcuts is expanded to explain
  **backward or forward** read-only navigation with no wrapping,
  booking, reservation, or free-time check.

## Implementation

Add the pure function
`previousProposedDateBySavedCoverage(statuses, agendaDate, kind)`
to `src/core/recurring-visit-saved-appointments.ts` alongside
`nextProposedDateBySavedCoverage`. It consumes the same
`readonly PlannedDateAppointmentStatuses[]` and a selected ISO
business-local agenda date and returns a proposed ISO date or `null`.
No additional DB/API fetch, customer lookup, resource check,
state mutation, persistence or new booking logic.

Two targets are derived in the existing Schedule component and
connected to native buttons; all other controls are unchanged.

## Testing

- Unit tests cover mixed positive and zero saved-date counts,
  completed and cancelled-but-non-archived appointments, archived
  exclusion, strictly earlier matches, closest-prior selection,
  the first-date boundary, no-wrap behavior, an agenda date
  between proposals, empty input, all-saved, all-zero, and
  unmodified source arrays and saved records.
- Extend the **same existing** no-login Cleaning Company and
  Property Manager Playwright scheduling session **without any new
  demo sessions**:
  - Four labelled shortcuts appear in the existing coverage group;
    previous shortcuts start disabled when reviewing the first date.
  - On a six-visit proposal, derive expected previous saved/no-saved
    matches from the currently displayed per-date saved counts,
    starting at the final proposed date. Click each enabled button
    and check the corresponding Schedule date and reviewed position,
    returning to the last date between checks.
  - Verify the first-date boundary disables both previous buttons;
    the last-date boundary still disables both *next* buttons.
    No direction wraps and the proposal's date-card texts stay fixed.
  - In 12-date Compact view, all four shortcuts remain visible.
  - An invalid/out-of-range proposal hides both previous controls
    with the existing overview.
  - Following the existing deliberate one-appointment manual Save,
    both previous controls are still displayed; saved-record
    snapshots and organization isolation remain intact.
  - Preserve the existing WCAG/mobile checks, available/unknown
    status rules, clipboard/TXT/CSV export, no-booking disclaimers,
    explicit manual Save/Cancel safeguards and fixed 24-session cap.

## Safety

These are **read-only review shortcuts**, not suggestions of
appointment availability, free staff, equipment capacity, or a
confirmed booking. No creation of appointments or recurrence series,
data mutation, changes to authorization/org isolation, API calls,
server schema, migration, notification, billing, customer export,
new demo sessions, ForgeOS, or other repositories.

## Merge gate

Keep **#223 DRAFT / UNMERGED** until **all five** GitHub checks
for its *final head SHA* succeed: Foundation, PostgreSQL, Browser,
Release install Ubuntu and Release install Windows. Fix any
failure on **the same PR branch**, recheck all five, and
**never auto-merge**.
