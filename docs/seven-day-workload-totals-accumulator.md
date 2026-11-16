# Seven-day workload — one temporary totals accumulator (PR #184)

## Purpose

The seven-day workload overview summarizes the already-authorized
business-local date cards into five counts: **appointments**,
**unfinished work**, **inspections**, **days with recorded activity**,
and **days in the window**.

The existing `summarizeSevenDayWorkload` function used `Array.reduce`
but allocated a **new five-field totals object for every date**.
PR #184 continues using `Array.reduce`, while updating a single
fresh accumulator for that invocation. The same five counters and
conditional-inspection rules remain intact.

## Compatibility and privacy

- The original `appointments` and `unfinishedWork` arithmetic is
  preserved. The `inspections` total includes saved inspection items
  only when `includeInspections=true`.
- `daysWithActivity` still counts a day when any enabled category has
  a positive saved count; disabled equipment does not create activity.
  `daysInWindow` still counts the supplied recorded day entries.
- `Array.reduce` is retained, so uncommon sparse input arrays continue
  to **skip missing slots** just as before. Identical day references
  occurring multiple times still count once per occurrence.
- The initial totals object is constructed anew for each call.
  The caller's array and day objects are not mutated, and no totals,
  organization data, time zone, activity mode, or equipment setting
  is cached across calls.
- No booking, labor-hour, staffing capacity, equipment safety, job
  scheduling, authorization, or business decision is inferred from
  a count. This remains **read-only presentation data**.

## Regression coverage

`tests/unit/workload-summary-single-accumulator-parity.test.ts`
contains an independent copy of the original **allocating reduce**
from verified five-green merged LMS #183.

It compares the entire returned five-counter object for **720
fictional day cards**, additional repeated references, reversed
and shorter arrays, empty inputs, both equipment inclusion settings,
active/empty day mixtures, unusual sparse arrays, and seven-day
workloads generated from already authorized business-local views
during daylight-saving and leap-day dates.

These checks verify **observable result parity**. This PR does not
claim a benchmarked performance gain.

## Merge gate and excluded areas

PR #184 must remain **draft and unmerged** until its final head
commit passes Foundation, PostgreSQL, Browser, Release install Ubuntu,
and Release install Windows. Fix any failure on the same PR branch.
Never auto-merge.

No persisted records, organization access rules, user interface,
CSV schemas, API/database/migrations, release/deployment,
MIT license, fictional public no-login demo, or other repositories
(including ForgeOS) are modified.
