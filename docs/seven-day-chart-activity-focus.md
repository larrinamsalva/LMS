# Daily Operations — chart activity category focus (PR #196)

## Purpose
The seven-day **Saved activity by date** chart now lets staff compare
**All saved activity**, **Appointment starts**, **Unfinished work due**, or
**Equipment inspections** (only when the workspace has the equipment module).
This makes the chart more useful than a combined total when different
activity types cluster on different days.

## Display and safety rules
- **Chart activity to show** is a separately labeled, keyboard-operable
  native select within the existing chart. Default is **All saved activity**.
- Every selection keeps the **same seven authorized business-local dates in
  calendar order**, including zeros and very small positive counts. Bars
  scale relative to the *highest recorded count in the selected category*,
  not capacity, duration, staffing, resources or bookable slots.
- The exact selected count is printed on each date and announced in an
  accessible label. The category's full-week saved count is a polite live
  region. Neither label nor colors require interpreting bar height.
- Chart focus is **independent** of existing date-card activity/category,
  weekday/weekend, quiet/active, sort and comparison controls. It never
  changes any day card, full-week total, selected date, CSV or record.
- A workspace without the equipment module never exposes its category,
  and a stale equipment selection from another workspace safely displays
  All saved activity. Disabled equipment inspections never appear in counts.
- The existing horizontally scrollable chart remains keyboard focusable,
  high contrast, and legible on mobile/tablet in light/dark modes.
- These are observations about **saved records only**. A zero-count day
  does not confirm staff, equipment, scheduling or appointment availability.

## Verification
- Unit test coverage checks independent counts and relative chart scaling
  for all four categories across 720 fictional business-local dates,
  reversed data, empty inputs, disabled equipment and zero-only weeks.
  Old two-argument chart calls remain exactly compatible.
- The existing no-login fictional demo Playwright session checks category
  switching on empty and populated weeks, all seven dates, accessible
  labels and isolation from the date-card category filter.
- No new demo login, external calls, databases, APIs, schema changes,
  migrations, exports, license changes or release/deployment changes.
  ForgeOS and all other repositories are untouched.

## Merge gate
Keep PR #196 **draft and unmerged** until the **final head** passes:
Foundation, PostgreSQL, Browser, Release install Ubuntu and
Release install Windows. Repair failures on the same branch, recheck,
and **never auto-merge**.
