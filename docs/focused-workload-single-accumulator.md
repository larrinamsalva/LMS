# Focused workload — one temporary totals accumulator (PR #185)

## Purpose

The authorized seven-day workload view supports four saved-item
focuses: **all recorded items**, **appointments**, **unfinished
work**, and **upcoming equipment inspections**. The
`summarizeFocusedWorkload` helper produces three presentation-only
counts: **savedItems**, **matchingDays**, and **daysInWindow**.

Previously, the function used `Array.reduce` but created a
new three-field result object for every included day. PR #185
continues using `Array.reduce`, updating one newly created
private totals object for that call. It retains the original
`focusedRecordedItemCount` calculation for every day.

## Compatibility and safety invariants

- All four activity focuses continue to use the original
  `focusedRecordedItemCount` implementation without
  reinterpreting saved records.
- Inspection counts contribute to the `all` or `inspections`
  focus **only if** `includeInspections=true`; disabled equipment
  cannot create matching days or saved items.
- `matchingDays` still increments if and only if the focused
  recorded item count is strictly positive. The days-in-window
  count still increments per processed date-card entry.
- `Array.reduce` is preserved, including skipping sparse array
  slots, counting identical references each time they occur,
  and producing zero totals for empty arrays.
- A new accumulator is created per invocation. The caller's
  original day records, date values, references, and array
  are not mutated. No global or cross-workspace cache exists.
- These are saved-record **planning counts**, not booked staff
  hours, availability, equipment safety, urgency or capacity
  estimates. No organization-level authorization or decision
  making is changed.

## Regression coverage

`tests/unit/focused-workload-single-accumulator-parity.test.ts`
contains an independent reference of the original **allocating
reduce from verified five-green merged #184**.

It checks complete three-field parity against the old implementation
over **720 fictional day cards**, duplicate references, reversed
input, short and empty weeks, sparse arrays, changing inputs between
calls, all four focuses and both inspection toggle settings.

It also compares totals on real authorized seven-day summaries
across fall daylight-saving boundaries and leap dates, including
fictional archived and foreign organization records excluded
upstream. Exact counts and input immutability have explicit tests.

The tests establish **behavioral parity**, not a benchmarked
performance gain.

## Non-goals and merge gate

Read-only presentation optimization only. No persisted appointment,
job, task, or equipment data, booking/staffing authority, access
control, UI, CSV schemas, API/database/migrations, release/deployment,
MIT license, fictional public no-login demo, or other repository
(including ForgeOS) is modified.

PR #185 remains **draft and unmerged** until five checks pass on
its final head SHA: Foundation, PostgreSQL, Browser, Ubuntu
install and Windows install. Fix any failure on this same branch.
Never auto-merge.
