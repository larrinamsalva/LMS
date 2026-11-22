# Recurring visit planner — show ordinal and reviewed focus in cancelled-only list (PR #226)

## Goal
PR #225 introduced an optional expanded list of proposed calendar dates where all already-saved, non-archived appointments are Cancelled. Each row includes its date and a read-only Review button. Operators using Compact view benefit from seeing where those filtered dates fall in the *full* recurring proposal and which date they are currently reviewing.

## Behavior
- Every cancelled-only date row now shows **Proposed visit X of N**, where N is the complete, validated 2–12-date proposal and X is the date's **original position** in that proposal. The filtered list's row number is NOT used: for example, if only proposed visits 2 and 5 qualify, they remain **2 of 6** and **5 of 6**, not 1 and 2.
- Continue showing the weekday, ISO business-local YYYY-MM-DD date and original **Review cancelled-only proposed date YYYY-MM-DD** button. Do not introduce a saved appointment time, free-slot hint, customer/resource fields or new booking semantics.
- If the agenda is currently reviewing a date in the cancelled-only list, exactly that row has native `aria-current="date"`, a visible **Currently reviewing** label, and a subtle themed border. Its Review button stays disabled as before.
- A date that is NOT in the cancelled-only list must not be marked as current in that list; no fallback row is selected. When the user reviews a different proposed date by an existing list Review button or the standard jump selector, the state moves automatically to the exact matching row or disappears from the filtered list.
- All existing keyboard/mobile/dark/light accessibility, minimum 44px buttons, explicit manual single-appointment Save, Compact view, recurrence settings, per-date saved status counts, local exports, and read-only warnings remain unchanged.
- Use the existing `plannedVisitReviewPosition(plannedVisitDates, cancelledDate)` helper, which reuses the already validated business-local proposal and returns the correct one-based original position. Do not add a second recurrence computation, server call or stored state.
- If there are no cancelled-only dates, the existing Show list button stays disabled and no rows appear. The list still collapses on interval/count/anchor changes, never resurrecting stale dates.

## Tests
- Unit test in the existing saved-appointments test file: for weekly, two-week and four-week 6-visit proposals, ensure a filtered list containing only visits 2 and 5 still maps to exact original ordinals 2 of 6 and 5 of 6. Verify source appointments unchanged.
- Extend the **existing** no-login Playwright Schedule test for both fictional Cleaning Company and Property Manager, *without creating additional demo sessions*:
  - Where a four-visit cancelled-only list is nonempty, verify every row's original ordinal matches its date in the unfiltered cards.
  - Verify exactly one `aria-current="date"` row when the agenda date qualifies; otherwise no row is marked. Confirm the visible **Currently reviewing** label and disabled Review button.
  - Clicking a different eligible cancelled-only date updates the marked row and keeps the full proposed series unchanged. Returning via standard jump picker restores or clears the correct marker.
  - In twelve-date Compact view, verify ordinals against the normal jump picker even though the full cards are hidden, and verify selected-row semantics. Keep the explicit **NOT BOOKED** reminder.
  - Preserve the existing cancellation-only zero-state, list collapse, out-of-range hiding, coverage count, WCAG/mobile, organization isolation, fixed 24-demo-session cap, and explicit one-appointment Save/Cancel assertions.

## Safety and scope
This is **display-only and read-only navigation** of date-only proposals and already-authorized status summaries. A cancelled-only date is not confirmed available and is not a booked visit in this series. No recurrence booking, appointment creation, staff/equipment assignment, persistent state, new API, server query, migration, authorization change, new demo session, notification, payment, customer data export or modification to ForgeOS/other repositories.

## Merge gate
Leave PR **#226 DRAFT / UNMERGED** until all five checks on the *final PR head SHA* succeed: Foundation, PostgreSQL, Browser, Release install Ubuntu and Release install Windows. If a check fails, fix **the same PR branch** and rerun/reverify all five. Never auto-merge.
