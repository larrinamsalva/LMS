# Recurring visit planner — business-local weekdays (PR #210)

## Purpose
The shared Schedule planner previews **2–12 unsaved recurring visit dates**
at a weekly, two-week or four-week interval. Operators can already
review individual dates, see existing saved appointment totals and
statuses, prepare one manual appointment, return to the same plan,
navigate Previous/Next, see their current review focus, and download
the proposed dates as CSV.

PR #210 makes the **weekday of every proposed date** visible. This
helps identify proposed Saturday/Sunday visits without converting a
business-local calendar date to an arbitrary UTC instant.

## Behavior
- Each proposed-date card retains its original
  `Visit N: YYYY-MM-DD` date heading and adds a separate readable
  line, e.g. **Friday**.
- Saturday and Sunday cards add **Weekend — verify staffing before
  booking** as a neutral caution. A weekend is **not automatically
  closed, staffed, booked or available**, and the operator must check
  the actual requirements before manually saving an appointment.
- Weekday labels are independent of the highlighted
  "Currently reviewing" status and independent of the per-date
  **Already saved** and **Saved statuses** counts.
- The labels refresh automatically when the Schedule anchor,
  frequency, or number of preview dates changes. They remain
  the same when just reviewing a later proposed date or returning
  after a manually prepared appointment's Save or Cancel.
- Invalid, overflowing, or incomplete previews show the existing
  validation error and **no weekday labels**, just as they have no
  proposed dates.
- Labels use normal text (not color-only badges), existing
  high-contrast light/dark-theme colors, wrapping, and responsive
  grid layouts. The ISO date remains visible and machine-readable
  in its HTML `time` element.

## Date-only contract
- Pure `plannedVisitWeekday(date)` accepts only canonical
  `YYYY-MM-DD` values, uses `Temporal.PlainDate.dayOfWeek`
  (Monday=1 ... Sunday=7) and returns
  `{ weekday: "Monday"|...|"Sunday", isWeekend: boolean }`.
- There is **no UTC offset, clock time, client timezone guess,
  location request, employee lookup, availability proof, automatic
  reservation, or server request** in weekday calculations.
- The existing validated generator is still the source of proposed
  dates, including 2020–2100 boundaries, 1/2/4-week intervals,
  2–12 occurrences and overflow rejection.
- The **CSV header and file format from #209 are unchanged**.
  No calendar or recurrence data is persisted; no API, database
  migration, automatic booking, notifications, billing, roles,
  session limits, authentication, or unrelated repository is touched.

## Verification
- Unit tests cover every weekday, weekend flags, malformed date
  rejection, March/November daylight-saving changes, the 2028
  leap day, year boundaries and 12-date recurrence cycles across
  1/2/4-week intervals.
- Existing no-login Playwright scheduling test, **both** fictional
  Cleaning Company and Property Manager, checks:
  Friday display across interval and count changes; Saturday
  weekend caution after deliberate re-anchoring; weekday labels
  removed for an invalid preview; unchanged reviewed date,
  manual appointment Save/Cancel and session safety checks.
- No new browser test session is created: preserve the fixed
  **24-session** fictional demo cap and all security boundaries.

## Merge gate
PR #210 stays **draft and unmerged** until **all five checks on
its final head SHA pass**: Foundation, PostgreSQL, Browser,
Release install Ubuntu, and Release install Windows.
Repair failed checks on **this same branch**; **never auto-merge**.
