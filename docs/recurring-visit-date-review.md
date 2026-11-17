# Recurring visit planner — review individual suggested dates (PR #202)

## Why this follows #201
The date-only recurring visit preview in #201 can propose weekly,
fortnightly, or four-week cleaning and maintenance visits without writing
a single appointment. PR #202 adds a **Review YYYY-MM-DD** button for
each proposed visit, so a user can inspect already-saved appointments
in the existing Schedule agenda before booking.

## Exact behavior
1. Choose **Schedule date** and open the **Repeating visit planner**.
   Pick one of the reviewed 1/2/4-week intervals and 2–12 occurrences.
2. Each preview date shows an accessible, minimum 44px
   **Review YYYY-MM-DD** button. The button has an explicit
   screen-reader label that includes its visit number and exact date.
3. Selecting a date **only navigates** the existing Schedule date
   and shows non-archived appointments for that day, using the existing
   business-local time zone. It also clears stale exact-appointment focus
   and clears the archive-only toggle so the day can be reviewed.
4. The **original preview series stays anchored** as the user reviews
   multiple suggested dates. Review does not shift the series forward
   or lose previously proposed dates.
5. When the user intentionally edits the **Schedule date** picker or
   selects **Previous day/Next day**, that chosen date becomes the
   series' new first visit. All recurrence validation remains inherited
   from #201, including date-range overflow and DST-safe plain-date
   calculations.
6. Review is enabled for viewers as a read-only navigation action,
   but is disabled while the workspace reports a busy operation to
   avoid conflicting interactions.

## Critical boundaries
- Reviewing a day does **not** create, edit, archive, reserve,
  or automatically validate an appointment.
- Showing no existing appointments on a day is **not** a guarantee
  of staff, crew, property, equipment, travel or booking availability.
- To book anything, an authorized user must still use **Add
  appointment** and pass its exact start/end, IANA time-zone/DST,
  resource/assignment, authorization and final conflict checks.
- Nothing new is persisted: no recurrence schedule object, bulk
  creation, rule export, API, database, migration or new permission.
- This operates in both fictional Cleaning Company and Property
  Manager workspaces, without changing ForgeOS or other repositories.

## Regression coverage
The preexisting no-login Playwright scheduling scenario in **both**
business types checks all six review buttons, navigates to the fourth
four-week candidate, retains the exact same preview list, observes
the selected agenda date, reanchors after a deliberate date picker
change, and checks that the workspace's saved records are unchanged.
It retains the phone-fit and axe accessibility checks.

The pure calendar-date preview remains covered by #201's isolated unit
tests (720 fictional start dates, all three intervals, leap days,
year/DST boundaries, and strict full-range rejection). #202 adds no
new date-calculation algorithm.

## Merge gate
PR #202 remains **draft and unmerged** until its **final-head**
Foundation, PostgreSQL, Browser, Ubuntu release install and Windows
release install GitHub checks all succeed. Fix failures on the **same
branch** and rerun. **Never auto-merge.**
