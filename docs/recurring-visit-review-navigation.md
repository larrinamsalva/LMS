# Recurring visit planner — navigate proposed dates without changing the plan (PR #207)

## Goal
After #201–#206, an operator can generate a **read-only** list of
weekly, two-week or four-week proposed cleaning or maintenance dates;
see saved appointment totals/statuses; review any date; prepare exactly
one *manual* appointment; and return to the same unsaved list after
Save or Cancel. With up to 12 dates, selecting the next day from the
full list repeatedly is cumbersome on phones.

Add **Previous planned visit** and **Next planned visit** as
read-only shortcuts for the Schedule agenda. No appointments or
resources are created, reserved or automatically validated.

## Behavior
- Navigation sits immediately above the numbered proposed-date list,
  with the **currently reviewed agenda date** visible.
- **Next planned visit** chooses the first proposed visit date strictly
  later than the agenda date. **Previous planned visit** chooses the
  last proposed date strictly earlier. This also works if the agenda
  date is between proposed dates or before/after the entire list.
- At the first proposed date, Previous is disabled; at the final
  date, Next is disabled. Buttons **do not wrap**.
- No navigation is available if the current proposed series is
  invalid or overflows the supported 2020–2100 planning window.
- The shortcuts use the **same read-only review behavior** as the
  existing per-date Review buttons: clear any historical archived-only
  agenda filter or Daily Operations focused appointment, and set
  the agenda's selected business-local date.
- They **never change** the preview's original start date, rule,
  count or generated dates. They never call appointment Save, Add,
  archive or resource-allocation actions. They do not imply the day
  or any staff, resource or equipment is available.
- Direct edits to the Schedule date picker and the ordinary
  Previous day / Next day toolbar remain deliberate **re-anchor**
  operations, just as before. The planned-visit buttons are visibly
  distinct from those ordinary calendar controls.
- Navigation uses native buttons, 44px or greater touch targets,
  standard disabled state and theme-safe labels in light/dark mode.

## Source of truth and safety
- Pure `adjacentPlannedVisitDate(dates, agendaDate, direction)`
  compares already-validated canonical, ascending YYYY-MM-DD
  proposed dates with the agenda date, returns one date or null.
  It is deterministic, date-only and doesn't mutate inputs.
- The existing bounded `previewRecurringVisitDates` retains
  1/2/4-week rules, 2–12 dates, overflow rejection and business-local
  date arithmetic. Counts continue to derive only from the current
  authorized workspace. No new DB query or organization data read.
- **No new recurrence persistence, bulk bookings, APIs, migrations,
  role bypass, authentication, payment, outbound notifications,
  auto-availability decisions or resource reservations.** No other
  repositories, including ForgeOS, are changed.

## Verification
- Unit tests cover first/last dates, gaps between proposed dates,
  before/after-series dates, empty series, input immutability,
  all three intervals, 12-date series and DST/year boundaries.
- Extend the existing no-login Playwright scheduling session for
  **both Cleaning Company and Property Manager**: navigate forward
  and backward, verify original 6-date four-week labels stay fixed,
  verify terminal buttons disable without wrap, prove the existing
  per-row Review still works, preserve date-picker re-anchoring,
  reject invalid-range navigation, and retain existing mobile,
  accessibility, authorized CRUD and no-extra-demo-session assertions.

## Merge gate
Keep **#207 draft and unmerged** until all five GitHub checks on the
**final head** succeed: Foundation, PostgreSQL, Browser,
Release install Ubuntu, Release install Windows. Repair failed checks
**on this same branch**; never auto-merge.
