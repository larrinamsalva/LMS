# Daily Operations — shared per-summary appointment instant parsing (PR #178)

## Purpose

Daily Operations shows **two separate, read-only appointment lists** from
the same already-authorized workspace snapshot:

1. Appointments overlapping the selected business-local date.
2. Appointments starting within the next seven business-local dates.

Earlier merged changes (#174 and #175) optimized these lists separately,
using a per-summary cache for today's appointment starts and ends and a
second per-summary cache for upcoming appointment starts. Both were
parsing some of the **same saved string start timestamps**, independently,
during the same `summarizeDailyOperations` call.

PR #178 reuses the **existing** `dayInstant` string parser and
`Map<string, bigint>` in both appointment filters. This eliminates
the redundant second map and lets already parsed string instants be
reused between the daily and upcoming selection passes.

## Exact compatibility rules

- The temporary parser is created only after the snapshot has been
  filtered to the requested `organizationId` and non-archived records.
  It cannot cross organizations, dates, time zones, snapshots or calls.
- Both original entity and status exclusions stay in their respective
  filters. Cancelled or unrelated records are not parsed.
- The original selected-day **strict overlap** remains
  `start < until && end > from`, with
  `Temporal.PlainDate` business-local midnight boundaries.
- The upcoming window remains **start >= until && start < upcomingEnd**,
  using next-local-midnight through midnight on day +8.
  The same 23-hour/25-hour DST and leap-day boundaries remain.
- **String** inputs reuse their original
  `instant(value).epochNanoseconds` result, including valid zero
  nanosecond values. Invalid included strings continue to throw.
- **Non-string historical inputs are not cached**. The upcoming
  filter retains the old two-evaluation short circuit, preserving
  per-occurrence `String(value)` coercion and errors.
- The original `Temporal.Instant.compare` sort for each list is
  unchanged; source identity, stable tie order, duplicate IDs and
  duplicate object references remain intact.
- No saved data, appointment status, staff availability, bookings,
  business rules or authorization is changed.

## Regression verification

`tests/unit/daily-appointment-shared-instant-cache-parity.test.ts`
contains an **independent copy of the merged five-green #177
filters**, with separate original timestamp caches and sort comparators.

It compares **both selected-day and next-seven-day appointment
arrays**, including **exact returned record references, duplicate
occurrences, ordering and counts**, against the current implementation
over **720 fictional appointment revisions**, UTC, Los Angeles and
New York, fall-back clock repetition, spring-forward gaps, leap dates,
exact next-local-midnight boundaries, current/archived/cancelled/
foreign-organization records, and edits between calls.
Malformed excluded inputs and invalid included timestamps preserve
their original behavior.

These tests establish result parity, **not benchmarked speedup**.

## Non-goals and merge gate

No UI, CSV schema, database, API, migrations, releases, deployment,
MIT license, fictional no-login public demo, or other repositories
(including ForgeOS) are modified.

PR #178 remains **draft and unmerged** until all five
GitHub Actions jobs succeed on its **final head commit**:
Foundation, PostgreSQL, Browser, Release install Ubuntu, and
Release install Windows. Fix failures on this same PR branch.
Never auto-merge.
