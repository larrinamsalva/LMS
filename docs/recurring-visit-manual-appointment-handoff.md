# Recurring visit planning — prepare one manual appointment date (PR #205)

## Goal
After #201's safe recurrence preview, #202's date review shortcuts,
#203's saved appointment counts, and #204's status breakdown, a user
should be able to start the **existing** appointment form from one
specific proposed visit date without retyping the date.

**This is a date-only manual draft handoff, not recurring booking.**

## UX
1. In either fictional Cleaning Company or Property Manager, open
   **Schedule → Preview repeating visit dates (no bookings)**.
2. Choose an interval (weekly, every two weeks or every four weeks)
   and 2–12 planned dates.
3. Beside each planned date, **Prepare appointment** is available
   only for roles allowed to write and when no operation is busy.
   The existing **Review** shortcut remains a separate, read-only action.
4. **Prepare appointment** opens the regular **Add appointment**
   form in the same organization with only
   `scheduled_date: YYYY-MM-DD` as the initial value.
   There is no preselected hour, duration, customer, work, crew,
   worker, equipment, service, status override, or booking.
   The regular form still defaults its new status and IANA
   booking zone according to the existing contracts.
5. The form tells the operator that this date came from an
   unsaved proposal and requires an exact start/end time and
   all normal booking fields. Entering the start time may
   deliberately update the read-only scheduled date to match.
   The operator must **Save record** explicitly, with all
   existing time/DST validation, authorization, employee and
   resource conflict enforcement.
6. **Cancel** drops the unsaved draft. An ordinary
   **+ Add appointment** resets the previous suggested date.
   This also retains correct behavior for future inventory and
   pricing forms that use the shared `initialData` feature.

## Contract and limits
- Pure `plannedVisitAppointmentDraft(startDate, interval, count,
  chosenDate)` re-generates the strictly bounded current preview
  and refuses a date not on that exact series. The returned object
  has **only** `scheduled_date`. If the generator refuses a
  missing/invalid/out-of-range plan, no handoff is generated.
- The existing date-only 1/2/4-week recurrence remains in
  **business-local PlainDate** arithmetic, 2020–2100 bounds,
  2–12 dates, no hard-coded UTC hour across DST.
- No automatic creation of multiple appointments, resource
  reservations, conflict-free proof, availability lookup,
  background task, API route, DB migration, recurrence
  persistence, external calendar, new login, billing or
  outbound communication.
- The existing Engine/API authorization and transactional
  booking checks remain the only final authority. The
  date alone is **never** a confirmation of availability.
- No changes to other repositories, including ForgeOS.

## Verification
- Pure unit coverage validates selected-date membership,
  rejects unrelated dates and invalid/out-of-range plans,
  and proves that no time, resource, customer or work fields
  are manufactured.
- The existing no-login Playwright scheduling suite adds
  a separate test for **both** businesses, confirming the
  date-only form handoff, empty start/end/title,
  accessible note, phone fit and accessibility,
  zero writes after opening/cancelling, and no stale
  date when starting a normal new appointment.
- Retain all previous recurrence count, DST, UI, Engine
  and database regression checks.

## Merge gate
PR #205 remains **draft and unmerged** until **all five checks
pass on the final head SHA**: Foundation, PostgreSQL, Browser,
Release install Ubuntu and Release install Windows.
Fix failures **on this same branch** and re-run.
**Never auto-merge.**
