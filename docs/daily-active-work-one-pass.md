# Daily Operations — classify active work once (PR #182)

## Purpose

The read-only Daily Operations overview uses the same authorized active jobs
and tasks for two queues: **Needs scheduling** (no saved due date) and
**Dated unfinished work** (saved `YYYY-MM-DD`-shaped due value).

Previously, each queue independently scanned every eligible active record,
reading either `data.date` for jobs or `data.due` for tasks. PR #182
examines the saved date value **once per active work occurrence**, adds the
record to either applicable result array, and then applies the **original
independent sorting comparators**.

This builds on merged #180, which already classifies the sorted dated-work
array into overdue, due-today and upcoming panels in one pass.

## Invariants

- Active work still comes from the **existing same-organization,
  non-archived** record filter, and includes only jobs/tasks whose
  saved status is not `Done`, `Completed`, or `Cancelled`.
- Needs scheduling still means `null`, `undefined`, or an **empty or
  whitespace-only string** saved date; no due date is invented.
- Dated work still requires a **string matching the exact original
  `YYYY-MM-DD` shape regular expression**. The optimization does not
  validate, normalize, or silently correct malformed calendar dates.
  Numeric and missing values remain excluded from dated work.
- The original `needsScheduling` title/ID sort and `unfinished`
  saved-due/title sort are **unchanged**. Equal-key ties retain their
  original source order, and duplicate IDs/retained object references
  remain distinct occurrences.
- The existing subsequent due-today, overdue, and next-seven-day
  classification remains unchanged. `Temporal.PlainDate` business-local
  boundaries, daylight-saving days, and leap-day handling are unaffected.
- Both result arrays and all read-only calculations are recreated for
  each summary; no data is mutated or persisted.

## Regression verification

`tests/unit/daily-active-work-one-pass-parity.test.ts` includes an
**independent reference of the original two scans and sorts from verified
five-green merged LMS #181**, followed by the unchanged one-pass due-date
section partition.

It compares **exact values, row order, source record identity, and
duplicate occurrences** across Needs scheduling, Due today, Overdue and
Upcoming for **720 fictional job/task revisions**, three business zones,
five selected dates, duplicate saved revisions, foreign and archived
records, completed/cancelled statuses, missing/blank/malformed/numeric
dates, same-title sorting ties, and live changes between invocations.

The checks establish **behavioral parity**, not a benchmarked speedup.

## Non-goals and merge gate

This PR changes only read-only Daily Operations classification:
no persisted jobs or tasks, due dates, user permissions, scheduling
or booking authority, UI, CSV schema, API/database/migrations,
releases/deployment, MIT license, fictional public no-login demo,
or any other repository (including ForgeOS) is modified.

PR #182 must remain **draft and unmerged** until the final head commit
has five successful CI checks: Foundation, PostgreSQL, Browser, Ubuntu
install and Windows install. Repair any failures on the **same PR
branch**. Never auto-merge.
