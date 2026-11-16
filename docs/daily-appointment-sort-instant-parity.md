# Daily Operations — reuse parsed appointment instants during sorting (PR #179)

## Purpose

The read-only Daily Operations summary shows two appointment lists:
appointments overlapping the selected business-local date and appointments
starting within the next seven business-local calendar dates. Both lists
are sorted by their saved scheduled start timestamp.

Previously, each filter parsed relevant appointment timestamps once per
authorized summary call, but the two `.sort()` comparators independently
called `Temporal.Instant.compare(instant(String(a.start)), instant(String(b.start)))`
**for every comparison**. For many appointments this repeated an expensive
timestamp parse during the sort, even though the same valid timestamp had
already been parsed for view selection.

PR #179 introduces one `compareAppointmentStarts` function used by
both lists. For **two string start values**, it reuses the existing
`dayInstant` per-summary cache from merged #178 and compares their exact
`epochNanoseconds`. For any comparator involving a **non-string**
historical value, it deliberately falls back to the original
`Temporal.Instant.compare` and independent per-comparison
`String(value)` conversion. Nothing persists between summary calls.

## Invariants

- Both appointment filters and their UTC/explicit-offset timestamp
  validation remain unchanged. The existing business-local
  `Temporal.PlainDate` boundaries still govern today's strict
  `start < midnightAfter && end > midnightBefore` overlap and
  the next-seven-day `start >= midnightAfter && start < dayPlusEight`
  range. Leap days, DST folds and DST gaps remain calendar-correct.
- For valid strings, comparing epoch nanoseconds yields the same
  -1/0/+1 ordering as `Temporal.Instant.compare`. Alternate
  string offsets representing **the same instant** still compare
  equal, preserving JavaScript's stable sort and the original order
  of duplicate and equal-time records.
- Non-string legacy values retain the original comparator and its
  thrown-error/coercion behavior. Valid strings are never normalized
  or rewritten, and neither sort changes the original records.
- Organization authorization, archived and cancelled record
  exclusions, record identity, retained duplicates, existing UI
  and CSV data remain unchanged. This change does not grant
  booking or staffing availability.

## Regression checks

`tests/unit/daily-appointment-sort-instant-parity.test.ts` contains
an **independent reference copied from verified merged #178**,
including the exact previous `Temporal.Instant.compare` sort
for **both** appointment views.

It verifies **exact returned record identities, ordering, counts,
and duplicate occurrences** across **720 fictional appointments**,
three business time zones, eight selected dates, both 01:30 DST
fold occurrences, spring transitions, leap days, same instants in
different UTC offset spellings, identical retained references,
cancelled/archived/foreign records, changes across summary calls,
invalid starts, and a legacy non-string start with valid coercion.

These are **semantic parity tests**, not a measured speed benchmark.

## Guardrails and merge gate

No persisted records, authorization, scheduling or booking authority,
equipment, staff availability, interface, CSV schema,
API/database/migrations, deployment/release, MIT license,
fictional no-login public demo or other repository (including ForgeOS)
is changed.

PR #179 stays **draft and unmerged** until all five final-head GitHub
checks succeed: Foundation, PostgreSQL, Browser, Release install Ubuntu,
and Release install Windows. Fix any failures on this same branch.
Never auto-merge.
