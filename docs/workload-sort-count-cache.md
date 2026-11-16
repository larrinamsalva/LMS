# Seven-day workload — cache activity counts during sorting (PR #183)

## Purpose

The read-only seven-day workload view can optionally order a business's
already-authorized day cards by **most recorded items** instead of
calendar date. Its `orderWorkloadDays` comparator previously called
`focusedRecordedItemCount` twice **on each comparison**, repeatedly
calculating the same saved-item count when a day is compared to many
others.

PR #183 caches each day object's focused count in a temporary
`Map<DailyWorkload, number>` **only for a single most-recorded sort**,
reusing that score as comparisons revisit the same date card.

## Exact compatibility

- **Calendar ordering** still sorts only ascending date strings. It
  does not build a count cache or inspect activity counts.
- **Most-recorded ordering** still uses the exact comparator:
  descending `focusedRecordedItemCount` followed by ascending
  `date.localeCompare` when counts tie.
- The count function is unchanged for all four activity focuses:
  `all`, `appointments`, `work`, and `inspections`.
  `includeInspections=false` continues to suppress inspection
  counts in both the `all` and `inspections` modes.
- The cache is keyed by a day **object reference**, not its date
  string: distinct cards with the same date but different saved
  counts remain distinct. Repeated occurrences of an identical
  reference remain in the sorted result, including equal-key ties.
- Each invocation creates a fresh cache. It cannot leak counts
  across changing input, activity mode, equipment toggle or business
  workspace. The caller's input array and day objects are not mutated.
- The function still returns a new array. No saved appointments,
  due work, inspections, actual capacity, staffing, customer records,
  booking decisions, CSV output or organization access are altered.

## Regression coverage

`tests/unit/workload-sort-count-cache-parity.test.ts` copies the
**original uncached comparator** from verified five-green merged
LMS #182, then checks exact **day-object references, ordering and
duplicate occurrences** against the updated implementation for
**720 fictional day cards** plus duplicates and same-date cards
with different counts.

It covers both sort modes, all four activity focuses,
both inspection-toggle settings, original and reversed input
order, equal scores and same-date ties, zero-activity days,
mutable values between calls, and calendar-only access behavior.

The parity tests do **not** claim measured performance gains.

## Merge gate

PR #183 must remain **draft and unmerged** until the final head
passes all five GitHub Actions checks: Foundation, PostgreSQL,
Browser, Release install Ubuntu, and Release install Windows.
If any check fails, repair **this branch** and recheck.
Never automatically merge.

No other repositories (including ForgeOS), schema/database,
migration, API, user interface, release, license or fictional
public no-login demo are modified.
