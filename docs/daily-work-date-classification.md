# Daily Operations — one-pass due-work classification (PR #180)

## Purpose

The read-only Daily Operations summary shows unfinished jobs and tasks
in three separate date sections: **overdue work**, **work due today**,
and **work due in the next seven business-local calendar dates**.

The existing implementation first builds and sorts the same authorized
`unfinished` array, then independently filters it three times
(`=== date`, `< date`, and `> date && <= upcomingThrough`).

PR #180 iterates that **already sorted** list once, pushing each
reference into the same date section using the **exact original
YYYY-MM-DD string comparisons**. This removes two additional scans
without changing any source or output data.

## Compatibility and privacy invariants

- The original snapshot organization filter excludes all foreign
  and archived records before any work classification. Only jobs
  and tasks that are **not** Done, Completed or Cancelled participate.
- The `needsScheduling` array and its title-and-ID sorting logic are
  **untouched**. Missing or blank due dates are not invented.
- The original `unfinished` flatMap and due-date/title sort are
  unchanged. The single classification pass preserves the existing
  **relative order** of every returned row, including identical
  due dates, equal titles, duplicate IDs, and repeated references.
- Each section uses the exact same lexical date conditions as
  previously. There is **no new date normalization or validation**;
  existing odd but syntactically shaped retained YYYY-MM-DD strings
  keep their prior classification and exclusion behavior.
- `upcomingThrough` still comes from
  `Temporal.PlainDate.add({ days: 7 })`, not a UTC 24-hour
  increment. Leap days and daylight-saving boundaries remain
  correct. Today is excluded from the future window.
- The three lists are **freshly built** for each summary, and
  no record, date, status or saved data is changed.

## Independent regression parity

`tests/unit/daily-operations-work-date-classification-parity.test.ts`
copies the **old three separate filter passes** from verified,
five-green merged LMS #179 and independently constructs its
original authorized and sorted work array.

It compares **the exact values, order, duplicate occurrences,
and record references** in all three date sections for **720
fictional job/task revisions**, several selected dates and three
business time zones. It covers active/finished statuses,
archived and foreign records, missing/blank/malformed dates,
same-title ties, leap days, seven-day boundaries, and edits
between summary calls. It also checks that the separate
`needsScheduling` result is unaffected.

These tests demonstrate **observable output parity**, not
benchmarked speed gains.

## Exclusions and merge gate

This is solely a read-only Daily Operations classification
optimization: no persisted records, scheduling/booking/staffing
authority, permissions or organization boundaries, UI,
CSV schema, API/database/migrations, release/deployment,
MIT license, fictional public no-login demo or other
repository (including ForgeOS) is modified.

**PR #180 remains a draft and unmerged** until all five CI
checks pass on its final head SHA: Foundation, PostgreSQL,
Browser, Release install Ubuntu, and Release install Windows.
Repair failures on the same branch and never auto-merge.
