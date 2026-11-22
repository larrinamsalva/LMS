# Recurring visit planner — expandable cancelled-only proposed date list (PR #225)

## Goal
#224 added a read-only count of proposed dates whose existing,
non-archived saved appointments are all **Cancelled**. In Compact view,
the long proposed-date cards are hidden, so finding the particular
dates behind that count is harder.

Add a small, optionally expanded list of only those proposed
business-local dates, each with a **Review** shortcut. This does
not confirm that the proposal is booked or that the date is available.

## User experience
- In Schedule > Repeating visit planner > Plan at a glance >
  Saved appointment date coverage, show a **Show cancelled-only
  proposed dates (N)** toggle below the existing cancelled-only
  number. The control starts collapsed, and is disabled if N = 0.
- The native toggle provides `aria-expanded`. When opened it says
  **Hide cancelled-only proposed dates** and displays a labelled
  list of ISO calendar dates with their weekdays and a button for
  each: **Review cancelled-only proposed date YYYY-MM-DD**.
- Both the date list and all reviewed-date controls are **read-only**.
  A review button follows the same existing `reviewPlannedDate`
  navigation pathway as the regular date cards, changes only the
  Schedule agenda date, closes stale reviewed-date notes and does
  not re-anchor the proposed recurrence or change saved records.
  The button for a date already under review is disabled.
- List shows only proposed dates whose already-computed saved
  status rows satisfy `savedAppointments > 0` **and**
  `cancelled === savedAppointments`. Zero-saved, mixed-status,
  unknown status, and archived-only dates never qualify.
  Overnight appointments retain the previously established
  business-local date overlap semantics.
- No customer, work, resource, appointment time, site, money, or
  other saved record metadata is placed in the list. The detail
  is limited to weekday and YYYY-MM-DD plus a NOT BOOKED warning.
- The list is present and usable when **Compact view** hides the
  regular proposed-date cards. The long list never has more than
  twelve entries because the existing recurrence generator
  bounds the proposal to 2–12 dates.
- The list is collapsed whenever the user changes the recurrence
  rule, visit count, or anchor using Schedule's existing controls.
  Changing back does not resurrect the previously expanded list.
  Invalid/overflowing plans hide the overview and toggle.
  Regular per-date Review keeps the list expanded for choosing
  other cancelled-only dates in the current unchanged proposal.
- Use existing light/dark theme variables, minimum 44px touch
  controls, wrapping to phone width, visible text labels, native
  button/ul/time semantics and keyboard focus. No extra nested
  `<details>` element (to preserve existing Schedule tests).
- A date with only cancelled saved appointments may still have
  resource conflicts; the list explicitly says **NOT BOOKED by
  this plan or confirmed available**.

## Implementation
- Pure `cancelledOnlySavedDateList(statuses)` in
  `src/core/recurring-visit-saved-appointments.ts` derives only
  sorted date strings from the same authorized current-organization
  `PlannedDateAppointmentStatuses[]` used for all existing
  coverage counts and review shortcuts.
- Reuse it in the existing `cancelledOnlySavedDateCount` to keep
  count and optional list in sync. No new record query, server API,
  persistence, scheduling logic or appointment mutation.
- Client-only expansion key tied to the exact proposal; reset on
  every interval/count/anchor change to avoid stale resurrection.

## Tests
- Unit tests: unique sorted dates, two cancelled records on one
  date still listed once, mixed Scheduled/Completed/Other excluded,
  empty, archived and corrupt records excluded, local midnight
  crossings included on each overlapped date, no input mutation,
  count equals list length.
- Extend the **existing** no-login Playwright Schedule session for
  fictional Cleaning Company and Property Manager, **without new
  demo sessions** (maintain the strict 24-session cap):
  - Four-date list hidden on entry; count derived from existing
    per-date card status labels; toggle disabled when 0.
  - When a cancelled-only date exists, expand and compare each
    list date to exactly the expected cancelled-only card dates,
    review an eligible date, and restore original agenda date
    without shifting the recurrence start date. Hide removes list.
  - Changing recurrence rule/count collapses the list.
  - In twelve-date Compact view the list can still be opened and
    shows N entries with explicit NOT BOOKED wording.
  - Invalid/overflowing proposals hide the control and entries.
  - After the existing *explicit one-date manual Save*, the
    updated coverage and optional toggle remain present.
  - Preserve mobile/WCAG, status, clipboard/TXT/CSV,
    explicit appointment Save/Cancel, organization isolation,
    saved-record snapshots and existing navigation tests.

## Safety and merge
Read-only review of already authorized dates, not free-slot or
availability advice. No automatic recurrence, saved appointment,
resource reservation, messaging, invoice, payment, API/schema
change, new demo session, ForgeOS or other repo modifications.

Leave **#225 DRAFT / UNMERGED** until all five checks on the
**final PR head SHA** succeed: Foundation, PostgreSQL, Browser,
Release install Ubuntu, Release install Windows. Fix any failure
on **the same branch**, rerun and verify. **Never auto-merge.**
