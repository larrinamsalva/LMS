# Recurring visit planner — copy proposed dates as plain text (PR #211)

## Purpose
PRs #201–#210 built the bounded, **unsaved** recurring visit planner,
manual appointment preparation and return, per-date saved-status counts,
previous/next review, currently reviewed highlighting, local CSV export
and weekday/weekend labels for Cleaning Company and Property Manager.

Downloading a CSV works for spreadsheets, but sharing a short *proposed*
schedule in a private note should not require opening a downloaded file.
**Copy planned dates** provides a simple, plain-text format to paste
wherever the operator chooses.

## UI and behavior
1. Open Schedule → Preview repeating visit dates (no bookings).
2. Pick a valid first Schedule date, interval (weekly, every two weeks
   or every four weeks) and 2–12 occurrences.
3. Click **Copy planned dates** beside the existing **Download planned
   dates CSV** button. The browser clipboard API is called **only
   after the user's click**. It copies the currently valid plan;
   no server request, download, email or external service is involved.
4. Success is announced as **Proposed dates copied. Nothing was
   booked or reserved.** Browser permission denial, blocked/insecure
   clipboard environments or unsupported APIs display **Could not
   copy dates. Clipboard access may be blocked; use Download planned
   dates CSV instead.** No false success claim.
5. Copy/CSV buttons appear only for a complete valid preview and are
   disabled while an existing workspace mutation is busy. Changing
   the date anchor/rule/count hides feedback from the previous plan.
6. The user controls pasting or sharing. The app never transmits
   the proposed dates itself. The existing CSV option remains
   available and its file contract is unchanged.

## Exact text contract

```text
LMS proposed recurring visit dates - NOT BOOKED
Starts: 2026-11-06 | Repeat: every four weeks (not monthly) | Proposed visits: 6
Business-local calendar dates (no appointment times or availability):
1. Friday, 2026-11-06 - proposed only
2. Friday, 2026-12-04 - proposed only
3. Friday, 2027-01-01 - proposed only
4. Friday, 2027-01-29 - proposed only
5. Friday, 2027-02-26 - proposed only
6. Friday, 2027-03-26 - proposed only
Planning preview only. Copying does not book visits, reserve resources, or confirm staff availability.
```

- Pure `recurringVisitPreviewText(startDate, everyWeeks, occurrences)`
  regenerates all dates through the **same strictly bounded** existing
  `previewRecurringVisitDates` helper (1/2/4 weeks, 2–12 dates, date
  validity, 2020–2100 overflow). Weekdays use `Temporal.PlainDate`.
  No clock or UTC zone conversion.
- **No saved appointment status or live availability** is included.
  The copied text never reads customer, name, work, address,
  email, financial records, assignments, booking IDs, equipment,
  business secrets, or content from a different organization.
- Every copied schedule is visibly marked **NOT BOOKED**, each row
  says **proposed only**, and the footer explicitly rejects
  booking or staff/resource availability assumptions.
- No localStorage, server state, recurrence persistence, booking,
  appointment Save, resource allocation, authorization, database,
  migration, outbound message, extra demo sessions or ForgeOS changes.
  Actual manual appointments still require the original checks.

## Test plan
- Vitest checks the exact six-date four-week text, weekday names,
  no sensitive data, stable output over all intervals and DST/leap/
  year boundaries, and strict invalid/overflow rejection.
- Extend the **existing** Playwright no-login Cleaning Company and
  Property Manager session (never start a new demo). Test visible
  buttons; stub only the in-browser clipboard transport to inspect
  copied text; test denied clipboard permission shows failure feedback;
  confirm feedback is scoped to plan and disappears for an invalid
  preview; verify no customer/job/resource contents; retain existing
  API snapshot assertions showing no unintended saved records.
- Preserve the current 24-session production guard and all existing
  device-fit, WCAG, authorization, single Save, CSV download and
  conflict tests. Browser mocks are test-only and are not bundled
  in production.

## Merge gate
Leave #211 **draft and unmerged** until all five jobs succeed on
the final head SHA: Foundation, PostgreSQL, Browser, Release install
Ubuntu and Release install Windows. Repair any failure on **this
same branch**; never auto-merge.
