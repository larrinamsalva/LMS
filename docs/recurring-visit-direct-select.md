# Recurring visit planner — direct-select any proposed date (PR #214)

## Goal
LMS #213 added read-only **First/Previous/Next/Last planned visit**
shortcuts. With as many as 12 proposed dates, scanning numbered cards
to review visit #7 or #10 is still awkward on narrow phones and tablets.
PR #214 adds a compact **Jump to planned visit** native select inside
the current valid recurring-visit planner, above the existing four
navigation buttons.

## User experience
- Open Schedule → **Preview repeating visit dates (no bookings)**.
- For any valid 2–12-date proposal, the **Jump to planned visit**
  control lists the same generated visit numbers, business-local
  weekday names and canonical calendar dates as the numbered cards:
  `Visit 3 — Friday, 2027-01-01`.
- Select any listed visit. The agenda moves to that proposed date,
  exactly like the existing **Review**, **Previous**, **Next**,
  **First** or **Last planned visit** controls. The chosen visit
  receives the existing `Currently reviewing X of Y` highlight.
- When the agenda date is already one of the proposed dates, the
  select reflects its current date. When an anchor/rule/count change
  leaves the agenda date outside the current proposed series, it
  shows the neutral **Choose a proposed visit** placeholder and
  **does not select a proposed date implicitly**.
- On selection, accept the date only if
  `plannedVisitReviewPosition(plannedVisitDates, selected)`
  confirms membership in this exact valid current date list.
  No user-entered arbitrary date is passed to review.
- The select is omitted when the preview is invalid, incomplete,
  or exceeds 2100-12-31. While a workspace action is busy, it is
  disabled like the existing planned-visit buttons.
- Keyboard and native mobile select behavior are preserved.
  The control uses a unique React `useId` label, native focus/
  keyboard semantics, at least 44px target height, flex-safe width,
  accessible readable text and light/dark theme tokens.
- The existing calendar **Schedule date**, **Previous day** and
  **Next day** actions still deliberately **re-anchor** a plan,
  as before. Choosing a planned visit does not.
- After cancelling or successfully saving **one** manual appointment,
  the same transient plan returns and the control reflects the
  selected returned date. Existing CSV, clipboard, overview,
  saved-status breakdown and planner previews are unchanged.

## Boundaries
**Selecting a date is ONLY read-only agenda navigation.** It does not:
create, update or reserve an appointment; allocate staff/equipment;
check availability; set times; save recurring schedules; send messages;
change access controls; affect other organizations; or create an
automatic booking.

The new control is fully derived from the same validated 1/2/4-week,
2–12-occurrence, business-local date-only series as the rest of the
planner. No new APIs, DB writes, migrations, role changes, session
limits, server state, external services or unrelated repos (including
ForgeOS) are touched.

## Tests
Extend the existing no-login, two-business Playwright scheduling test:
- Valid six-date plan renders the right native option count and
  correctly labelled visit #3.
- Direct jump to #3 changes the agenda and selected review highlight
  while keeping all proposed dates unchanged.
- Changing the recurrence rule to one that excludes the selected
  agenda date shows an empty placeholder and zero highlighted rows.
  Restoring the rule preserves the original proposed date and
  selected review; no surprise re-anchoring.
- Expanding to 12 dates renders 12 options plus the placeholder;
  restoring six renders the correct six plus placeholder.
- First/Last/Previous/Next controls and row Review continue to work,
  invalid plans hide the picker, and cancelling a manual appointment
  restores the picker to the selected returned date.
- Existing tests for CSV/copy, WCAG accessibility, mobile fit,
  persisted record safety, staff/resource checks and manual booking
  still run; **no new demo sessions** are created.

## Merge gate
Keep #214 **DRAFT/UNMERGED** until the **final head** passes
Foundation, PostgreSQL, Browser, Release install Ubuntu and Release
install Windows. Fix failures **on this same PR branch**. Do not
auto-merge, even if every check passes.
