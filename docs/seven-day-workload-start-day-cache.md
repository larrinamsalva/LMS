# Seven-day workload — repeated appointment start-day conversion (PR #173)

## Scope

The **read-only seven-day workload forecast** counts saved appointment
starts, unfinished jobs/tasks and upcoming equipment inspections on the
next seven **business-local calendar dates** after the selected date.
These counts are for planning, **not** staffing, equipment safety,
available hours, or booking capacity.

Previously, `sevenDayWorkload` converted every upcoming appointment's
scheduled start using `localDate(String(start), zone)`. Historical
appointments and revisions frequently share the **same string instant**.
The forecast now reuses the resulting business-local `YYYY-MM-DD`
date for identical string values within **one function invocation**.

* The in-memory cache is a temporary `Map<string, string>`. It does
  not persist between calls, zones, workspaces, or edits.
* **Non-string retained values are not cached** and undergo the original
  per-use `String(value)` conversion.
* The same `localDate` conversion and **original invalid-date errors**
  remain in force. No invented calendar dates or silent fallback are added.
* The seven-day window still uses `Temporal.PlainDate.add({ days })`,
  which correctly handles 23- and 25-hour DST transition days and leap
  days. Upcoming appointments are counted on their **saved start day**
  once per retained occurrence, not on every day that a shift overlaps.
* Unfinished work, equipment inspections, empty days, record ordering,
  archived/cancelled/foreign record exclusions, and existing
  seven-day CSV output stay unchanged.

## Regression tests

`tests/unit/seven-day-workload-start-day-cache-parity.test.ts`
includes an **independent copy of the previous five-green implementation**
and compares the exact seven day/count objects against the new function
for **720 fictional appointment records**, three time zones, multiple
selected dates, duplicate revision IDs and identical references, archived
and cancelled records, organization collisions, DST folds/spring shifts,
a leap day, due work and equipment inspection dates. Separate cases test
a changed start timestamp between calls and invalid non-string values.

These are output-parity tests, **not measured runtime benchmarks**.

## Safety

No persisted appointment, resource or workforce history; scheduling
permission or capacity; organization authorization; UI; CSV format;
API/database/migrations; release/deployment; MIT license; fictional
no-login public demo; or any other repository (including ForgeOS) is
changed. PR #173 must remain a draft until **Foundation, PostgreSQL,
Browser, Ubuntu install and Windows install** all pass on its final
head commit. Never merge automatically.
