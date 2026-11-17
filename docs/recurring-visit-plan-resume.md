# Recurring visit planner: resume after preparing a single appointment (PR #206)

## Intent
PRs #201–#205 built a **date-only** recurring visit preview, reviewed
individual dates, displayed saved appointment counts and statuses, and
opened the **ordinary** manual appointment editor with a suggested date.
That editor previously left the operator in Records after Cancel or Save
and lost the unsaved preview settings.

PR #206 makes **Cancel or successful Save** of a *prepared new appointment*
return to the same proposed visit series, ready to review the next date.
**The series is still unsaved and nothing is automatically booked.**

## Behavior
1. Open the repeating visit planner under Schedule in a fictional
   Cleaning Company or Property Manager workspace.
2. Choose a start date, 1/2/4-week interval and 2–12 dates. You can
   review a later date without changing the series' anchor.
3. Select **Prepare appointment** beside a date. A minimal transient
   return route captures exactly `startDate`, `everyWeeks`,
   `occurrences`, `selectedDate`, and the **current organization ID**.
   Only `scheduled_date` is handed into the normal form.
4. **Cancel** drops the unsaved appointment, then returns to Schedule
   displaying the *selected* date, **the original preview start**,
   original recurrence rule, original count and **expanded planner**.
   No appointment is written and no booking availability is inferred.
5. **Successful Save** of that single appointment uses the original
   Engine/API validation, roles, resource checks and conflict exclusions.
   After the mutation succeeds, the operator returns to the same plan
   and can review another date. Saved counts/statuses derive from the
   newly refreshed authorized workspace snapshot.
6. The original schedule is **never** stored or auto-repeated.
   A user can choose another planned date and explicitly prepare
   another appointment. Direct edits to the Schedule date picker and
   previous/next-day buttons still re-anchor the plan.
7. **Ordinary + Add appointment**, editing a different record,
   changing a sidebar view, and switching organizations clear the
   transient return route. They do not inherit a stale planned date.
   A failed Save keeps the existing form open for correction and does
   **not** pretend that an appointment was saved.

## Safety boundary
- The return route contains **no customer, work, resource, title, time,
  capacity, reservation or login data**. It is component state, not
  browser/local storage, API, export, Blueprint, SQL or migration data.
- The return plan is re-validated against the same bounded date
  series when handed into the editor and when restoring it. It must
  belong to the exact already-authorized organization.
- No saved recurring rule, bulk creation, background job, reminders,
  notifications or implied availability. Staff/equipment/time conflicts
  continue to be checked ONLY by the existing manual booking flow.
- No changes to ForgeOS or other repositories. No adjustments to the
  fictional demo's capacity, roles or session-security boundaries.

## Verification
- Unit tests confirm the return route is date-only, copied and rejects
  unplanned selections, invalid frequencies, >12 dates and overflow.
- The **existing** Playwright cleaning/property scheduling scenario
  checks return after Cancel, re-expanded planner, original start,
  frequency and occurrence count, ability to prepare a second date,
  and correct cancellation without record writes. It also verifies
  a successful **single appointment Save** returns to the original
  plan with the refreshed saved appointment count and exactly one
  newly saved record. Ordinary new Add remains blank afterward.
- All testing reuses the **existing fictional demo sessions** so the
  24-session safety limit stays unchanged. Existing device-fit and
  accessible-name tests are retained.

## CI / merge
Leave #206 **draft and unmerged** until Foundation, PostgreSQL,
Browser, Release install Ubuntu and Release install Windows all
pass on the final head SHA. Fix any failure on **this same branch**,
then recheck. **Never auto-merge.**
