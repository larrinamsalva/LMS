# Recurring visit planner — export proposed dates as CSV (PR #209)

## Why
The no-login LMS scheduling demo can now preview 2–12 proposed dates
for weekly, two-week or four-week (not calendar-month) repeat visits.
Users can review dates, see saved appointment counts/statuses, prepare
one manual appointment at a time, resume their plan after Save/Cancel,
navigate Previous/Next planned visit and see their current review focus.

A lightweight CSV export helps an operator take that **unsaved planning
sketch** into an offline worksheet or share proposed dates manually
without taking screenshots or copying every row.

## How to use
1. Open Schedule → **Preview repeating visit dates (no bookings)**.
2. Set the desired **Schedule date** as the first proposed visit, then
   choose the 1/2/4-week interval and 2–12 occurrences.
3. For a valid complete preview, choose **Download planned dates CSV**.
4. The browser downloads `lms-visit-preview-YYYY-MM-DD.csv` (the
   selected preview anchor's business-local date). The button is
   omitted for an invalid or overflowing preview; it is disabled
   during a pending workspace mutation.
5. The export regenerates the exact currently selected bounded
   proposal on demand, so changing interval, count or anchor updates
   the next file. Merely viewing a later proposed date with Review or
   Previous/Next planned visit does **not** shift the exported anchor.
6. The native browser download occurs locally. No upload, server
   export endpoint, persistent recurrence, database write, automated
   job, email, SMS or external calendar operation is triggered.

## CSV contract
UTF-8 text, RFC 4180-style CRLF row endings, fixed header:

```csv
Visit,Proposed date,Repeat every (weeks),Note
1,2026-11-06,4,Preview only - no appointment booked by export
2,2026-12-04,4,Preview only - no appointment booked by export
```

- `Visit` is a bounded one-based integer. `Proposed date` is a
  canonical `YYYY-MM-DD` **business-local calendar date**, not a UTC
  instant or a promised start time. Repeat is `1`, `2` or `4` weeks.
- Every row explicitly says the export itself **makes no booking**.
  Some dates may independently have existing appointments;
  export does **not** claim otherwise or imply an available slot.
- Variable cells are exclusively generated dates and bounded integers;
  no customer, address, staff, resource, invoice, free-form text,
  status, booking ID, formula or cross-organization data is exported.
  No CSV injection vector from user-controlled text.
- Normal appointment saves continue to require the existing
  authorization, resource-conflict and time/DST checks. No role,
  session, API, database, migration or entitlement change.
- Files contain **only proposal dates**, so they are not complete
  appointment backups, confirmed schedules or guaranteed availability.

## Verification
- Pure unit tests check the six exact four-week dates across a year
  boundary, stable CSV header and CRLF, no customer/resource fields,
  12-date DST/leap/year spans, unchanged original preview, and
  rejection of invalid/overflowing plans.
- Extend the **existing** two-business Playwright scheduling test:
  local download event and expected filename, 6-date content and
  no fictional customer/job/resource, zero changes to saved records,
  hidden export for invalid plans, and existing responsive/axe
  and manual booking checks. **No additional demo sessions** are
  created; the fixed 24-session cap remains unchanged.

## Merge gate
PR #209 remains **draft and unmerged** until all five final-head
GitHub jobs pass: Foundation, PostgreSQL, Browser, Release install
Ubuntu and Release install Windows. Any failures are repaired on
**this same branch** and all five reverified. **Never auto-merge.**
