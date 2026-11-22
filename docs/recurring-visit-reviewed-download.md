# Recurring visit planner — download the reviewed visit as TXT (PR #219)

## Goal
LMS #218 introduced **Copy reviewed visit**, which copies only one
proposed date with its weekday, proposal position and a prominent
**NOT BOOKED** disclaimer. Some browsers, insecure contexts and
phone settings deny clipboard permission. The existing fallback
points to the **whole-plan CSV**, which is not ideal if the user
wants only the reviewed date.

PR #219 adds **Download reviewed visit TXT** directly beside
**Copy reviewed visit** in the existing reviewed-visit details
panel. It offers a local file-download alternative that does
not require clipboard permission or any new server functionality.

## Exact exported content
The download reuses the exact *same* pure, membership-validated
`recurringVisitReviewedText(startDate, everyWeeks, occurrences,
selectedDate)` from #218; no new export payload or private data.

For reviewed visit 3 of a six-visit proposal:

```text
LMS proposed visit 3 of 6 - NOT BOOKED
Friday, 2027-01-01 (business-local date; no time)
Planning note only. No appointment, staff or equipment is booked or confirmed.
```

The downloaded file contains this text followed by a final
newline. The suggested filename is
`lms-proposed-visit-2027-01-01-NOT-BOOKED.txt`.

The selected date is from the existing strictly validated
`YYYY-MM-DD` preview, making the filename safe and deterministic.

## Behavior
- **Download reviewed visit TXT** is shown only when a reviewed
  date is part of the current **valid** 2–12-date proposal.
  Off-plan/invalid/overflowed proposals hide the selected-visit
  panel and both the Copy and TXT Download buttons.
- On explicit click, the exact selected date is revalidated
  against the current recurrence using the existing core helper.
  The UI creates a local UTF-8 `text/plain` Blob and a short-lived
  object URL, triggers the browser's download using a temporary
  anchor, removes the anchor and revokes the URL, just as the
  existing whole-plan CSV download already does.
- The TXT button is disabled while the workspace is busy and
  remains visible when **Compact view** hides the numbered cards.
- Existing **Copy reviewed visit** still uses the clipboard.
  On clipboard rejection, it now recommends the **matching
  Download reviewed visit TXT** action rather than the
  **whole-plan CSV**. Its existing success/failure status and
  feedback scoping are preserved.
- No other export format, calendar calculation, saved-date
  status, manual appointment preparation, or current-review
  highlight changes.

## Safety boundaries
- The TXT contains only the selected **unbooked** proposal
  position, weekday, ISO date and disclaimers. It never contains
  saved appointment counts, customer names, work details,
  equipment/crew assignments, phone numbers, location, amounts,
  invoice details or booking identifiers.
- The file is generated entirely in the browser from the same
  pure validated date-only function as the existing clipboard
  action; it calls no API and writes no application data.
- Downloading **does not create or confirm a booking, appointment,
  availability, reservation, notification or saved recurrence**.
- The existing 24-demo-session limit, organization scoping,
  booking authorization/resource-conflict validation, DB schema,
  roles and all other workspaces remain untouched. No changes to
  ForgeOS or other repositories.

## Test plan
Extend the existing no-login, two-business Playwright scheduling
scenario (Cleaning Company / Property Manager; no new sessions):
- The initial first-of-four reviewed visit offers the TXT button;
  downloaded filename and bytes match the date-only helper exactly.
- After selecting visit three-of-six, download again and compare
  byte-for-byte with the reviewed visit's verified clipboard
  payload plus the final newline. Ensure no other proposed visit,
  customer, job, resource or saved counts are included.
- Explicitly deny clipboard permission and verify Copy reports
  failure, points to TXT download, and downloading still works
  without requiring clipboard authorization.
- Off-plan and invalid/overflowed previews hide TXT together
  with the selected-visit panel; Compact view retains it.
- Existing checks for unchanged saved records, manual single
  Save/Cancel, mobile fit, accessibility, CSV/full-plan copy
  contracts and the fixed demo session cap remain unchanged.

## Merge gate
Keep **DRAFT / UNMERGED** until all five **final-head** jobs
pass: Foundation, PostgreSQL, Browser, Release install Ubuntu,
Release install Windows. Fix any failure **on this branch**,
rerun and verify all five. **Never auto-merge**.
