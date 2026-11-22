# Recurring visit planner — copy the currently reviewed proposed visit (PR #218)

## Goal
The LMS Schedule recurring-visit planner already has a **Copy planned
dates** action for the entire unsaved 2–12-date schedule (#211), and
a **Reviewed proposed visit details** panel (#215) that remains
available when Compact view hides the numbered date cards (#216–#217).

When sharing just one *proposed* calendar date with a colleague,
operators should not have to copy every date in the recurrence and
manually remove all the other entries. PR #218 introduces a small
**Copy reviewed visit** button directly in the selected-visit panel.

## User experience
- Open **Schedule → Preview repeating visit dates (no bookings)**.
- Choose a valid proposed visit with the native **Jump to planned
  visit** dropdown, First/Previous/Next/Last controls, or a row's
  Review action. The panel shows that visit's weekday, date, visit
  index and saved appointment status context as before.
- Click **Copy reviewed visit**. Only the current **validated** date,
  its one-based proposal position/total count, weekday and an
  explicit **NOT BOOKED** notice are copied to the browser clipboard:

```text
LMS proposed visit 3 of 6 - NOT BOOKED
Friday, 2027-01-01 (business-local date; no time)
Planning note only. No appointment, staff or equipment is booked or confirmed.
```

- Copying occurs only after an explicit button click using the
  browser's native `navigator.clipboard.writeText`; no clipboard
  read access is requested. No copy is performed automatically.
- A successful write announces **Selected proposed visit copied.
  Nothing was booked.** If the browser denies or does not offer
  clipboard access, the UI displays **Could not copy selected visit.
  Clipboard access may be blocked; use Download planned dates CSV
  instead.** It never falsely claims success.
- Feedback is keyed to the selected plan and date so a late
  clipboard result for a previous selection is not displayed for
  a different proposal. Navigating with the standard Review path
  also clears the previous single-date status.
- The action stays available when the numbered date cards are
  hidden in Compact view. It is disabled while the workspace
  is busy, just like the full-plan copy option.
- If the agenda date is not one of the **current** valid
  proposed dates, or the series fails existing validation, the
  reviewed-visit panel and copy button disappear, preventing a
  misleading or stale date from being copied.
- The existing **Copy planned dates** (all dates) and
  **Download planned dates CSV** behaviors/formats do not change.

## Validation and privacy
- Pure `recurringVisitReviewedText(startDate, everyWeeks,
  occurrences, selectedDate)` rebuilds the existing strictly
  bounded 1/2/4-week, 2–12-date, 2020–2100 calendar series
  and rechecks that the selected date belongs to that precise plan.
  The helper uses the same business-local `Temporal.PlainDate`
  weekday logic as the individual visit cards; no UTC conversions
  or guessed appointment times.
- The copied text contains **no saved-appointment status counts,
  names, customers, organization identifiers, work descriptions,
  addresses, assignments, phone numbers, financial values or
  booking IDs**. The current organization's appointments may be
  shown in the panel, but they are **never included in the copy**.
- Clicking Copy does not prepare or save any appointment, reserve
  a worker or piece of equipment, write a record, create a booking,
  send a message, or claim that resources are available.
- No changes to authorization, DB schema/migrations, REST endpoints,
  the 24-session fictional demo limit, persistence, app data,
  ForgeOS or any other repository.

## Testing
- Vitest: exact unbooked single-date format, privacy boundary,
  all three recurrence intervals, 2/4/6/8/12 visit counts,
  leap/DST/year transitions, the first and last visit, invalid
  series and non-member date rejection.
- Extend the **existing** no-login Cleaning Company and Property
  Manager Playwright scheduling sessions; **do not create more
  sessions**. Verify:
  - The button is present in the selected review panel.
  - Choosing visit #3 and clicking copies exactly the date and
    disclaimers (not the other five dates or saved records).
  - Browser clipboard denial produces an honest error with no
    new copied payload.
  - The button disappears when the agenda date is off-plan or
    the preview is incomplete/overflowed.
  - In the twelve-date Compact view, the single-date Copy
    action remains available.
  - Existing privacy tests for full CSV/copy, saved-record
    snapshots, manual single Save/Cancel, mobile fit and
    axe accessibility remain intact.

## Merge gate
Leave #218 **DRAFT / UNMERGED** until **all five** GitHub jobs
on the final head are successful: Foundation, PostgreSQL, Browser,
Release install Ubuntu, and Release install Windows.
Repair failures on **this same PR branch**, rerun and verify.
**Never auto-merge**.
