# Recurring visit planner — first and last review jumps (PR #213)

## Purpose
The existing Schedule preview proposes 2–12 recurring dates for a
Cleaning Company or Property Manager. Operators can already navigate
one date at a time and review a numbered proposed visit, while keeping
the series fixed. A quick **First planned visit** / **Last planned visit**
jump makes it easier to return to either boundary of a long proposal.

## Behavior
- The four adjacent native buttons appear inside the **valid,
  expanded** planner: **First planned visit**, **Previous planned
  visit**, **Next planned visit**, **Last planned visit**.
- First chooses the very first proposed calendar date, and Last
  chooses the final proposed calendar date in the current series.
  This works even when the agenda currently reviews a date between
  proposals, or before/after the proposed range.
- First is disabled when the agenda is already at the first proposed
  date; Last is disabled when already at the last. Previous/Next
  behavior, including no wraparound, is unchanged.
- All four controls share the existing read-only
  `reviewPlannedDate` path: clear appointment focus and archived
  filter, then update only the visible Schedule agenda date.
  None re-anchors the preview, alters interval/count, saves an
  appointment, assigns staff/equipment or reserves a resource.
- **Ordinary Previous day, Next day and direct Schedule date edits
  still re-anchor** the plan. The jump controls only review.
- Invalid, incomplete or overflowing previews show the existing
  error instead of any proposed-date navigation.
- A pending workspace operation disables jump buttons. The planner
  retains existing minimum 44px keyboard/touch-friendly buttons,
  visible focus, light/dark contrast and responsive wrapping.
- After the optional manually saved appointment's Save or Cancel,
  the original transient plan and its visit boundaries remain
  available, as added in #206.
- No change to the exported CSV or clipboard proposal formats.

## Source of truth
Pure `edgePlannedVisitDate(plannedDates, edge)` accepts the existing
validated, ascending date-only list and returns its first/last value,
or `null` for an empty preview. It never mutates the list and makes
no locale/UTC/timezone or business availability assumptions.

The existing proposed-only summary, weekday/weekend counts, saved
appointment status breakdown, selected visit highlight, and manual
one-appointment booking workflow remain unchanged. **Jumping is not
booking; an agenda date is not a confirmed timeslot.**

## Tests
- Unit: all 1/2/4-week rules, 2/4/6/8/12 dates, leap/year/DST
  boundaries, immutable lists, and empty/single-element behavior.
- Extend the **existing** no-login Playwright two-business scheduling
  test for Cleaning Company and Property Manager: first and last
  disabled states; jump from first to last and back with preserved
  six-date labels; current-review indicator and exactly one marked
  list item; Previous/Next and card Review still work; no buttons
  for an invalid plan; existing unchanged-record snapshot, mobile
  fit, WCAG and explicit Save/Cancel checks continue.
- Do not add demo sessions or raise the fixed 24-session limit.

## Merge gate
PR #213 stays **draft and unmerged** until all five final-head GitHub
checks succeed: Foundation, PostgreSQL, Browser, Release install
Ubuntu and Release install Windows. Repair any failures **on this
same PR branch**, rerun and verify. **Never auto-merge.**
