# Recurring visit planner — cancelled-only status clarity on date cards and reviewed visit (PR #227)

## Goal

LMS #224–#226 added a count, optional filtered date list, and visit-position/selection labels for proposed calendar dates whose only existing non-archived saved appointment records are **Cancelled**. Standard per-date cards and the focused **Reviewed proposed visit details** panel still require reading the numeric status breakdown to recognize the same situation.

Add a subtle **text-only, read-only clarification** to those existing cards and the selected proposed visit, without assuming a booking or availability.

## Behavior

- For each standard, expanded proposed-date card whose existing status row has at least one non-archived saved appointment and **all** have the exact status `Cancelled`, show:
  **Only cancelled saved appointments — NOT BOOKED by this proposal; availability not confirmed.**
- For the currently reviewed proposed date, when the same condition is true, show beneath Saved statuses:
  **Only cancelled saved appointments on this date. This proposed visit is NOT BOOKED and availability is not confirmed.**
- The new text is **absent** on dates with no saved appointments, with a mix of Cancelled and Scheduled/In progress/Completed/Other, or with only archived/invalid saved records. Unknown statuses remain Other and cannot be treated as cancelled.
- Reuse the existing `savedAppointmentStatusesOnPlannedDates` results and shared `cancelledOnlySavedDateList` classification. The common pure helper `isCancelledOnlySavedDate` enforces `savedAppointments > 0 && cancelled === savedAppointments`. The list also uses this helper, avoiding divergent status definitions.
- Display only simple explanatory text, not a warning badge, availability state, customer/resource names, or a suggested booking time. Keep the original Saved statuses totals, warning text, current-date marker, Review and Prepare actions, copy/TXT/CSV exports, and all four next/previous date navigation controls unchanged.
- When Compact view hides standard date cards, the **focused reviewed-visit** clarification remains available. An overflowing or invalid proposed recurrence hides these labels with the existing preview.
- Labels update automatically on navigation, recurrence interval/count/anchor changes, organization switch, and after an **explicit manual** appointment Save through existing Schedule safeguards. No persistence or auto-booking.
- Use high-contrast dark/light theme variables and responsive text wrapping; no reliance on color alone. A readable text block is preferable to a status indicator that might imply availability.

## Implementation

- `src/core/recurring-visit-saved-appointments.ts`: pure shared `isCancelledOnlySavedDate(status)` classifier, reused in `cancelledOnlySavedDateList`. The previously introduced count still uses the list length.
- `src/components/schedule.tsx`: conditional text inside existing selected proposed-visit details and standard numbered proposed-date cards, using only already-available rows and the shared predicate.
- `src/app/globals.css`: theme-aware, narrow-screen-safe styling for two explanatory text classes.

## Tests

- Unit tests verify one or multiple Cancelled saved records qualify, while zero-record days, archived-only days, mixed Scheduled+Cancelled days, unknown Other and corrupt intervals do not. Overnight records retain local-date overlap semantics. Inputs and records remain immutable.
- Extend the **existing two-workspace no-login Playwright scheduling scenario**, no extra demo sessions:
  1. Derive qualifying four-visit dates from card saved totals and saved status subtotals. Exactly those cards show the new clarification.
  2. The initially reviewed date shows the focused note if and only if it qualifies; clicking a qualifying list Review button moves the note to the new agenda date; navigating back restores/hides it appropriately.
  3. For a six-date proposal, ensure the number of explanatory card labels matches the count obtained from those same card statuses.
  4. An invalid/overflowed proposal hides all card and reviewed notes.
  5. After an explicitly saved Scheduled appointment, the reviewed date must no longer be labelled cancelled-only.
  6. Preserve existing mobile/axe accessibility, Compact view, org isolation, no-login demo 24-session cap, one-date Save/Cancel, clipboard/TXT/CSV exports and previously tested review controls.

## Security and scope

This is **read-only clarification of already-authorized status counts**. A date with only cancelled appointments is not necessarily available, and is NOT booked by the proposed recurring plan. No new bookings, customer data, resource allocation, notifications, payment, server calls, migrations, auth changes, demo sessions, persistent settings, ForgeOS or other repository changes.

## Merge gate

Keep PR **#227 DRAFT / UNMERGED** until **all five checks on the final head SHA** succeed: Foundation, PostgreSQL, Browser, Release install Ubuntu and Release install Windows. Fix any failure **on this same branch**, reverify the final-head tests, and **never auto-merge**.
